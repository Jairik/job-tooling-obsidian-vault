/* Bun server that serves the React app and its JSON/SSE API. */
import index from "./src/index.html";
import { generate, followUp, cleanup, cancel, loadSessions, summarize, autoPlace, fillinScan, fillinWrite, writeCleanup, generateSkill, docPropose } from "./agent/runner";
import { detectSkills, listSkills, createSkill } from "./agent/skills";
import { geminiAvailable, cliAvailable } from "./agent/gemini";
import { readLogs, appendLog, clearLogs } from "./agent/logs";
import { fetchUsageForTarget } from "./agent/usage";
import { resolveWebPage } from "./agent/web";
import { extractDocument, MAX_UPLOAD_BYTES } from "./agent/documents";
import { saveAttachment, getAttachment, deleteAttachment, resolveAttachments, sweepAttachments } from "./agent/attachments";
import { compileLatex, getCompiled, stripTexFences, tectonicAvailable, tectonicInstallHint } from "./agent/latex";
import { loadConfig, saveConfig, defaultSettings, mergeServerSettings, MODELS, ENGINES, DEFAULT_VAULT, type ServerSettings } from "./agent/config";
import { effectiveEngineModel } from "./shared/settings";
import { stat } from "fs/promises";

const PORT = Number(process.env.PORT || 5173);
const DEV = process.env.NODE_ENV !== "production";

await loadSessions();
sweepAttachments().catch(() => {});

// One-time write-approval tokens: minted by /api/vault/preview, consumed by
// /api/vault/write. Their existence is what makes user approval mandatory — no
// code path can reach a disk write without having surfaced a preview first.
const WRITE_TOKEN_TTL_MS = 10 * 60 * 1000;
const writeTokens = new Map<string, { path: string; expires: number }>();

/* Mints a one-time approval token for a vault-relative path. */
function mintWriteToken(path: string): string {
  const now = Date.now();
  for (const [token, entry] of writeTokens) {
    if (entry.expires < now) writeTokens.delete(token);
  }
  const token = crypto.randomUUID();
  writeTokens.set(token, { path, expires: now + WRITE_TOKEN_TTL_MS });
  return token;
}

/* Resolves a vault-relative path, or null when it escapes the vault. */
async function resolveVaultPath(filePath: string): Promise<string | null> {
  const config = await loadConfig();
  const { join, resolve } = await import("path");
  const fullPath = join(config.vaultDir, filePath);
  if (!resolve(fullPath).startsWith(resolve(config.vaultDir))) return null;
  return fullPath;
}

/*
 * Wraps a streaming job in a Server-Sent Events response.
 * `emit` serializes named events while keeping a broken client connection harmless.
 */
function sse(handler: (emit: (event: string, data: unknown) => void) => Promise<void>): Response {
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      const emit = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      try {
        await handler(emit);
      } catch (err: any) {
        emit("error", { message: err?.message ? String(err.message) : String(err) });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

/* Merges persisted configuration with a tab-specific client override. */
async function resolveSettings(override: Partial<ServerSettings> | undefined): Promise<ServerSettings> {
  const global = await loadConfig();
  const merged = mergeServerSettings(global, override);
  if (!merged.vaultDir) merged.vaultDir = DEFAULT_VAULT;
  return merged;
}

/* Converts a client-supplied usage target into a known engine id. */
function usageEngine(value: string | null, fallback: ServerSettings["engine"]): ServerSettings["engine"] {
  return ENGINES.some((engine) => engine.id === value) ? (value as ServerSettings["engine"]) : fallback;
}

const server = Bun.serve({
  port: PORT,
  development: DEV,
  idleTimeout: 0, // keep SSE streams open for long generations

  routes: {
    "/": index,

    /* Supplies static UI metadata without exposing server-only configuration. */
    "/api/meta": () =>
      Response.json({ models: MODELS, engines: ENGINES, defaults: defaultSettings(DEFAULT_VAULT) }),

    /* Reads and partially updates durable application settings. */
    "/api/config": {
      GET: async () => Response.json(await loadConfig()),
      POST: async (req) => {
        const patch = await req.json();
        return Response.json(await saveConfig(patch));
      },
    },

    // Durable activity log, persisted to a local (gitignored) file. The UI keeps
    // its own localStorage copy; GET hydrates from disk, POST appends one entry,
    // DELETE clears the file.
    "/api/logs": {
      GET: async () => Response.json(await readLogs()),
      POST: async (req) => {
        await appendLog(await req.json());
        return Response.json({ ok: true });
      },
      DELETE: async () => {
        await clearLogs();
        return Response.json({ ok: true });
      },
    },

    // Current usage for the selected engine/model when a compatible provider exists.
    "/api/usage": async (req) => {
      const settings = await loadConfig();
      const url = new URL(req.url);
      const engine = usageEngine(url.searchParams.get("engine"), settings.engine);
      const model = url.searchParams.has("model")
        ? url.searchParams.get("model") ?? ""
        : effectiveEngineModel(settings, engine);
      return Response.json(await fetchUsageForTarget({ engine, model }));
    },

    "/api/skills/status": async (req) => {
      const url = new URL(req.url);
      const vault = url.searchParams.get("vault") || (await loadConfig()).vaultDir;
      const skills = await detectSkills(vault);
      return Response.json({
        ...skills,
        gemini: geminiAvailable(),
        opencode: cliAvailable("opencode"),
        cursor: cliAvailable("cursor"),
        copilot: cliAvailable("copilot"),
        codex: cliAvailable("codex"),
      });
    },

    // Full list of installed skills (user + vault scope) for the skill picker.
    "/api/skills/list": async (req) => {
      const url = new URL(req.url);
      const vault = url.searchParams.get("vault") || (await loadConfig()).vaultDir;
      return Response.json(await listSkills(vault));
    },

    // Author (or rewrite) a SKILL.md from a plain-language description, using the
    // bundled skill-creator guide. Streams the document as it is written; the final
    // event carries the parsed name/description/body for the Settings form to edit.
    // Cancellable via /api/tabs/__skill_creator__/cancel (the reserved id below).
    "/api/skills/generate": {
      POST: async (req) => {
        const body = await req.json();
        const settings = await resolveSettings(undefined);
        const current =
          body.current && typeof body.current === "object"
            ? {
                name: String(body.current.name ?? ""),
                description: String(body.current.description ?? ""),
                body: String(body.current.body ?? ""),
              }
            : undefined;
        return sse((emit) =>
          generateSkill(
            "__skill_creator__",
            {
              description: typeof body.description === "string" ? body.description : "",
              current,
              feedback: typeof body.feedback === "string" ? body.feedback : undefined,
              settings,
            },
            emit
          )
        );
      },
    },

    // Scaffold a new skill (SKILL.md) from the Settings "Add skill" form.
    "/api/skills/create": {
      POST: async (req) => {
        const body = await req.json();
        const vaultDir = (await loadConfig()).vaultDir;
        const res = await createSkill({
          name: body.name || "",
          description: body.description || "",
          body: body.body || "",
          scope: body.scope === "vault" ? "vault" : "user",
          vaultDir,
        });
        return Response.json(res, { status: res.ok ? 200 : 400 });
      },
    },

    // Checks whether a selected directory is usable as a vault and reports its
    // top-level context folders (any user's vault layout — no fixed structure).
    "/api/vault/validate": async (req) => {
      const path = new URL(req.url).searchParams.get("path") || "";
      const SKIP = new Set([".git", ".obsidian", "node_modules", ".trash"]);
      try {
        const s = await stat(path);
        if (!s.isDirectory()) {
          return Response.json({ valid: false, isDir: false, foundDirs: [], message: "Not a directory" });
        }
        const { readdirSync } = await import("fs");
        const foundDirs = readdirSync(path, { withFileTypes: true })
          .filter((ent) => ent.isDirectory() && !SKIP.has(ent.name) && !ent.name.startsWith("."))
          .map((ent) => ent.name)
          .sort((a, b) => a.localeCompare(b));
        return Response.json({ valid: true, isDir: true, foundDirs });
      } catch {
        return Response.json({ valid: false, isDir: false, foundDirs: [], message: "Path not found" });
      }
    },

    "/api/tabs/:id/generate": {
      POST: async (req) => {
        const body = await req.json();
        const settings = await resolveSettings(body.settings);
        // Attachments are stored server-side by upload id; resolve them to text
        // here so the model never spends a turn parsing documents itself.
        const attachmentIds = Array.isArray(body.attachmentIds) ? body.attachmentIds.filter((x: unknown) => typeof x === "string") : [];
        const { docs, missing } = await resolveAttachments(attachmentIds);
        return sse((emit) => {
          if (missing.length) {
            emit("notice", {
              message: `${missing.length} attached document${missing.length === 1 ? " is" : "s are"} no longer available and ${missing.length === 1 ? "was" : "were"} skipped — re-attach ${missing.length === 1 ? "it" : "them"}.`,
            });
          }
          return generate(
            req.params.id,
            {
              jobDescription: body.jobDescription || "",
              question: body.question || "",
              skills: Array.isArray(body.skills) ? body.skills : [],
              rag: Boolean(body.rag),
              mode: body.mode === "job" ? "job" : "ask",
              extraContext: typeof body.extraContext === "string" ? body.extraContext : "",
              attachedDocs: docs,
              latex: Boolean(body.latex),
              settings,
            },
            emit
          );
        });
      },
    },

    "/api/tabs/:id/message": {
      POST: async (req) => {
        const body = await req.json();
        const settings = await resolveSettings(body.settings);
        return sse((emit) =>
          followUp(
            req.params.id,
            { text: body.text || "", skills: Array.isArray(body.skills) ? body.skills : [], rag: Boolean(body.rag), mode: body.mode === "job" ? "job" : "ask", latex: Boolean(body.latex), settings },
            emit
          )
        );
      },
    },

    "/api/tabs/:id/cleanup": {
      POST: async (req) => {
        const body = await req.json();
        const settings = await resolveSettings(body.settings);
        return sse((emit) => cleanup(req.params.id, { text: body.text || "", skills: Array.isArray(body.skills) ? body.skills : [], latex: Boolean(body.latex), settings }, emit));
      },
    },

    "/api/tabs/:id/cancel": {
      POST: (req) => {
        cancel(req.params.id);
        return Response.json({ ok: true });
      },
    },

    // ── Vault Writer endpoints ──────────────────────────────────────────────

    "/api/tabs/:id/summarize": {
      POST: async (req) => {
        const body = await req.json();
        const settings = await resolveSettings(body.settings);
        return sse((emit) => summarize(req.params.id, { input: body.input, isUrl: body.isUrl ?? false, skills: Array.isArray(body.skills) ? body.skills : [], settings }, emit));
      },
    },

    "/api/tabs/:id/auto-place": {
      POST: async (req) => {
        const body = await req.json();
        const settings = await resolveSettings(body.settings);
        return sse((emit) => autoPlace(req.params.id, { content: body.content, settings }, emit));
      },
    },

    "/api/tabs/:id/fillin-scan": {
      POST: async (req) => {
        const body = await req.json();
        const settings = await resolveSettings(body.settings);
        return sse((emit) => fillinScan(req.params.id, { prompt: body.prompt, dir: body.dir, settings }, emit));
      },
    },

    "/api/tabs/:id/fillin-write": {
      POST: async (req) => {
        const body = await req.json();
        const settings = await resolveSettings(body.settings);
        return sse((emit) => fillinWrite(req.params.id, {
          question: body.question,
          answer: body.answer,
          targetPath: body.targetPath,
          skills: Array.isArray(body.skills) ? body.skills : [],
          settings,
        }, emit));
      },
    },

    // Analyze an uploaded document (by attachment id) and propose vault writes.
    "/api/tabs/:id/doc-propose": {
      POST: async (req) => {
        const body = await req.json();
        const settings = await resolveSettings(body.settings);
        const attachment = typeof body.attachmentId === "string" ? await getAttachment(body.attachmentId) : undefined;
        return sse((emit) => {
          if (!attachment) {
            emit("error", { message: "The uploaded document is no longer available — upload it again." });
            return Promise.resolve();
          }
          return docPropose(
            req.params.id,
            { docText: attachment.text, focus: typeof body.focus === "string" ? body.focus : undefined, settings },
            emit
          );
        });
      },
    },

    "/api/tabs/:id/write-cleanup": {
      POST: async (req) => {
        const body = await req.json();
        const settings = await resolveSettings(body.settings);
        return sse((emit) => writeCleanup(req.params.id, { text: body.text, skills: Array.isArray(body.skills) ? body.skills : [], settings }, emit));
      },
    },

    // Approval step 1: reports whether the target exists (with its current
    // content, for a diff) and mints the one-time token that /api/vault/write
    // requires. Every vault write therefore passes through a surfaced preview.
    "/api/vault/preview": {
      POST: async (req) => {
        const body = await req.json();
        const filePath = body?.path;
        if (!filePath || typeof filePath !== "string") {
          return Response.json({ ok: false, error: "Missing path" }, { status: 400 });
        }
        const fullPath = await resolveVaultPath(filePath);
        if (!fullPath) {
          return Response.json({ ok: false, error: "Path escapes vault directory" }, { status: 400 });
        }
        let exists = false;
        let existingContent = "";
        let tooLarge = false;
        try {
          const s = await stat(fullPath);
          exists = s.isFile();
          if (exists) {
            if (s.size > 512 * 1024) tooLarge = true;
            else existingContent = await Bun.file(fullPath).text();
          }
        } catch {
          /* new file */
        }
        return Response.json({ ok: true, path: filePath, exists, existingContent, tooLarge, token: mintWriteToken(filePath) });
      },
    },

    "/api/vault/write": {
      POST: async (req) => {
        const body = await req.json();
        const { path: filePath, content, token } = body;
        if (!filePath || typeof filePath !== "string") {
          return Response.json({ ok: false, error: "Missing path" }, { status: 400 });
        }
        // Mandatory approval: the token proves a preview for this exact path was
        // surfaced to the user. Consumed before writing (one-time use).
        const entry = typeof token === "string" ? writeTokens.get(token) : undefined;
        if (!entry) {
          return Response.json({ ok: false, error: "Write not approved — request a preview first." }, { status: 403 });
        }
        writeTokens.delete(token);
        if (entry.path !== filePath || entry.expires < Date.now()) {
          return Response.json({ ok: false, error: "Approval token expired or path mismatch — re-approve the write." }, { status: 403 });
        }
        const fullPath = await resolveVaultPath(filePath);
        if (!fullPath) {
          return Response.json({ ok: false, error: "Path escapes vault directory" }, { status: 400 });
        }
        const { dirname } = await import("path");
        const { mkdir, writeFile } = await import("fs/promises");
        await mkdir(dirname(fullPath), { recursive: true });
        await writeFile(fullPath, content, "utf8");
        return Response.json({ ok: true, path: filePath });
      },
    },

    // ── Document attachments (extracted server-side, stored by upload id) ────

    "/api/attachments": {
      POST: async (req) => {
        let form: FormData;
        try {
          form = await req.formData();
        } catch {
          return Response.json({ ok: false, error: "Expected multipart form data with a `file` field." }, { status: 400 });
        }
        const file = form.get("file");
        if (!(file instanceof File)) {
          return Response.json({ ok: false, error: "Missing `file` field." }, { status: 400 });
        }
        if (file.size > MAX_UPLOAD_BYTES) {
          return Response.json({ ok: false, error: `File too large (max ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB).` }, { status: 400 });
        }
        try {
          const extracted = await extractDocument(file.name, await file.arrayBuffer());
          const meta = await saveAttachment(file.name, file.size, extracted);
          return Response.json({ ok: true, ...meta });
        } catch (e: any) {
          return Response.json({ ok: false, error: String(e?.message || e) }, { status: 400 });
        }
      },
    },

    "/api/attachments/:id": {
      GET: async (req) => {
        const record = await getAttachment(req.params.id);
        if (!record) return Response.json({ ok: false }, { status: 404 });
        const { id, name, size, chars, truncated } = record;
        return Response.json({ ok: true, id, name, size, chars, truncated });
      },
      DELETE: async (req) => {
        await deleteAttachment(req.params.id);
        return Response.json({ ok: true });
      },
    },

    // ── LaTeX output ──────────────────────────────────────────────────────────

    // Synchronous compile used by manual edits / recompiles; generation-time
    // compiles run inside the SSE pipeline (agent/runner.ts finishLatex).
    "/api/latex/compile": {
      POST: async (req) => {
        const body = await req.json();
        const tex = typeof body.tex === "string" ? stripTexFences(body.tex) : "";
        if (!tex) return Response.json({ ok: false, error: "Missing tex source" }, { status: 400 });
        if (!tectonicAvailable()) {
          return Response.json({ ok: false, error: "tectonic is not installed", hint: tectonicInstallHint() }, { status: 503 });
        }
        const result = await compileLatex(tex);
        if (!result.ok) {
          return Response.json({ ok: false, error: "Compilation failed", log: result.log }, { status: 422 });
        }
        return Response.json({ ok: true, compileId: result.compileId, pdfUrl: `/api/latex/${result.compileId}/pdf` });
      },
    },

    "/api/latex/:id/pdf": {
      GET: async (req) => {
        const doc = getCompiled(req.params.id);
        if (!doc) return new Response("PDF not found — recompile the document.", { status: 404 });
        return new Response(Bun.file(doc.pdfPath), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="document.pdf"`,
            "Cache-Control": "no-store",
          },
        });
      },
    },

    "/api/fetch-url": {
      POST: async (req) => {
        const body = await req.json();
        const { url, method } = body;
        if (!url || typeof url !== "string") {
          return Response.json({ text: "", title: "", error: "Missing URL" }, { status: 400 });
        }
        try {
          // Resolve on the server so both URL imports and agent reads share the
          // same bounded extraction, redirect validation, and SSRF protections.
          const page = await resolveWebPage(url, method);
          return Response.json(page);
        } catch (e: any) {
          return Response.json({ text: "", title: "", error: String(e?.message || e) }, { status: 400 });
        }
      },
    },

    "/api/vault/tree": {
      GET: async (req) => {
        const url = new URL(req.url);
        const vaultPath = url.searchParams.get("path") || (await loadConfig()).vaultDir;
        const { readdirSync } = await import("fs");
        const { join } = await import("path");
        const SKIP = new Set([".git", ".obsidian", "node_modules", ".trash"]);

        interface TreeNode { name: string; path: string; children?: TreeNode[]; isFile?: boolean }

        function buildTree(dir: string, rel: string, depth: number): TreeNode[] {
          if (depth > 4) return [];
          const nodes: TreeNode[] = [];
          try {
            for (const ent of readdirSync(dir, { withFileTypes: true })) {
              if (SKIP.has(ent.name) || ent.name.startsWith(".")) continue;
              const entRel = rel ? `${rel}/${ent.name}` : ent.name;
              if (ent.isDirectory()) {
                nodes.push({ name: ent.name, path: entRel, children: buildTree(join(dir, ent.name), entRel, depth + 1) });
              }
            }
          } catch { /* skip unreadable */ }
          return nodes.sort((a, b) => a.name.localeCompare(b.name));
        }

        return Response.json(buildTree(vaultPath, "", 0));
      },
    },
  },

  error(err) {
    console.error(err);
    return new Response(`Server error: ${err?.message ?? err}`, { status: 500 });
  },
});

console.log(`\n  Vault Assistant → http://localhost:${server.port}\n`);

/* Bun server that serves the React app and its JSON/SSE API. */
import index from "./src/index.html";
import { generate, followUp, cleanup, cancel, loadSessions, summarize, autoPlace, fillinScan, fillinWrite, writeCleanup, generateSkill } from "./agent/runner";
import { detectSkills, listSkills, createSkill } from "./agent/skills";
import { geminiAvailable, cliAvailable } from "./agent/gemini";
import { readLogs, appendLog, clearLogs } from "./agent/logs";
import { fetchClaudeUsage } from "./agent/usage";
import { resolveWebPage } from "./agent/web";
import { loadConfig, saveConfig, defaultSettings, mergeServerSettings, MODELS, ENGINES, DEFAULT_VAULT, type ServerSettings } from "./agent/config";
import { stat } from "fs/promises";

const PORT = Number(process.env.PORT || 5173);
const DEV = process.env.NODE_ENV !== "production";

await loadSessions();

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

    // Current Claude Code subscription usage (the data the CLI's /usage shows).
    "/api/usage": async () => Response.json(await fetchClaudeUsage()),

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
        return sse((emit) =>
          generate(
            req.params.id,
            {
              jobDescription: body.jobDescription || "",
              question: body.question || "",
              skills: Array.isArray(body.skills) ? body.skills : [],
              rag: Boolean(body.rag),
              mode: body.mode === "job" ? "job" : "ask",
              settings,
            },
            emit
          )
        );
      },
    },

    "/api/tabs/:id/message": {
      POST: async (req) => {
        const body = await req.json();
        const settings = await resolveSettings(body.settings);
        return sse((emit) =>
          followUp(
            req.params.id,
            { text: body.text || "", skills: Array.isArray(body.skills) ? body.skills : [], rag: Boolean(body.rag), mode: body.mode === "job" ? "job" : "ask", settings },
            emit
          )
        );
      },
    },

    "/api/tabs/:id/cleanup": {
      POST: async (req) => {
        const body = await req.json();
        const settings = await resolveSettings(body.settings);
        return sse((emit) => cleanup(req.params.id, { text: body.text || "", skills: Array.isArray(body.skills) ? body.skills : [], settings }, emit));
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

    "/api/tabs/:id/write-cleanup": {
      POST: async (req) => {
        const body = await req.json();
        const settings = await resolveSettings(body.settings);
        return sse((emit) => writeCleanup(req.params.id, { text: body.text, skills: Array.isArray(body.skills) ? body.skills : [], settings }, emit));
      },
    },

    "/api/vault/write": {
      POST: async (req) => {
        const body = await req.json();
        const { path: filePath, content } = body;
        if (!filePath || typeof filePath !== "string") {
          return Response.json({ ok: false, error: "Missing path" }, { status: 400 });
        }
        const config = await loadConfig();
        const { join, dirname, resolve } = await import("path");
        const { mkdir, writeFile } = await import("fs/promises");
        const fullPath = join(config.vaultDir, filePath);
        // Safety: ensure the resolved path is within the vault.
        if (!resolve(fullPath).startsWith(resolve(config.vaultDir))) {
          return Response.json({ ok: false, error: "Path escapes vault directory" }, { status: 400 });
        }
        await mkdir(dirname(fullPath), { recursive: true });
        await writeFile(fullPath, content, "utf8");
        return Response.json({ ok: true, path: filePath });
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

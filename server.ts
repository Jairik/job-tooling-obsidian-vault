// Bun full-stack server: serves the React app (src/index.html) and a small
// JSON + SSE API that drives Claude Code instances per tab.
import index from "./src/index.html";
import { generate, followUp, cleanup, cancel, loadSessions, summarize, autoPlace, fillinScan, fillinWrite, writeCleanup } from "./agent/runner";
import { detectSkills } from "./agent/skills";
import { geminiAvailable, cliAvailable } from "./agent/gemini";
import { loadConfig, saveConfig, defaultSettings, MODELS, ENGINES, DEFAULT_VAULT, type Settings } from "./agent/config";
import { stat } from "fs/promises";
import { join } from "path";

const PORT = Number(process.env.PORT || 5173);
const DEV = process.env.NODE_ENV !== "production";

await loadSessions();

// Wrap a streaming handler in an SSE Response. The handler receives `emit`.
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

// Merge global config with a per-request settings override coming from the client.
async function resolveSettings(override: Partial<Settings> | undefined): Promise<Settings> {
  const global = await loadConfig();
  const merged = { ...global, ...(override || {}) } as Settings;
  if (!merged.vaultDir) merged.vaultDir = DEFAULT_VAULT;
  return merged;
}

const server = Bun.serve({
  port: PORT,
  development: DEV,
  idleTimeout: 0, // keep SSE streams open for long generations

  routes: {
    "/": index,

    "/api/meta": () =>
      Response.json({ models: MODELS, engines: ENGINES, defaults: defaultSettings(DEFAULT_VAULT) }),

    "/api/config": {
      GET: async () => Response.json(await loadConfig()),
      POST: async (req) => {
        const patch = await req.json();
        return Response.json(await saveConfig(patch));
      },
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
      });
    },

    "/api/vault/validate": async (req) => {
      const path = new URL(req.url).searchParams.get("path") || "";
      const known = [
        "JJ-master",
        "JJ-master/Projects",
        "JJ-master/Background",
        "JJ-master/Leadership-Examples",
        "JJ-master/Personal-Skills",
        "JJ-master/QnA",
      ];
      try {
        const s = await stat(path);
        if (!s.isDirectory()) {
          return Response.json({ valid: false, isDir: false, foundDirs: [], message: "Not a directory" });
        }
        const foundDirs: string[] = [];
        for (const d of known) {
          try {
            if ((await stat(join(path, d))).isDirectory()) foundDirs.push(d);
          } catch {
            /* missing */
          }
        }
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
              yc: Boolean(body.yc),
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
            { text: body.text || "", rag: Boolean(body.rag), mode: body.mode === "job" ? "job" : "ask", settings },
            emit
          )
        );
      },
    },

    "/api/tabs/:id/cleanup": {
      POST: async (req) => {
        const body = await req.json();
        const settings = await resolveSettings(body.settings);
        return sse((emit) => cleanup(req.params.id, { text: body.text || "", settings }, emit));
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
        return sse((emit) => summarize(req.params.id, { input: body.input, isUrl: body.isUrl ?? false, settings }, emit));
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
          settings,
        }, emit));
      },
    },

    "/api/tabs/:id/write-cleanup": {
      POST: async (req) => {
        const body = await req.json();
        const settings = await resolveSettings(body.settings);
        return sse((emit) => writeCleanup(req.params.id, { text: body.text, settings }, emit));
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
        const { url } = body;
        if (!url || typeof url !== "string") {
          return Response.json({ text: "", title: "", error: "Missing URL" }, { status: 400 });
        }
        try {
          const res = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; VaultAssistant/1.0)" },
            redirect: "follow",
          });
          const html = await res.text();
          // Basic HTML to text extraction.
          const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
          const title = titleMatch ? titleMatch[1].trim() : "";
          // Strip tags, decode entities, collapse whitespace.
          const text = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 50000);
          return Response.json({ text, title });
        } catch (e: any) {
          return Response.json({ text: "", title: "", error: e.message }, { status: 500 });
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

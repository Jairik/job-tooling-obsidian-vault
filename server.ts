// Bun full-stack server: serves the React app (src/index.html) and a small
// JSON + SSE API that drives Claude Code instances per tab.
import index from "./src/index.html";
import { generate, followUp, cancel, loadSessions } from "./agent/runner";
import { detectSkills } from "./agent/skills";
import { geminiAvailable } from "./agent/gemini";
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
      return Response.json({ ...skills, gemini: geminiAvailable() });
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
          followUp(req.params.id, { text: body.text || "", rag: Boolean(body.rag), settings }, emit)
        );
      },
    },

    "/api/tabs/:id/cancel": {
      POST: (req) => {
        cancel(req.params.id);
        return Response.json({ ok: true });
      },
    },
  },

  error(err) {
    console.error(err);
    return new Response(`Server error: ${err?.message ?? err}`, { status: 500 });
  },
});

console.log(`\n  Job Tooling → http://localhost:${server.port}\n`);

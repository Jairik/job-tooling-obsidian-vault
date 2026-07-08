/*
 * Lifecycle for the persistent `opencode serve` process backing the OpenCode SDK
 * transport. Unlike Codex's SDK (a thin per-turn CLI wrapper), OpenCode's SDK is an
 * HTTP client for a long-lived server, so the server process and its single shared
 * event subscription are owned here and reused across turns instead of being
 * recreated per turn.
 *
 * Safety: `opencode run --pure` (the legacy transport) does not disable tools; it
 * only disables external plugins. The real safety boundary here is a deny-all
 * permission/tools config passed at server start, verified against the installed
 * SDK/server source to resolve tool-permission checks synchronously (no live "ask"
 * event, no hang risk) rather than relying on directory-scoping alone.
 *
 * Directory note (verified live, not assumed): opencode's `event.subscribe()` only
 * delivers session-scoped events (message/session updates) to subscribers whose
 * `query.directory` matches; a session is permanently bound to whatever directory
 * it was created with, and querying it under a different directory later (e.g. a
 * fresh per-turn temp dir on a resumed session) silently receives no events at
 * all. So, unlike Codex's per-turn temp directory, every opencode session/prompt/
 * subscribe call in this transport shares one sandbox directory created once for
 * the life of the server. That's safe here specifically because the deny-all
 * config above already guarantees no tool ever reads or writes it: the directory
 * is defense-in-depth on top of "no tool access", not a per-turn isolation
 * boundary, so reusing one empty directory across turns/sessions doesn't weaken
 * anything.
 */
import { rmSync } from "fs";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

/* Tool ids the running opencode server understands (bash/glob/read/... plus the
 * newer permission categories); denying all of them means nothing is ever offered
 * to or executed by the model, so vault context stays prompt-injected only. */
const OPENCODE_TOOL_IDS = [
  "bash",
  "glob",
  "read",
  "grep",
  "webfetch",
  "write",
  "edit",
  "task",
  "apply_patch",
  "todowrite",
  "question",
  "skill",
  "execute",
];

/* Belt-and-suspenders per-request tool disable map, layered on top of the server's
 * own deny-all permission config below. */
export const OPENCODE_DISABLED_TOOLS: Record<string, boolean> = Object.fromEntries(
  OPENCODE_TOOL_IDS.map((id) => [id, false])
);

/* Server-level config: denies every known permission category up front so tool
 * calls are rejected synchronously instead of falling through to the default
 * "ask" behavior, which awaits a reply that never comes in this headless setup. */
function denyAllConfig(): Record<string, unknown> {
  const denyAll: Record<string, string> = {};
  for (const id of [...OPENCODE_TOOL_IDS, "doom_loop", "external_directory", "websearch", "lsp"]) {
    denyAll[id] = "deny";
  }
  return { permission: denyAll, tools: OPENCODE_DISABLED_TOOLS };
}

interface OpenCodeServerHandle {
  baseUrl: string;
  client: any;
  sandboxDir: string;
  close(): void;
}

let serverPromise: Promise<OpenCodeServerHandle> | null = null;
let currentHandle: OpenCodeServerHandle | null = null;
const sessionListeners = new Map<string, Set<(ev: any) => void>>();

export function openCodeEventSessionId(ev: { properties?: any }): string | undefined {
  const props = ev.properties ?? {};
  return props.sessionID ?? props.info?.sessionID ?? props.part?.sessionID;
}

async function startServer(): Promise<OpenCodeServerHandle> {
  const sandboxDir = await mkdtemp(join(tmpdir(), "jas-opencode-"));

  const sdk: typeof import("@opencode-ai/sdk") = await import("@opencode-ai/sdk");
  const server = await sdk.createOpencodeServer({
    hostname: "127.0.0.1",
    port: 0,
    config: denyAllConfig() as any,
  });
  const client = sdk.createOpencodeClient({ baseUrl: server.url });
  const handle: OpenCodeServerHandle = { baseUrl: server.url, client, sandboxDir, close: server.close };
  currentHandle = handle;

  // Scoped to the shared sandbox directory: opencode only delivers session-scoped
  // events to subscribers whose directory matches (verified live), and every
  // session/prompt call below uses this same directory.
  const { stream } = await client.event.subscribe({ query: { directory: sandboxDir } });
  (async () => {
    try {
      for await (const ev of stream) {
        const sessionId = openCodeEventSessionId(ev as any);
        if (!sessionId) continue;
        const listeners = sessionListeners.get(sessionId);
        if (!listeners) continue;
        for (const listener of listeners) listener(ev);
      }
    } finally {
      // Stream ended (server crashed or connection dropped): drop the cached
      // server so the next turn restarts fresh. Any turn still waiting on this
      // session's events falls back on its own watchdog timeout, not on this.
      if (currentHandle === handle) {
        serverPromise = null;
        currentHandle = null;
      }
    }
  })();

  return handle;
}

/* Lazily starts (or reuses) the shared opencode serve process and its event bus. */
export async function ensureOpenCodeServer(): Promise<OpenCodeServerHandle> {
  if (!serverPromise) {
    serverPromise = startServer().catch((err) => {
      serverPromise = null;
      currentHandle = null;
      throw err;
    });
  }
  return serverPromise;
}

/* Registers a listener for events belonging to one opencode session id; returns an unsubscribe function. */
export function onOpenCodeSessionEvent(sessionId: string, handler: (ev: any) => void): () => void {
  let set = sessionListeners.get(sessionId);
  if (!set) {
    set = new Set();
    sessionListeners.set(sessionId, set);
  }
  set.add(handler);
  return () => {
    set!.delete(handler);
    if (set!.size === 0) sessionListeners.delete(sessionId);
  };
}

process.on("exit", () => {
  if (!currentHandle) return;
  currentHandle.close();
  try {
    rmSync(currentHandle.sandboxDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup only
  }
});

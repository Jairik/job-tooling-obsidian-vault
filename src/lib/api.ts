// Tiny API client. Streaming endpoints are POST + SSE, so we read the response
// body manually (EventSource only supports GET).
import type { SkillInfo, LogEntry, UrlFetchMethod, AttachmentMeta } from "./store";
import type { UsageResult, UsageTarget } from "../../shared/usage";

export type SSEHandlers = Record<string, (data: any) => void>;

/* Parses one complete Server-Sent Event frame into its event name and JSON payload. */
function parseEvent(chunk: string): { event: string; data: any } | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of chunk.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (!dataLines.length) return null;
  const raw = dataLines.join("\n");
  try {
    return { event, data: JSON.parse(raw) };
  } catch {
    return { event, data: raw };
  }
}

/* Posts JSON and incrementally forwards the response's SSE events to matching handlers. */
export async function streamPost(
  url: string,
  body: unknown,
  handlers: SSEHandlers,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const ev = parseEvent(chunk);
      if (ev && handlers[ev.event]) handlers[ev.event](ev.data);
    }
  }
}

export interface ModelOption {
  id: string;
  label: string;
}

/* Named wrappers for each non-streaming server endpoint used by React components. */
export const api = {
  meta: (): Promise<{ models: ModelOption[]; engines: ModelOption[]; defaults: any }> =>
    fetch("/api/meta").then((r) => r.json()),
  getConfig: (): Promise<any> => fetch("/api/config").then((r) => r.json()),
  saveConfig: (patch: unknown): Promise<any> =>
    fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then((r) => r.json()),
  skills: (vault: string): Promise<{ humanizer: boolean; gemini: boolean; opencode: boolean; cursor: boolean; copilot: boolean; codex: boolean }> =>
    fetch(`/api/skills/status?vault=${encodeURIComponent(vault)}`).then((r) => r.json()),
  listSkills: (vault: string): Promise<SkillInfo[]> =>
    fetch(`/api/skills/list?vault=${encodeURIComponent(vault)}`).then((r) => r.json()),
  createSkill: (payload: {
    name: string;
    description: string;
    body: string;
    scope: "user" | "vault";
  }): Promise<{ ok: boolean; name?: string; scope?: string; path?: string; error?: string }> =>
    fetch("/api/skills/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) => r.json()),
  /*
   * Streams a generated (or rewritten) SKILL.md. `text` events carry the document
   * as it is written; the `done` event carries the parsed { name, description, body }.
   * Pass `current` + `feedback` to revise an existing draft instead of starting fresh.
   */
  generateSkill: (
    payload: {
      description: string;
      current?: { name: string; description: string; body: string };
      feedback?: string;
    },
    handlers: SSEHandlers,
    signal?: AbortSignal
  ): Promise<void> => streamPost("/api/skills/generate", payload, handlers, signal),
  validateVault: (
    path: string
  ): Promise<{ valid: boolean; isDir: boolean; foundDirs: string[]; message?: string }> =>
    fetch(`/api/vault/validate?path=${encodeURIComponent(path)}`).then((r) => r.json()),
  cancel: (id: string): Promise<unknown> => fetch(`/api/tabs/${id}/cancel`, { method: "POST" }),

  /* Current usage for the selected engine/model when a compatible provider exists. */
  usage: (target?: UsageTarget): Promise<UsageResult> => {
    const query = target ? `?${new URLSearchParams({ engine: target.engine, model: target.model })}` : "";
    return fetch(`/api/usage${query}`).then((r) => r.json());
  },

  /* Durable activity log persisted server-side to a local file. */
  getLogs: (): Promise<LogEntry[]> => fetch("/api/logs").then((r) => r.json()),
  appendLog: (entry: LogEntry): Promise<unknown> =>
    fetch("/api/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    }),
  clearLogs: (): Promise<unknown> => fetch("/api/logs", { method: "DELETE" }),

  /* Vault Writer file browsing, writing, and URL-import endpoints. */
  vaultTree: (vault: string): Promise<any[]> =>
    fetch(`/api/vault/tree?path=${encodeURIComponent(vault)}`).then((r) => r.json()),
  /* Approval step 1: fetch the target's current state + a one-time write token. */
  vaultPreview: (
    path: string
  ): Promise<{ ok: boolean; path: string; exists: boolean; existingContent: string; tooLarge?: boolean; token: string; error?: string }> =>
    fetch("/api/vault/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    }).then((r) => r.json()),
  /* Approval step 2: the token from vaultPreview is required — no token, no write. */
  vaultWrite: (path: string, content: string, token: string): Promise<{ ok: boolean; path: string; error?: string }> =>
    fetch("/api/vault/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content, token }),
    }).then((r) => r.json()),

  /* Uploads a document; the server extracts its text and returns metadata only. */
  uploadAttachment: (file: File): Promise<{ ok: boolean; error?: string } & Partial<AttachmentMeta>> => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch("/api/attachments", { method: "POST", body: fd }).then((r) => r.json());
  },
  getAttachment: (id: string): Promise<{ ok: boolean } & Partial<AttachmentMeta>> =>
    fetch(`/api/attachments/${id}`).then((r) => r.json()),
  deleteAttachment: (id: string): Promise<unknown> =>
    fetch(`/api/attachments/${id}`, { method: "DELETE" }),

  /* Compiles edited LaTeX source into a fresh PDF. */
  latexCompile: (
    tex: string
  ): Promise<{ ok: boolean; compileId?: string; pdfUrl?: string; error?: string; log?: string; hint?: string }> =>
    fetch("/api/latex/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tex }),
    }).then((r) => r.json()),
  fetchUrl: (
    url: string,
    method: UrlFetchMethod
  ): Promise<{ text: string; title: string; sourceUrl?: string; method?: string; error?: string }> =>
    fetch("/api/fetch-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, method }),
    }).then((r) => r.json()),
};

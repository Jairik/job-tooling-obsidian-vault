// HTTP + SSE client for the TUI. The TUI is a second client of the same API the
// React web app uses (see src/lib/api.ts). The only difference is that Ink runs
// outside a browser, so fetch needs an absolute base URL instead of a relative one.
import type { CoreSettings } from "../../shared/settings";
import type { EngineScanResult } from "../../shared/engine-scan";
import { DEFAULT_PORT } from "../../shared/ports";
import type { UsageResult, UsageTarget } from "../../shared/usage";
import { basename } from "path";

let BASE = `http://localhost:${DEFAULT_PORT}`;

/* Points the client at a specific server origin (host:port). */
export function setBaseUrl(url: string): void {
  BASE = url.replace(/\/+$/, "");
}

/* Returns the current server origin the client talks to. */
export function getBaseUrl(): string {
  return BASE;
}

export type ServerSettings = CoreSettings;

export interface ModelOption {
  id: string;
  label: string;
}

export interface MetaResult {
  models: ModelOption[];
  engines: ModelOption[];
  defaults: ServerSettings;
}

export interface SkillInfo {
  name: string;
  description: string;
  scope: "user" | "vault";
  path?: string;
  chars?: number;
  estimatedTokens?: number;
  hasSupportingFiles?: boolean;
  tooLarge?: boolean;
}

export interface SkillStatus {
  humanizer: boolean;
  gemini: boolean;
  opencode: boolean;
  cursor: boolean;
  copilot: boolean;
  codex: boolean;
}

export interface TreeNode {
  name: string;
  path: string;
  children?: TreeNode[];
  isFile?: boolean;
}

export interface LogEntry {
  id: string;
  ts: number;
  tabId?: string;
  tabName?: string;
  tabColor?: string;
  kind: string;
  engine?: string;
  model?: string;
  question?: string;
  durationMs?: number;
  chars?: number;
  detail?: string;
}

export interface AttachmentMeta {
  id: string;
  name: string;
  size: number;
  chars: number;
  truncated: boolean;
}

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
  path: string,
  body: unknown,
  handlers: SSEHandlers,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
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

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

/* Named wrappers for each non-streaming server endpoint, mirroring src/lib/api.ts. */
export const api = {
  meta: (): Promise<MetaResult> => getJson<MetaResult>("/api/meta"),
  engineScan: (): Promise<EngineScanResult> => getJson<EngineScanResult>("/api/engines/scan"),
  getConfig: (): Promise<ServerSettings> => getJson<ServerSettings>("/api/config"),
  saveConfig: async (patch: Partial<ServerSettings>): Promise<ServerSettings> => {
    const res = await fetch(`${BASE}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error((data && typeof (data as any).error === "string" && (data as any).error) || `Settings save failed (${res.status})`);
    }
    return data as ServerSettings;
  },
  skillStatus: (vault: string): Promise<SkillStatus> =>
    getJson<SkillStatus>(`/api/skills/status?vault=${encodeURIComponent(vault)}`),
  listSkills: (vault: string): Promise<SkillInfo[]> =>
    getJson<SkillInfo[]>(`/api/skills/list?vault=${encodeURIComponent(vault)}`),
  createSkill: (payload: {
    name: string;
    description: string;
    body: string;
    scope: "user" | "vault";
  }): Promise<{ ok: boolean; name?: string; scope?: string; path?: string; error?: string }> =>
    postJson("/api/skills/create", payload),
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
    getJson(`/api/vault/validate?path=${encodeURIComponent(path)}`),
  cancel: (id: string): Promise<unknown> =>
    fetch(`${BASE}/api/tabs/${id}/cancel`, { method: "POST" }).catch(() => undefined),
  usage: (target?: UsageTarget): Promise<UsageResult> => {
    const query = target ? `?${new URLSearchParams({ engine: target.engine, model: target.model })}` : "";
    return getJson<UsageResult>(`/api/usage${query}`);
  },
  getLogs: (): Promise<LogEntry[]> => getJson<LogEntry[]>("/api/logs"),
  appendLog: (entry: LogEntry): Promise<unknown> => postJson("/api/logs", entry),
  clearLogs: (): Promise<unknown> =>
    fetch(`${BASE}/api/logs`, { method: "DELETE" }).then((r) => r.json()),
  vaultTree: (vault: string): Promise<TreeNode[]> =>
    getJson<TreeNode[]>(`/api/vault/tree?path=${encodeURIComponent(vault)}`),
  vaultPreview: (
    path: string
  ): Promise<{ ok: boolean; path: string; exists: boolean; existingContent: string; tooLarge?: boolean; token: string; error?: string }> =>
    postJson("/api/vault/preview", { path }),
  vaultWrite: (path: string, content: string, token: string): Promise<{ ok: boolean; path: string; error?: string }> =>
    postJson("/api/vault/write", { path, content, token }),
  uploadAttachmentPath: async (
    path: string
  ): Promise<{ ok: boolean; error?: string } & Partial<AttachmentMeta>> => {
    const file = Bun.file(path);
    const fd = new FormData();
    fd.append("file", file, basename(path));
    const res = await fetch(`${BASE}/api/attachments`, { method: "POST", body: fd });
    return (await res.json()) as { ok: boolean; error?: string } & Partial<AttachmentMeta>;
  },
  getAttachment: (id: string): Promise<{ ok: boolean } & Partial<AttachmentMeta>> =>
    getJson(`/api/attachments/${id}`),
  deleteAttachment: (id: string): Promise<unknown> =>
    fetch(`${BASE}/api/attachments/${id}`, { method: "DELETE" }).then((r) => r.json()),
  latexCompile: (
    tex: string
  ): Promise<{ ok: boolean; compileId?: string; pdfUrl?: string; error?: string; log?: string; hint?: string }> =>
    postJson("/api/latex/compile", { tex }),
  fetchUrl: (
    url: string,
    method: ServerSettings["urlFetchMethod"]
  ): Promise<{ text: string; title: string; sourceUrl?: string; method?: string; error?: string }> =>
    postJson("/api/fetch-url", { url, method }),
};

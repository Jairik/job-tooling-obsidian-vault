// Tiny API client. Streaming endpoints are POST + SSE, so we read the response
// body manually (EventSource only supports GET).

export type SSEHandlers = Record<string, (data: any) => void>;

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
  skills: (vault: string): Promise<{ yc: boolean; humanizer: boolean; gemini: boolean; opencode: boolean; cursor: boolean; copilot: boolean }> =>
    fetch(`/api/skills/status?vault=${encodeURIComponent(vault)}`).then((r) => r.json()),
  validateVault: (
    path: string
  ): Promise<{ valid: boolean; isDir: boolean; foundDirs: string[]; message?: string }> =>
    fetch(`/api/vault/validate?path=${encodeURIComponent(path)}`).then((r) => r.json()),
  cancel: (id: string): Promise<unknown> => fetch(`/api/tabs/${id}/cancel`, { method: "POST" }),

  // Vault Writer APIs
  vaultTree: (vault: string): Promise<any[]> =>
    fetch(`/api/vault/tree?path=${encodeURIComponent(vault)}`).then((r) => r.json()),
  vaultWrite: (path: string, content: string): Promise<{ ok: boolean; path: string }> =>
    fetch("/api/vault/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    }).then((r) => r.json()),
  fetchUrl: (url: string, method = "basic"): Promise<{ text: string; title: string; error?: string }> =>
    fetch("/api/fetch-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, method }),
    }).then((r) => r.json()),
};

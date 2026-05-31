// Gemini Antigravity engine: shells out to the `agy` CLI.
//
// SAFETY: `agy` is a full agentic CLI (it can write files and run shell commands).
// To keep it from ever touching the user's vault, we (1) run it in a throwaway
// temp directory, (2) do NOT pass --dangerously-skip-permissions, (3) enable
// --sandbox, and (4) inject the vault context into the prompt ourselves (read
// only) so the model never needs filesystem access. Humanization uses inline
// rules and follow-ups are stateless (prior answer passed in the prompt).
import { mkdtemp, rm, readdir, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join, extname } from "path";

export type Emit = (event: string, data: unknown) => void;

export function geminiAvailable(): boolean {
  return Boolean(Bun.which("agy"));
}

const CONTEXT_EXTS = new Set([".md", ".txt"]);
const CONTEXT_SKIP = new Set([".git", ".obsidian", "node_modules", ".trash"]);

// Read-only: concatenate the vault's markdown/text files into a bounded context
// bundle so agy can stay sandboxed in a temp dir with no access to the vault.
export async function gatherVaultContext(
  vaultDir: string,
  extraDirs: string[] = [],
  maxBytes = 150_000
): Promise<string> {
  const files: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 5) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (CONTEXT_SKIP.has(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p, depth + 1);
      else if (CONTEXT_EXTS.has(extname(e.name).toLowerCase())) files.push(p);
    }
  }
  for (const root of [vaultDir, ...extraDirs]) await walk(root, 0);
  files.sort();

  let out = "";
  let total = 0;
  for (const f of files) {
    let body: string;
    try {
      body = await readFile(f, "utf8");
    } catch {
      continue;
    }
    const rel = f.startsWith(vaultDir) ? f.slice(vaultDir.length + 1) : f;
    const block = `\n===== FILE: ${rel} =====\n${body}\n`;
    if (total + block.length > maxBytes) {
      out += "\n[context truncated to fit budget]\n";
      break;
    }
    out += block;
    total += block.length;
  }
  return out;
}

interface AgyArgs {
  prompt: string;
  phase: string;
  emit: Emit;
  abort: AbortController;
}

// Run one `agy -p` turn inside a sandboxed temp dir. Streams stdout chunks as
// text deltas; returns the full printed response. Throws on non-zero exit.
export async function runAgyTurn(args: AgyArgs): Promise<string> {
  const bin = Bun.which("agy") ?? "agy";
  // Isolated working directory — agy gets NO access to the vault.
  const work = await mkdtemp(join(tmpdir(), "jas-agy-"));
  // Prompt goes on stdin (it can exceed the argv size limit). No
  // --dangerously-skip-permissions; --sandbox restricts terminal access.
  const cmd = [bin, "-p", "--sandbox"];

  args.emit("activity", { tool: "agy", input: `${args.phase}…` });

  const proc = Bun.spawn(cmd, { cwd: work, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  proc.stdin.write(args.prompt);
  proc.stdin.end();
  const onAbort = () => proc.kill();
  args.abort.signal.addEventListener("abort", onAbort, { once: true });

  let text = "";
  try {
    const errPromise = new Response(proc.stderr).text();
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      text += chunk;
      args.emit("text", { phase: args.phase, delta: chunk });
    }
    const code = await proc.exited;
    if (code !== 0 && !args.abort.signal.aborted) {
      const err = (await errPromise).trim();
      throw new Error(`agy exited ${code}${err ? `: ${err.slice(0, 400)}` : ""}`);
    }
  } finally {
    args.abort.signal.removeEventListener("abort", onAbort);
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }

  return text.trim();
}

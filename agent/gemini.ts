// CLI engine driver: shells out to agy, opencode, cursor, or copilot CLIs.
//
// SAFETY: All CLI agents are run inside throwaway sandboxed temp directories,
// with appropriate sandboxing/safety/yolo flags as supported by each tool,
// and we inject the vault context into the prompt ourselves (read-only)
// so the CLI agents never need direct vault filesystem access.
import { mkdtemp, rm, readdir, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join, extname } from "path";
import type { Engine } from "./config";

export type Emit = (event: string, data: unknown) => void;

export function cliAvailable(engine: Engine): boolean {
  if (engine === "claude") return true; // managed via SDK
  if (engine === "gemini") return Boolean(Bun.which("agy"));
  if (engine === "opencode") return Boolean(Bun.which("opencode"));
  if (engine === "cursor") return Boolean(Bun.which("cursor-agent") || Bun.which("cursor"));
  if (engine === "copilot") return Boolean(Bun.which("copilot"));
  return false;
}

export function geminiAvailable(): boolean {
  return cliAvailable("gemini");
}

const CONTEXT_EXTS = new Set([".md", ".txt"]);
const CONTEXT_SKIP = new Set([".git", ".obsidian", "node_modules", ".trash"]);

// Read-only: concatenate the vault's markdown/text files into a bounded context
// bundle so CLIs can stay sandboxed in a temp dir with no access to the vault.
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

interface CliArgs {
  prompt: string;
  phase: string;
  emit: Emit;
  abort: AbortController;
}

// Run one CLI engine turn inside a sandboxed temp dir. Streams stdout chunks as
// text deltas; returns the full printed response. Throws on non-zero exit.
export async function runCliTurn(engine: Engine, args: CliArgs): Promise<string> {
  let bin = "";
  let cmd: string[] = [];
  let writeToStdin = false;

  if (engine === "gemini") {
    bin = Bun.which("agy") ?? "agy";
    cmd = [bin, "-p", "--sandbox"];
    writeToStdin = true;
  } else if (engine === "opencode") {
    bin = Bun.which("opencode") ?? "opencode";
    cmd = [bin, "run", "--pure", args.prompt];
  } else if (engine === "cursor") {
    const cursorAgentBin = Bun.which("cursor-agent");
    if (cursorAgentBin) {
      bin = cursorAgentBin;
      cmd = [bin, "--print", "--trust", "--sandbox", "enabled", args.prompt];
    } else {
      bin = Bun.which("cursor") ?? "cursor";
      cmd = [bin, "agent", "--print", "--trust", "--sandbox", "enabled", args.prompt];
    }
  } else if (engine === "copilot") {
    bin = Bun.which("copilot") ?? "copilot";
    cmd = [bin, "-p", args.prompt, "-s", "--yolo"];
  } else {
    throw new Error(`Unsupported CLI engine: ${engine}`);
  }

  // Isolated working directory
  const work = await mkdtemp(join(tmpdir(), `jas-${engine}-`));

  args.emit("activity", { tool: engine, input: `${args.phase}…` });

  const spawnOpts: any = {
    cwd: work,
    stdin: writeToStdin ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  };

  const proc = Bun.spawn(cmd, spawnOpts) as any;

  if (writeToStdin) {
    proc.stdin!.write(args.prompt);
    proc.stdin!.end();
  }

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
      throw new Error(`${engine} exited ${code}${err ? `: ${err.slice(0, 400)}` : ""}`);
    }
  } finally {
    args.abort.signal.removeEventListener("abort", onAbort);
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }

  return text.trim();
}

export async function runAgyTurn(args: CliArgs): Promise<string> {
  return runCliTurn("gemini", args);
}

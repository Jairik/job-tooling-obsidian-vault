/*
 * CLI engine driver for agy, OpenCode, Cursor, Copilot, and Codex.
 *
 * Safety: every CLI agent runs in a throwaway sandboxed directory. Vault content
 * is injected into the prompt as read-only text, so the CLI never needs access
 * to the user's vault filesystem.
 */
import { mkdtemp, rm, readdir, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join, extname } from "path";
import { effectiveEngineModel, effectiveEngineReasoning, type Engine } from "../shared/settings";
import type { ServerSettings } from "./config";

type Emit = (event: string, data: unknown) => void;

/* Reports whether an engine is available on PATH; Claude is handled by its SDK. */
export function cliAvailable(engine: Engine): boolean {
  if (engine === "claude") return true; // managed via SDK
  if (engine === "gemini") return Boolean(Bun.which("agy"));
  if (engine === "opencode") return Boolean(Bun.which("opencode"));
  if (engine === "cursor") return Boolean(Bun.which("cursor-agent") || Bun.which("cursor"));
  if (engine === "copilot") return Boolean(Bun.which("copilot"));
  if (engine === "codex") return Boolean(Bun.which("codex"));
  return false;
}

/* Retains the Gemini-specific availability check used by older API callers. */
export function geminiAvailable(): boolean {
  return cliAvailable("gemini");
}

const CONTEXT_EXTS = new Set([".md", ".txt"]);
const CONTEXT_SKIP = new Set([".git", ".obsidian", "node_modules", ".trash"]);

/*
 * Concatenates vault markdown/text files into a bounded, read-only context bundle.
 * CLI engines receive this text while remaining sandboxed without vault access.
 */
export async function gatherVaultContext(
  vaultDir: string,
  extraDirs: string[] = [],
  maxBytes = 150_000
): Promise<string> {
  const files: string[] = [];
  /* Recursively collects eligible text files while enforcing a shallow traversal limit. */
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
  settings?: ServerSettings;
}

export interface CliCommand {
  cmd: string[];
  prompt: string;
  writeToStdin: boolean;
}

export const CLI_ARG_PROMPT_SOFT_LIMIT_BYTES = 512_000;

/* Adds a portable reasoning instruction for CLIs without a dedicated setting. */
function withRuntimeHints(prompt: string, reasoning: string): string {
  if (!reasoning.trim()) return prompt;
  return `Reasoning effort: ${reasoning.trim()}. Use this as an internal budget and return only the final answer.\n\n${prompt}`;
}

/* Escapes a string for Codex's TOML-style --config command-line value. */
function tomlString(value: string): string {
  return JSON.stringify(value);
}

/*
 * Builds the safe command and input transport for one external CLI.
 * Prompts use stdin whenever possible so large vault context never exceeds argv limits.
 */
export function buildCliCommand(engine: Engine, args: { prompt: string; settings?: ServerSettings }): CliCommand {
  const model = args.settings ? effectiveEngineModel(args.settings, engine) : "";
  const reasoning = args.settings ? effectiveEngineReasoning(args.settings, engine) : "";
  const prompt = withRuntimeHints(args.prompt, reasoning);
  let bin = "";
  let cmd: string[] = [];
  let writeToStdin = false;

  if (engine === "gemini") {
    bin = Bun.which("agy") ?? "agy";
    cmd = [bin, "-p", "--sandbox"];
    if (model) cmd.push("--model", model);
    writeToStdin = true;
  } else if (engine === "opencode") {
    bin = Bun.which("opencode") ?? "opencode";
    cmd = [bin, "run", "--pure"];
    if (model) cmd.push("--model", model);
    if (reasoning) cmd.push("--variant", reasoning);
    writeToStdin = true;
  } else if (engine === "cursor") {
    const cursorAgentBin = Bun.which("cursor-agent");
    if (cursorAgentBin) {
      bin = cursorAgentBin;
      cmd = [bin, "--print", "--trust", "--sandbox", "enabled"];
    } else {
      bin = Bun.which("cursor") ?? "cursor";
      cmd = [bin, "agent", "--print", "--trust", "--sandbox", "enabled"];
    }
    if (model) cmd.push("--model", model);
    writeToStdin = true;
  } else if (engine === "copilot") {
    bin = Bun.which("copilot") ?? "copilot";
    cmd = [bin, "-s", "--yolo"];
    if (model) cmd.push("--model", model);
    if (reasoning) cmd.push("--reasoning-effort", reasoning);
    writeToStdin = true;
  } else if (engine === "codex") {
    bin = Bun.which("codex") ?? "codex";
    cmd = [bin, "exec", "--sandbox", "read-only", "--skip-git-repo-check", "--color", "never", "--ephemeral"];
    if (model) cmd.push("--model", model);
    if (reasoning) cmd.push("--config", `model_reasoning_effort=${tomlString(reasoning)}`);
    cmd.push("-");
    writeToStdin = true;
  } else {
    throw new Error(`Unsupported CLI engine: ${engine}`);
  }

  /* Fail before spawning an argv-only CLI with a command its OS cannot accept. */
  if (!writeToStdin && new TextEncoder().encode(prompt).length > CLI_ARG_PROMPT_SOFT_LIMIT_BYTES) {
    throw new Error(
      `${engine} prompt is too large for argv transport (${prompt.length} chars). Lower the context budget or use an engine that accepts stdin.`
    );
  }

  return { cmd, prompt, writeToStdin };
}

/*
 * Runs one external CLI in a sandboxed temporary directory.
 * Streams stdout chunks as text deltas, returns the full response, and throws on failure.
 */
export async function runCliTurn(engine: Engine, args: CliArgs): Promise<string> {
  const { cmd, prompt, writeToStdin } = buildCliCommand(engine, args);

  // Isolated working directory
  const work = await mkdtemp(join(tmpdir(), `jas-${engine}-`));

  args.emit("activity", { tool: engine, input: `${args.phase}…` });

  const spawnOpts: any = {
    cwd: work,
    stdin: writeToStdin ? new Blob([prompt]) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  };

  const proc = Bun.spawn(cmd, spawnOpts) as any;

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

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
import { injectSkillsIntoPrompt, type ServerSettings, type SkillNote } from "./config";
import { cliPathForEngine, codexSdkAvailable } from "./engine-scan";
import { ensureOpenCodeServer, onOpenCodeSessionEvent, OPENCODE_DISABLED_TOOLS } from "./opencode-server";

type Emit = (event: string, data: unknown) => void;

/* Reports whether an engine is available on PATH; Claude is handled by its SDK. */
export function cliAvailable(engine: Engine): boolean {
  if (engine === "claude") return true; // managed via SDK
  if (engine === "codex" && codexSdkAvailable()) return true;
  return Boolean(cliPathForEngine(engine));
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
  // Full user-selected SKILL.md bundles. These are prompt-injected because CLI
  // agents do not expose Claude's native Skill tool or shared skill directories.
  skills?: SkillNote[];
  phase: string;
  // Tool-protocol turns are held back until the mediator has either fulfilled a
  // request or received a final answer, so raw JSON never leaks into the UI.
  suppressText?: boolean;
  emit: Emit;
  abort: AbortController;
  settings?: ServerSettings;
  resume?: string;
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
export function buildCliCommand(
  engine: Engine,
  args: { prompt: string; settings?: ServerSettings; skills?: SkillNote[]; resume?: string }
): CliCommand {
  const model = args.settings ? effectiveEngineModel(args.settings, engine) : "";
  const reasoning = args.settings ? effectiveEngineReasoning(args.settings, engine) : "";
  // Inject before runtime hints so every CLI command builder call, including
  // future call sites, delivers the selected SKILL.md instructions consistently.
  const prompt = withRuntimeHints(injectSkillsIntoPrompt(args.prompt, args.skills), reasoning);
  let bin = "";
  let cmd: string[] = [];
  let writeToStdin = false;

  if (engine === "gemini") {
    bin = Bun.which("agy") ?? "agy";
    cmd = [bin, "-p", "--sandbox"];
    if (args.resume) cmd.push("--conversation", args.resume);
    if (model) cmd.push("--model", model);
    writeToStdin = true;
  } else if (engine === "opencode") {
    bin = Bun.which("opencode") ?? "opencode";
    cmd = [bin, "run", "--pure", "--format", "json"];
    if (args.resume) cmd.push("--session", args.resume);
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
    if (args.resume) {
      cmd = [bin, "exec", "resume", args.resume, "--json"];
      if (model) cmd.push("--model", model);
      cmd.push("-");
    } else {
      cmd = [bin, "exec", "--sandbox", "read-only", "--skip-git-repo-check", "--color", "never", "--json"];
      if (model) cmd.push("--model", model);
      if (reasoning) cmd.push("--config", `model_reasoning_effort=${tomlString(reasoning)}`);
      cmd.push("-");
    }
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

export interface CodexSdkTurnState {
  sentAgentText: string;
}

export interface MappedCodexSdkEvent {
  sessionId?: string;
  delta?: string;
  error?: string;
}

/*
 * Pure mapper from a Codex SDK ThreadEvent to the same {sessionId, delta, error}
 * shape the legacy JSONL parser produced above. Unlike the legacy `codex exec
 * --json` stream (which has a separate `item.delta` event), this SDK's
 * item.updated/item.completed events carry the *full* accumulated
 * agent_message text rather than incremental chunks, so deltas are
 * reconstructed by diffing against the text already sent (tracked in `state`).
 */
export function mapCodexSdkEvent(
  ev: { type: string; thread_id?: string; message?: string; error?: { message: string }; item?: { type: string; text?: string } },
  state: CodexSdkTurnState
): MappedCodexSdkEvent {
  if (ev.type === "thread.started" && ev.thread_id) return { sessionId: ev.thread_id };
  if (ev.type === "error" && ev.message) return { error: ev.message };
  if (ev.type === "turn.failed" && ev.error?.message) return { error: ev.error.message };
  if ((ev.type === "item.updated" || ev.type === "item.completed") && ev.item?.type === "agent_message") {
    const full = ev.item.text ?? "";
    if (full.length <= state.sentAgentText.length) return {};
    const delta = full.slice(state.sentAgentText.length);
    state.sentAgentText = full;
    return { delta };
  }
  return {};
}

export interface CodexThreadOptions {
  workingDirectory: string;
  sandboxMode: "read-only";
  skipGitRepoCheck: true;
  model?: string;
  modelReasoningEffort?: string;
}

/* Builds the ThreadOptions passed to both startThread and resumeThread (the SDK applies them identically either way). */
export function buildCodexThreadOptions(workingDirectory: string, model: string, reasoning: string): CodexThreadOptions {
  const options: CodexThreadOptions = {
    workingDirectory,
    sandboxMode: "read-only",
    skipGitRepoCheck: true,
  };
  if (model) options.model = model;
  if (reasoning) options.modelReasoningEffort = reasoning;
  return options;
}

/* Emitted once per process if the optional Codex SDK dependency is missing. */
let codexSdkMissingNoticeShown = false;

export function isCodexSdkStartupError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes("Unable to locate Codex CLI binaries") ||
    message.includes("Unsupported platform:") ||
    message.includes("Unsupported target triple:")
  );
}

/*
 * Runs one Codex turn through @openai/codex-sdk instead of hand-parsed
 * `codex exec --json`. Same sandbox contract as the legacy path: empty temp
 * cwd, read-only sandbox, prompt over stdio, no vault filesystem access.
 * Returns null (instead of throwing) when the optional SDK dependency isn't
 * installed, signaling the caller to fall back to the legacy CLI transport.
 */
export async function runCodexSdkTurn(args: CliArgs): Promise<string | null> {
  let sdk: typeof import("@openai/codex-sdk");
  try {
    sdk = await import("@openai/codex-sdk");
  } catch {
    if (!codexSdkMissingNoticeShown) {
      codexSdkMissingNoticeShown = true;
      args.emit("notice", { message: "Codex SDK not installed; using the codex CLI directly for this turn." });
    }
    return null;
  }

  const settings = args.settings;
  const model = settings ? effectiveEngineModel(settings, "codex") : "";
  const reasoning = settings ? effectiveEngineReasoning(settings, "codex") : "";
  const prompt = withRuntimeHints(injectSkillsIntoPrompt(args.prompt, args.skills), reasoning);

  const work = await mkdtemp(join(tmpdir(), "jas-codex-"));
  args.emit("activity", { tool: "codex", input: `${args.phase}…` });

  let text = "";
  try {
    const codex = new sdk.Codex();
    const threadOptions = buildCodexThreadOptions(work, model, reasoning);

    const thread = args.resume
      ? codex.resumeThread(args.resume, threadOptions as any)
      : codex.startThread(threadOptions as any);

    const { events } = await thread.runStreamed(prompt, { signal: args.abort.signal });

    const state: CodexSdkTurnState = { sentAgentText: "" };
    for await (const ev of events) {
      const mapped = mapCodexSdkEvent(ev as any, state);
      if (mapped.sessionId) args.emit("session", { sessionId: mapped.sessionId });
      if (mapped.delta) {
        text += mapped.delta;
        if (!args.suppressText) args.emit("text", { phase: args.phase, delta: mapped.delta });
      }
      if (mapped.error) throw new Error(mapped.error);
    }
    return text.trim();
  } catch (err) {
    if (args.abort.signal.aborted) return text.trim();
    if (!text && isCodexSdkStartupError(err)) {
      // Nothing streamed yet: the SDK's own bundled binary likely isn't resolvable
      // (e.g. a partial optional-dependency install). Fall back to the legacy CLI
      // transport, which can still use a PATH-installed codex binary.
      if (!codexSdkMissingNoticeShown) {
        codexSdkMissingNoticeShown = true;
        args.emit("notice", { message: "Codex SDK failed to start; using the codex CLI directly for this turn." });
      }
      return null;
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`codex: ${message.slice(0, 400)}`);
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/* Splits the app's "provider/model" setting into the SDK's {providerID, modelID} shape. */
export function mapOpenCodeModel(model: string): { providerID: string; modelID: string } | undefined {
  const trimmed = model.trim();
  if (!trimmed) return undefined;
  const idx = trimmed.indexOf("/");
  if (idx === -1) return undefined;
  return { providerID: trimmed.slice(0, idx), modelID: trimmed.slice(idx + 1) };
}

export interface OpenCodeSdkTurnState {
  assistantMessageId?: string;
  answerPartId?: string;
  sentText: string;
}

export interface MappedOpenCodeSdkEvent {
  delta?: string;
  done?: boolean;
  error?: string;
}

/*
 * Pure mapper from one shared-bus OpenCode server event (already filtered to this
 * turn's session id by onOpenCodeSessionEvent) to the same {delta, done, error}
 * shape mapCodexSdkEvent produces.
 *
 * Verified live against a real server (not assumed from types): the prompt's own
 * echoed user message and the assistant's reasoning both arrive as
 * message.part.updated/message.part.delta events too, so this tracks the
 * assistant's message id explicitly (via message.updated with role "assistant")
 * and, within that message, the specific text-typed part id (ignoring reasoning
 * parts) before accepting any deltas — otherwise the user's own prompt or the
 * model's chain-of-thought gets mistaken for the answer. message.part.delta
 * (field:"text", partID, delta) is real on the wire but isn't in the published
 * SDK's typed Event union; message.part.updated's cumulative part.text is used
 * as a dedup-safe fallback/finalizer for it.
 */
export function mapOpenCodeSdkEvent(
  ev: { type: string; properties?: any },
  state: OpenCodeSdkTurnState
): MappedOpenCodeSdkEvent {
  const props = ev.properties ?? {};

  if (ev.type === "message.updated" && props.info?.role === "assistant" && !state.assistantMessageId) {
    state.assistantMessageId = props.info.id;
    return {};
  }

  if (ev.type === "message.part.updated" && props.part?.messageID === state.assistantMessageId) {
    if (props.part.type !== "text") return {};
    if (!state.answerPartId) state.answerPartId = props.part.id;
    if (props.part.id !== state.answerPartId) return {};
    const full: string = props.part.text ?? "";
    if (full.length <= state.sentText.length) return {};
    const delta = full.slice(state.sentText.length);
    state.sentText = full;
    return { delta };
  }

  if (ev.type === "message.part.delta" && props.field === "text" && props.partID === state.answerPartId) {
    const delta: string = props.delta ?? "";
    if (!delta) return {};
    state.sentText += delta;
    return { delta };
  }

  if (ev.type === "session.idle") return { done: true };
  if (ev.type === "session.error") {
    const error = props.error;
    const message = error?.data?.message ?? error?.name ?? "opencode session error";
    return { error: message };
  }
  return {};
}

/* Emitted once per process if the optional OpenCode SDK dependency is missing. */
let openCodeSdkMissingNoticeShown = false;
const openCodeSdkSessionDirs = new Map<string, string>();

export function openCodeResumeSessionId(
  resume: string | undefined,
  directory: string,
  sessionDirs: ReadonlyMap<string, string> = openCodeSdkSessionDirs
): string | undefined {
  return resume && sessionDirs.get(resume) === directory ? resume : undefined;
}

/* Safety net for the "unset permission category hangs forever" and "server died
 * mid-turn" risks documented in agent/opencode-server.ts — generous enough to
 * never bother a real turn, but bounded so a turn can't hang indefinitely. */
const OPENCODE_TURN_TIMEOUT_MS = 10 * 60 * 1000;

/*
 * Runs one OpenCode turn through @opencode-ai/sdk against the shared, lazily
 * started `opencode serve` process (agent/opencode-server.ts). Every
 * tool/permission category is denied server-side so the model never gets real
 * filesystem access; prompt-injected context only, same as every other CLI
 * engine. Unlike Codex, this reuses the server's one shared sandbox directory
 * rather than a fresh temp dir per turn — see the directory note in
 * agent/opencode-server.ts for why a fresh per-turn directory silently breaks
 * event delivery on resumed sessions. Returns null (instead of throwing) when
 * the optional SDK dependency isn't installed or the server can't start,
 * signaling the caller to fall back to the legacy CLI transport.
 */
export async function runOpenCodeSdkTurn(args: CliArgs): Promise<string | null> {
  let server: { baseUrl: string; client: any; sandboxDir: string };
  try {
    server = await ensureOpenCodeServer();
  } catch {
    if (!openCodeSdkMissingNoticeShown) {
      openCodeSdkMissingNoticeShown = true;
      args.emit("notice", { message: "OpenCode SDK not available; using the opencode CLI directly for this turn." });
    }
    return null;
  }

  const settings = args.settings;
  const model = settings ? effectiveEngineModel(settings, "opencode") : "";
  const reasoning = settings ? effectiveEngineReasoning(settings, "opencode") : "";
  const prompt = withRuntimeHints(injectSkillsIntoPrompt(args.prompt, args.skills), reasoning);
  const modelRef = mapOpenCodeModel(model);
  const directory = server.sandboxDir;

  args.emit("activity", { tool: "opencode", input: `${args.phase}…` });

  let text = "";
  let turnSessionId: string | undefined;
  // Held on an object rather than bare `let`s: closures below reassign these, and
  // narrowing bare `let`s reassigned inside a closure across an `await` boundary
  // isn't reliable across TS versions (an object property sidesteps it cleanly).
  const cleanup: { onAbort: (() => void) | null; unsubscribe: (() => void) | null; watchdog: ReturnType<typeof setTimeout> | null } = {
    onAbort: null,
    unsubscribe: null,
    watchdog: null,
  };

  // Registered up front, before session creation, so an abort that fires while
  // still awaiting session.create() (i.e. before turnSessionId even exists) isn't
  // silently missed — addEventListener on an already-fired AbortSignal never
  // calls the handler, so this must be listening for the entire turn lifetime,
  // not just the later event-wait promise.
  const aborted = new Promise<never>((_resolve, reject) => {
    cleanup.onAbort = () => {
      if (turnSessionId) server.client.session.abort({ path: { id: turnSessionId } }).catch(() => {});
      reject(new Error("aborted"));
    };
    if (args.abort.signal.aborted) cleanup.onAbort();
    else args.abort.signal.addEventListener("abort", cleanup.onAbort, { once: true });
  });

  try {
    let sessionId = openCodeResumeSessionId(args.resume, directory);
    if (!sessionId) {
      const created = await Promise.race([server.client.session.create({ query: { directory } }), aborted]);
      if (created.error) throw new Error(created.error?.data?.message ?? "failed to create opencode session");
      sessionId = created.data.id as string;
      openCodeSdkSessionDirs.set(sessionId, directory);
      args.emit("session", { sessionId });
    }
    turnSessionId = sessionId;
    const confirmedSessionId = sessionId;

    const state: OpenCodeSdkTurnState = { sentText: "" };
    const turnCompleted = new Promise<void>((resolve, reject) => {
      cleanup.watchdog = setTimeout(() => {
        server.client.session.abort({ path: { id: confirmedSessionId } }).catch(() => {});
        reject(new Error("opencode turn timed out"));
      }, OPENCODE_TURN_TIMEOUT_MS);

      cleanup.unsubscribe = onOpenCodeSessionEvent(confirmedSessionId, (ev) => {
        const mapped = mapOpenCodeSdkEvent(ev, state);
        if (mapped.delta) {
          text += mapped.delta;
          if (!args.suppressText) args.emit("text", { phase: args.phase, delta: mapped.delta });
        }
        if (mapped.error) reject(new Error(mapped.error));
        else if (mapped.done) resolve();
      });

      server.client.session
        .promptAsync({
          path: { id: confirmedSessionId },
          query: { directory },
          body: {
            ...(modelRef ? { model: modelRef } : {}),
            tools: OPENCODE_DISABLED_TOOLS,
            parts: [{ type: "text", text: prompt }],
          },
        })
        .then((res: any) => {
          if (res?.error) reject(new Error(res.error?.data?.message ?? "opencode prompt request failed"));
        })
        .catch(reject);
    });

    await Promise.race([turnCompleted, aborted]);
    return text.trim();
  } catch (err) {
    if (args.abort.signal.aborted) return text.trim();
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`opencode: ${message.slice(0, 400)}`);
  } finally {
    cleanup.unsubscribe?.();
    if (cleanup.watchdog) clearTimeout(cleanup.watchdog);
    if (cleanup.onAbort) args.abort.signal.removeEventListener("abort", cleanup.onAbort);
  }
}

/*
 * Runs one external CLI in a sandboxed temporary directory.
 * Streams stdout chunks as text deltas, returns the full response, and throws on failure.
 */
export async function runCliTurn(engine: Engine, args: CliArgs): Promise<string> {
  if (engine === "codex" && process.env.VAULT_CODEX_TRANSPORT !== "cli") {
    const sdkText = await runCodexSdkTurn(args);
    if (sdkText !== null) return sdkText;
    // SDK unavailable: fall through to the legacy CLI transport below.
  }
  if (engine === "opencode" && process.env.VAULT_OPENCODE_TRANSPORT !== "cli") {
    const sdkText = await runOpenCodeSdkTurn(args);
    if (sdkText !== null) return sdkText;
    // SDK unavailable: fall through to the legacy CLI transport below.
  }

  // buildCliCommand performs the portable skill injection before choosing this
  // engine's command line, so all CLI agents receive identical instructions.
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
    const isJsonFormat = engine === "opencode" || engine === "codex";
    let buffer = "";

    const processLine = (line: string) => {
      if (!line.trim()) return;
      try {
        const ev = JSON.parse(line);
        // Capture session ID
        if (ev.sessionID) {
          args.emit("session", { sessionId: ev.sessionID });
        } else if (ev.type === "thread.started" && ev.thread_id) {
          args.emit("session", { sessionId: ev.thread_id });
        }

        // Extract text delta
        let delta = "";
        if (ev.type === "text" && ev.part?.text) {
          delta = ev.part.text;
        } else if (ev.type === "item.delta" && ev.delta?.text) {
          delta = ev.delta.text;
        } else if (ev.type === "item.completed" && ev.item?.type === "agent_message" && ev.item?.text) {
          delta = ev.item.text;
        }
        if (delta) {
          text += delta;
          if (!args.suppressText) args.emit("text", { phase: args.phase, delta });
        }
      } catch {
        // If not valid JSON, treat as raw text or ignore if it's junk/logs
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (isJsonFormat) {
        buffer += chunk;
        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          processLine(line);
        }
      } else {
        text += chunk;
        if (!args.suppressText) args.emit("text", { phase: args.phase, delta: chunk });
      }
    }
    if (isJsonFormat && buffer) {
      processLine(buffer);
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

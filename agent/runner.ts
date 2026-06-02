// Wraps the Claude Agent SDK query() into the per-tab pipeline:
//   generate = draft turn -> humanize turn
//   followUp = single resumed turn
// Streams SSE-style events out via an `emit` callback and tracks one Claude Code
// session per tab (persisted to .sessions.json so follow-ups survive a restart).
import { query } from "@anthropic-ai/claude-agent-sdk";
import { join } from "path";
import {
  REASONING,
  DEFAULT_MODEL,
  DEFAULT_CLEANUP_MODEL,
  ASK_PERSONA,
  buildAppend,
  buildDraftPrompt,
  buildRagDraftPrompt,
  buildRagFollowupPrompt,
  buildAskPrompt,
  buildRagAskPrompt,
  buildCleanupPrompt,
  buildCleanupAppend,
  buildGeminiDraftPrompt,
  buildGeminiHumanizePrompt,
  buildGeminiFollowupPrompt,
  buildGeminiAskPrompt,
  buildGeminiCleanupPrompt,
  type Settings,
  type TabMode,
} from "./config";
import { detectSkills } from "./skills";
import { geminiAvailable, runAgyTurn, gatherVaultContext } from "./gemini";
import { retrieveContext } from "./rag";

const DEFAULT_TOOLS = ["Skill", "Read", "Grep", "Glob"];
// In RAG mode the excerpts are injected into the prompt, so file-browsing tools
// are dropped — the agent can only run skills (e.g. humanizer). This is what
// keeps token usage down: no autonomous Read/Grep/Glob over the whole vault.
const RAG_TOOLS = ["Skill"];

export type Emit = (event: string, data: unknown) => void;

interface TabSession {
  sessionId?: string;
  abort?: AbortController;
  lastAnswer?: string; // used by the stateless Gemini follow-up path
}

const sessions = new Map<string, TabSession>();
const SESS_PATH = join(import.meta.dir, "..", ".sessions.json");

export async function loadSessions(): Promise<void> {
  try {
    const obj = JSON.parse(await Bun.file(SESS_PATH).text());
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string") sessions.set(k, { sessionId: v });
    }
  } catch {
    /* no prior sessions */
  }
}

async function persistSessions(): Promise<void> {
  const obj: Record<string, string> = {};
  for (const [k, v] of sessions) if (v.sessionId) obj[k] = v.sessionId;
  await Bun.write(SESS_PATH, JSON.stringify(obj, null, 2));
}

export function cancel(tabId: string): void {
  sessions.get(tabId)?.abort?.abort();
}

export function clearSession(tabId: string): void {
  sessions.delete(tabId);
  void persistSessions();
}

function summarizeToolInput(name: string, input: any): string {
  if (!input || typeof input !== "object") return "";
  if (name === "Read") return input.file_path ?? "";
  if (name === "Grep") return input.pattern ?? "";
  if (name === "Glob") return input.pattern ?? "";
  if (name === "Skill") return input.command ?? input.name ?? input.skill ?? "";
  const firstKey = Object.keys(input)[0];
  const val = firstKey ? input[firstKey] : "";
  return typeof val === "string" ? val.slice(0, 80) : "";
}

interface TurnArgs {
  prompt: string;
  resume?: string;
  settings: Settings;
  append: string;
  phase: string;
  allowedTools?: string[];
  emit: Emit;
  abort: AbortController;
}

// Run one query() turn. Streams text deltas + tool activity; returns the final
// answer text and the (possibly new) session id.
async function runTurn(args: TurnArgs): Promise<{ text: string; sessionId?: string }> {
  let finalText = "";
  let streamed = "";
  let sessionId = args.resume;

  const options: any = {
    cwd: args.settings.vaultDir,
    model: args.settings.model || DEFAULT_MODEL,
    maxThinkingTokens: REASONING[args.settings.effort] ?? REASONING.medium,
    settingSources: ["user", "project"],
    allowedTools: args.allowedTools ?? DEFAULT_TOOLS,
    permissionMode: "bypassPermissions",
    includePartialMessages: true,
    systemPrompt: { type: "preset", preset: "claude_code", append: args.append },
    abortController: args.abort,
    maxTurns: args.settings.maxTurns ?? 24,
  };
  if (args.settings.extraDirs?.length) options.additionalDirectories = args.settings.extraDirs;
  if (args.resume) options.resume = args.resume;

  for await (const msg of query({ prompt: args.prompt, options }) as AsyncIterable<any>) {
    if (msg.type === "system" && msg.subtype === "init") {
      sessionId = msg.session_id;
      args.emit("session", { sessionId });
    } else if (msg.type === "stream_event") {
      const ev = msg.event;
      if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") {
        streamed += ev.delta.text;
        args.emit("text", { phase: args.phase, delta: ev.delta.text });
      }
    } else if (msg.type === "assistant") {
      for (const block of msg.message?.content ?? []) {
        if (block.type === "tool_use") {
          args.emit("activity", {
            tool: block.name,
            input: summarizeToolInput(block.name, block.input),
          });
        }
      }
    } else if (msg.type === "result") {
      if (msg.subtype === "success" && typeof msg.result === "string") {
        finalText = msg.result;
      }
      sessionId = msg.session_id ?? sessionId;
    }
  }

  return { text: finalText || streamed, sessionId };
}

// Retrieve relevant vault excerpts for a query and report them in the activity
// log. Returns empty context when nothing matches (callers fall back to the
// normal whole-vault path).
async function retrieveForQuery(settings: Settings, query: string, emit: Emit): Promise<string> {
  const r = await retrieveContext(settings.vaultDir, settings.extraDirs ?? [], query);
  if (!r.context) return "";
  emit("activity", {
    tool: "RAG",
    input: `${r.chunkCount} excerpt${r.chunkCount === 1 ? "" : "s"} · ${r.fileCount} file${r.fileCount === 1 ? "" : "s"} · ~${Math.max(1, Math.round(r.bytes / 1000))}KB`,
  });
  for (const s of r.sources) {
    emit("activity", { tool: "RAG", input: s.heading ? `${s.file} › ${s.heading}` : s.file });
  }
  return r.context;
}

interface GenerateArgs {
  jobDescription: string;
  question: string;
  yc: boolean;
  rag: boolean;
  mode: TabMode;
  settings: Settings;
}

export async function generate(tabId: string, args: GenerateArgs, emit: Emit): Promise<void> {
  const abort = new AbortController();
  sessions.set(tabId, { ...sessions.get(tabId), abort });

  const isGemini = args.settings.engine === "gemini";
  const isAsk = args.mode === "ask";
  const skills = await detectSkills(args.settings.vaultDir);
  // The yc-combinator skill is Claude-only and job-mode-only.
  const useYc = !isAsk && !isGemini && args.yc && skills.yc;
  if (!isAsk && args.yc && !useYc) {
    emit("notice", {
      message: isGemini
        ? "YC styling uses the Claude-only yc-combinator skill and is skipped on the Gemini engine."
        : "yc-combinator skill not found — generated without YC styling. Add it at ~/.claude/skills/yc-combinator to enable.",
    });
  }

  let finalText = "";
  let finalSession: string | undefined;

  // Ask mode retrieves on the question alone; job mode also factors in the JD.
  const ragQuery = isAsk ? args.question : `${args.jobDescription}\n\n${args.question}`;

  if (isAsk) {
    // ── Ask mode: a single grounded answer turn, no humanize pass ──────────
    let ragContext = "";
    if (args.rag) {
      ragContext = await retrieveForQuery(args.settings, ragQuery, emit);
      if (!ragContext) {
        emit("notice", {
          message: "RAG found no matching vault excerpts — falling back to full vault reading for this answer.",
        });
      }
    }
    const useRag = Boolean(ragContext);

    emit("phase", { phase: "draft" });
    if (isGemini) {
      if (!geminiAvailable()) {
        emit("error", {
          message: "The `agy` CLI was not found on PATH. Install Gemini Antigravity CLI, or switch the engine to Claude in Settings.",
        });
        return;
      }
      let context = ragContext;
      if (!context) context = await gatherVaultContext(args.settings.vaultDir, args.settings.extraDirs ?? []);
      finalText = await runAgyTurn({
        prompt: buildGeminiAskPrompt(ASK_PERSONA, context, args.question),
        phase: "draft",
        emit,
        abort,
      });
    } else {
      const ans = await runTurn({
        prompt: useRag ? buildRagAskPrompt(ragContext, args.question) : buildAskPrompt(args.question),
        settings: args.settings,
        append: buildAppend({ persona: ASK_PERSONA, mode: "ask", useRag, phase: "draft" }),
        allowedTools: useRag ? RAG_TOOLS : undefined,
        phase: "draft",
        emit,
        abort,
      });
      finalText = ans.text;
      finalSession = ans.sessionId;
    }

    sessions.set(tabId, { sessionId: finalSession, abort: undefined, lastAnswer: finalText });
    await persistSessions();
    emit("done", { text: finalText, sessionId: finalSession });
    return;
  }

  if (isGemini) {
    if (!geminiAvailable()) {
      emit("error", {
        message: "The `agy` CLI was not found on PATH. Install Gemini Antigravity CLI, or switch the engine to Claude in Settings.",
      });
      return;
    }
    // Inject vault context ourselves (read-only); agy runs sandboxed. With RAG on
    // we send only the retrieved excerpts instead of dumping the whole vault.
    let context = "";
    if (args.rag) context = await retrieveForQuery(args.settings, ragQuery, emit);
    if (!context) context = await gatherVaultContext(args.settings.vaultDir, args.settings.extraDirs ?? []);
    emit("phase", { phase: "draft" });
    const draft = await runAgyTurn({
      prompt: buildGeminiDraftPrompt(args.settings.persona, context, args.jobDescription, args.question),
      phase: "draft",
      emit,
      abort,
    });
    emit("draft", { text: draft });
    finalText = draft;

    if (args.settings.humanize && draft) {
      emit("phase", { phase: "humanize" });
      const hum = await runAgyTurn({
        prompt: buildGeminiHumanizePrompt(draft),
        phase: "humanize",
        emit,
        abort,
      });
      if (hum) finalText = hum;
    }
  } else {
    // Claude pipeline: draft turn, then humanizer-skill turn.
    // With RAG on we retrieve the relevant excerpts up front, inject them, and
    // disable file-browsing tools so the agent never reads the whole vault.
    let ragContext = "";
    if (args.rag) {
      ragContext = await retrieveForQuery(args.settings, ragQuery, emit);
      if (!ragContext) {
        emit("notice", {
          message: "RAG found no matching vault excerpts — falling back to full vault reading for this answer.",
        });
      }
    }
    const useRag = Boolean(ragContext);
    const tools = useRag ? RAG_TOOLS : undefined;

    emit("phase", { phase: "draft" });
    const draft = await runTurn({
      prompt: useRag
        ? buildRagDraftPrompt(ragContext, args.jobDescription, args.question)
        : buildDraftPrompt(args.jobDescription, args.question),
      settings: args.settings,
      append: buildAppend({ persona: args.settings.persona, mode: "job", useYc, useRag, phase: "draft" }),
      allowedTools: tools,
      phase: "draft",
      emit,
      abort,
    });
    emit("draft", { text: draft.text });
    finalText = draft.text;
    finalSession = draft.sessionId;

    if (args.settings.humanize) {
      emit("phase", { phase: "humanize" });
      const hum = await runTurn({
        prompt:
          "Apply the humanizer skill to your previous answer. Return ONLY the final humanized version of the answer text — no commentary, no drafts, no audit notes.",
        resume: draft.sessionId,
        settings: args.settings,
        append: buildAppend({ persona: args.settings.persona, mode: "job", useYc, useRag, phase: "humanize" }),
        allowedTools: tools,
        phase: "humanize",
        emit,
        abort,
      });
      if (hum.text) finalText = hum.text;
      finalSession = hum.sessionId;
    }
  }

  sessions.set(tabId, { sessionId: finalSession, abort: undefined, lastAnswer: finalText });
  await persistSessions();
  emit("done", { text: finalText, sessionId: finalSession });
}

interface FollowUpArgs {
  text: string;
  rag: boolean;
  mode: TabMode;
  settings: Settings;
}

export async function followUp(tabId: string, args: FollowUpArgs, emit: Emit): Promise<void> {
  const prev = sessions.get(tabId);
  const abort = new AbortController();
  sessions.set(tabId, { ...prev, abort });

  emit("phase", { phase: "followup" });

  // Ask follow-ups keep the general assistant voice; job follow-ups keep the
  // configurable job persona. The resumed session re-receives this each turn.
  const persona = args.mode === "ask" ? ASK_PERSONA : args.settings.persona;

  let finalText = "";
  let finalSession = prev?.sessionId;

  if (args.settings.engine === "gemini") {
    if (!geminiAvailable()) {
      emit("error", { message: "The `agy` CLI was not found on PATH. Switch the engine to Claude in Settings." });
      return;
    }
    let context = "";
    if (args.rag) context = await retrieveForQuery(args.settings, args.text, emit);
    if (!context) context = await gatherVaultContext(args.settings.vaultDir, args.settings.extraDirs ?? []);
    finalText = await runAgyTurn({
      prompt: buildGeminiFollowupPrompt(persona, context, prev?.lastAnswer ?? "", args.text),
      phase: "followup",
      emit,
      abort,
    });
  } else {
    // With RAG on, refresh excerpts for the tweak and keep file-browsing disabled.
    let ragContext = "";
    if (args.rag) ragContext = await retrieveForQuery(args.settings, args.text, emit);
    const useRag = Boolean(ragContext);
    const r = await runTurn({
      prompt: useRag ? buildRagFollowupPrompt(ragContext, args.text) : args.text,
      resume: prev?.sessionId,
      settings: args.settings,
      append: buildAppend({ persona, mode: args.mode, useRag, phase: "followup" }),
      allowedTools: useRag ? RAG_TOOLS : undefined,
      phase: "followup",
      emit,
      abort,
    });
    finalText = r.text;
    finalSession = r.sessionId;
  }

  sessions.set(tabId, { sessionId: finalSession, abort: undefined, lastAnswer: finalText });
  await persistSessions();
  emit("done", { text: finalText, sessionId: finalSession });
}

interface CleanupArgs {
  text: string;
  settings: Settings;
}

// Polish the supplied answer text (grammar fix + humanize) with the lightweight
// cleanup model. Runs a fresh, throwaway turn on the exact text passed in
// (including any manual edits) — it does NOT resume the tab's conversation, and
// it preserves the tab's real follow-up session id.
export async function cleanup(tabId: string, args: CleanupArgs, emit: Emit): Promise<void> {
  const prev = sessions.get(tabId);
  const abort = new AbortController();
  sessions.set(tabId, { ...prev, abort });

  emit("phase", { phase: "cleanup" });

  const text = args.text.trim();
  if (!text) {
    sessions.set(tabId, { ...prev, abort: undefined });
    emit("done", { text: "", sessionId: prev?.sessionId });
    return;
  }

  const skills = await detectSkills(args.settings.vaultDir);
  let cleaned = text;

  if (args.settings.engine === "gemini") {
    if (!geminiAvailable()) {
      emit("error", { message: "The `agy` CLI was not found on PATH. Switch the engine to Claude in Settings." });
      return;
    }
    const out = await runAgyTurn({
      prompt: buildGeminiCleanupPrompt(text),
      phase: "cleanup",
      emit,
      abort,
    });
    if (out) cleaned = out;
  } else {
    // Lightweight: cleanup model + low reasoning, Skill tool only (no file browsing).
    const cleanupSettings: Settings = {
      ...args.settings,
      model: args.settings.cleanupModel || DEFAULT_CLEANUP_MODEL,
      effort: "low",
    };
    const r = await runTurn({
      prompt: buildCleanupPrompt(text, skills.humanizer),
      settings: cleanupSettings,
      append: buildCleanupAppend(skills.humanizer),
      allowedTools: RAG_TOOLS,
      phase: "cleanup",
      emit,
      abort,
    });
    if (r.text) cleaned = r.text;
  }

  sessions.set(tabId, { sessionId: prev?.sessionId, abort: undefined, lastAnswer: cleaned });
  emit("done", { text: cleaned, sessionId: prev?.sessionId });
}

export function hasSession(tabId: string): boolean {
  return Boolean(sessions.get(tabId)?.sessionId);
}

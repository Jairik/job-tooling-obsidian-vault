// Wraps the Claude Agent SDK query() into the per-tab pipeline:
//   generate = draft turn -> humanize turn
//   followUp = single resumed turn
// Streams SSE-style events out via an `emit` callback and tracks one Claude Code
// session per tab (persisted to .sessions.json so follow-ups survive a restart).
import { query } from "@anthropic-ai/claude-agent-sdk";
import { join } from "path";
import {
  DEFAULT_MODEL,
  DEFAULT_CLEANUP_MODEL,
  claudeReasoningTokens,
  effectiveEngineModel,
  ASK_PERSONA,
  buildAppend,
  buildDraftPrompt,
  buildRagDraftPrompt,
  buildRagFollowupPrompt,
  buildAskPrompt,
  buildRagAskPrompt,
  buildCleanupPrompt,
  buildCleanupAppend,
  buildCliDraftPrompt,
  buildCliHumanizePrompt,
  buildCliFollowupPrompt,
  buildCliAskPrompt,
  buildCliCleanupPrompt,
  buildSummarizePrompt,
  buildAutoPlacePrompt,
  buildFillinScanPrompt,
  buildFillinAnswerPrompt,
  buildWriteCleanupPrompt,
  buildSkillsNote,
  type Settings,
  type TabMode,
  type SkillNote,
} from "./config";
import { detectSkills, listSkills } from "./skills";
import { cliAvailable, runCliTurn, gatherVaultContext } from "./gemini";
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
    model: effectiveEngineModel(args.settings, "claude") || DEFAULT_MODEL,
    maxThinkingTokens: claudeReasoningTokens(args.settings),
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

// Resolve the user's selected skill names into prompt notes (name + description).
// On CLI engines the Skill tool is unavailable, so any selection is skipped with
// a notice; names that don't match an installed skill are reported and dropped.
async function resolveSkillNotes(
  settings: Settings,
  names: string[] | undefined,
  isCliEngine: boolean,
  emit: Emit
): Promise<SkillNote[]> {
  const selected = names ?? [];
  if (!selected.length) return [];
  if (isCliEngine) {
    emit("notice", {
      message: `Skills use the Claude-only Skill tool and are skipped on the \`${settings.engine}\` CLI engine.`,
    });
    return [];
  }
  const byName = new Map((await listSkills(settings.vaultDir)).map((s) => [s.name, s]));
  const notes: SkillNote[] = [];
  const missing: string[] = [];
  for (const n of selected) {
    const info = byName.get(n);
    if (info) notes.push({ name: info.name, description: info.description });
    else missing.push(n);
  }
  if (missing.length) {
    emit("notice", { message: `Skill${missing.length === 1 ? "" : "s"} not found and skipped: ${missing.join(", ")}.` });
  }
  return notes;
}

// Ensure the Skill tool is allowed when skills are selected so the agent can
// invoke them. `undefined` keeps the default tool set (which already has Skill).
function withSkillTool(tools: string[] | undefined, hasSkills: boolean): string[] | undefined {
  if (!hasSkills || tools === undefined) return tools;
  return tools.includes("Skill") ? tools : ["Skill", ...tools];
}

interface GenerateArgs {
  jobDescription: string;
  question: string;
  skills: string[];
  rag: boolean;
  mode: TabMode;
  settings: Settings;
}

export async function generate(tabId: string, args: GenerateArgs, emit: Emit): Promise<void> {
  const abort = new AbortController();
  sessions.set(tabId, { ...sessions.get(tabId), abort });

  const isCliEngine = args.settings.engine !== "claude";
  const isAsk = args.mode === "ask";
  // Selected skills apply to every mode (Claude engine only — CLI has no Skill tool).
  const skillNotes = await resolveSkillNotes(args.settings, args.skills, isCliEngine, emit);

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
    if (isCliEngine) {
      if (!cliAvailable(args.settings.engine)) {
        emit("error", {
          message: `The \`${args.settings.engine}\` CLI was not found on PATH. Install it, or switch the engine to Claude in Settings.`,
        });
        return;
      }
      let context = ragContext;
      if (!context) context = await gatherVaultContext(args.settings.vaultDir, args.settings.extraDirs ?? []);
      finalText = await runCliTurn(args.settings.engine, {
        prompt: buildCliAskPrompt(ASK_PERSONA, context, args.question),
        phase: "draft",
        emit,
        abort,
        settings: args.settings,
      });
    } else {
      const ans = await runTurn({
        prompt: useRag ? buildRagAskPrompt(ragContext, args.question) : buildAskPrompt(args.question),
        settings: args.settings,
        append: buildAppend({ persona: ASK_PERSONA, mode: "ask", skills: skillNotes, useRag, phase: "draft" }),
        allowedTools: withSkillTool(useRag ? RAG_TOOLS : undefined, skillNotes.length > 0),
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

  if (isCliEngine) {
    if (!cliAvailable(args.settings.engine)) {
      emit("error", {
        message: `The \`${args.settings.engine}\` CLI was not found on PATH. Install it, or switch the engine to Claude in Settings.`,
      });
      return;
    }
    // Inject vault context ourselves (read-only); CLI runs sandboxed. With RAG on
    // we send only the retrieved excerpts instead of dumping the whole vault.
    let context = "";
    if (args.rag) context = await retrieveForQuery(args.settings, ragQuery, emit);
    if (!context) context = await gatherVaultContext(args.settings.vaultDir, args.settings.extraDirs ?? []);
    emit("phase", { phase: "draft" });
    const draft = await runCliTurn(args.settings.engine, {
      prompt: buildCliDraftPrompt(args.settings.persona, context, args.jobDescription, args.question),
      phase: "draft",
      emit,
      abort,
      settings: args.settings,
    });
    emit("draft", { text: draft });
    finalText = draft;

    if (args.settings.humanize && draft) {
      emit("phase", { phase: "humanize" });
      const hum = await runCliTurn(args.settings.engine, {
        prompt: buildCliHumanizePrompt(draft),
        phase: "humanize",
        emit,
        abort,
        settings: args.settings,
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
    const tools = withSkillTool(useRag ? RAG_TOOLS : undefined, skillNotes.length > 0);

    emit("phase", { phase: "draft" });
    const draft = await runTurn({
      prompt: useRag
        ? buildRagDraftPrompt(ragContext, args.jobDescription, args.question)
        : buildDraftPrompt(args.jobDescription, args.question),
      settings: args.settings,
      append: buildAppend({ persona: args.settings.persona, mode: "job", skills: skillNotes, useRag, phase: "draft" }),
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
        append: buildAppend({ persona: args.settings.persona, mode: "job", skills: skillNotes, useRag, phase: "humanize" }),
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
  skills: string[];
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
  const isCliEngine = args.settings.engine !== "claude";
  const skillNotes = await resolveSkillNotes(args.settings, args.skills, isCliEngine, emit);

  let finalText = "";
  let finalSession = prev?.sessionId;

  if (isCliEngine) {
    if (!cliAvailable(args.settings.engine)) {
      emit("error", { message: `The \`${args.settings.engine}\` CLI was not found on PATH. Switch the engine to Claude in Settings.` });
      return;
    }
    let context = "";
    if (args.rag) context = await retrieveForQuery(args.settings, args.text, emit);
    if (!context) context = await gatherVaultContext(args.settings.vaultDir, args.settings.extraDirs ?? []);
    finalText = await runCliTurn(args.settings.engine, {
      prompt: buildCliFollowupPrompt(persona, context, prev?.lastAnswer ?? "", args.text),
      phase: "followup",
      emit,
      abort,
      settings: args.settings,
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
      append: buildAppend({ persona, mode: args.mode, skills: skillNotes, useRag, phase: "followup" }),
      allowedTools: withSkillTool(useRag ? RAG_TOOLS : undefined, skillNotes.length > 0),
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
  skills: string[];
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

  const isCliEngine = args.settings.engine !== "claude";
  const skills = await detectSkills(args.settings.vaultDir);
  const skillNotes = await resolveSkillNotes(args.settings, args.skills, isCliEngine, emit);
  let cleaned = text;

  if (isCliEngine) {
    if (!cliAvailable(args.settings.engine)) {
      emit("error", { message: `The \`${args.settings.engine}\` CLI was not found on PATH. Switch the engine to Claude in Settings.` });
      return;
    }
    const out = await runCliTurn(args.settings.engine, {
      prompt: buildCliCleanupPrompt(text),
      phase: "cleanup",
      emit,
      abort,
      settings: args.settings,
    });
    if (out) cleaned = out;
  } else {
    // Lightweight: cleanup model + low reasoning, Skill tool only (no file browsing).
    const cleanupSettings: Settings = {
      ...args.settings,
      model: args.settings.cleanupModel || DEFAULT_CLEANUP_MODEL,
      effort: "low",
      engineModels: { ...(args.settings.engineModels ?? {}), claude: args.settings.cleanupModel || DEFAULT_CLEANUP_MODEL },
      engineReasoning: { ...(args.settings.engineReasoning ?? {}), claude: "low" },
    };
    const note = buildSkillsNote(skillNotes);
    const baseAppend = buildCleanupAppend(skills.humanizer);
    const r = await runTurn({
      prompt: buildCleanupPrompt(text, skills.humanizer),
      settings: cleanupSettings,
      append: note ? `${baseAppend}\n\n${note}` : baseAppend,
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

// ── Vault Writer pipeline ───────────────────────────────────────────────────

interface SummarizeArgs {
  input: string;
  isUrl: boolean;
  skills: string[];
  settings: Settings;
}

export async function summarize(tabId: string, args: SummarizeArgs, emit: Emit): Promise<void> {
  const abort = new AbortController();
  sessions.set(tabId, { ...sessions.get(tabId), abort });

  emit("phase", { phase: "draft" });

  let sourceText = args.input.trim();
  // If input is a URL, the server should have already fetched + extracted the text
  // and passed it as `input`. We just summarize whatever text we receive.

  const isCliEngine = args.settings.engine !== "claude";
  const skillNotes = await resolveSkillNotes(args.settings, args.skills, isCliEngine, emit);
  let context = await gatherVaultContext(args.settings.vaultDir, args.settings.extraDirs ?? []);

  let finalText = "";

  if (isCliEngine) {
    if (!cliAvailable(args.settings.engine)) {
      emit("error", { message: `The \`${args.settings.engine}\` CLI was not found on PATH.` });
      return;
    }
    finalText = await runCliTurn(args.settings.engine, {
      prompt: buildSummarizePrompt(sourceText, context),
      phase: "draft",
      emit,
      abort,
      settings: args.settings,
    });
  } else {
    const note = buildSkillsNote(skillNotes);
    const baseAppend = "You are summarizing content for a personal knowledge vault. Produce clean, well-structured markdown.";
    const r = await runTurn({
      prompt: buildSummarizePrompt(sourceText, context),
      settings: args.settings,
      append: note ? `${baseAppend}\n\n${note}` : baseAppend,
      allowedTools: ["Skill"],
      phase: "draft",
      emit,
      abort,
    });
    finalText = r.text;
  }

  sessions.set(tabId, { ...sessions.get(tabId), abort: undefined });
  emit("done", { text: finalText });
}

interface AutoPlaceArgs {
  content: string;
  settings: Settings;
}

export async function autoPlace(tabId: string, args: AutoPlaceArgs, emit: Emit): Promise<void> {
  const abort = new AbortController();
  sessions.set(tabId, { ...sessions.get(tabId), abort });

  emit("phase", { phase: "draft" });

  // Build a simple directory listing of the vault for the agent.
  const { readdirSync, statSync } = await import("fs");
  const { join, relative } = await import("path");
  const SKIP = new Set([".git", ".obsidian", "node_modules", ".trash"]);

  function listDirs(dir: string, depth = 0): string[] {
    if (depth > 4) return [];
    const lines: string[] = [];
    try {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        if (!ent.isDirectory() || SKIP.has(ent.name)) continue;
        const rel = relative(args.settings.vaultDir, join(dir, ent.name));
        lines.push("  ".repeat(depth) + rel + "/");
        lines.push(...listDirs(join(dir, ent.name), depth + 1));
      }
    } catch { /* skip unreadable */ }
    return lines;
  }

  const structure = listDirs(args.settings.vaultDir).join("\n");

  const isCliEngine = args.settings.engine !== "claude";
  let finalText = "";

  if (isCliEngine) {
    if (!cliAvailable(args.settings.engine)) {
      emit("error", { message: `The \`${args.settings.engine}\` CLI was not found on PATH.` });
      return;
    }
    finalText = await runCliTurn(args.settings.engine, {
      prompt: buildAutoPlacePrompt(args.content, structure),
      phase: "draft",
      emit,
      abort,
      settings: args.settings,
    });
  } else {
    const r = await runTurn({
      prompt: buildAutoPlacePrompt(args.content, structure),
      settings: { ...args.settings, effort: "low", engineReasoning: { ...(args.settings.engineReasoning ?? {}), claude: "low" } },
      append: "Suggest the best file path in the vault for this content. Respond with ONLY the path.",
      allowedTools: ["Skill"],
      phase: "draft",
      emit,
      abort,
    });
    finalText = r.text;
  }

  // Clean the response to just the path
  const suggestedPath = finalText.trim().split("\n")[0].trim().replace(/^["'`]+|["'`]+$/g, "");
  sessions.set(tabId, { ...sessions.get(tabId), abort: undefined });
  emit("done", { text: suggestedPath });
}

interface FillinScanArgs {
  prompt?: string;
  dir?: string;
  settings: Settings;
}

export async function fillinScan(tabId: string, args: FillinScanArgs, emit: Emit): Promise<void> {
  const abort = new AbortController();
  sessions.set(tabId, { ...sessions.get(tabId), abort });

  emit("phase", { phase: "draft" });

  const scanDir = args.dir || args.settings.vaultDir;
  const context = await gatherVaultContext(scanDir, args.settings.extraDirs ?? []);

  const isCliEngine = args.settings.engine !== "claude";
  let finalText = "";

  if (isCliEngine) {
    if (!cliAvailable(args.settings.engine)) {
      emit("error", { message: `The \`${args.settings.engine}\` CLI was not found on PATH.` });
      return;
    }
    finalText = await runCliTurn(args.settings.engine, {
      prompt: buildFillinScanPrompt(context, args.prompt),
      phase: "draft",
      emit,
      abort,
      settings: args.settings,
    });
  } else {
    const r = await runTurn({
      prompt: buildFillinScanPrompt(context, args.prompt),
      settings: args.settings,
      append: "Analyze the vault and return a JSON array of questions about missing information.",
      allowedTools: ["Read", "Grep", "Glob"],
      phase: "draft",
      emit,
      abort,
    });
    finalText = r.text;
  }

  sessions.set(tabId, { ...sessions.get(tabId), abort: undefined });
  emit("done", { text: finalText });
}

interface FillinWriteArgs {
  question: string;
  answer: string;
  targetPath: string;
  skills: string[];
  settings: Settings;
}

export async function fillinWrite(tabId: string, args: FillinWriteArgs, emit: Emit): Promise<void> {
  const abort = new AbortController();
  sessions.set(tabId, { ...sessions.get(tabId), abort });

  emit("phase", { phase: "draft" });

  const context = await gatherVaultContext(args.settings.vaultDir, args.settings.extraDirs ?? []);

  const isCliEngine = args.settings.engine !== "claude";
  const skillNotes = await resolveSkillNotes(args.settings, args.skills, isCliEngine, emit);
  let finalText = "";

  if (isCliEngine) {
    if (!cliAvailable(args.settings.engine)) {
      emit("error", { message: `The \`${args.settings.engine}\` CLI was not found on PATH.` });
      return;
    }
    finalText = await runCliTurn(args.settings.engine, {
      prompt: buildFillinAnswerPrompt(context, args.question, args.answer, args.targetPath),
      phase: "draft",
      emit,
      abort,
      settings: args.settings,
    });
  } else {
    const note = buildSkillsNote(skillNotes);
    const baseAppend = "Format the user's answer into clean vault markdown. Output ONLY the formatted content.";
    const r = await runTurn({
      prompt: buildFillinAnswerPrompt(context, args.question, args.answer, args.targetPath),
      settings: args.settings,
      append: note ? `${baseAppend}\n\n${note}` : baseAppend,
      allowedTools: ["Skill"],
      phase: "draft",
      emit,
      abort,
    });
    finalText = r.text;
  }

  sessions.set(tabId, { ...sessions.get(tabId), abort: undefined });
  emit("done", { text: finalText });
}

interface WriteCleanupArgs {
  text: string;
  skills: string[];
  settings: Settings;
}

export async function writeCleanup(tabId: string, args: WriteCleanupArgs, emit: Emit): Promise<void> {
  const abort = new AbortController();
  sessions.set(tabId, { ...sessions.get(tabId), abort });

  emit("phase", { phase: "cleanup" });

  const isCliEngine = args.settings.engine !== "claude";
  const skillNotes = await resolveSkillNotes(args.settings, args.skills, isCliEngine, emit);
  let finalText = args.text;

  if (isCliEngine) {
    if (!cliAvailable(args.settings.engine)) {
      emit("error", { message: `The \`${args.settings.engine}\` CLI was not found on PATH.` });
      return;
    }
    const out = await runCliTurn(args.settings.engine, {
      prompt: buildWriteCleanupPrompt(args.text),
      phase: "cleanup",
      emit,
      abort,
      settings: args.settings,
    });
    if (out) finalText = out;
  } else {
    const note = buildSkillsNote(skillNotes);
    const baseAppend = "Clean up and format the text into well-structured vault markdown.";
    const r = await runTurn({
      prompt: buildWriteCleanupPrompt(args.text),
      settings: {
        ...args.settings,
        model: args.settings.cleanupModel || DEFAULT_CLEANUP_MODEL,
        effort: "low",
        engineModels: { ...(args.settings.engineModels ?? {}), claude: args.settings.cleanupModel || DEFAULT_CLEANUP_MODEL },
        engineReasoning: { ...(args.settings.engineReasoning ?? {}), claude: "low" },
      },
      append: note ? `${baseAppend}\n\n${note}` : baseAppend,
      allowedTools: ["Skill"],
      phase: "cleanup",
      emit,
      abort,
    });
    if (r.text) finalText = r.text;
  }

  sessions.set(tabId, { ...sessions.get(tabId), abort: undefined });
  emit("done", { text: finalText });
}

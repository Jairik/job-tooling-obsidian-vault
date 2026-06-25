// Wraps the Claude Agent SDK query() into the per-tab pipeline:
//   generate = draft turn -> humanize turn
//   followUp = single resumed turn
// Streams SSE-style events out via an `emit` callback and tracks one Claude Code
// session per tab (persisted to .sessions.json so follow-ups survive a restart).
import { query } from "@anthropic-ai/claude-agent-sdk";
import { join } from "path";
import {
  claudeReasoningTokens,
  resolveAskPersona,
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
  buildGenerateSkillPrompt,
  buildRewriteSkillPrompt,
  buildSkillsNote,
  type SkillNote,
} from "./config";
import { DEFAULT_CLAUDE_MODEL, DEFAULT_CLEANUP_MODEL, effectiveEngineModel, type TabMode } from "../shared/settings";
import type { ServerSettings } from "./config";
import { detectSkills, loadSelectedSkills, loadSkillCreatorGuide, parseGeneratedSkill } from "./skills";
import { cliAvailable, runCliTurn, gatherVaultContext } from "./gemini";
import { retrieveContext } from "./rag";
import {
  buildWebResearchSkill,
  formatWebToolResult,
  parseWebToolRequest,
  runWebTool,
  webResearchEnabled,
} from "./web";

const DEFAULT_TOOLS = ["Skill", "Read", "Grep", "Glob"];
// In RAG mode the excerpts are injected into the prompt, so file-browsing tools
// are dropped — the agent can only run skills (e.g. humanizer). This is what
// keeps token usage down: no autonomous Read/Grep/Glob over the whole vault.
const RAG_TOOLS = ["Skill"];

type Emit = (event: string, data: unknown) => void;

interface TabSession {
  sessionId?: string;
  abort?: AbortController;
  lastAnswer?: string; // used by the stateless Gemini follow-up path
}

const sessions = new Map<string, TabSession>();
const SESS_PATH = join(import.meta.dir, "..", ".sessions.json");

/* Restores per-tab Claude session identifiers after a server restart. */
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

/* Writes the current session map so follow-up turns can resume conversations. */
async function persistSessions(): Promise<void> {
  const obj: Record<string, string> = {};
  for (const [k, v] of sessions) if (v.sessionId) obj[k] = v.sessionId;
  await Bun.write(SESS_PATH, JSON.stringify(obj, null, 2));
}

/* Aborts the in-flight model request associated with a browser tab. */
export function cancel(tabId: string): void {
  sessions.get(tabId)?.abort?.abort();
}


/* Reduces verbose SDK tool input to a short activity-log description. */
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
  settings: ServerSettings;
  append: string;
  phase: string;
  allowedTools?: string[];
  emit: Emit;
  abort: AbortController;
  // Agentic web-research requests are protocol messages, not user-visible text.
  // The mediator emits only the final answer after fulfilling any requested reads.
  suppressText?: boolean;
}

// Run one query() turn. Streams text deltas + tool activity; returns the final
// answer text and the (possibly new) session id.
/* Runs one Claude SDK turn and relays its text and tool activity as SSE events. */
async function runTurn(args: TurnArgs): Promise<{ text: string; sessionId?: string }> {
  let finalText = "";
  let streamed = "";
  let sessionId = args.resume;

  const options: any = {
    cwd: args.settings.vaultDir,
    model: effectiveEngineModel(args.settings, "claude") || DEFAULT_CLAUDE_MODEL,
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
        if (!args.suppressText) args.emit("text", { phase: args.phase, delta: ev.delta.text });
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
/* Retrieves relevant vault excerpts only when RAG is enabled for the request. */
async function retrieveForQuery(settings: ServerSettings, query: string, emit: Emit): Promise<string> {
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

// Resolve selected names into complete SKILL.md instruction bundles. The bundles
// are prompt-injected for CLI engines and included in Claude's system prompt, so
// skill selection behaves identically regardless of the active agent.
/* Resolves user-selected skills into portable prompt instructions. */
async function resolveSkillNotes(
  settings: ServerSettings,
  names: string[] | undefined,
  emit: Emit
): Promise<SkillNote[]> {
  const { skills, missing, unreadable } = await loadSelectedSkills(settings.vaultDir, names);
  if (missing.length) {
    emit("notice", { message: `Skill${missing.length === 1 ? "" : "s"} not found and skipped: ${missing.join(", ")}.` });
  }
  if (unreadable.length) {
    emit("notice", { message: `Skill${unreadable.length === 1 ? "" : "s"} could not be read and skipped: ${unreadable.join(", ")}.` });
  }
  return skills;
}

const MAX_WEB_TOOL_CALLS = 4;

interface WebTurnResult {
  text: string;
  sessionId?: string;
}

interface WebResearchLoopArgs {
  task: string;
  settings: ServerSettings;
  phase: string;
  emit: Emit;
  abort: AbortController;
  // The boolean suppresses intermediate model text. It is required because a
  // cross-engine text protocol has no native "tool call" event to hide for us.
  execute: (prompt: string, suppressText: boolean) => Promise<WebTurnResult>;
}

/*
 * Gives every engine the identical text-based web tool contract. Claude has
 * native tools and each CLI has its own tool API, but those APIs are not portable;
 * this bounded request/result loop is. It is deliberately server-mediated rather
 * than letting a model run shell commands or reach arbitrary network targets.
 */
async function runWithWebResearch(args: WebResearchLoopArgs): Promise<WebTurnResult> {
  if (!webResearchEnabled(args.settings)) return args.execute(args.task, false);

  const skill = buildWebResearchSkill();
  const evidence: string[] = [];
  let prompt = `${skill}\n\nTASK\n${args.task}`;
  let last: WebTurnResult = { text: "" };

  for (let count = 0; count <= MAX_WEB_TOOL_CALLS; count++) {
    if (args.abort.signal.aborted) throw new Error("Generation cancelled.");
    last = await args.execute(prompt, true);
    const request = parseWebToolRequest(last.text);
    if (!request) {
      // Do not reveal a protocol-shaped intermediate response. The entire final
      // answer is emitted once, preserving clean output for every client engine.
      if (last.text) args.emit("text", { phase: args.phase, delta: last.text });
      return last;
    }

    if (count === MAX_WEB_TOOL_CALLS) {
      prompt = `${skill}\n\nThe web research limit has been reached. Do not request another tool. Answer the original task using only the vault context and the web evidence below.\n\nORIGINAL TASK\n${args.task}\n\n${evidence.join("\n\n")}`;
      last = await args.execute(prompt, true);
      if (last.text) args.emit("text", { phase: args.phase, delta: last.text });
      return last;
    }

    const input = request.tool === "web_search" ? request.query : request.url;
    args.emit("activity", { tool: request.tool === "web_search" ? "Web search" : "Web read", input });
    const result = await runWebTool(args.settings, request, args.abort.signal);
    if (result.ok && result.tool === "web_search") {
      args.emit("activity", { tool: "Web search", input: `${result.results.length} result${result.results.length === 1 ? "" : "s"}` });
    } else if (result.ok && result.tool === "web_read") {
      args.emit("activity", { tool: "Web read", input: result.page.sourceUrl });
    } else if (!result.ok) {
      args.emit("notice", { message: `Web research failed: ${result.error}` });
    }
    evidence.push(formatWebToolResult(result));
    prompt = `${skill}\n\nORIGINAL TASK\n${args.task}\n\n${evidence.join("\n\n")}\n\nContinue the task. Request another tool only if needed; otherwise provide the final answer.`;
  }

  return last;
}

/* Runs one stateless external CLI turn with the portable web research protocol. */
async function runCliAgentTurn(
  engine: ServerSettings["engine"],
  args: {
    prompt: string;
    skills?: SkillNote[];
    phase: string;
    emit: Emit;
    abort: AbortController;
    settings: ServerSettings;
  }
): Promise<string> {
  const result = await runWithWebResearch({
    task: args.prompt,
    settings: args.settings,
    phase: args.phase,
    emit: args.emit,
    abort: args.abort,
    execute: async (prompt, suppressText) => ({
      text: await runCliTurn(engine, { ...args, prompt, suppressText }),
    }),
  });
  return result.text;
}

/* Runs a Claude SDK turn with the same protocol while preserving its session id. */
async function runClaudeAgentTurn(args: TurnArgs): Promise<WebTurnResult> {
  let resume = args.resume;
  return runWithWebResearch({
    task: args.prompt,
    settings: args.settings,
    phase: args.phase,
    emit: args.emit,
    abort: args.abort,
    execute: async (prompt, suppressText) => {
      const result = await runTurn({ ...args, prompt, resume, suppressText });
      resume = result.sessionId ?? resume;
      return result;
    },
  });
}

// Claude's native Skill tool stays available where its own built-in workflows
// need it (notably the dedicated humanizer). Selected UI skills do not depend on
// that tool because their full text is embedded in the prompt for every engine.
/* Retains the native Skill tool in a restricted Claude tool list when needed. */
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
  settings: ServerSettings;
}

/* Generates a new answer, including draft/humanize phases when configured. */
export async function generate(tabId: string, args: GenerateArgs, emit: Emit): Promise<void> {
  const abort = new AbortController();
  sessions.set(tabId, { ...sessions.get(tabId), abort });

  const isCliEngine = args.settings.engine !== "claude";
  const isAsk = args.mode === "ask";
  // Resolve once so both the draft and optional humanize phase receive the same
  // selected skill instructions, independent of the chosen agent.
  const skillNotes = await resolveSkillNotes(args.settings, args.skills, emit);

  let finalText = "";
  let finalSession: string | undefined;

  // Ask mode retrieves on the question alone; job mode also factors in the JD.
  const ragQuery = isAsk ? args.question : `${args.jobDescription}\n\n${args.question}`;

  if (isAsk) {
    // ── Ask mode: a grounded answer turn, then an optional humanize pass ────
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
    // Reused by the draft and the humanize turn so both keep the Skill tool (for
    // the humanizer) and the same file-browsing restriction under RAG.
    const askTools = withSkillTool(useRag ? RAG_TOOLS : undefined, skillNotes.length > 0);

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
      finalText = await runCliAgentTurn(args.settings.engine, {
        prompt: buildCliAskPrompt(resolveAskPersona(args.settings), context, args.question),
        skills: skillNotes,
        phase: "draft",
        emit,
        abort,
        settings: args.settings,
      });
    } else {
      const ans = await runClaudeAgentTurn({
        prompt: useRag ? buildRagAskPrompt(ragContext, args.question) : buildAskPrompt(args.question),
        settings: args.settings,
        append: buildAppend({ persona: resolveAskPersona(args.settings), mode: "ask", skills: skillNotes, useRag, phase: "draft" }),
        allowedTools: askTools,
        phase: "draft",
        emit,
        abort,
      });
      finalText = ans.text;
      finalSession = ans.sessionId;
    }

    // The Humanize pre-packaged skill applies to every answer mode, so ask-mode
    // answers also get the de-AI rewrite when it is enabled.
    if (args.settings.humanize && finalText) {
      emit("phase", { phase: "humanize" });
      if (isCliEngine) {
        const hum = await runCliTurn(args.settings.engine, {
          prompt: buildCliHumanizePrompt(finalText),
          skills: skillNotes,
          phase: "humanize",
          emit,
          abort,
          settings: args.settings,
        });
        if (hum) finalText = hum;
      } else {
        const hum = await runTurn({
          prompt:
            "Apply the humanizer skill to your previous answer. Return ONLY the final humanized version of the answer text — no commentary, no drafts, no audit notes.",
          resume: finalSession,
          settings: args.settings,
          append: buildAppend({ persona: resolveAskPersona(args.settings), mode: "ask", skills: skillNotes, useRag, phase: "humanize" }),
          allowedTools: askTools,
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
    const draft = await runCliAgentTurn(args.settings.engine, {
      prompt: buildCliDraftPrompt(args.settings.persona, context, args.jobDescription, args.question),
      skills: skillNotes,
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
        skills: skillNotes,
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
    const draft = await runClaudeAgentTurn({
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
  settings: ServerSettings;
}

/* Revises the most recent answer using the follow-up text for a tab. */
export async function followUp(tabId: string, args: FollowUpArgs, emit: Emit): Promise<void> {
  const prev = sessions.get(tabId);
  const abort = new AbortController();
  sessions.set(tabId, { ...prev, abort });

  emit("phase", { phase: "followup" });

  // Ask follow-ups keep the general assistant voice; job follow-ups keep the
  // configurable job persona. The resumed session re-receives this each turn.
  const persona = args.mode === "ask" ? resolveAskPersona(args.settings) : args.settings.persona;
  const isCliEngine = args.settings.engine !== "claude";
  const skillNotes = await resolveSkillNotes(args.settings, args.skills, emit);

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
    finalText = await runCliAgentTurn(args.settings.engine, {
      prompt: buildCliFollowupPrompt(persona, context, prev?.lastAnswer ?? "", args.text),
      skills: skillNotes,
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
    const r = await runClaudeAgentTurn({
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
  settings: ServerSettings;
}

// Polish the supplied answer text (grammar fix + humanize) with the lightweight
// cleanup model. Runs a fresh, throwaway turn on the exact text passed in
// (including any manual edits) — it does NOT resume the tab's conversation, and
// it preserves the tab's real follow-up session id.
/* Runs the standalone cleanup pass over an existing answer. */
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
  const skillNotes = await resolveSkillNotes(args.settings, args.skills, emit);
  let cleaned = text;

  if (isCliEngine) {
    if (!cliAvailable(args.settings.engine)) {
      emit("error", { message: `The \`${args.settings.engine}\` CLI was not found on PATH. Switch the engine to Claude in Settings.` });
      return;
    }
    const out = await runCliTurn(args.settings.engine, {
      prompt: buildCliCleanupPrompt(text),
      skills: skillNotes,
      phase: "cleanup",
      emit,
      abort,
      settings: args.settings,
    });
    if (out) cleaned = out;
  } else {
    // Lightweight: cleanup model + low reasoning, Skill tool only (no file browsing).
    const cleanupSettings: ServerSettings = {
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

// ── Vault Writer pipeline ───────────────────────────────────────────────────

interface SummarizeArgs {
  input: string;
  isUrl: boolean;
  skills: string[];
  settings: ServerSettings;
}

interface EngineTurnArgs {
  settings: ServerSettings;
  claudeSettings?: ServerSettings;
  prompt: string;
  // Selected SKILL.md bundles forwarded to CLI prompts. Claude receives the same
  // bundle through its append field, so both execution paths stay equivalent.
  skills?: SkillNote[];
  append: string;
  allowedTools: string[];
  phase: string;
  emit: Emit;
  abort: AbortController;
}

// All Vault Writer actions share the same CLI-or-Claude dispatch. Keeping it in
// one place prevents the two execution paths from slowly gaining different
// availability checks, stream metadata, or model handling.
/* Routes one Vault Writer prompt through Claude or the selected sandboxed CLI. */
async function runWriterTurn({
  settings,
  claudeSettings = settings,
  prompt,
  skills,
  append,
  allowedTools,
  phase,
  emit,
  abort,
}: EngineTurnArgs): Promise<string | undefined> {
  if (settings.engine !== "claude") {
    if (!cliAvailable(settings.engine)) {
      emit("error", { message: `The \`${settings.engine}\` CLI was not found on PATH.` });
      return undefined;
    }
    return runCliTurn(settings.engine, { prompt, skills, phase, emit, abort, settings });
  }

  const result = await runTurn({
    prompt,
    settings: claudeSettings,
    append,
    allowedTools,
    phase,
    emit,
    abort,
  });
  return result.text;
}

/* Summarizes imported text into a vault-ready note. */
export async function summarize(tabId: string, args: SummarizeArgs, emit: Emit): Promise<void> {
  const abort = new AbortController();
  sessions.set(tabId, { ...sessions.get(tabId), abort });

  emit("phase", { phase: "draft" });

  let sourceText = args.input.trim();
  // If input is a URL, the server should have already fetched + extracted the text
  // and passed it as `input`. We just summarize whatever text we receive.

  const skillNotes = await resolveSkillNotes(args.settings, args.skills, emit);
  let context = await gatherVaultContext(args.settings.vaultDir, args.settings.extraDirs ?? []);

  const note = buildSkillsNote(skillNotes);
  const baseAppend = "You are summarizing content for a personal knowledge vault. Produce clean, well-structured markdown.";
  const finalText = await runWriterTurn({
    settings: args.settings,
    prompt: buildSummarizePrompt(sourceText, context),
    skills: skillNotes,
    append: note ? `${baseAppend}\n\n${note}` : baseAppend,
    allowedTools: ["Skill"],
    phase: "draft",
    emit,
    abort,
  });
  if (finalText === undefined) return;

  sessions.set(tabId, { ...sessions.get(tabId), abort: undefined });
  emit("done", { text: finalText });
}

interface AutoPlaceArgs {
  content: string;
  settings: ServerSettings;
}

/* Suggests the vault path where generated content belongs. */
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

  const finalText = await runWriterTurn({
    settings: args.settings,
    claudeSettings: { ...args.settings, effort: "low", engineReasoning: { ...(args.settings.engineReasoning ?? {}), claude: "low" } },
    prompt: buildAutoPlacePrompt(args.content, structure),
    append: "Suggest the best file path in the vault for this content. Respond with ONLY the path.",
    allowedTools: ["Skill"],
    phase: "draft",
    emit,
    abort,
  });
  if (finalText === undefined) return;

  // Clean the response to just the path
  const suggestedPath = finalText.trim().split("\n")[0].trim().replace(/^["'`]+|["'`]+$/g, "");
  sessions.set(tabId, { ...sessions.get(tabId), abort: undefined });
  emit("done", { text: suggestedPath });
}

interface FillinScanArgs {
  prompt?: string;
  dir?: string;
  settings: ServerSettings;
}

/* Finds prompts in the vault that need a generated answer. */
export async function fillinScan(tabId: string, args: FillinScanArgs, emit: Emit): Promise<void> {
  const abort = new AbortController();
  sessions.set(tabId, { ...sessions.get(tabId), abort });

  emit("phase", { phase: "draft" });

  const scanDir = args.dir || args.settings.vaultDir;
  const context = await gatherVaultContext(scanDir, args.settings.extraDirs ?? []);

  const finalText = await runWriterTurn({
    settings: args.settings,
    prompt: buildFillinScanPrompt(context, args.prompt),
    append: "Analyze the vault and return a JSON array of questions about missing information.",
    allowedTools: ["Read", "Grep", "Glob"],
    phase: "draft",
    emit,
    abort,
  });
  if (finalText === undefined) return;

  sessions.set(tabId, { ...sessions.get(tabId), abort: undefined });
  emit("done", { text: finalText });
}

interface FillinWriteArgs {
  question: string;
  answer: string;
  targetPath: string;
  skills: string[];
  settings: ServerSettings;
}

/* Drafts an answer for one selected fill-in-the-blank question. */
export async function fillinWrite(tabId: string, args: FillinWriteArgs, emit: Emit): Promise<void> {
  const abort = new AbortController();
  sessions.set(tabId, { ...sessions.get(tabId), abort });

  emit("phase", { phase: "draft" });

  const context = await gatherVaultContext(args.settings.vaultDir, args.settings.extraDirs ?? []);

  const skillNotes = await resolveSkillNotes(args.settings, args.skills, emit);
  const note = buildSkillsNote(skillNotes);
  const baseAppend = "Format the user's answer into clean vault markdown. Output ONLY the formatted content.";
  const finalText = await runWriterTurn({
    settings: args.settings,
    prompt: buildFillinAnswerPrompt(context, args.question, args.answer, args.targetPath),
    skills: skillNotes,
    append: note ? `${baseAppend}\n\n${note}` : baseAppend,
    allowedTools: ["Skill"],
    phase: "draft",
    emit,
    abort,
  });
  if (finalText === undefined) return;

  sessions.set(tabId, { ...sessions.get(tabId), abort: undefined });
  emit("done", { text: finalText });
}

interface WriteCleanupArgs {
  text: string;
  skills: string[];
  settings: ServerSettings;
}

/* Cleans a Vault Writer draft before it is written to disk. */
export async function writeCleanup(tabId: string, args: WriteCleanupArgs, emit: Emit): Promise<void> {
  const abort = new AbortController();
  sessions.set(tabId, { ...sessions.get(tabId), abort });

  emit("phase", { phase: "cleanup" });

  const skillNotes = await resolveSkillNotes(args.settings, args.skills, emit);
  const note = buildSkillsNote(skillNotes);
  const baseAppend = "Clean up and format the text into well-structured vault markdown.";
  const output = await runWriterTurn({
    settings: args.settings,
    claudeSettings: {
      ...args.settings,
      model: args.settings.cleanupModel || DEFAULT_CLEANUP_MODEL,
      effort: "low",
      engineModels: { ...(args.settings.engineModels ?? {}), claude: args.settings.cleanupModel || DEFAULT_CLEANUP_MODEL },
      engineReasoning: { ...(args.settings.engineReasoning ?? {}), claude: "low" },
    },
    prompt: buildWriteCleanupPrompt(args.text),
    skills: skillNotes,
    append: note ? `${baseAppend}\n\n${note}` : baseAppend,
    allowedTools: ["Skill"],
    phase: "cleanup",
    emit,
    abort,
  });
  if (output === undefined) return;
  const finalText = output || args.text;

  sessions.set(tabId, { ...sessions.get(tabId), abort: undefined });
  emit("done", { text: finalText });
}

// ── Skill authoring ──────────────────────────────────────────────────────────

interface GenerateSkillArgs {
  description: string;
  // When revising an existing draft, the current parsed skill plus the requested
  // change. Their presence switches the turn from authoring to rewriting.
  current?: { name: string; description: string; body: string };
  feedback?: string;
  settings: ServerSettings;
}

// Author (or rewrite) one complete SKILL.md from a plain-language description, using
// the bundled skill-creator guide. The document streams out as text deltas so the UI
// can show it being written, and the parsed name/description/body are returned on
// `done` so the Settings form can drop them into editable fields. Like `cleanup`,
// this runs a throwaway turn and does not touch any tab's conversation session.
/* Generates or rewrites a SKILL.md and emits its parsed fields when complete. */
export async function generateSkill(genId: string, args: GenerateSkillArgs, emit: Emit): Promise<void> {
  const abort = new AbortController();
  sessions.set(genId, { ...sessions.get(genId), abort });

  const isRewrite = Boolean(args.feedback && args.current);
  if (!isRewrite && !args.description.trim()) {
    sessions.delete(genId);
    emit("error", { message: "Describe the skill you want before generating." });
    return;
  }

  emit("phase", { phase: "draft" });

  const guide = await loadSkillCreatorGuide();
  const skillNotes: SkillNote[] = [guide];
  const note = buildSkillsNote(skillNotes);
  const baseAppend =
    "You are an expert skill author. From the user's request you write a single, complete, portable SKILL.md document — frontmatter plus Markdown body — following the attached skill-creator guide. Return only the document.";

  const prompt =
    isRewrite && args.current
      ? buildRewriteSkillPrompt(args.current, args.feedback ?? "")
      : buildGenerateSkillPrompt(args.description);

  const output = await runWriterTurn({
    settings: args.settings,
    prompt,
    skills: skillNotes,
    append: note ? `${baseAppend}\n\n${note}` : baseAppend,
    allowedTools: ["Skill"],
    phase: "draft",
    emit,
    abort,
  });

  sessions.delete(genId);
  if (output === undefined) return; // error already emitted by runWriterTurn

  const raw = (output || "").trim();
  if (!raw) {
    emit("error", { message: "The agent returned an empty skill. Try again or add more detail." });
    return;
  }

  const parsed = parseGeneratedSkill(raw);
  emit("done", { ...parsed, raw });
}

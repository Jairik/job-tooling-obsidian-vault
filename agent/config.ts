// Configuration: defaults, model list, reasoning map, persona/system-prompt
// builder, and persistence of global config to config.json.
import { join } from "path";
import {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_CLEANUP_MODEL,
  defaultEngineModels,
  defaultEngineReasoning,
  effectiveEngineModel,
  effectiveEngineReasoning,
  toUrlFetchMethod,
  mergeEngineSettings,
  normalizeEngineSettings,
  toEffort,
  type CoreSettings,
  type Effort,
  type EngineModels,
  type EngineReasoning,
  type TabMode,
} from "../shared/settings";
import { buildDefaultSystemPrompt, buildJobPersona, buildAskPersona } from "../shared/persona";

export const DEFAULT_VAULT = process.env.VAULT_DIR || "/home/jj/repos/obsidian-vault";

export const MODELS = [
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6 (default)" },
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
];

export const ENGINES = [
  { id: "claude", label: "Claude Code (default)" },
  { id: "gemini", label: "Gemini Antigravity (agy)" },
  { id: "opencode", label: "OpenCode" },
  { id: "cursor", label: "Cursor Agent" },
  { id: "copilot", label: "GitHub Copilot" },
  { id: "codex", label: "Codex" },
];

// "medium reasoning" maps to a medium thinking budget.
const REASONING: Record<Effort, number> = {
  low: 2000,
  medium: 8000,
  high: 16000,
};

export type ServerSettings = CoreSettings;

// Both default personas are generated from an empty profile, so a fresh install
// gets neutral, reusable prompts. Onboarding (and the Settings profile fields)
// regenerate them with the user's name/role/voice. Once saved, each persona is
// stored verbatim in config.json and injected as-is — see resolveAskPersona(),
// which is now used only to seed/migrate the default Ask prompt from the profile.

/* Builds the default ask-mode persona from the configured profile (name/role/voice). */
function resolveAskPersona(settings: Pick<CoreSettings, "userName" | "userRole" | "personaNotes">): string {
  return buildAskPersona({
    userName: settings.userName,
    userRole: settings.userRole,
    personaNotes: settings.personaNotes,
  });
}

/* Builds the common default system rules that apply outside Ask/Job too. */
export function resolveDefaultSystemPrompt(settings: Pick<CoreSettings, "userName" | "userRole" | "personaNotes">): string {
  return buildDefaultSystemPrompt({
    userName: settings.userName,
    userRole: settings.userRole,
    personaNotes: settings.personaNotes,
  });
}

/* Creates the complete, safe configuration used when no config file exists. */
export function defaultSettings(vaultDir = DEFAULT_VAULT): ServerSettings {
  return {
    engine: "claude",
    model: DEFAULT_CLAUDE_MODEL,
    cleanupModel: DEFAULT_CLEANUP_MODEL,
    effort: "medium",
    engineModels: defaultEngineModels(),
    engineReasoning: defaultEngineReasoning(),
    humanize: true,
    rag: false,
    maxTurns: 24,
    persona: buildJobPersona(),
    askPersona: buildAskPersona(),
    userName: "",
    userRole: "",
    personaNotes: "",
    onboarded: false,
    vaultDir,
    extraDirs: [],
    urlFetchMethod: "auto",
    webResearchEnabled: false,
    searxngUrl: "http://127.0.0.1:8080",
  };
}

/* Validates persisted settings, filling omissions and upgrading legacy fields. */
export function normalizeServerSettings(saved: Partial<ServerSettings> = {}, vaultDir = DEFAULT_VAULT): ServerSettings {
  const base = defaultSettings(vaultDir);
  const raw = saved as Partial<ServerSettings> & { engineModels?: EngineModels; engineReasoning?: EngineReasoning };
  const engineSettings = normalizeEngineSettings(raw);

  const normalized: ServerSettings = {
    ...base,
    ...saved,
    ...engineSettings,
    userName: typeof raw.userName === "string" ? raw.userName : base.userName,
    userRole: typeof raw.userRole === "string" ? raw.userRole : base.userRole,
    personaNotes: typeof raw.personaNotes === "string" ? raw.personaNotes : base.personaNotes,
    onboarded: raw.onboarded === true,
    vaultDir: raw.vaultDir || vaultDir,
    extraDirs: Array.isArray(raw.extraDirs) ? raw.extraDirs : [],
    urlFetchMethod: toUrlFetchMethod(raw.urlFetchMethod),
    webResearchEnabled: raw.webResearchEnabled === true,
    searxngUrl: typeof raw.searxngUrl === "string" ? raw.searxngUrl.trim() : base.searxngUrl,
  };

  // Migration: a config.json written before askPersona existed has no such key.
  // Seed it from the (already normalized) profile so Ask mode keeps the exact
  // prompt it used to recompute on every request. A present value — even "" —
  // is the user's own choice and is preserved verbatim.
  normalized.askPersona =
    typeof raw.askPersona === "string" ? raw.askPersona : resolveAskPersona(normalized);

  return normalized;
}

/* Applies one partial settings update, then normalizes the resulting full configuration. */
export function mergeServerSettings(base: ServerSettings, patch: Partial<ServerSettings> | undefined): ServerSettings {
  const merged = patch ? mergeEngineSettings(base, patch) : base;
  return normalizeServerSettings(merged, patch?.vaultDir || base.vaultDir || DEFAULT_VAULT);
}

/* Converts a Claude reasoning label or numeric override into its SDK token budget. */
export function claudeReasoningTokens(settings: ServerSettings): number {
  const raw = effectiveEngineReasoning(settings, "claude").toLowerCase();
  if (/^\d+$/.test(raw)) return Math.max(1_000, Math.min(64_000, Number(raw)));
  const effort =
    raw === "none" || raw === "minimal"
      ? "low"
      : raw === "xhigh" || raw === "max"
        ? "high"
        : toEffort(raw);
  return REASONING[effort ?? settings.effort] ?? REASONING.medium;
}

// A complete skill selected by the user for one interaction. The complete
// SKILL.md is intentionally carried with the prompt: external CLIs do not share
// Claude's native Skill tool, so inline instructions are the portable contract.
export interface SkillNote {
  name: string;
  description: string;
  instructions: string;
}

// Render a self-contained skill block that can be attached to either Claude's
// system prompt or a CLI's stdin prompt. The delimiters retain each skill's
// boundaries and make it clear that the body was explicitly selected by the user.
/* Renders portable, inline instructions for the selected skills. */
export function buildSkillsNote(skills: SkillNote[] | undefined): string {
  if (!skills?.length) return "";
  const bundles = skills.map(
    (skill) =>
      `--- BEGIN USER-SELECTED SKILL: ${skill.name} ---\n${skill.instructions.trim()}\n--- END USER-SELECTED SKILL: ${skill.name} ---`
  );
  return `SELECTED SKILL INSTRUCTIONS\n- The user explicitly selected the complete skills below. Apply their relevant instructions directly.\n- The instructions are embedded for portability; do not rely on a native Skill tool or filesystem access to retrieve them.\n- Obey the task's safety, tool, and output constraints when a skill conflicts with them.\n\n${bundles.join("\n\n")}`;
}

// CLI engines accept one stdin prompt rather than Claude's system-prompt append.
// Prefix the same portable bundle here so every supported engine receives exactly
// the selected instructions without requiring agent-specific skill installation.
/* Prepends selected skill instructions to a self-contained CLI task prompt. */
export function injectSkillsIntoPrompt(prompt: string, skills: SkillNote[] | undefined): string {
  const note = buildSkillsNote(skills);
  return note ? `${note}\n\nTASK\n${prompt}` : prompt;
}

interface BuildArgs {
  persona: string;
  mode: TabMode;
  skills?: SkillNote[];
  useRag?: boolean;
  phase: "draft" | "humanize" | "followup";
}

// Compose the system-prompt append from the base persona plus phase/mode notes.
// The humanize pass (when enabled) and selected skills apply to every mode; the
// REVISION note is worded per mode so the ask voice stays neutral.
/* Builds the mode- and phase-specific system-prompt suffix for a model turn. */
export function buildAppend({ persona, mode, skills, useRag, phase }: BuildArgs): string {
  const isAsk = mode === "ask";
  const parts = [persona.trim()];

  if (useRag) {
    parts.push(
      `RETRIEVAL MODE\n- Relevant excerpts have already been retrieved and included in the user message. Treat them as your only source of facts. The Read, Grep, and Glob tools are disabled, so do not try to browse files - rely solely on the provided excerpts. If they do not support a claim, leave it out.`
    );
  }

  const skillsNote = buildSkillsNote(skills);
  if (skillsNote) parts.push(skillsNote);

  if (phase === "humanize") {
    parts.push(
      `HUMANIZE PASS\n- Use the humanizer skill on your previous answer. Return ONLY the final humanized version of the answer text: no drafts, no audit notes, no commentary, no "still-AI" bullets.`
    );
  }

  if (phase === "followup") {
    parts.push(
      isAsk
        ? `REVISION\n- You are revising your previous answer based on the user's requested change. Apply it and return the FULL revised answer, staying grounded in the provided context. Output only the revised answer.`
        : `REVISION\n- You are revising the existing answer based on the user's requested tweak. Apply their change and return the FULL revised answer, keeping the same grounded first-person voice and avoiding AI-writing tells. Output only the revised answer.`
    );
  }

  return parts.join("\n\n");
}

// ---- Ask mode prompts (general personal-context Q&A) ----
/* Formats a direct question for general context-grounded answer mode. */
export function buildAskPrompt(question: string): string {
  return `Question:
"""
${question.trim()}
"""

Answer the question above, grounded in the available personal context.`;
}

// RAG ask prompt (Claude engine): retrieved excerpts are the only facts available.
/* Formats an ask prompt whose facts are limited to retrieved excerpts. */
export function buildRagAskPrompt(context: string, question: string): string {
  return `${contextBlock(context)}\n\n${buildAskPrompt(question)}\n\nGround your answer ONLY in the excerpts above. Do not read or search additional files.`;
}

/* Formats the self-contained ask prompt used by sandboxed external CLIs. */
export function buildCliAskPrompt(persona: string, context: string, question: string): string {
  return `${persona.trim()}\n\n${contextBlock(context)}\n\n${buildAskPrompt(question)}\n\n${NO_TOOLS}`;
}

/* Formats the job description and question used to draft an application answer. */
export function buildDraftPrompt(jobDescription: string, question: string): string {
  return `Job description:
"""
${jobDescription.trim() || "(none provided)"}
"""

Question to answer:
"""
${question.trim()}
"""

Write the answer to the question above in the first person, grounded in the available personal context.`;
}

// RAG draft prompt (Claude engine): the retrieved excerpts are the only facts
// available, so they go straight into the prompt and file-reading is disabled.
/* Formats a draft prompt whose claims must come only from RAG excerpts. */
export function buildRagDraftPrompt(context: string, jobDescription: string, question: string): string {
  return `${contextBlock(context)}\n\n${buildDraftPrompt(jobDescription, question)}\n\nGround your answer ONLY in the excerpts above. Do not read or search additional files.`;
}

// RAG follow-up prompt (Claude engine): refresh the excerpts for the new tweak
// so revisions stay grounded without re-enabling file browsing.
/* Formats a revision request while retaining the RAG-only fact boundary. */
export function buildRagFollowupPrompt(context: string, tweak: string): string {
  return `${contextBlock(context)}\n\n${tweak.trim()}\n\nApply the change using ONLY the excerpts above (plus the answer you already wrote). Do not read or search additional files.`;
}

// ---- Gemini Antigravity (agy) engine ----
// agy has no separate system prompt and no Skill tool, so instructions are folded
// into the prompt and humanization is done with inline rules instead of a skill.

const HUMANIZE_INLINE = `Rewrite the answer below to remove all signs of AI writing, while preserving every fact and keeping the first-person voice.
- Remove every em dash and en dash. Use periods, commas, or parentheses instead.
- Cut AI-vocab words (delve, tapestry, testament, underscore, pivotal, vibrant, crucial, leverage, foster, robust, seamless, intricate, showcase).
- Prefer plain "is/are/has" over "serves as / stands as / boasts".
- Vary sentence length; let some be short. No rule-of-three padding, no promotional language, no negative parallelisms.
- Drop filler and hedging. No "I hope this helps", no meta commentary, no headings.
- Keep it concrete and specific.
Output ONLY the rewritten answer.`;

// CLI agents stay sandboxed. When the opt-in LOCAL WEB RESEARCH SKILL is present,
// its two tagged JSON requests are the sole exception; the mediator executes them
// rather than giving the model shell, browser, filesystem, or network access.
const NO_TOOLS = `Do not use any tools directly, do not run any shell commands, and do not read or write any files. Use ONLY the PERSONAL CONTEXT provided above as your source of facts, unless the separately supplied LOCAL WEB RESEARCH SKILL returns mediated web evidence.`;

/* Wraps retrieved personal text in a clearly delimited prompt section. */
function contextBlock(context: string): string {
  return `PERSONAL CONTEXT (read-only - your only source of facts):\n"""\n${context.trim() || "(none provided)"}\n"""`;
}

/* Creates the complete draft instruction for an external CLI without vault access. */
export function buildCliDraftPrompt(
  persona: string,
  context: string,
  jobDescription: string,
  question: string
): string {
  return `${persona.trim()}\n\n${contextBlock(context)}\n\n${buildDraftPrompt(jobDescription, question)}\n\n${NO_TOOLS}`;
}

/* Creates the final-style pass prompt for external CLI engines. */
export function buildCliHumanizePrompt(draft: string, systemPrompt = ""): string {
  const system = systemPrompt.trim();
  return `${system ? `${system}\n\n` : ""}${HUMANIZE_INLINE}\n\nAnswer to rewrite:\n"""\n${draft.trim()}\n"""\n\nDo not use any tools or run any commands; just return the rewritten answer.`;
}

// ---- Clean up (lightweight grammar fix + humanize) ----
// Used by the answer card's "Clean up" button. Operates on the exact text the
// user currently has (including any manual edits), independent of any session.

const CLEANUP_GRAMMAR = `Fix any spelling, grammar, punctuation, and awkward phrasing in the text below. Preserve every fact and the original meaning; do not add new information.`;

// Claude engine: when the humanizer skill is installed we run it; otherwise we
// fold the inline humanize rules into the prompt (a missing skill does nothing).
/* Requests a light editing pass while optionally using the humanizer skill. */
export function buildCleanupPrompt(text: string, useSkill: boolean): string {
  const polish = useSkill
    ? `Then apply the humanizer skill to remove any signs of AI writing.`
    : HUMANIZE_INLINE;
  return `${CLEANUP_GRAMMAR}\n\n${polish}\n\nText to clean up:\n"""\n${text.trim()}\n"""\n\nReturn ONLY the cleaned text — no commentary, no notes, no headings.`;
}

/* Builds the companion system instruction for the cleanup phase. */
export function buildCleanupAppend(systemPrompt: string, useSkill: boolean): string {
  const cleanup = useSkill
    ? `CLEANUP PASS\n- Fix grammar and writing in the provided text, then use the humanizer skill on it. Return ONLY the final cleaned text: no drafts, no audit notes, no commentary.`
    : `CLEANUP PASS\n- Fix grammar and writing in the provided text and remove signs of AI writing. Return ONLY the final cleaned text: no commentary, no notes.`;
  return [systemPrompt.trim(), cleanup].filter(Boolean).join("\n\n");
}

// Gemini engine has no Skill tool, so cleanup always uses the inline rules.
/* Builds the self-contained cleanup prompt sent to external CLIs. */
export function buildCliCleanupPrompt(text: string, systemPrompt = ""): string {
  const system = systemPrompt.trim();
  return `${system ? `${system}\n\n` : ""}${CLEANUP_GRAMMAR}\n${HUMANIZE_INLINE}\n\nText to clean up:\n"""\n${text.trim()}\n"""\n\nDo not use any tools or run any commands; return ONLY the cleaned text.`;
}

/* Includes the existing answer and requested change for a sandboxed CLI revision. */
export function buildCliFollowupPrompt(
  persona: string,
  context: string,
  priorAnswer: string,
  tweak: string
): string {
  return `${persona.trim()}

${contextBlock(context)}

You previously wrote this answer:
"""
${priorAnswer.trim()}
"""

The user wants this change: ${tweak.trim()}

Apply the change and return the FULL revised answer, grounded in the context above and written in a natural first-person voice with no AI-writing tells. Output ONLY the answer.

${NO_TOOLS}`;
}

// ---- Writer prompts ----

/* Builds the common writer-mode append so every writer action gets default rules. */
export function buildWriterAppend(
  settings: Pick<CoreSettings, "userName" | "userRole" | "personaNotes">,
  taskInstruction: string
): string {
  return `${resolveDefaultSystemPrompt(settings)}

WRITER MODE
- Use the same source-grounding, project-description, and user-facing phrasing rules as Ask and Job modes.
- ${taskInstruction.trim()}`;
}

/* Directs the writer workflow to summarize imported text using personal context. */
export function buildSummarizePrompt(text: string, personalContext: string): string {
  return `Summarize imported content for the user's personal notes.

${contextBlock(personalContext)}

Content to summarize:
"""
${text.trim()}
"""

Produce a clear, well-structured markdown summary of the content above. Use headings, bullet points, and key takeaways where appropriate. The summary should fit with the existing personal context. Output ONLY the markdown summary - no commentary.

${NO_TOOLS}`;
}

/* Asks the writer workflow to select the most appropriate destination path. */
export function buildAutoPlacePrompt(content: string, vaultStructure: string): string {
  return `Determine the best location for new personal-note content.

Directory structure:
"""
${vaultStructure.trim()}
"""

New content to place:
"""
${content.trim().slice(0, 2000)}
"""

Based on the directory structure and content topic, suggest the single best relative file path where this content should be saved. The path should use an existing directory if one fits, or suggest a new subdirectory under an appropriate parent. Use .md extension.

Respond with ONLY the file path, nothing else. Example: Projects/new-project.md

${NO_TOOLS}`;
}

/* Finds unanswered prompts in personal context and returns structured questions to fill. */
export function buildFillinScanPrompt(personalContext: string, prompt?: string): string {
  const focus = prompt ? `\nThe user wants to focus on: ${prompt.trim()}` : '';
  return `Find gaps and missing information in the user's personal context.${focus}

${contextBlock(personalContext)}

Analyze the personal context above and identify up to 5 specific pieces of missing information, incomplete sections, or topics that would benefit from being documented. For each gap, write a clear, specific question that the user can answer to fill it in.

Respond with a JSON array of objects, each with "question" (the question to ask) and "targetPath" (suggested note file path for the answer). Example:
[{"question": "What technologies did you use in the XYZ project?", "targetPath": "Projects/xyz.md"}]

Output ONLY the JSON array, no commentary or markdown fencing.

${NO_TOOLS}`;
}

/* Prepares an answer that can be inserted into a specific note file and question. */
export function buildFillinAnswerPrompt(personalContext: string, question: string, answer: string, targetPath: string): string {
  return `Format the user's answer into a well-structured note entry.

${contextBlock(personalContext)}

Question that was asked: ${question.trim()}
User's answer: ${answer.trim()}
Target file: ${targetPath}

Format the user's answer into clean, well-structured markdown that fits naturally with the surrounding personal context. If the target file already has content in the personal context, format this as an addition/update. Use appropriate headings, bullet points, and formatting.

Output ONLY the formatted markdown content — no commentary, no file path, no fencing.

${NO_TOOLS}`;
}

/* Applies the writer workflow's formatting and clarity cleanup before saving. */
export function buildWriteCleanupPrompt(text: string): string {
  return `Clean up and format the following text into well-structured markdown for personal notes.

Text to clean up:
"""
${text.trim()}
"""

Fix any spelling, grammar, and punctuation errors. Improve the structure with appropriate markdown headings, bullet points, and formatting. Preserve all factual content and meaning.

Output ONLY the cleaned markdown — no commentary.

${NO_TOOLS}`;
}

// ---- Skill authoring prompts ----
// The skill-creator guide is attached to the system prompt (Claude) or folded into
// the task prompt (CLI engines); these builders supply just the task half. The model
// returns one complete SKILL.md so the server can parse it back into editable fields.

const SKILL_OUTPUT_RULES = `Output ONLY the complete SKILL.md file contents: the YAML frontmatter block (opening with --- and closing with ---, containing at least \`name\` and \`description\`), followed by the Markdown body. Do not wrap it in code fences. Do not add commentary before or after it.`;

/* Builds the task prompt that turns a plain-language description into a SKILL.md. */
export function buildGenerateSkillPrompt(description: string): string {
  return `Write a complete SKILL.md for the skill described below, following the skill-creator authoring guide.

Skill description:
"""
${description.trim()}
"""

Choose a fitting kebab-case \`name\`, write a sharp, trigger-rich \`description\`, and write a focused Markdown body of instructions.

${SKILL_OUTPUT_RULES}`;
}

interface SkillDraft {
  name: string;
  description: string;
  body: string;
}

/* Rebuilds a SKILL.md document from its parsed parts for a revision prompt. */
function renderSkillDoc(draft: SkillDraft): string {
  const name = draft.name.trim();
  const description = draft.description.trim();
  const front = `---\n${name ? `name: ${name}\n` : ""}${description ? `description: ${description}\n` : ""}---`;
  return `${front}\n\n${draft.body.trim()}\n`;
}

/* Builds the task prompt that revises an existing SKILL.md from user feedback. */
export function buildRewriteSkillPrompt(current: SkillDraft, feedback: string): string {
  const keepName = current.name.trim()
    ? `Keep the name \`${current.name.trim()}\` unless the requested change is specifically about the name.`
    : "";
  return `Revise the SKILL.md below based on the requested change, following the skill-creator authoring guide. ${keepName}

Current SKILL.md:
"""
${renderSkillDoc(current)}
"""

Requested change:
"""
${feedback.trim()}
"""

Apply the change, then re-read the whole skill so it still reads as one coherent document.

${SKILL_OUTPUT_RULES}`;
}

// ---- Global config persistence ----
const CONFIG_PATH = join(import.meta.dir, "..", "config.json");

/* Loads config.json when available, otherwise returns normalized defaults. */
export async function loadConfig(): Promise<ServerSettings> {
  try {
    const saved = JSON.parse(await Bun.file(CONFIG_PATH).text());
    // Legacy migration: a config.json written before onboarding existed has no
    // `onboarded` flag. Its owner is already set up, so don't show them the
    // first-run modal — only a missing config.json (fresh install) is unonboarded.
    if (saved && typeof saved === "object" && saved.onboarded === undefined) {
      saved.onboarded = true;
    }
    return normalizeServerSettings(saved);
  } catch {
    return defaultSettings();
  }
}

/* Persists a partial settings update and returns the canonical saved configuration. */
export async function saveConfig(patch: Partial<ServerSettings>): Promise<ServerSettings> {
  const next = mergeServerSettings(await loadConfig(), patch);
  await Bun.write(CONFIG_PATH, JSON.stringify(next, null, 2));
  return next;
}

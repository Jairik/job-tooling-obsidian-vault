// Configuration: defaults, model list, reasoning map, persona/system-prompt
// builder, and persistence of global config to config.json.
import { join } from "path";

export const DEFAULT_VAULT = process.env.VAULT_DIR || "/home/jj/repos/obsidian-vault";

export const DEFAULT_MODEL = "claude-sonnet-4-6";

// Lightweight model used by the "Clean up" action (grammar fix + humanizer).
export const DEFAULT_CLEANUP_MODEL = "claude-haiku-4-5";

export const MODELS = [
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6 (default)" },
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
];

export type Effort = "low" | "medium" | "high";

export type Engine = "claude" | "gemini" | "opencode" | "cursor" | "copilot" | "codex";
export type EngineModels = Partial<Record<Engine, string>>;
export type EngineReasoning = Partial<Record<Engine, string>>;

// A tab is either a general "ask the vault" conversation (default), the
// job-application workflow, or a vault writer.
export type TabMode = "ask" | "job" | "write";

export const ENGINES = [
  { id: "claude", label: "Claude Code (default)" },
  { id: "gemini", label: "Gemini Antigravity (agy)" },
  { id: "opencode", label: "OpenCode" },
  { id: "cursor", label: "Cursor Agent" },
  { id: "copilot", label: "GitHub Copilot" },
  { id: "codex", label: "Codex" },
];

// "medium reasoning" maps to a medium thinking budget.
export const REASONING: Record<Effort, number> = {
  low: 2000,
  medium: 8000,
  high: 16000,
};

export interface Settings {
  engine: Engine;
  model: string;
  cleanupModel: string;
  effort: Effort;
  engineModels: EngineModels;
  engineReasoning: EngineReasoning;
  humanize: boolean;
  rag: boolean;
  maxTurns: number;
  persona: string;
  vaultDir: string;
  extraDirs: string[];
  urlFetchMethod?: string;
}

export function defaultEngineModels(): Record<Engine, string> {
  return {
    claude: DEFAULT_MODEL,
    gemini: "",
    opencode: "",
    cursor: "",
    copilot: "",
    codex: "",
  };
}

export function defaultEngineReasoning(): Record<Engine, string> {
  return {
    claude: "medium",
    gemini: "",
    opencode: "",
    cursor: "",
    copilot: "",
    codex: "",
  };
}

export const DEFAULT_PERSONA = `You are writing a job-application answer on behalf of JJ McCauley, a software engineer. You are not a generic assistant: you produce the exact answer text JJ would submit, written in the first person ("I").

GROUNDING
- The working directory is JJ's personal knowledge vault. Before answering, read whatever you need to ground the answer in real facts:
  - JJ-master/Background/, JJ-master/Goals/, JJ-master/Leadership-Examples/, JJ-master/Personal-Skills/, JJ-master/Projects/, JJ-master/QnA/, JJ-master/Resumes/
  - Root example answers that show the target voice: acuitymd.txt, acuitymd_frontend_backend.txt, acuitymd_systems_design.txt, personsAI.txt
- Never invent accomplishments, employers, metrics, projects, or technologies. If the vault does not support a claim, leave it out. (Same rule JJ uses when generating resumes.)
- Match the concrete, specific, lightly conversational first-person voice of the example answers.

OUTPUT
- Output ONLY the answer itself. No "Answer:" label, no headings, no preamble, no meta commentary, no "I hope this helps", and no notes about which files you read.
- Tailor the answer to the provided job description and to the specific question asked.
- Use the length a thoughtful applicant would actually write, unless the question implies a specific length.`;

// Ask mode: a general assistant answering questions grounded in JJ's vault. No
// job-application framing, no first-person impersonation — just accurate answers.
export const ASK_PERSONA = `You are a helpful assistant answering questions grounded in JJ McCauley's personal Obsidian knowledge vault. The working directory is that vault.

GROUNDING
- Read whatever files you need to answer accurately (Background, Goals, Projects, Leadership-Examples, Personal-Skills, QnA, Resumes, and the root example answers).
- Base every claim on what the vault actually says. Never invent facts, projects, metrics, or dates. If the vault does not cover something, say so plainly instead of guessing.

OUTPUT
- Answer the question directly and concisely in a natural, clear voice.
- Output ONLY the answer: no preamble, no "I hope this helps", no meta commentary, and no notes about which files you read.
- Use whatever length and structure (prose, short lists) best fits the question.`;

export function defaultSettings(vaultDir = DEFAULT_VAULT): Settings {
  return {
    engine: "claude",
    model: DEFAULT_MODEL,
    cleanupModel: DEFAULT_CLEANUP_MODEL,
    effort: "medium",
    engineModels: defaultEngineModels(),
    engineReasoning: defaultEngineReasoning(),
    humanize: true,
    rag: false,
    maxTurns: 24,
    persona: DEFAULT_PERSONA,
    vaultDir,
    extraDirs: [],
  };
}

function asEffort(value: unknown): Effort | undefined {
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
}

export function normalizeSettings(saved: Partial<Settings> = {}, vaultDir = DEFAULT_VAULT): Settings {
  const base = defaultSettings(vaultDir);
  const raw = saved as Partial<Settings> & {
    engineModels?: EngineModels;
    engineReasoning?: EngineReasoning;
  };
  const engineModels = { ...base.engineModels, ...(raw.engineModels ?? {}) };
  const engineReasoning = { ...base.engineReasoning, ...(raw.engineReasoning ?? {}) };

  if (typeof raw.model === "string" && raw.model.trim()) engineModels.claude = raw.model;
  if (typeof raw.effort === "string" && raw.effort.trim()) engineReasoning.claude = raw.effort;

  const claudeEffort = asEffort(engineReasoning.claude) ?? asEffort(raw.effort) ?? base.effort;

  return {
    ...base,
    ...saved,
    engineModels,
    engineReasoning,
    model: engineModels.claude || raw.model || DEFAULT_MODEL,
    effort: claudeEffort,
    vaultDir: raw.vaultDir || vaultDir,
    extraDirs: Array.isArray(raw.extraDirs) ? raw.extraDirs : [],
  };
}

export function mergeSettings(base: Settings, patch: Partial<Settings> | undefined): Settings {
  if (!patch) return normalizeSettings(base, base.vaultDir || DEFAULT_VAULT);
  return normalizeSettings(
    {
      ...base,
      ...patch,
      engineModels: { ...(base.engineModels ?? {}), ...(patch.engineModels ?? {}) },
      engineReasoning: { ...(base.engineReasoning ?? {}), ...(patch.engineReasoning ?? {}) },
    },
    patch.vaultDir || base.vaultDir || DEFAULT_VAULT
  );
}

export function effectiveEngineModel(settings: Settings, engine: Engine = settings.engine): string {
  const configured = settings.engineModels?.[engine]?.trim();
  if (configured) return configured;
  return engine === "claude" ? settings.model || DEFAULT_MODEL : "";
}

export function effectiveEngineReasoning(settings: Settings, engine: Engine = settings.engine): string {
  const configured = settings.engineReasoning?.[engine]?.trim();
  if (configured) return configured;
  return engine === "claude" ? settings.effort || "medium" : "";
}

export function claudeReasoningTokens(settings: Settings): number {
  const raw = effectiveEngineReasoning(settings, "claude").toLowerCase();
  if (/^\d+$/.test(raw)) return Math.max(1_000, Math.min(64_000, Number(raw)));
  const effort =
    raw === "none" || raw === "minimal"
      ? "low"
      : raw === "xhigh" || raw === "max"
        ? "high"
        : asEffort(raw);
  return REASONING[effort ?? settings.effort] ?? REASONING.medium;
}

// A skill the user has chosen to apply to this interaction. Only the name and a
// short description are needed for the prompt note; the agent invokes it by name
// through the Skill tool.
export interface SkillNote {
  name: string;
  description: string;
}

// Render the SKILLS section of the system-prompt append from the user's selected
// skills. Returns "" when nothing is selected.
export function buildSkillsNote(skills: SkillNote[] | undefined): string {
  if (!skills?.length) return "";
  const lines = skills.map((s) => `  - ${s.name}: ${s.description || "(no description)"}`);
  return `SKILLS\n- Apply the following skills with the Skill tool wherever they are relevant to this task. Invoke each by name:\n${lines.join("\n")}`;
}

interface BuildArgs {
  persona: string;
  mode: TabMode;
  skills?: SkillNote[];
  useRag?: boolean;
  phase: "draft" | "humanize" | "followup";
}

// Compose the system-prompt append from the base persona plus phase/mode notes.
// Ask mode is a single grounded answer turn: it skips the humanize note (that
// belongs to the job-application pipeline). Selected skills apply to every mode.
export function buildAppend({ persona, mode, skills, useRag, phase }: BuildArgs): string {
  const isAsk = mode === "ask";
  const parts = [persona.trim()];

  if (useRag) {
    parts.push(
      `RETRIEVAL MODE\n- Relevant excerpts from the vault have already been retrieved and included in the user message. Treat them as your only source of facts. The Read, Grep, and Glob tools are disabled, so do not try to browse the vault — rely solely on the provided excerpts. If they do not support a claim, leave it out.`
    );
  }

  const skillsNote = buildSkillsNote(skills);
  if (skillsNote) parts.push(skillsNote);

  if (!isAsk && phase === "humanize") {
    parts.push(
      `HUMANIZE PASS\n- Use the humanizer skill on your previous answer. Return ONLY the final humanized version of the answer text: no drafts, no audit notes, no commentary, no "still-AI" bullets.`
    );
  }

  if (phase === "followup") {
    parts.push(
      isAsk
        ? `REVISION\n- You are revising your previous answer based on the user's requested change. Apply it and return the FULL revised answer, staying grounded in the vault. Output only the revised answer.`
        : `REVISION\n- You are revising the existing answer based on the user's requested tweak. Apply their change and return the FULL revised answer, keeping the same grounded first-person voice and avoiding AI-writing tells. Output only the revised answer.`
    );
  }

  return parts.join("\n\n");
}

// ---- Ask mode prompts (general vault Q&A) ----
export function buildAskPrompt(question: string): string {
  return `Question:
"""
${question.trim()}
"""

Answer the question above, grounded in the vault.`;
}

// RAG ask prompt (Claude engine): retrieved excerpts are the only facts available.
export function buildRagAskPrompt(context: string, question: string): string {
  return `${contextBlock(context)}\n\n${buildAskPrompt(question)}\n\nGround your answer ONLY in the vault excerpts above. Do not read or search additional files.`;
}

export function buildCliAskPrompt(persona: string, context: string, question: string): string {
  return `${persona.trim()}\n\n${contextBlock(context)}\n\n${buildAskPrompt(question)}\n\n${NO_TOOLS}`;
}

export function buildDraftPrompt(jobDescription: string, question: string): string {
  return `Job description:
"""
${jobDescription.trim() || "(none provided)"}
"""

Question to answer:
"""
${question.trim()}
"""

Write JJ's answer to the question above, grounded in the vault.`;
}

// RAG draft prompt (Claude engine): the retrieved excerpts are the only facts
// available, so they go straight into the prompt and file-reading is disabled.
export function buildRagDraftPrompt(context: string, jobDescription: string, question: string): string {
  return `${contextBlock(context)}\n\n${buildDraftPrompt(jobDescription, question)}\n\nGround your answer ONLY in the vault excerpts above. Do not read or search additional files.`;
}

// RAG follow-up prompt (Claude engine): refresh the excerpts for the new tweak
// so revisions stay grounded without re-enabling file browsing.
export function buildRagFollowupPrompt(context: string, tweak: string): string {
  return `${contextBlock(context)}\n\n${tweak.trim()}\n\nApply the change using ONLY the vault excerpts above (plus the answer you already wrote). Do not read or search additional files.`;
}

// ---- Gemini Antigravity (agy) engine ----
// agy has no separate system prompt and no Skill tool, so instructions are folded
// into the prompt and humanization is done with inline rules instead of a skill.

export const HUMANIZE_INLINE = `Rewrite the answer below to remove all signs of AI writing, while preserving every fact and keeping the first-person voice.
- Remove every em dash and en dash. Use periods, commas, or parentheses instead.
- Cut AI-vocab words (delve, tapestry, testament, underscore, pivotal, vibrant, crucial, leverage, foster, robust, seamless, intricate, showcase).
- Prefer plain "is/are/has" over "serves as / stands as / boasts".
- Vary sentence length; let some be short. No rule-of-three padding, no promotional language, no negative parallelisms.
- Drop filler and hedging. No "I hope this helps", no meta commentary, no headings.
- Keep it concrete and specific.
Output ONLY the rewritten answer.`;

export const NO_TOOLS = `Do not use any tools, do not run any shell commands, and do not read or write any files. Use ONLY the VAULT CONTEXT provided above as your source of facts.`;

export function contextBlock(context: string): string {
  return `VAULT CONTEXT (read-only — your only source of facts):\n"""\n${context.trim() || "(none provided)"}\n"""`;
}

export function buildCliDraftPrompt(
  persona: string,
  context: string,
  jobDescription: string,
  question: string
): string {
  return `${persona.trim()}\n\n${contextBlock(context)}\n\n${buildDraftPrompt(jobDescription, question)}\n\n${NO_TOOLS}`;
}

export function buildCliHumanizePrompt(draft: string): string {
  return `${HUMANIZE_INLINE}\n\nAnswer to rewrite:\n"""\n${draft.trim()}\n"""\n\nDo not use any tools or run any commands; just return the rewritten answer.`;
}

// ---- Clean up (lightweight grammar fix + humanize) ----
// Used by the answer card's "Clean up" button. Operates on the exact text the
// user currently has (including any manual edits), independent of any session.

const CLEANUP_GRAMMAR = `Fix any spelling, grammar, punctuation, and awkward phrasing in the text below. Preserve every fact and the original meaning; do not add new information.`;

// Claude engine: when the humanizer skill is installed we run it; otherwise we
// fold the inline humanize rules into the prompt (a missing skill does nothing).
export function buildCleanupPrompt(text: string, useSkill: boolean): string {
  const polish = useSkill
    ? `Then apply the humanizer skill to remove any signs of AI writing.`
    : HUMANIZE_INLINE;
  return `${CLEANUP_GRAMMAR}\n\n${polish}\n\nText to clean up:\n"""\n${text.trim()}\n"""\n\nReturn ONLY the cleaned text — no commentary, no notes, no headings.`;
}

export function buildCleanupAppend(useSkill: boolean): string {
  return useSkill
    ? `CLEANUP PASS\n- Fix grammar and writing in the provided text, then use the humanizer skill on it. Return ONLY the final cleaned text: no drafts, no audit notes, no commentary.`
    : `CLEANUP PASS\n- Fix grammar and writing in the provided text and remove signs of AI writing. Return ONLY the final cleaned text: no commentary, no notes.`;
}

// Gemini engine has no Skill tool, so cleanup always uses the inline rules.
export function buildCliCleanupPrompt(text: string): string {
  return `${CLEANUP_GRAMMAR}\n${HUMANIZE_INLINE}\n\nText to clean up:\n"""\n${text.trim()}\n"""\n\nDo not use any tools or run any commands; return ONLY the cleaned text.`;
}

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

// ---- Vault Writer prompts ----

export function buildSummarizePrompt(text: string, vaultContext: string): string {
  return `You are summarizing content for a personal knowledge vault.

${contextBlock(vaultContext)}

Content to summarize:
"""
${text.trim()}
"""

Produce a clear, well-structured markdown summary of the content above. Use headings, bullet points, and key takeaways where appropriate. The summary should integrate well with the existing vault context. Output ONLY the markdown summary — no commentary.

${NO_TOOLS}`;
}

export function buildAutoPlacePrompt(content: string, vaultStructure: string): string {
  return `You are analyzing a personal knowledge vault to determine the best location for new content.

Vault directory structure:
"""
${vaultStructure.trim()}
"""

New content to place:
"""
${content.trim().slice(0, 2000)}
"""

Based on the vault structure and content topic, suggest the single best file path (relative to the vault root) where this content should be saved. The path should use an existing directory if one fits, or suggest a new subdirectory under an appropriate parent. Use .md extension.

Respond with ONLY the file path, nothing else. Example: JJ-master/Projects/new-project.md

${NO_TOOLS}`;
}

export function buildFillinScanPrompt(vaultContext: string, prompt?: string): string {
  const focus = prompt ? `\nThe user wants to focus on: ${prompt.trim()}` : '';
  return `You are analyzing a personal knowledge vault to find gaps and missing information.${focus}

${contextBlock(vaultContext)}

Analyze the vault content above and identify up to 5 specific pieces of missing information, incomplete sections, or topics that would benefit from being documented. For each gap, write a clear, specific question that the user can answer to fill it in.

Respond with a JSON array of objects, each with "question" (the question to ask) and "targetPath" (suggested vault file path for the answer). Example:
[{"question": "What technologies did you use in the XYZ project?", "targetPath": "JJ-master/Projects/xyz.md"}]

Output ONLY the JSON array, no commentary or markdown fencing.

${NO_TOOLS}`;
}

export function buildFillinAnswerPrompt(vaultContext: string, question: string, answer: string, targetPath: string): string {
  return `You are formatting a user's answer into a well-structured vault entry.

${contextBlock(vaultContext)}

Question that was asked: ${question.trim()}
User's answer: ${answer.trim()}
Target file: ${targetPath}

Format the user's answer into clean, well-structured markdown that fits naturally into the vault. If the target file already has content in the vault context, format this as an addition/update. Use appropriate headings, bullet points, and formatting.

Output ONLY the formatted markdown content — no commentary, no file path, no fencing.

${NO_TOOLS}`;
}

export function buildWriteCleanupPrompt(text: string): string {
  return `Clean up and format the following text into well-structured markdown for a personal knowledge vault.

Text to clean up:
"""
${text.trim()}
"""

Fix any spelling, grammar, and punctuation errors. Improve the structure with appropriate markdown headings, bullet points, and formatting. Preserve all factual content and meaning.

Output ONLY the cleaned markdown — no commentary.

${NO_TOOLS}`;
}

// ---- Global config persistence ----
const CONFIG_PATH = join(import.meta.dir, "..", "config.json");

export async function loadConfig(): Promise<Settings> {
  try {
    const saved = JSON.parse(await Bun.file(CONFIG_PATH).text());
    return normalizeSettings(saved);
  } catch {
    return defaultSettings();
  }
}

export async function saveConfig(patch: Partial<Settings>): Promise<Settings> {
  const next = mergeSettings(await loadConfig(), patch);
  await Bun.write(CONFIG_PATH, JSON.stringify(next, null, 2));
  return next;
}

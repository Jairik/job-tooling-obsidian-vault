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

export type Engine = "claude" | "gemini";

// A tab is either a general "ask the vault" conversation (default) or the
// job-application workflow (the original tool).
export type TabMode = "ask" | "job";

export const ENGINES = [
  { id: "claude", label: "Claude Code (default)" },
  { id: "gemini", label: "Gemini Antigravity (agy)" },
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
  humanize: boolean;
  rag: boolean;
  maxTurns: number;
  persona: string;
  vaultDir: string;
  extraDirs: string[];
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
    humanize: true,
    rag: false,
    maxTurns: 24,
    persona: DEFAULT_PERSONA,
    vaultDir,
    extraDirs: [],
  };
}

interface BuildArgs {
  persona: string;
  mode: TabMode;
  useYc?: boolean;
  useRag?: boolean;
  phase: "draft" | "humanize" | "followup";
}

// Compose the system-prompt append from the base persona plus phase/mode notes.
// Ask mode is a single grounded answer turn: it skips the YC and humanize notes
// (those belong to the job-application pipeline).
export function buildAppend({ persona, mode, useYc, useRag, phase }: BuildArgs): string {
  const isAsk = mode === "ask";
  const parts = [persona.trim()];

  if (useRag) {
    parts.push(
      `RETRIEVAL MODE\n- Relevant excerpts from the vault have already been retrieved and included in the user message. Treat them as your only source of facts. The Read, Grep, and Glob tools are disabled, so do not try to browse the vault — rely solely on the provided excerpts. If they do not support a claim, leave it out.`
    );
  }

  if (!isAsk && useYc) {
    parts.push(
      `Y COMBINATOR\n- This answer is for a Y Combinator application. Use the yc-combinator skill to shape the structure and tone: direct, concrete, founder-style, no fluff.`
    );
  }

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

export function buildGeminiAskPrompt(persona: string, context: string, question: string): string {
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

const NO_TOOLS = `Do not use any tools, do not run any shell commands, and do not read or write any files. Use ONLY the VAULT CONTEXT provided above as your source of facts.`;

export function contextBlock(context: string): string {
  return `VAULT CONTEXT (read-only — your only source of facts):\n"""\n${context.trim() || "(none provided)"}\n"""`;
}

export function buildGeminiDraftPrompt(
  persona: string,
  context: string,
  jobDescription: string,
  question: string
): string {
  return `${persona.trim()}\n\n${contextBlock(context)}\n\n${buildDraftPrompt(jobDescription, question)}\n\n${NO_TOOLS}`;
}

export function buildGeminiHumanizePrompt(draft: string): string {
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
export function buildGeminiCleanupPrompt(text: string): string {
  return `${CLEANUP_GRAMMAR}\n${HUMANIZE_INLINE}\n\nText to clean up:\n"""\n${text.trim()}\n"""\n\nDo not use any tools or run any commands; return ONLY the cleaned text.`;
}

export function buildGeminiFollowupPrompt(
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

// ---- Global config persistence ----
const CONFIG_PATH = join(import.meta.dir, "..", "config.json");

export async function loadConfig(): Promise<Settings> {
  try {
    const saved = JSON.parse(await Bun.file(CONFIG_PATH).text());
    return { ...defaultSettings(), ...saved };
  } catch {
    return defaultSettings();
  }
}

export async function saveConfig(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadConfig()), ...patch };
  await Bun.write(CONFIG_PATH, JSON.stringify(next, null, 2));
  return next;
}

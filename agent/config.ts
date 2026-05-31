// Configuration: defaults, model list, reasoning map, persona/system-prompt
// builder, and persistence of global config to config.json.
import { join } from "path";

export const DEFAULT_VAULT = process.env.VAULT_DIR || "/home/jj/repos/obsidian-vault";

export const DEFAULT_MODEL = "claude-sonnet-4-6";

export const MODELS = [
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6 (default)" },
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
];

export type Effort = "low" | "medium" | "high";

export type Engine = "claude" | "gemini";

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

export function defaultSettings(vaultDir = DEFAULT_VAULT): Settings {
  return {
    engine: "claude",
    model: DEFAULT_MODEL,
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
  useYc?: boolean;
  useRag?: boolean;
  phase: "draft" | "humanize" | "followup";
}

// Compose the system-prompt append from the base persona plus phase/mode notes.
export function buildAppend({ persona, useYc, useRag, phase }: BuildArgs): string {
  const parts = [persona.trim()];

  if (useRag) {
    parts.push(
      `RETRIEVAL MODE\n- Relevant excerpts from the vault have already been retrieved and included in the user message. Treat them as your only source of facts. The Read, Grep, and Glob tools are disabled, so do not try to browse the vault — rely solely on the provided excerpts. If they do not support a claim, leave it out.`
    );
  }

  if (useYc) {
    parts.push(
      `Y COMBINATOR\n- This answer is for a Y Combinator application. Use the yc-combinator skill to shape the structure and tone: direct, concrete, founder-style, no fluff.`
    );
  }

  if (phase === "humanize") {
    parts.push(
      `HUMANIZE PASS\n- Use the humanizer skill on your previous answer. Return ONLY the final humanized version of the answer text: no drafts, no audit notes, no commentary, no "still-AI" bullets.`
    );
  }

  if (phase === "followup") {
    parts.push(
      `REVISION\n- You are revising the existing answer based on the user's requested tweak. Apply their change and return the FULL revised answer, keeping the same grounded first-person voice and avoiding AI-writing tells. Output only the revised answer.`
    );
  }

  return parts.join("\n\n");
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

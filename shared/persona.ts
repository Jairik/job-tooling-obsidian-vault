/*
 * Generic, profile-driven persona (system-prompt) templates shared by the Bun
 * server and the React client. Kept dependency-free, like shared/settings.ts, so
 * neither runtime pulls in the other's code.
 *
 * These replace the previously hard-coded, single-person personas: a fresh
 * install renders a neutral prompt, and first-run onboarding (or the Settings
 * profile fields) fills in the user's name/role/voice to personalize it.
 */

export interface PersonaProfile {
  userName?: string;
  userRole?: string;
  personaNotes?: string;
}

/* Resolves the name fragments used across the templates, with neutral fallbacks. */
function nameParts(userName?: string) {
  const name = (userName ?? "").trim();
  const first = name ? name.split(/\s+/)[0] : "";
  return {
    full: name || "the applicant",
    first: first || "the applicant",
    // First-name possessive reads naturally in the job persona ("JJ's vault").
    firstPossessive: first ? `${first}'s` : "the applicant's",
    // Full-name possessive reads better in the ask persona.
    fullPossessive: name ? `${name}'s` : "the user's",
  };
}

/* Appends optional, user-supplied voice/context notes as their own block. */
function notesBlock(personaNotes?: string): string {
  const notes = (personaNotes ?? "").trim();
  return notes ? `\n\nVOICE & CONTEXT\n${notes}` : "";
}

/*
 * Drafting mode: produce the exact first-person answer the user would submit, grounded
 * in their vault. Generic about vault layout (the agent reads what it needs)
 * instead of naming any one person's folder structure.
 */
export function buildJobPersona(profile: PersonaProfile = {}): string {
  const n = nameParts(profile.userName);
  const role = (profile.userRole ?? "").trim() || "a professional";
  return `You are writing a job-application answer on behalf of ${n.full}, ${role}. You are not a generic assistant: you produce the exact answer text ${n.first} would submit, written in the first person ("I").

GROUNDING
- The working directory is ${n.firstPossessive} personal knowledge vault. Before answering, read whatever you need to ground the answer in real facts: background, goals, leadership and experience examples, skills, projects, Q&A, resumes, and any example answers in the vault that show the target voice.
- Never invent accomplishments, employers, metrics, projects, or technologies. If the vault does not support a claim, leave it out.
- Match the concrete, specific, lightly conversational first-person voice of any example answers in the vault.

OUTPUT
- Output ONLY the answer itself. No "Answer:" label, no headings, no preamble, no meta commentary, no "I hope this helps", and no notes about which files you read.
- Tailor the answer to the provided job description and to the specific question asked.
- Use the length a thoughtful applicant would actually write, unless the question implies a specific length.${notesBlock(profile.personaNotes)}`;
}

/*
 * Ask mode: a general assistant answering questions grounded in the user's vault.
 * No job-application framing, no first-person impersonation — just accurate answers.
 */
export function buildAskPersona(profile: PersonaProfile = {}): string {
  const n = nameParts(profile.userName);
  return `You are a helpful assistant answering questions grounded in ${n.fullPossessive} personal knowledge vault. The working directory is that vault.

GROUNDING
- Read whatever files you need to answer accurately (background, goals, projects, experience, skills, Q&A, resumes, and any example answers).
- Base every claim on what the vault actually says. Never invent facts, projects, metrics, or dates. If the vault does not cover something, say so plainly instead of guessing.

OUTPUT
- Answer the question directly and concisely in a natural, clear voice.
- Output ONLY the answer: no preamble, no "I hope this helps", no meta commentary, and no notes about which files you read.
- Use whatever length and structure (prose, short lists) best fits the question.`;
}

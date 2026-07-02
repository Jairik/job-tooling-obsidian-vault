// The TUI's single-conversation state. Analogous to a `Tab` in src/lib/store.ts
// but with no multi-tab/colors/design — one session, switchable between Ask, Draft,
// and Write modes. Follow-ups resume the server-side session keyed by `id`.
import type { TabMode } from "../../shared/settings";

export type { TabMode } from "../../shared/settings";
export type WriteMode = "summarize" | "manual" | "fillin";
export type Phase = "idle" | "draft" | "humanize" | "cleanup" | "followup" | "done" | "error";

export interface Activity {
  tool: string;
  input: string;
}

export interface ChatMsg {
  role: "user" | "assistant";
  text: string;
}

export interface FillinQuestion {
  id: string;
  question: string;
  answer: string;
  written: boolean;
  targetPath?: string;
  preview?: string;
}

export interface Session {
  id: string;
  mode: TabMode;
  jobDescription: string;
  question: string;
  skills: string[];
  rag: boolean;
  draft: string;
  answer: string;
  messages: ChatMsg[];
  activity: Activity[];
  phase: Phase;
  notice?: string;
  error?: string;
  // Vault Writer fields
  writeMode: WriteMode;
  writePath: string;
  writeInput: string;
  writePreview: string;
  writeConfirmed: boolean;
  fillinQuestions: FillinQuestion[];
  fillinDir: string;
}

/* Generates a unique conversation id (drives a fresh server-side session). */
export function uid(): string {
  return `tui-${crypto.randomUUID()}`;
}

/* Creates a clean session in the given mode, reusing defaults from the prior one. */
export function newSession(mode: TabMode = "ask", base?: Partial<Session>): Session {
  return {
    id: uid(),
    mode,
    jobDescription: "",
    question: "",
    skills: base?.skills ?? [],
    rag: base?.rag ?? false,
    draft: "",
    answer: "",
    messages: [],
    activity: [],
    phase: "idle",
    notice: undefined,
    error: undefined,
    writeMode: base?.writeMode ?? "manual",
    writePath: "",
    writeInput: "",
    writePreview: "",
    writeConfirmed: false,
    fillinQuestions: [],
    fillinDir: "",
  };
}

/* Returns true when a request is in flight for this session. */
export function isRunning(phase: Phase): boolean {
  return phase === "draft" || phase === "humanize" || phase === "cleanup" || phase === "followup";
}

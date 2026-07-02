// The TUI's single-conversation state. Analogous to a `Tab` in src/lib/store.ts
// but with no multi-tab/colors/design — one session, switchable between Ask, Draft,
// and Write modes. Follow-ups resume the server-side session keyed by `id`.
import type { TabMode } from "../../shared/settings";

export type { TabMode } from "../../shared/settings";
export type WriteMode = "summarize" | "manual" | "fillin" | "document";
export type Phase = "idle" | "draft" | "humanize" | "cleanup" | "followup" | "render" | "done" | "error";

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

export interface AttachmentMeta {
  id: string;
  name: string;
  size: number;
  chars: number;
  truncated: boolean;
  expired?: boolean;
}

export type DocAction = "create" | "append" | "update";

export interface DocProposal {
  id: string;
  targetPath: string;
  action: DocAction;
  content: string;
  rationale: string;
  status: "pending" | "written" | "rejected";
}

export interface Session {
  id: string;
  mode: TabMode;
  jobDescription: string;
  question: string;
  extraContext: string;
  attachments: AttachmentMeta[];
  skills: string[];
  rag: boolean;
  latex: boolean;
  texSource: string;
  latexCompileId: string;
  latexLog: string;
  latexBusy?: boolean;
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
  docUploadPath: string;
  docAttachment?: AttachmentMeta;
  docProposals: DocProposal[];
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
    extraContext: "",
    attachments: [],
    skills: base?.skills ?? [],
    rag: base?.rag ?? false,
    latex: base?.latex ?? false,
    texSource: "",
    latexCompileId: "",
    latexLog: "",
    latexBusy: false,
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
    docUploadPath: "",
    docAttachment: undefined,
    docProposals: [],
  };
}

/* Returns true when a request is in flight for this session. */
export function isRunning(phase: Phase): boolean {
  return phase === "draft" || phase === "humanize" || phase === "cleanup" || phase === "followup" || phase === "render";
}

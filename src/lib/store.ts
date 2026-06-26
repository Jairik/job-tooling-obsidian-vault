// Client-side types + localStorage persistence for tabs and global settings.
import {
  DEFAULT_CLEANUP_MODEL,
  mergeEngineSettings,
  normalizeEngineSettings,
  toUrlFetchMethod,
  type CoreSettings,
  type Engine,
  type TabMode,
  type UrlFetchMethod,
} from "../../shared/settings";
import { buildAskPersona } from "../../shared/persona";
import type { FunVariant } from "../../shared/design";

export type { Engine, TabMode, UrlFetchMethod } from "../../shared/settings";

// Vault Writer sub-modes.
export type WriteMode = "summarize" | "manual" | "fillin";

// An installed skill discovered on disk (user or vault scope). Surfaced in the
// skill picker and the Settings skills list.
export interface SkillInfo {
  name: string;
  description: string;
  scope: "user" | "vault";
  path?: string;
}

// A single fill-in question + the user's answer.
export interface FillinQuestion {
  id: string;
  question: string;
  answer: string;
  written: boolean;
  targetPath?: string;
  preview?: string;
}

// Design customization types
export type FontFamily =
  | "system"
  | "inter"
  | "roboto"
  | "opensans"
  | "lato"
  | "montserrat"
  | "source-sans"
  | "nunito"
  | "raleway"
  | "poppins"
  | "fira-code"
  | "jetbrains-mono";

export type BorderRadius = "sharp" | "rounded" | "pill" | "circle";
export type SpacingScale = "compact" | "comfortable" | "spacious";
export type ShadowIntensity = "none" | "subtle" | "medium" | "strong";

export interface DesignSettings {
  funEnabled: boolean;
  funVariant: FunVariant;
  fontFamily: FontFamily;
  fontScale: number;
  accentHue: number;
  accentChroma: number;
  borderRadius: BorderRadius;
  spacingScale: SpacingScale;
  shadowIntensity: ShadowIntensity;
  toolbarDropdown: boolean;
}

export const DEFAULT_DESIGN: DesignSettings = {
  funEnabled: false,
  funVariant: "aurora",
  fontFamily: "system",
  fontScale: 1,
  accentHue: 250,
  accentChroma: 0.13,
  borderRadius: "rounded",
  spacingScale: "comfortable",
  shadowIntensity: "medium",
  toolbarDropdown: false,
};

export interface Settings extends CoreSettings {
  design: DesignSettings;
  urlFetchMethod: UrlFetchMethod;
}

/* Converts possibly old or incomplete browser settings into a full valid object. */
export function normalizeSettings(raw: Partial<Settings>): Settings {
  const engineSettings = normalizeEngineSettings(raw);

  return {
    engine: raw.engine ?? "claude",
    cleanupModel: raw.cleanupModel ?? DEFAULT_CLEANUP_MODEL,
    ...engineSettings,
    humanize: raw.humanize ?? true,
    rag: raw.rag ?? false,
    maxTurns: raw.maxTurns ?? 24,
    persona: raw.persona ?? "",
    // Mirror the server migration: when a cached settings blob predates
    // askPersona, seed it from the profile so the Ask prompt is never blank.
    // A present value (including "") is the user's choice and is kept verbatim.
    askPersona:
      typeof raw.askPersona === "string"
        ? raw.askPersona
        : buildAskPersona({ userName: raw.userName, userRole: raw.userRole, personaNotes: raw.personaNotes }),
    userName: raw.userName ?? "",
    userRole: raw.userRole ?? "",
    personaNotes: raw.personaNotes ?? "",
    onboarded: raw.onboarded ?? false,
    vaultDir: raw.vaultDir ?? "",
    extraDirs: Array.isArray(raw.extraDirs) ? raw.extraDirs : [],
    design: raw.design ?? DEFAULT_DESIGN,
    urlFetchMethod: toUrlFetchMethod(raw.urlFetchMethod),
    webResearchEnabled: raw.webResearchEnabled ?? false,
    searxngUrl: typeof raw.searxngUrl === "string" ? raw.searxngUrl : "http://127.0.0.1:8080",
  };
}

/* Merges a settings patch without replacing per-engine nested preferences. */
export function mergeSettings(base: Settings, patch: Partial<Settings>): Settings {
  return normalizeSettings(mergeEngineSettings(base, patch));
}

export type Phase = "idle" | "draft" | "humanize" | "cleanup" | "followup" | "done" | "error";

export interface Activity {
  tool: string;
  input: string;
}

export interface ChatMsg {
  role: "user" | "assistant";
  text: string;
}

export interface Tab {
  id: string;
  name: string;
  color: string;
  autoNamed: boolean; // false once the user manually renames
  mode: TabMode;
  jobDescription: string;
  question: string;
  skills: string[]; // names of skills selected to apply to this tab's interactions
  rag: boolean;
  draft: string;
  answer: string;
  messages: ChatMsg[];
  activity: Activity[];
  phase: Phase;
  notice?: string;
  error?: string;
  overrideEnabled: boolean;
  override?: Settings;
  // Vault Writer fields
  writeMode: WriteMode;
  writePath: string;
  writeInput: string;
  writePreview: string;
  writeConfirmed: boolean;
  fillinQuestions: FillinQuestion[];
  fillinDir: string;
}

// Distinct accent colors that read well on the dark theme.
export const PALETTE = [
  "#6ea8fe",
  "#f78c6b",
  "#a78bfa",
  "#4ec9b0",
  "#f2cc60",
  "#f06595",
  "#63e6be",
  "#ffa94d",
  "#b197fc",
  "#74c0fc",
  "#ff8787",
  "#69db7c",
];

const ADJECTIVES = [
  "Amber", "Cobalt", "Crimson", "Jade", "Slate", "Violet", "Coral", "Onyx",
  "Teal", "Saffron", "Indigo", "Sienna", "Ivory", "Cedar", "Marble", "Azure",
];
const NOUNS = [
  "Falcon", "Harbor", "Atlas", "Quartz", "Ember", "Comet", "Delta", "Vector",
  "Maple", "Summit", "Beacon", "Drift", "Compass", "Meridian", "Anchor", "Cipher",
];

/* Selects one array item uniformly for generated tab metadata. */
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/* Builds a memorable default name from the adjective and noun word lists. */
function codename(): string {
  return `${pick(ADJECTIVES)} ${pick(NOUNS)}`;
}

// Choose the least-used palette color so new tabs stay visually distinct.
/* Chooses the least-used tab color to make concurrent tabs easy to distinguish. */
function pickColor(existing: Tab[]): string {
  const counts = new Map<string, number>(PALETTE.map((c) => [c, 0]));
  for (const t of existing) counts.set(t.color, (counts.get(t.color) ?? 0) + 1);
  let best = PALETTE[0];
  let min = Infinity;
  for (const c of PALETTE) {
    const n = counts.get(c) ?? 0;
    if (n < min) {
      min = n;
      best = c;
    }
  }
  return best;
}

const FILLERS = /^(please\s+|can you\s+|could you\s+|in (a|one)[^,]*,\s*|tell us\s+|describe\s+|explain\s+|walk us through\s+|share\s+|what(?:'s| is)\s+|how\s+|why\s+)/i;

const COMPANY_STOP = new Set(["we", "the", "our", "you", "your", "this", "that", "a", "an", "i", "it", "they"]);

// Pull a likely company name out of the job description, fully offline.
/* Attempts to extract a company name for a more descriptive local tab title. */
function extractCompany(jobDescription: string): string {
  const text = jobDescription.replace(/\s+/g, " ").trim();
  if (!text) return "";
  const NAME = "([A-Z][\\w&.'’\\-]*(?:\\s+[A-Z][\\w&.'’\\-]*){0,2})";
  // Keyword may be capitalised; the captured name must start with a capital.
  const patterns = [
    new RegExp(`\\b(?:[Aa]t|[Jj]oin)\\s+${NAME}`),
    new RegExp(`\\b[Aa]bout\\s+${NAME}`),
    new RegExp(`${NAME}\\s+is\\s+(?:a|an|hiring|looking|seeking)\\b`),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) {
      const cand = m[1].trim();
      if (cand.length >= 2 && !COMPANY_STOP.has(cand.toLowerCase())) return cand.slice(0, 28);
    }
  }
  return "";
}

// Instant, offline title from the tab's content: company name if we can find one,
// otherwise a short slug of the question (or the JD's first line).
/* Derives a short title locally before model output is available. */
export function deriveTitleLocal(jobDescription: string, question: string): string {
  const company = extractCompany(jobDescription);
  if (company) return company;

  const q = question.replace(/\s+/g, " ").trim();
  const jdFirst = jobDescription.replace(/\s+/g, " ").trim().split(/[.\n]/)[0] || "";
  const source = q || jdFirst;
  if (!source) return "";

  let t = source.replace(FILLERS, "").replace(/[?.!,;:]+$/, "").trim();
  if (!t) t = source;
  if (t.length > 30) t = t.slice(0, 30).replace(/\s+\S*$/, "") + "…";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const TABS_KEY = "jt.tabs.v1";
const SETTINGS_KEY = "jt.settings.v1";
const DESIGN_KEY = "jt.design.v1";

/* Generates a compact client-side identifier for tabs and quick-note records. */
export function uid(): string {
  return crypto.randomUUID();
}

/* Creates a new tab with independent state and a balanced color assignment. */
export function newTab(existing: Tab[] = [], ragDefault = false, mode: TabMode = "ask"): Tab {
  return {
    id: uid(),
    name: codename(),
    color: pickColor(existing),
    autoNamed: true,
    mode,
    jobDescription: "",
    question: "",
    skills: [],
    rag: ragDefault,
    draft: "",
    answer: "",
    messages: [],
    activity: [],
    phase: "idle",
    overrideEnabled: false,
    // Vault Writer defaults
    writeMode: "manual",
    writePath: "",
    writeInput: "",
    writePreview: "",
    writeConfirmed: false,
    fillinQuestions: [],
    fillinDir: "",
  };
}

// A new conversation that reuses an existing tab's context (job description +
// RAG/YC/override settings) but starts fresh: new id → new server session, blank
// question, empty answer/messages, its own color and auto-name.
/* Copies the job context into a clean tab for another related question. */
export function cloneTabForNewQuestion(source: Tab, existing: Tab[]): Tab {
  const base = newTab(existing, source.rag, source.mode);
  return {
    ...base,
    jobDescription: source.jobDescription,
    skills: source.skills,
    rag: source.rag,
    overrideEnabled: source.overrideEnabled,
    override: source.override,
  };
}

// The per-tab settings override to send to the server, or undefined when the tab
// uses the global settings. Both system prompts (persona for Job mode, askPersona
// for Ask mode) and humanize are ALWAYS taken from the current global settings:
// the override UI only edits engine/model/effort/vault, never the system prompts,
// and humanize is now a pre-packaged skill toggled solely in Settings → Skills. So
// a tab — or one cloned via "+ New question" — follows the current global values
// rather than snapshots frozen when Override was first toggled on (now stale).
/* Returns an override payload only when the tab intentionally differs from global settings. */
export function overrideSettingsBody(tab: Tab, global: Settings): Settings | undefined {
  if (!tab.overrideEnabled || !tab.override) return undefined;
  return { ...tab.override, persona: global.persona, askPersona: global.askPersona, humanize: global.humanize };
}

/* Restores tabs from localStorage and repairs data written by earlier app versions. */
export function loadTabs(): Tab[] {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (raw) {
      const tabs = JSON.parse(raw) as Tab[];
      // Backfill fields added in later versions + reset transient running state.
      return tabs.map((t, i) => ({
        ...t,
        color: t.color ?? PALETTE[i % PALETTE.length],
        rag: t.rag ?? false,
        // Migrate the old per-tab `yc` boolean into the general skills selection.
        skills: t.skills ?? ((t as any).yc ? ["yc-combinator"] : []),
        // Tabs predating the rebrand: keep clearly job-application ones in Job
        // mode, default everything else to the new Ask mode.
        mode: t.mode ?? (t.jobDescription || (t as any).yc ? "job" : "ask"),
        autoNamed: t.autoNamed ?? /^Tab \d+$/.test(t.name),
        phase:
          t.phase === "draft" || t.phase === "humanize" || t.phase === "cleanup" || t.phase === "followup"
            ? "idle"
            : t.phase,
        // Backfill Vault Writer fields for tabs saved before this feature.
        writeMode: t.writeMode ?? "manual",
        writePath: t.writePath ?? "",
        writeInput: t.writeInput ?? "",
        writePreview: t.writePreview ?? "",
        writeConfirmed: t.writeConfirmed ?? false,
        fillinQuestions: t.fillinQuestions ?? [],
        fillinDir: t.fillinDir ?? "",
      }));
    }
  } catch {
    /* ignore */
  }
  return [newTab()];
}

/* Persists the complete tab list for the next browser session. */
export function saveTabs(tabs: Tab[]): void {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
  } catch {
    /* ignore quota */
  }
}

/* Reads browser settings; callers use server defaults if none have been saved. */
export function loadSettings(): Settings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? normalizeSettings(JSON.parse(raw) as Partial<Settings>) : null;
  } catch {
    return null;
  }
}

/* Persists the client settings cache after a user preference changes. */
export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore quota */
  }
}

/* Restores visual preferences while preserving defaults for newly introduced options. */
export function loadDesignSettings(): DesignSettings {
  try {
    const raw = localStorage.getItem(DESIGN_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DesignSettings>;
      return { ...DEFAULT_DESIGN, ...parsed };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_DESIGN;
}

/* Persists presentation-only settings separately from model configuration. */
export function saveDesignSettings(d: DesignSettings): void {
  try {
    localStorage.setItem(DESIGN_KEY, JSON.stringify(d));
  } catch {
    /* ignore quota */
  }
}

// ── Quick notes ─────────────────────────────────────────────────────────────
// A personal, copy-on-click scratchpad: reusable profile links, professional
// references (real people), and labeled note boxes to paste into applications.
// Local-only.

export interface QuickLink {
  id: string;
  icon: string; // key into the icon set; click cycles it
  label: string;
  value: string;
}

// A professional reference — an actual person, not a free-form note.
export interface Reference {
  id: string;
  name: string;
  email: string;
  phone: string;
}

export interface QuickBox {
  id: string;
  label: string;
  value: string;
}

export interface QuickNotes {
  links: QuickLink[];
  references: Reference[];
  boxes: QuickBox[];
}

const QUICKNOTES_KEY = "jt.quicknotes.v1";

// References are a fixed set of three slots, numbered 1–3.
/* Provides the initial contact references shown in Quick Notes. */
function defaultReferences(): Reference[] {
  return [
    { id: uid(), name: "", email: "", phone: "" },
    { id: uid(), name: "", email: "", phone: "" },
    { id: uid(), name: "", email: "", phone: "" },
  ];
}

/* Builds the first-run data model for the Quick Notes drawer. */
function defaultQuickNotes(): QuickNotes {
  return {
    links: [
      { id: uid(), icon: "github", label: "GitHub", value: "" },
      { id: uid(), icon: "linkedin", label: "LinkedIn", value: "" },
      { id: uid(), icon: "globe", label: "Personal site", value: "" },
      { id: uid(), icon: "mail", label: "Email", value: "" },
    ],
    references: defaultReferences(),
    boxes: [{ id: uid(), label: "Notes", value: "" }],
  };
}

/* Restores Quick Notes and backfills any collections absent in older saved data. */
export function loadQuickNotes(): QuickNotes {
  try {
    const raw = localStorage.getItem(QUICKNOTES_KEY);
    if (raw) {
      const qn = JSON.parse(raw) as QuickNotes;
      return {
        links: Array.isArray(qn.links) ? qn.links : [],
        // Backfill references for notes saved before this field existed.
        references: Array.isArray(qn.references) ? qn.references : defaultReferences(),
        boxes: Array.isArray(qn.boxes) ? qn.boxes : [],
      };
    }
  } catch {
    /* ignore */
  }
  return defaultQuickNotes();
}

/* Persists the editable Quick Notes workspace in localStorage. */
export function saveQuickNotes(qn: QuickNotes): void {
  try {
    localStorage.setItem(QUICKNOTES_KEY, JSON.stringify(qn));
  } catch {
    /* ignore */
  }
}

// ── Activity log ────────────────────────────────────────────────────────────
// A lightweight, local-only record of what the tool has been doing: generations,
// follow-ups, finished answers, tool calls and errors. Powers the Logs modal.

export type LogKind = "generate" | "followup" | "cleanup" | "answer" | "error" | "tool";

export interface LogEntry {
  id: string;
  ts: number; // Date.now()
  tabId: string;
  tabName: string;
  tabColor: string;
  kind: LogKind;
  engine?: Engine; // generate / answer
  model?: string; // generate / answer
  question?: string; // generate / followup
  detail?: string; // tool summary | error message | answer excerpt
  durationMs?: number; // answer (done)
  chars?: number; // answer length
}

const LOGS_KEY = "jt.logs.v1";
export const LOG_CAP = 300;

/* Reads the browser's activity-log cache, treating malformed storage as empty. */
export function loadLogs(): LogEntry[] {
  try {
    const raw = localStorage.getItem(LOGS_KEY);
    if (raw) {
      const logs = JSON.parse(raw) as LogEntry[];
      return Array.isArray(logs) ? logs : [];
    }
  } catch {
    /* ignore */
  }
  return [];
}

/* Saves the bounded activity-log cache for immediate UI hydration. */
export function saveLogs(logs: LogEntry[]): void {
  try {
    localStorage.setItem(LOGS_KEY, JSON.stringify(logs));
  } catch {
    /* ignore quota */
  }
}

/* Removes the browser copy of the activity log. */
export function clearLogs(): void {
  try {
    localStorage.removeItem(LOGS_KEY);
  } catch {
    /* ignore */
  }
}

// Merge two log lists (e.g. the localStorage cache and the durable server copy),
// de-duplicating by id, ordering oldest→newest, and keeping the most recent cap.
/* Combines local and server logs by id, retaining the most recent bounded set. */
export function mergeLogs(a: LogEntry[], b: LogEntry[]): LogEntry[] {
  const byId = new Map<string, LogEntry>();
  for (const e of [...a, ...b]) {
    if (e && typeof e.id === "string") byId.set(e.id, e);
  }
  return [...byId.values()].sort((x, y) => x.ts - y.ts).slice(-LOG_CAP);
}

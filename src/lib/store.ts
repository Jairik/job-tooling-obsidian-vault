// Client-side types + localStorage persistence for tabs and global settings.

export type Effort = "low" | "medium" | "high";
export type Engine = "claude" | "gemini";

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

export type Phase = "idle" | "draft" | "humanize" | "followup" | "done" | "error";

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
  jobDescription: string;
  question: string;
  yc: boolean;
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

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function codename(): string {
  return `${pick(ADJECTIVES)} ${pick(NOUNS)}`;
}

// Choose the least-used palette color so new tabs stay visually distinct.
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

const TABS_KEY = "jas.tabs.v1";
const SETTINGS_KEY = "jas.settings.v1";

export function uid(): string {
  return crypto.randomUUID();
}

export function newTab(existing: Tab[] = [], ragDefault = false): Tab {
  return {
    id: uid(),
    name: codename(),
    color: pickColor(existing),
    autoNamed: true,
    jobDescription: "",
    question: "",
    yc: false,
    rag: ragDefault,
    draft: "",
    answer: "",
    messages: [],
    activity: [],
    phase: "idle",
    overrideEnabled: false,
  };
}

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
        autoNamed: t.autoNamed ?? /^Tab \d+$/.test(t.name),
        phase:
          t.phase === "draft" || t.phase === "humanize" || t.phase === "followup" ? "idle" : t.phase,
      }));
    }
  } catch {
    /* ignore */
  }
  return [newTab()];
}

export function saveTabs(tabs: Tab[]): void {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
  } catch {
    /* ignore quota */
  }
}

export function loadSettings(): Settings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? (JSON.parse(raw) as Settings) : null;
  } catch {
    return null;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

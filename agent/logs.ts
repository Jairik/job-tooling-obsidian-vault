// Server-side persistence of the activity log to a local, gitignored file.
// The browser keeps its own copy in localStorage for instant render; this gives
// the log a durable home on disk (under logs/) so it survives a cleared cache and
// is shared across browsers on the same machine. Stored as JSON Lines so appends
// are cheap; reads trim to the most recent LOG_CAP entries and compact the file
// when it grows well past that.
import { appendFile, mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

const LOG_DIR = join(import.meta.dir, "..", "logs");
const LOG_FILE = join(LOG_DIR, "activity.jsonl");

// Keep the on-disk log bounded. A little larger than the client cap so the file
// holds a bit more history than any single browser session shows.
export const LOG_CAP = 1000;
const COMPACT_AT = LOG_CAP * 2;

// Mirrors the client LogEntry (src/lib/store.ts). Kept loose on purpose: the
// server just persists whatever the UI records, it doesn't interpret the fields.
export interface LogEntry {
  id: string;
  ts: number;
  tabId?: string;
  tabName?: string;
  tabColor?: string;
  kind?: string;
  engine?: string;
  model?: string;
  question?: string;
  detail?: string;
  durationMs?: number;
  chars?: number;
}

function parseLines(text: string): LogEntry[] {
  const out: LogEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* skip a corrupt line rather than losing the whole log */
    }
  }
  return out;
}

export async function readLogs(): Promise<LogEntry[]> {
  try {
    const entries = parseLines(await readFile(LOG_FILE, "utf8"));
    return entries.slice(-LOG_CAP);
  } catch {
    return [];
  }
}

export async function appendLog(entry: LogEntry): Promise<void> {
  if (!entry || typeof entry.id !== "string") return;
  try {
    await mkdir(LOG_DIR, { recursive: true });
    await appendFile(LOG_FILE, JSON.stringify(entry) + "\n");
    await compactIfNeeded();
  } catch {
    /* best-effort: logging must never break a generation */
  }
}

// Rewrite the file down to the most recent LOG_CAP entries once it has roughly
// doubled past the cap, so the append log can't grow without bound.
async function compactIfNeeded(): Promise<void> {
  try {
    const entries = parseLines(await readFile(LOG_FILE, "utf8"));
    if (entries.length <= COMPACT_AT) return;
    const trimmed = entries.slice(-LOG_CAP);
    await writeFile(LOG_FILE, trimmed.map((e) => JSON.stringify(e)).join("\n") + "\n");
  } catch {
    /* ignore */
  }
}

export async function clearLogs(): Promise<void> {
  try {
    await writeFile(LOG_FILE, "");
  } catch {
    /* ignore */
  }
}

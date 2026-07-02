// Disk-backed store for extracted document text. Only lightweight metadata is
// returned to (and persisted by) the browser; the full text stays here, keyed by
// upload id, so tabs never push hundreds of KB through localStorage. Files live
// in .attachments/ (gitignored) and therefore survive `bun --hot` reloads and
// server restarts, matching how tabs themselves persist across sessions.
import { join } from "path";
import { mkdir, readdir, rm, stat } from "fs/promises";
import type { ExtractedDoc } from "./documents";

const STORE_DIR = join(import.meta.dir, "..", ".attachments");
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 50;

export interface AttachmentMeta {
  id: string;
  name: string;
  size: number;
  chars: number;
  truncated: boolean;
}

interface AttachmentRecord extends AttachmentMeta {
  text: string;
  createdAt: number;
}

// Small read-through cache so repeated generates don't re-read the same file.
const cache = new Map<string, AttachmentRecord>();

function recordPath(id: string): string {
  return join(STORE_DIR, `${id}.json`);
}

/* Persists one extracted document and returns its client-safe metadata. */
export async function saveAttachment(name: string, size: number, doc: ExtractedDoc): Promise<AttachmentMeta> {
  await mkdir(STORE_DIR, { recursive: true });
  const record: AttachmentRecord = {
    id: crypto.randomUUID(),
    name,
    size,
    chars: doc.chars,
    truncated: doc.truncated,
    text: doc.text,
    createdAt: Date.now(),
  };
  await Bun.write(recordPath(record.id), JSON.stringify(record));
  cache.set(record.id, record);
  sweepAttachments().catch(() => {});
  const { text: _text, createdAt: _createdAt, ...meta } = record;
  return meta;
}

/* Loads one stored attachment, or undefined when it was pruned or never existed. */
export async function getAttachment(id: string): Promise<AttachmentRecord | undefined> {
  // Ids are UUIDs minted by saveAttachment; reject anything path-like.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const cached = cache.get(id);
  if (cached) return cached;
  try {
    const record = JSON.parse(await Bun.file(recordPath(id)).text()) as AttachmentRecord;
    cache.set(id, record);
    return record;
  } catch {
    return undefined;
  }
}

/* Removes one attachment from disk and cache. */
export async function deleteAttachment(id: string): Promise<void> {
  cache.delete(id);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await rm(recordPath(id), { force: true });
}

/* Resolves upload ids into prompt-ready documents, reporting the missing ones. */
export async function resolveAttachments(
  ids: string[]
): Promise<{ docs: { name: string; text: string }[]; missing: string[] }> {
  const docs: { name: string; text: string }[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const record = await getAttachment(id);
    if (record) docs.push({ name: record.name, text: record.text });
    else missing.push(id);
  }
  return { docs, missing };
}

/* Prunes attachments older than the retention window or beyond the entry cap. */
export async function sweepAttachments(): Promise<void> {
  let names: string[];
  try {
    names = (await readdir(STORE_DIR)).filter((n) => n.endsWith(".json"));
  } catch {
    return; // store dir doesn't exist yet
  }
  const entries: { name: string; mtime: number }[] = [];
  for (const name of names) {
    try {
      const s = await stat(join(STORE_DIR, name));
      entries.push({ name, mtime: s.mtimeMs });
    } catch {
      /* raced with a delete */
    }
  }
  entries.sort((a, b) => b.mtime - a.mtime);
  const now = Date.now();
  for (const [i, entry] of entries.entries()) {
    if (i >= MAX_ENTRIES || now - entry.mtime > MAX_AGE_MS) {
      const id = entry.name.replace(/\.json$/, "");
      cache.delete(id);
      await rm(join(STORE_DIR, entry.name), { force: true });
    }
  }
}

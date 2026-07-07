// Staging for documents uploaded in the Vault Writer's Upload mode. Files are
// written to a temporary per-tab directory; the doc-fill agent turn then reads
// them (PDFs and images natively via the Read tool, .docx via a text sidecar it
// extracts on demand). Nothing here ever touches the vault itself.
import { tmpdir } from "os";
import { join, extname, basename } from "path";
import { mkdir, writeFile, readdir, rm, stat, chmod } from "fs/promises";

export interface UploadedDocMeta {
  name: string;
  type: string; // friendly kind: "pdf" | "docx" | "image" | "text"
  size: number; // bytes
}

const UPLOAD_ROOT = join(tmpdir(), "vault-assistant-uploads");

// Documents we know how to feed to the model: text/markdown directly, PDFs and
// images natively through the Read tool, and Word docs via text extraction.
const ALLOWED = new Set([".pdf", ".docx", ".txt", ".md", ".markdown", ".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB per file
const MAX_FILES = 20; // per tab

/* Maps a filename extension to a friendly document kind for the UI. */
export function docKind(name: string): string {
  const ext = extname(name).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".docx") return "docx";
  if (IMAGE_EXTS.has(ext)) return "image";
  return "text";
}

/* Restricts a tab id to a safe directory name so uploads cannot escape the root. */
function safeTabId(tabId: string): string {
  const clean = (tabId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!clean) throw new Error("Invalid tab id");
  return clean;
}

const MAX_NAME_LEN = 200;

/* Reduces a client filename to a single safe path segment. */
function safeName(name: string): string {
  return basename(name || "").replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, MAX_NAME_LEN) || "file";
}

/*
 * Returns `base` if it isn't already in `taken`, otherwise inserts a numeric
 * suffix before the extension until a free name is found. This keeps two
 * uploads that share a basename — or that sanitize to the same string, e.g.
 * "a:b.pdf" and "a?b.pdf" — from silently overwriting one another on disk.
 *
 * The suffix uses only characters `safeName` already allows (letters, digits,
 * ".", "_", " ", "-"), since `removeUpload` re-sanitizes a name before
 * deleting it — a suffix built from disallowed characters would come back
 * mangled from that second pass and the file could never be deleted. For the
 * same reason, the stem is truncated to leave room for the suffix so the
 * whole candidate stays within `safeName`'s length cap: a candidate longer
 * than that cap would get silently shortened by `removeUpload`'s re-sanitize
 * pass, no longer matching the file actually saved to disk.
 */
function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  const ext = extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  let i = 2;
  let candidate = withSuffix(stem, ext, i);
  while (taken.has(candidate)) {
    i++;
    candidate = withSuffix(stem, ext, i);
  }
  return candidate;
}

/* Builds one "<stem>-<n><ext>" candidate, trimming the stem so the result never exceeds MAX_NAME_LEN. */
function withSuffix(stem: string, ext: string, i: number): string {
  const suffix = `-${i}`;
  const maxStem = Math.max(0, MAX_NAME_LEN - suffix.length - ext.length);
  return `${stem.slice(0, maxStem)}${suffix}${ext}`;
}

/* Returns (and lazily creates) the staging directory for one tab's uploads. */
async function dirFor(tabId: string): Promise<string> {
  // Force 0700/0600 on everything under the shared tmp root so uploaded
  // documents aren't readable by other local accounts. Directories may
  // predate this fix (or, if `mkdir`'s `mode` was clipped by umask, not have
  // taken effect), so re-assert the mode explicitly rather than relying on
  // `mkdir`'s `mode` option alone; `chmod` is a no-op failure (best effort)
  // if we don't own a pre-existing directory.
  await mkdir(UPLOAD_ROOT, { recursive: true, mode: 0o700 });
  await chmod(UPLOAD_ROOT, 0o700).catch(() => {});
  const dir = join(UPLOAD_ROOT, safeTabId(tabId));
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700).catch(() => {});
  return dir;
}

/* Persists newly uploaded files for a tab, rejecting oversized or unsupported ones. */
export async function saveUploads(tabId: string, files: File[]): Promise<UploadedDocMeta[]> {
  const dir = await dirFor(tabId);
  const existing = (await readdir(dir)).filter((n) => !n.endsWith(EXTRACTED_SUFFIX));
  const taken = new Set(existing);
  const saved: UploadedDocMeta[] = [];

  for (const file of files) {
    const ext = extname(file.name).toLowerCase();
    if (!ALLOWED.has(ext)) throw new Error(`Unsupported file type: ${file.name}`);
    if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is too large (max 25 MB)`);
    if (existing.length + saved.length >= MAX_FILES) throw new Error(`Too many files (max ${MAX_FILES})`);

    const name = uniqueName(safeName(file.name), taken);
    taken.add(name);
    const buf = Buffer.from(await file.arrayBuffer());
    await writeFile(join(dir, name), buf, { mode: 0o600 });
    saved.push({ name, type: docKind(name), size: file.size });
  }
  return saved;
}

/* Lists the documents currently staged for a tab (excluding extraction sidecars). */
export async function listUploads(tabId: string): Promise<UploadedDocMeta[]> {
  const dir = join(UPLOAD_ROOT, safeTabId(tabId));
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: UploadedDocMeta[] = [];
  for (const name of names) {
    if (name.endsWith(EXTRACTED_SUFFIX)) continue;
    try {
      const s = await stat(join(dir, name));
      out.push({ name, type: docKind(name), size: s.size });
    } catch {
      /* skip vanished file */
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/* Deletes one staged document (and its extraction sidecar, if any). */
export async function removeUpload(tabId: string, name: string): Promise<void> {
  const dir = join(UPLOAD_ROOT, safeTabId(tabId));
  const safe = safeName(name);
  await rm(join(dir, safe), { force: true });
  await rm(join(dir, safe + EXTRACTED_SUFFIX), { force: true });
}

const EXTRACTED_SUFFIX = ".extracted.txt";

/*
 * Returns absolute file paths the doc-fill agent turn should Read. PDFs, images
 * and text pass through unchanged; .docx files are converted to a UTF-8 text
 * sidecar (the Read tool cannot parse the binary Office format directly).
 */
export async function resolveAgentPaths(tabId: string): Promise<string[]> {
  const dir = join(UPLOAD_ROOT, safeTabId(tabId));
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const paths: string[] = [];
  for (const name of names) {
    if (name.endsWith(EXTRACTED_SUFFIX)) continue;
    const abs = join(dir, name);
    if (extname(name).toLowerCase() === ".docx") {
      const sidecar = abs + EXTRACTED_SUFFIX;
      try {
        const mammoth = (await import("mammoth")).default;
        const { value } = await mammoth.extractRawText({ path: abs });
        await writeFile(sidecar, value || "(empty document)", { encoding: "utf8", mode: 0o600 });
        paths.push(sidecar);
      } catch (e: any) {
        await writeFile(sidecar, `(failed to extract ${name}: ${e?.message || e})`, { encoding: "utf8", mode: 0o600 });
        paths.push(sidecar);
      }
    } else {
      paths.push(abs);
    }
  }
  return paths.sort((a, b) => a.localeCompare(b));
}

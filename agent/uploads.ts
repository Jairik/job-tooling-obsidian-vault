// Staging for documents uploaded in the Vault Writer's Upload mode. Files are
// written to a temporary per-tab directory; the doc-fill agent turn then reads
// them (PDFs and images natively via the Read tool, .docx via a text sidecar it
// extracts on demand). Nothing here ever touches the vault itself.
import { tmpdir } from "os";
import { join, extname, basename } from "path";
import { mkdir, writeFile, readdir, rm, stat } from "fs/promises";

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

/* Reduces a client filename to a single safe path segment. */
function safeName(name: string): string {
  return basename(name || "").replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 200) || "file";
}

/* Returns (and lazily creates) the staging directory for one tab's uploads. */
async function dirFor(tabId: string): Promise<string> {
  const dir = join(UPLOAD_ROOT, safeTabId(tabId));
  await mkdir(dir, { recursive: true });
  return dir;
}

/* Persists newly uploaded files for a tab, rejecting oversized or unsupported ones. */
export async function saveUploads(tabId: string, files: File[]): Promise<UploadedDocMeta[]> {
  const dir = await dirFor(tabId);
  const existing = (await readdir(dir)).filter((n) => !n.endsWith(EXTRACTED_SUFFIX));
  const saved: UploadedDocMeta[] = [];

  for (const file of files) {
    const ext = extname(file.name).toLowerCase();
    if (!ALLOWED.has(ext)) throw new Error(`Unsupported file type: ${file.name}`);
    if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is too large (max 25 MB)`);
    if (existing.length + saved.length >= MAX_FILES) throw new Error(`Too many files (max ${MAX_FILES})`);

    const name = safeName(file.name);
    const buf = Buffer.from(await file.arrayBuffer());
    await writeFile(join(dir, name), buf);
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
        await writeFile(sidecar, value || "(empty document)", "utf8");
        paths.push(sidecar);
      } catch (e: any) {
        await writeFile(sidecar, `(failed to extract ${name}: ${e?.message || e})`, "utf8");
        paths.push(sidecar);
      }
    } else {
      paths.push(abs);
    }
  }
  return paths.sort((a, b) => a.localeCompare(b));
}

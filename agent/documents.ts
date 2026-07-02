// Server-side document text extraction for uploaded files. Parsing happens in
// TypeScript (unpdf / mammoth) rather than in an agent turn, so attaching a
// document costs zero model tokens until its text is actually used in a prompt.
import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
// Bound the text fed into prompts: ~200k chars ≈ 50k tokens, already generous.
export const MAX_EXTRACT_CHARS = 200_000;
// Below this many characters a "successful" extraction is treated as a scanned /
// image-only document rather than usable text.
const MIN_MEANINGFUL_CHARS = 50;

export type DocumentKind = "pdf" | "docx" | "text";

export interface ExtractedDoc {
  text: string;
  chars: number;
  truncated: boolean;
  kind: DocumentKind;
}

/* Maps a filename to the extraction strategy, or null when unsupported. */
export function documentKind(filename: string): DocumentKind | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".txt") || lower.endsWith(".md")) return "text";
  return null;
}

/* Collapses odd extractor whitespace while preserving paragraph breaks. */
function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* Extracts plain text from an uploaded PDF, DOCX, or plain-text document. */
export async function extractDocument(filename: string, data: ArrayBuffer): Promise<ExtractedDoc> {
  const kind = documentKind(filename);
  if (!kind) {
    throw new Error(`Unsupported file type — attach a .pdf or .docx file.`);
  }
  if (data.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(`File too large (max ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB).`);
  }

  let raw = "";
  if (kind === "pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(data));
    const { text } = await extractText(pdf, { mergePages: true });
    raw = text;
  } else if (kind === "docx") {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(data) });
    raw = value;
  } else {
    raw = new TextDecoder("utf-8", { fatal: false }).decode(data);
  }

  const text = normalizeText(raw);
  if (text.length < MIN_MEANINGFUL_CHARS) {
    throw new Error(
      kind === "pdf"
        ? "No selectable text found — this PDF may be a scanned image. OCR is not supported."
        : "No text could be extracted from this document."
    );
  }

  const truncated = text.length > MAX_EXTRACT_CHARS;
  return {
    text: truncated ? text.slice(0, MAX_EXTRACT_CHARS) : text,
    chars: text.length,
    truncated,
    kind,
  };
}

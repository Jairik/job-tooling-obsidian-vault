// Terminal markdown rendering for answer panes, plus a plain-text extractor used
// by "copy as plain text" (mirrors the web app's markdown-stripped copy in
// src/components/AnswerStream.tsx).
import { Marked } from "marked";
import { markedTerminal } from "marked-terminal";

// One Marked instance per render width: marked-terminal reflows paragraphs to the
// pane width so the answer pane can scroll by physical line without re-wrapping.
const byWidth = new Map<number, Marked>();

function instanceFor(width: number): Marked {
  let m = byWidth.get(width);
  if (!m) {
    m = new Marked();
    m.use(markedTerminal({ width, reflowText: true, tab: 2 }) as any);
    byWidth.set(width, m);
  }
  return m;
}

/* Renders markdown to ANSI sized for the given pane width. */
export function renderMarkdown(text: string, width = 80): string {
  if (!text.trim()) return "";
  const safeWidth = Math.max(20, Math.min(200, Math.floor(width)));
  try {
    const out = instanceFor(safeWidth).parse(text) as string;
    return out.replace(/\n+$/, "");
  } catch {
    return text; // never let a render error swallow the answer
  }
}

/* Removes ANSI escape sequences (e.g. to measure or copy rendered output). */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\[[0-9;]*m/g, "");
}

/* Strips common markdown syntax to a readable plain-text form for clipboard copy. */
export function toPlainText(md: string): string {
  let t = md;
  // Fenced code blocks: keep the code, drop the fences.
  t = t.replace(/```[^\n]*\n([\s\S]*?)```/g, (_m, code) => code.replace(/\n$/, ""));
  // Inline code, bold, italics, strikethrough markers.
  t = t.replace(/`([^`]+)`/g, "$1");
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1");
  t = t.replace(/\*([^*]+)\*/g, "$1");
  t = t.replace(/__([^_]+)__/g, "$1");
  t = t.replace(/~~([^~]+)~~/g, "$1");
  // Links / images: keep the visible text.
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // Heading hashes and blockquote markers at line start.
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  t = t.replace(/^\s{0,3}>\s?/gm, "");
  return t.trim();
}

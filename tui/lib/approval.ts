import { buildVaultPreviewPayload, buildVaultWritePayload } from "./payloads";
import { uid, type DocAction, type DocProposal, type FillinQuestion } from "./session";

export interface VaultPreview {
  ok: boolean;
  path: string;
  exists: boolean;
  existingContent: string;
  tooLarge?: boolean;
  token: string;
  error?: string;
}

export interface PendingWriteApproval {
  path: string;
  exists: boolean;
  existingContent: string;
  tooLarge?: boolean;
  newContent: string;
  token: string;
  action: DocAction;
}

export function createPendingApproval(preview: VaultPreview, content: string, action: DocAction = "create"): PendingWriteApproval {
  if (action === "append" && preview.exists && preview.tooLarge) {
    throw new Error("Cannot safely append to this file because its existing content is too large to preview.");
  }

  const newContent =
    action === "append" && preview.exists && !preview.tooLarge
      ? `${preview.existingContent.replace(/\s+$/, "")}\n\n${content}`
      : content;

  return {
    path: preview.path,
    exists: preview.exists,
    existingContent: preview.existingContent,
    tooLarge: preview.tooLarge,
    newContent,
    token: preview.token,
    action,
  };
}

export function approvalPreviewPayload(path: string) {
  return buildVaultPreviewPayload(path);
}

export function approvalWritePayload(approval: PendingWriteApproval) {
  return buildVaultWritePayload(approval.path, approval.newContent, approval.token);
}

export function formatApprovalSummary(approval: PendingWriteApproval): string {
  const target = approval.exists ? "existing file" : "new file";
  const existing = approval.tooLarge ? "existing content too large to display" : `${approval.existingContent.length} existing chars`;
  return [
    `Path: ${approval.path}`,
    `Action: ${approval.action}`,
    `Target: ${target}`,
    `Size: ${existing} -> ${approval.newContent.length} new chars`,
    "",
    "Press y or Enter to approve. Press n or Esc to reject.",
  ].join("\n");
}

function stripFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

export function parseJsonArrayFromModel<T = unknown>(raw: string): T[] {
  const text = stripFence(raw);
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error("Expected a JSON array");
    return parsed as T[];
  } catch {
    const first = text.indexOf("[");
    const last = text.lastIndexOf("]");
    if (first === -1 || last === -1 || last < first) throw new Error("Invalid JSON array returned");
    const parsed = JSON.parse(text.substring(first, last + 1));
    if (!Array.isArray(parsed)) throw new Error("Expected a JSON array");
    return parsed as T[];
  }
}

export function parseFillinQuestions(raw: string): FillinQuestion[] {
  return parseJsonArrayFromModel<any>(raw).map((q) => ({
    id: uid(),
    question: String(q.question ?? ""),
    answer: "",
    written: false,
    targetPath: typeof q.targetPath === "string" ? q.targetPath : undefined,
  }));
}

function normalizeAction(value: unknown): DocAction {
  return value === "append" || value === "update" ? value : "create";
}

export function parseDocProposals(raw: string): DocProposal[] {
  return parseJsonArrayFromModel<any>(raw).map((p) => ({
    id: uid(),
    targetPath: String(p.targetPath ?? ""),
    action: normalizeAction(p.action),
    content: String(p.content ?? ""),
    rationale: String(p.rationale ?? ""),
    status: "pending",
  }));
}

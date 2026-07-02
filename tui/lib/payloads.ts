import type { CoreSettings, TabMode } from "../../shared/settings";
import type { AttachmentMeta, DocProposal, FillinQuestion, Session } from "./session";

type MaybeSettings = Partial<CoreSettings> | undefined;

function addSettings<T extends Record<string, unknown>>(payload: T, settings?: MaybeSettings): T & { settings?: MaybeSettings } {
  return settings ? { ...payload, settings } : payload;
}

export function activeAttachmentIds(attachments: AttachmentMeta[]): string[] {
  return attachments.filter((a) => !a.expired).map((a) => a.id);
}

export function buildGeneratePayload(session: Pick<Session, "jobDescription" | "question" | "skills" | "rag" | "mode" | "extraContext" | "attachments" | "latex">, settings?: MaybeSettings) {
  return addSettings(
    {
      jobDescription: session.jobDescription,
      question: session.question,
      skills: session.skills,
      rag: session.rag,
      mode: session.mode as TabMode,
      extraContext: session.extraContext,
      attachmentIds: activeAttachmentIds(session.attachments),
      latex: session.latex,
    },
    settings
  );
}

export function buildMessagePayload(session: Pick<Session, "skills" | "rag" | "mode" | "latex">, text: string, settings?: MaybeSettings) {
  return addSettings({ text, skills: session.skills, rag: session.rag, mode: session.mode, latex: session.latex }, settings);
}

export function buildCleanupPayload(session: Pick<Session, "skills" | "latex">, text: string, settings?: MaybeSettings) {
  return addSettings({ text, skills: session.skills, latex: session.latex }, settings);
}

export function buildSummarizePayload(session: Pick<Session, "skills">, input: string, isUrl: boolean, settings?: MaybeSettings) {
  return addSettings({ input, isUrl, skills: session.skills }, settings);
}

export function buildAutoPlacePayload(content: string, settings?: MaybeSettings) {
  return addSettings({ content }, settings);
}

export function buildFillinScanPayload(session: Pick<Session, "writeInput" | "fillinDir">, settings?: MaybeSettings) {
  return addSettings({ prompt: session.writeInput, dir: session.fillinDir }, settings);
}

export function buildFillinWritePayload(question: Pick<FillinQuestion, "question" | "answer" | "targetPath">, session: Pick<Session, "skills">, settings?: MaybeSettings) {
  return addSettings(
    { question: question.question, answer: question.answer, targetPath: question.targetPath, skills: session.skills },
    settings
  );
}

export function buildWriteCleanupPayload(session: Pick<Session, "writeInput" | "skills">, settings?: MaybeSettings) {
  return addSettings({ text: session.writeInput, skills: session.skills }, settings);
}

export function buildDocProposePayload(session: Pick<Session, "docAttachment" | "writeInput">, settings?: MaybeSettings) {
  return addSettings({ attachmentId: session.docAttachment?.id, focus: session.writeInput }, settings);
}

export function buildFetchUrlPayload(url: string, method: CoreSettings["urlFetchMethod"]) {
  return { url, method };
}

export function buildVaultPreviewPayload(path: string) {
  return { path };
}

export function buildVaultWritePayload(path: string, content: string, token: string) {
  return { path, content, token };
}

export function buildDocWriteRequest(proposal: Pick<DocProposal, "targetPath" | "content" | "action">) {
  return { path: proposal.targetPath, content: proposal.content, action: proposal.action };
}


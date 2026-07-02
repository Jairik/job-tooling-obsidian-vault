// Streamed conversation + vault-writer actions for the TUI. Ported from
// src/lib/conversation-actions.ts and the vault-writer handlers in src/App.tsx,
// with `updateTab` replaced by a single `setSession` updater. Request payloads are
// kept identical so the server sees the same bodies the web client sends. Settings
// are omitted (no per-tab override) so the server uses the global config the TUI
// edits via /api/config.
import { api, streamPost, type ServerSettings } from "./api";
import { type DocAction, type FillinQuestion, type Session } from "./session";
import {
  buildAutoPlacePayload,
  buildCleanupPayload,
  buildDocProposePayload,
  buildFillinScanPayload,
  buildFillinWritePayload,
  buildGeneratePayload,
  buildMessagePayload,
  buildSummarizePayload,
  buildWriteCleanupPayload,
} from "./payloads";
import { parseDocProposals, parseFillinQuestions } from "./approval";

type Updater = (fn: (s: Session) => Partial<Session>) => void;

export interface ActionContext {
  settings: ServerSettings;
  controllers: Map<string, AbortController>;
  update: Updater;
  requestWrite: (request: {
    path: string;
    content: string;
    action: DocAction;
    onWritten: () => void;
  }) => void;
}

function latexPatch(data: any): Partial<Session> {
  if (data.status === "ok") {
    return { latexCompileId: data.compileId, latexLog: "", texSource: data.tex ?? "" };
  }
  return {
    latexCompileId: "",
    latexLog: String(data.log ?? data.hint ?? "LaTeX compilation failed."),
    ...(data.tex ? { texSource: data.tex } : {}),
  };
}

/* Replaces any previous request for a session and returns its cancellation signal. */
function startRequest(controllers: Map<string, AbortController>, id: string): AbortController {
  controllers.get(id)?.abort();
  const controller = new AbortController();
  controllers.set(id, controller);
  return controller;
}

function clearLatexOutput(): Pick<Session, "latexCompileId" | "latexLog" | "latexBusy" | "texSource"> {
  return { latexCompileId: "", latexLog: "", latexBusy: false, texSource: "" };
}

/* Builds the streamed actions bound to the current session updater + settings. */
export function createActions({ settings, controllers, update, requestWrite }: ActionContext) {
  const forSession =
    (id: string): Updater =>
    (fn) =>
      update((cur) => (cur.id === id ? fn(cur) : {}));

  /* Starts a fresh answer, clearing any prior response state. */
  const runGenerate = (s: Session) => {
    const apply = forSession(s.id);
    const controller = startRequest(controllers, s.id);
    apply(() => ({
      draft: "",
      answer: "",
      activity: [],
      messages: [],
      notice: undefined,
      error: undefined,
      phase: "draft",
      ...clearLatexOutput(),
    }));

    streamPost(
      `/api/tabs/${s.id}/generate`,
      buildGeneratePayload(s),
      {
        phase: (d) => apply(() => ({ phase: d.phase })),
        text: (d) =>
          apply((cur) => (d.phase === "draft" ? { draft: cur.draft + d.delta } : { answer: cur.answer + d.delta })),
        draft: (d) => apply(() => ({ draft: d.text })),
        activity: (d) => apply((cur) => ({ activity: [...cur.activity, d] })),
        notice: (d) => apply(() => ({ notice: d.message })),
        latex: (d) => apply(() => latexPatch(d)),
        done: (d) => apply((cur) => ({ answer: d.text, phase: "done", ...(cur.latex ? { texSource: d.text } : {}) })),
        error: (d) => apply(() => ({ error: d.message, phase: "error" })),
        session: () => {},
      },
      controller.signal
    )
      .catch((err) => {
        if (controller.signal.aborted) {
          apply((cur) => ({ phase: cur.answer || cur.draft ? "done" : "idle" }));
          return;
        }
        apply(() => ({ error: String(err?.message || err), phase: "error" }));
      })
      .finally(() => controllers.delete(s.id));
  };

  /* Sends a revision while preserving the conversation transcript. */
  const runFollowUp = (s: Session, text: string) => {
    const apply = forSession(s.id);
    const controller = startRequest(controllers, s.id);
    apply((cur) => ({
      messages: [...cur.messages, { role: "user", text }],
      phase: "followup",
      activity: [],
      answer: "",
      error: undefined,
      ...clearLatexOutput(),
    }));

    streamPost(
      `/api/tabs/${s.id}/message`,
      buildMessagePayload(s, text),
      {
        phase: (d) => apply(() => ({ phase: d.phase })),
        text: (d) => apply((cur) => ({ answer: cur.answer + d.delta })),
        activity: (d) => apply((cur) => ({ activity: [...cur.activity, d] })),
        latex: (d) => apply(() => latexPatch(d)),
        done: (d) =>
          apply((cur) => ({
            answer: d.text,
            phase: "done",
            messages: [...cur.messages, { role: "assistant", text: d.text }],
            ...(cur.latex ? { texSource: d.text } : {}),
          })),
        error: (d) => apply(() => ({ error: d.message, phase: "error" })),
        session: () => {},
      },
      controller.signal
    )
      .catch((err) => {
        if (controller.signal.aborted) {
          apply(() => ({ phase: "done" }));
          return;
        }
        apply(() => ({ error: String(err?.message || err), phase: "error" }));
      })
      .finally(() => controllers.delete(s.id));
  };

  /* Runs the current answer through the grammar + humanize cleanup endpoint. */
  const runCleanup = (s: Session) => {
    const sourceText = (s.answer || s.draft).trim();
    if (!sourceText) return;
    const apply = forSession(s.id);
    const controller = startRequest(controllers, s.id);
    apply(() => ({ phase: "cleanup", activity: [], answer: "", error: undefined, notice: undefined, ...clearLatexOutput() }));

    streamPost(
      `/api/tabs/${s.id}/cleanup`,
      buildCleanupPayload(s, sourceText),
      {
        phase: (d) => apply(() => ({ phase: d.phase })),
        text: (d) => apply((cur) => ({ answer: cur.answer + d.delta })),
        activity: (d) => apply((cur) => ({ activity: [...cur.activity, d] })),
        notice: (d) => apply(() => ({ notice: d.message })),
        latex: (d) => apply(() => latexPatch(d)),
        done: (d) => apply((cur) => ({ answer: d.text || sourceText, phase: "done", ...(cur.latex && d.text ? { texSource: d.text } : {}) })),
        error: (d) => apply((cur) => ({ error: d.message, phase: "error", answer: cur.answer || sourceText })),
        session: () => {},
      },
      controller.signal
    )
      .catch((err) => {
        if (controller.signal.aborted) {
          apply((cur) => ({ phase: "done", answer: cur.answer || sourceText }));
          return;
        }
        apply((cur) => ({ error: String(err?.message || err), phase: "error", answer: cur.answer || sourceText }));
      })
      .finally(() => controllers.delete(s.id));
  };

  /* Cancels both the local fetch and the matching server-side generation. */
  const cancel = (id: string) => {
    controllers.get(id)?.abort();
    api.cancel(id);
  };

  // ── Vault Writer ────────────────────────────────────────────────────────────

  /* Shared streaming wrapper for the single-shot writer endpoints. */
  const runWriterStream = (
    s: Session,
    endpoint: string,
    body: unknown,
    initial: Partial<Session>,
    buildHandlers: (apply: Updater) => Record<string, (data: any) => void>
  ) => {
    const apply = forSession(s.id);
    const controller = startRequest(controllers, s.id);
    apply(() => initial);
    const handlers = buildHandlers(apply);
    streamPost(
      `/api/tabs/${s.id}/${endpoint}`,
      body,
      {
        phase: (d) => apply(() => ({ phase: d.phase })),
        activity: (d) => apply((cur) => ({ activity: [...cur.activity, d] })),
        error: (d) => apply(() => ({ phase: "error", error: d.message })),
        ...handlers,
      },
      controller.signal
    )
      .catch((e) => {
        if (controller.signal.aborted) apply(() => ({ phase: "idle" }));
        else apply(() => ({ phase: "error", error: String(e?.message || e) }));
      })
      .finally(() => controllers.delete(s.id));
  };

  /* Fetches URL content when needed, then streams a vault-ready summary. */
  const runSummarize = async (s: Session) => {
    const apply = forSession(s.id);
    const controller = startRequest(controllers, s.id);
    apply(() => ({ phase: "draft", error: undefined, writePreview: "", writeConfirmed: false, activity: [] }));

    const input = s.writeInput.trim();
    const isUrl = /^https?:\/\//i.test(input);
    let finalInput = input;
    if (isUrl) {
      try {
        const res = await api.fetchUrl(input, settings.urlFetchMethod);
        if (res.error) throw new Error(res.error);
        finalInput = res.text;
      } catch (err: any) {
        apply(() => ({ phase: "error", error: err.message }));
        controllers.delete(s.id);
        return;
      }
    }
    if (controller.signal.aborted) {
      controllers.delete(s.id);
      return;
    }

    streamPost(
      `/api/tabs/${s.id}/summarize`,
      buildSummarizePayload(s, finalInput, isUrl),
      {
        phase: (d) => apply(() => ({ phase: d.phase })),
        text: (d) => apply((cur) => ({ writePreview: (cur.writePreview || "") + d.delta })),
        activity: (d) => apply((cur) => ({ activity: [...cur.activity, d] })),
        done: (d) => apply(() => ({ phase: "done", writePreview: d.text })),
        error: (d) => apply(() => ({ phase: "error", error: d.message })),
      },
      controller.signal
    )
      .catch((e) => {
        if (!controller.signal.aborted) apply(() => ({ phase: "error", error: String(e?.message || e) }));
        else apply(() => ({ phase: "idle" }));
      })
      .finally(() => controllers.delete(s.id));
  };

  /* Asks the writer workflow to choose a destination path for the content. */
  const runAutoPlace = (s: Session) => {
    runWriterStream(
      s,
      "auto-place",
      buildAutoPlacePayload(s.writeInput),
      { phase: "draft", error: undefined, writeConfirmed: false },
      (apply) => ({ done: (d) => apply(() => ({ phase: "done", writePath: (d.text || "").trim() })) })
    );
  };

  /* Scans the selected vault area and converts the JSON response into UI records. */
  const runFillinScan = (s: Session) => {
    runWriterStream(
      s,
      "fillin-scan",
      buildFillinScanPayload(s),
      { phase: "draft", error: undefined, writeConfirmed: false },
      (apply) => ({
        done: (d) => {
          try {
            apply(() => ({
              phase: "done",
              fillinQuestions: parseFillinQuestions(String(d.text)),
            }));
          } catch (err: any) {
            apply(() => ({ phase: "error", error: "Failed to parse questions: " + err.message }));
          }
        },
      })
    );
  };

  /* Streams a proposed answer into a single fill-in question. */
  const runFillinWrite = (s: Session, questionId: string) => {
    const q = s.fillinQuestions.find((x) => x.id === questionId);
    if (!q) return;
    runWriterStream(
      s,
      "fillin-write",
      buildFillinWritePayload(q, s),
      {
        phase: "draft",
        error: undefined,
        writeConfirmed: false,
        fillinQuestions: s.fillinQuestions.map((xq) => (xq.id === questionId ? { ...xq, preview: "" } : xq)),
      },
      (apply) => ({
        text: (d) =>
          apply((cur) => ({
            fillinQuestions: cur.fillinQuestions.map((xq) =>
              xq.id === questionId ? { ...xq, preview: (xq.preview || "") + d.delta } : xq
            ),
          })),
        done: (d) =>
          apply((cur) => ({
            phase: "done",
            fillinQuestions: cur.fillinQuestions.map((xq) => (xq.id === questionId ? { ...xq, preview: d.text } : xq)),
          })),
      })
    );
  };

  /* Writes an approved fill-in preview to disk and marks that question complete. */
  const confirmFillinWrite = (s: Session, questionId: string) => {
    const q = s.fillinQuestions.find((x) => x.id === questionId);
    if (!q || !q.targetPath || !q.preview) return;
    requestWrite({
      path: q.targetPath,
      content: q.preview,
      action: "create",
      onWritten: () =>
        update((cur) => ({
          writeConfirmed: true,
          error: undefined,
          fillinQuestions: cur.fillinQuestions.map((xq) => (xq.id === questionId ? { ...xq, written: true } : xq)),
        })),
    });
  };

  /* Sends a writer draft through the formatting + clarity cleanup pass. */
  const runWriteCleanup = (s: Session) => {
    runWriterStream(
      s,
      "write-cleanup",
      buildWriteCleanupPayload(s),
      { phase: "cleanup", error: undefined, writePreview: "", writeConfirmed: false },
      (apply) => ({
        text: (d) => apply((cur) => ({ writePreview: (cur.writePreview || "") + d.delta })),
        done: (d) => apply(() => ({ phase: "done", writePreview: d.text })),
      })
    );
  };

  /* Persists the approved preview, or the raw input when no preview is present. */
  const confirmWrite = (s: Session) => {
    if (!s.writePath) return;
    const content = s.writePreview || s.writeInput;
    if (!content) return;
    requestWrite({
      path: s.writePath,
      content,
      action: "create",
      onWritten: () => update(() => ({ writeConfirmed: true, error: undefined })),
    });
  };

  /* Analyzes an uploaded document and converts proposals into terminal records. */
  const runDocPropose = (s: Session) => {
    if (!s.docAttachment || s.docAttachment.expired) return;
    runWriterStream(
      s,
      "doc-propose",
      buildDocProposePayload(s),
      { phase: "draft", error: undefined, writeConfirmed: false, docProposals: [] },
      (apply) => ({
        done: (d) => {
          try {
            apply(() => ({ phase: "done", docProposals: parseDocProposals(String(d.text)) }));
          } catch (err: any) {
            apply(() => ({ phase: "error", error: "Failed to parse proposals: " + err.message }));
          }
        },
      })
    );
  };

  /* Routes one document proposal through the preview + approval flow. */
  const confirmDocWrite = (s: Session, proposalId: string) => {
    const p = s.docProposals.find((x) => x.id === proposalId);
    if (!p || p.status !== "pending" || !p.targetPath || !p.content) return;
    requestWrite({
      path: p.targetPath,
      content: p.content,
      action: p.action,
      onWritten: () =>
        update((cur) => ({
          writeConfirmed: true,
          error: undefined,
          docProposals: cur.docProposals.map((xp) => (xp.id === proposalId ? { ...xp, status: "written" } : xp)),
        })),
    });
  };

  const dismissDocProposal = (_s: Session, proposalId: string) => {
    update((cur) => ({
      docProposals: cur.docProposals.map((xp) => (xp.id === proposalId ? { ...xp, status: "rejected" } : xp)),
    }));
  };

  const attachDraftDocument = async (_s: Session, path: string) => {
    const trimmed = path.trim();
    if (!trimmed) return;
    try {
      const res = await api.uploadAttachmentPath(trimmed);
      if (!res.ok || !res.id) throw new Error(res.error || "Upload failed.");
      update((cur) => ({
        attachments: [
          ...cur.attachments,
          { id: res.id!, name: res.name!, size: res.size!, chars: res.chars!, truncated: Boolean(res.truncated) },
        ],
        error: undefined,
        notice: `Attached ${res.name}`,
      }));
    } catch (err: any) {
      update(() => ({ error: String(err?.message || err) }));
    }
  };

  const removeAttachment = (_s: Session, id: string) => {
    update((cur) => ({ attachments: cur.attachments.filter((a) => a.id !== id) }));
    api.deleteAttachment(id).catch(() => {});
  };

  const attachDocDocument = async (_s: Session, path: string) => {
    const trimmed = path.trim();
    if (!trimmed) return;
    try {
      const res = await api.uploadAttachmentPath(trimmed);
      if (!res.ok || !res.id) throw new Error(res.error || "Upload failed.");
      update(() => ({
        docAttachment: { id: res.id!, name: res.name!, size: res.size!, chars: res.chars!, truncated: Boolean(res.truncated) },
        docProposals: [],
        docUploadPath: trimmed,
        error: undefined,
        notice: `Loaded ${res.name}`,
      }));
    } catch (err: any) {
      update(() => ({ error: String(err?.message || err) }));
    }
  };

  const runLatexRecompile = async (_s: Session, tex: string) => {
    update(() => ({ latexBusy: true, texSource: tex, latexLog: "" }));
    try {
      const res = await api.latexCompile(tex);
      if (res.ok && res.compileId) {
        update(() => ({ latexCompileId: res.compileId, latexLog: "", latexBusy: false }));
      } else {
        update(() => ({
          latexCompileId: "",
          latexLog: res.log || res.hint || res.error || "Compilation failed.",
          latexBusy: false,
        }));
      }
    } catch (err: any) {
      update(() => ({ latexLog: String(err?.message || err), latexBusy: false }));
    }
  };

  return {
    runGenerate,
    runFollowUp,
    runCleanup,
    cancel,
    runSummarize,
    runAutoPlace,
    runFillinScan,
    runFillinWrite,
    confirmFillinWrite,
    runWriteCleanup,
    confirmWrite,
    runDocPropose,
    confirmDocWrite,
    dismissDocProposal,
    attachDraftDocument,
    removeAttachment,
    attachDocDocument,
    runLatexRecompile,
  };
}

export type Actions = ReturnType<typeof createActions>;
export type { FillinQuestion };

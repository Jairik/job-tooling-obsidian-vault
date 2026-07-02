// Streamed conversation + vault-writer actions for the TUI. Ported from
// src/lib/conversation-actions.ts and the vault-writer handlers in src/App.tsx,
// with `updateTab` replaced by a single `setSession` updater. Request payloads are
// kept identical so the server sees the same bodies the web client sends. Settings
// are omitted (no per-tab override) so the server uses the global config the TUI
// edits via /api/config.
import { api, streamPost, type ServerSettings } from "./api";
import { uid, type Session, type FillinQuestion } from "./session";

type Updater = (fn: (s: Session) => Partial<Session>) => void;

export interface ActionContext {
  settings: ServerSettings;
  controllers: Map<string, AbortController>;
  update: Updater;
}

/* Replaces any previous request for a session and returns its cancellation signal. */
function startRequest(controllers: Map<string, AbortController>, id: string): AbortController {
  controllers.get(id)?.abort();
  const controller = new AbortController();
  controllers.set(id, controller);
  return controller;
}

/* Builds the streamed actions bound to the current session updater + settings. */
export function createActions({ settings, controllers, update }: ActionContext) {
  /* Starts a fresh answer, clearing any prior response state. */
  const runGenerate = (s: Session) => {
    const controller = startRequest(controllers, s.id);
    update(() => ({ draft: "", answer: "", activity: [], messages: [], notice: undefined, error: undefined, phase: "draft" }));

    streamPost(
      `/api/tabs/${s.id}/generate`,
      { jobDescription: s.jobDescription, question: s.question, skills: s.skills, rag: s.rag, mode: s.mode },
      {
        phase: (d) => update(() => ({ phase: d.phase })),
        text: (d) =>
          update((cur) => (d.phase === "draft" ? { draft: cur.draft + d.delta } : { answer: cur.answer + d.delta })),
        draft: (d) => update(() => ({ draft: d.text })),
        activity: (d) => update((cur) => ({ activity: [...cur.activity, d] })),
        notice: (d) => update(() => ({ notice: d.message })),
        done: (d) => update(() => ({ answer: d.text, phase: "done" })),
        error: (d) => update(() => ({ error: d.message, phase: "error" })),
        session: () => {},
      },
      controller.signal
    )
      .catch((err) => {
        if (controller.signal.aborted) {
          update((cur) => ({ phase: cur.answer || cur.draft ? "done" : "idle" }));
          return;
        }
        update(() => ({ error: String(err?.message || err), phase: "error" }));
      })
      .finally(() => controllers.delete(s.id));
  };

  /* Sends a revision while preserving the conversation transcript. */
  const runFollowUp = (s: Session, text: string) => {
    const controller = startRequest(controllers, s.id);
    update((cur) => ({
      messages: [...cur.messages, { role: "user", text }],
      phase: "followup",
      activity: [],
      answer: "",
      error: undefined,
    }));

    streamPost(
      `/api/tabs/${s.id}/message`,
      { text, skills: s.skills, rag: s.rag, mode: s.mode },
      {
        phase: (d) => update(() => ({ phase: d.phase })),
        text: (d) => update((cur) => ({ answer: cur.answer + d.delta })),
        activity: (d) => update((cur) => ({ activity: [...cur.activity, d] })),
        done: (d) =>
          update((cur) => ({
            answer: d.text,
            phase: "done",
            messages: [...cur.messages, { role: "assistant", text: d.text }],
          })),
        error: (d) => update(() => ({ error: d.message, phase: "error" })),
        session: () => {},
      },
      controller.signal
    )
      .catch((err) => {
        if (controller.signal.aborted) {
          update(() => ({ phase: "done" }));
          return;
        }
        update(() => ({ error: String(err?.message || err), phase: "error" }));
      })
      .finally(() => controllers.delete(s.id));
  };

  /* Runs the current answer through the grammar + humanize cleanup endpoint. */
  const runCleanup = (s: Session) => {
    const sourceText = (s.answer || s.draft).trim();
    if (!sourceText) return;
    const controller = startRequest(controllers, s.id);
    update(() => ({ phase: "cleanup", activity: [], answer: "", error: undefined, notice: undefined }));

    streamPost(
      `/api/tabs/${s.id}/cleanup`,
      { text: sourceText, skills: s.skills },
      {
        phase: (d) => update(() => ({ phase: d.phase })),
        text: (d) => update((cur) => ({ answer: cur.answer + d.delta })),
        activity: (d) => update((cur) => ({ activity: [...cur.activity, d] })),
        notice: (d) => update(() => ({ notice: d.message })),
        done: (d) => update(() => ({ answer: d.text || sourceText, phase: "done" })),
        error: (d) => update((cur) => ({ error: d.message, phase: "error", answer: cur.answer || sourceText })),
        session: () => {},
      },
      controller.signal
    )
      .catch((err) => {
        if (controller.signal.aborted) {
          update((cur) => ({ phase: "done", answer: cur.answer || sourceText }));
          return;
        }
        update((cur) => ({ error: String(err?.message || err), phase: "error", answer: cur.answer || sourceText }));
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
    handlers: Record<string, (data: any) => void>
  ) => {
    const controller = startRequest(controllers, s.id);
    update(() => initial);
    streamPost(
      `/api/tabs/${s.id}/${endpoint}`,
      body,
      {
        phase: (d) => update(() => ({ phase: d.phase })),
        activity: (d) => update((cur) => ({ activity: [...cur.activity, d] })),
        error: (d) => update(() => ({ phase: "error", error: d.message })),
        ...handlers,
      },
      controller.signal
    )
      .catch((e) => {
        if (controller.signal.aborted) update(() => ({ phase: "idle" }));
        else update(() => ({ phase: "error", error: String(e?.message || e) }));
      })
      .finally(() => controllers.delete(s.id));
  };

  /* Fetches URL content when needed, then streams a vault-ready summary. */
  const runSummarize = async (s: Session) => {
    const controller = startRequest(controllers, s.id);
    update(() => ({ phase: "draft", error: undefined, writePreview: "", writeConfirmed: false, activity: [] }));

    const input = s.writeInput.trim();
    const isUrl = /^https?:\/\//i.test(input);
    let finalInput = input;
    if (isUrl) {
      try {
        const res = await api.fetchUrl(input, settings.urlFetchMethod);
        if (res.error) throw new Error(res.error);
        finalInput = res.text;
      } catch (err: any) {
        update(() => ({ phase: "error", error: err.message }));
        controllers.delete(s.id);
        return;
      }
    }

    streamPost(
      `/api/tabs/${s.id}/summarize`,
      { input: finalInput, isUrl, skills: s.skills },
      {
        phase: (d) => update(() => ({ phase: d.phase })),
        text: (d) => update((cur) => ({ writePreview: (cur.writePreview || "") + d.delta })),
        activity: (d) => update((cur) => ({ activity: [...cur.activity, d] })),
        done: (d) => update(() => ({ phase: "done", writePreview: d.text })),
        error: (d) => update(() => ({ phase: "error", error: d.message })),
      },
      controller.signal
    )
      .catch((e) => {
        if (!controller.signal.aborted) update(() => ({ phase: "error", error: String(e?.message || e) }));
        else update(() => ({ phase: "idle" }));
      })
      .finally(() => controllers.delete(s.id));
  };

  /* Asks the writer workflow to choose a destination path for the content. */
  const runAutoPlace = (s: Session) => {
    runWriterStream(
      s,
      "auto-place",
      { content: s.writeInput },
      { phase: "draft", error: undefined, writeConfirmed: false },
      { done: (d) => update(() => ({ phase: "done", writePath: (d.text || "").trim() })) }
    );
  };

  /* Scans the selected vault area and converts the JSON response into UI records. */
  const runFillinScan = (s: Session) => {
    runWriterStream(
      s,
      "fillin-scan",
      { prompt: s.writeInput, dir: s.fillinDir },
      { phase: "draft", error: undefined, writeConfirmed: false },
      {
        done: (d) => {
          try {
            const raw = String(d.text).trim();
            const first = raw.indexOf("[");
            const last = raw.lastIndexOf("]");
            if (first === -1 || last === -1) throw new Error("Invalid JSON returned");
            const qs = JSON.parse(raw.substring(first, last + 1));
            update(() => ({
              phase: "done",
              fillinQuestions: qs.map((q: any) => ({ ...q, id: uid(), answer: "", written: false })),
            }));
          } catch (err: any) {
            update(() => ({ phase: "error", error: "Failed to parse questions: " + err.message }));
          }
        },
      }
    );
  };

  /* Streams a proposed answer into a single fill-in question. */
  const runFillinWrite = (s: Session, questionId: string) => {
    const q = s.fillinQuestions.find((x) => x.id === questionId);
    if (!q) return;
    runWriterStream(
      s,
      "fillin-write",
      { question: q.question, answer: q.answer, targetPath: q.targetPath, skills: s.skills },
      {
        phase: "draft",
        error: undefined,
        writeConfirmed: false,
        fillinQuestions: s.fillinQuestions.map((xq) => (xq.id === questionId ? { ...xq, preview: "" } : xq)),
      },
      {
        text: (d) =>
          update((cur) => ({
            fillinQuestions: cur.fillinQuestions.map((xq) =>
              xq.id === questionId ? { ...xq, preview: (xq.preview || "") + d.delta } : xq
            ),
          })),
        done: (d) =>
          update((cur) => ({
            phase: "done",
            fillinQuestions: cur.fillinQuestions.map((xq) => (xq.id === questionId ? { ...xq, preview: d.text } : xq)),
          })),
      }
    );
  };

  /* Writes an approved fill-in preview to disk and marks that question complete. */
  const confirmFillinWrite = async (s: Session, questionId: string) => {
    const q = s.fillinQuestions.find((x) => x.id === questionId);
    if (!q || !q.targetPath || !q.preview) return;
    try {
      const res = await api.vaultWrite(q.targetPath, q.preview);
      if (!res.ok) throw new Error(res.error || "Write failed");
      update((cur) => ({
        writeConfirmed: true,
        fillinQuestions: cur.fillinQuestions.map((xq) => (xq.id === questionId ? { ...xq, written: true } : xq)),
      }));
    } catch (err: any) {
      update(() => ({ error: err.message }));
    }
  };

  /* Sends a writer draft through the formatting + clarity cleanup pass. */
  const runWriteCleanup = (s: Session) => {
    runWriterStream(
      s,
      "write-cleanup",
      { text: s.writeInput, skills: s.skills },
      { phase: "cleanup", error: undefined, writePreview: "", writeConfirmed: false },
      {
        text: (d) => update((cur) => ({ writePreview: (cur.writePreview || "") + d.delta })),
        done: (d) => update(() => ({ phase: "done", writePreview: d.text })),
      }
    );
  };

  /* Persists the approved preview, or the raw input when no preview is present. */
  const confirmWrite = async (s: Session) => {
    if (!s.writePath) return;
    const content = s.writePreview || s.writeInput;
    if (!content) return;
    try {
      const res = await api.vaultWrite(s.writePath, content);
      if (!res.ok) throw new Error(res.error || "Write failed");
      update(() => ({ writeConfirmed: true, error: undefined }));
    } catch (err: any) {
      update(() => ({ error: err.message }));
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
  };
}

export type Actions = ReturnType<typeof createActions>;
export type { FillinQuestion };

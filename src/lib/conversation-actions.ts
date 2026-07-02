/* Client-side orchestration for streamed generate, follow-up, cleanup, and cancel actions. */
import { api, streamPost } from "./api";
import { deriveTitleLocal, overrideSettingsBody, type LogEntry, type Settings, type Tab } from "./store";
import { effectiveCleanupModel, effectiveEngineModel } from "../../shared/settings";

type UpdateTab = (id: string, patch: Partial<Tab> | ((tab: Tab) => Partial<Tab>)) => void;
type AddLog = (entry: Omit<LogEntry, "id" | "ts">) => void;

interface ConversationActionContext {
  settings: Settings | null;
  controllers: Map<string, AbortController>;
  updateTab: UpdateTab;
  addLog: AddLog;
}

// Fold a server `latex` SSE event (compile outcome) into tab state. A missing /
// failed compile clears the pdf pointer and surfaces the log or install hint.
/* Converts a latex compile event into the matching tab patch. */
function latexEventPatch(data: any): Partial<Tab> {
  if (data.status === "ok") {
    return { latexCompileId: data.compileId, latexLog: "", texSource: data.tex ?? "" };
  }
  return {
    latexCompileId: "",
    latexLog: String(data.log ?? data.hint ?? "LaTeX compilation failed."),
    ...(data.tex ? { texSource: data.tex } : {}),
  };
}

/* Replaces any previous request for a tab and returns its new cancellation signal. */
function startRequest(controllers: Map<string, AbortController>, tabId: string): AbortController {
  controllers.get(tabId)?.abort();
  const controller = new AbortController();
  controllers.set(tabId, controller);
  return controller;
}

/* Creates tab-bound handlers that synchronize streamed server events with UI state and logs. */
export function createConversationActions({ settings, controllers, updateTab, addLog }: ConversationActionContext) {
  /* Starts a fresh answer and clears response state left by an earlier run. */
  const runGenerate = (tab: Tab) => {
    if (!settings) return;
    const controller = startRequest(controllers, tab.id);
    updateTab(tab.id, {
      draft: "",
      answer: "",
      activity: [],
      messages: [],
      notice: undefined,
      error: undefined,
      phase: "draft",
      texSource: "",
      latexCompileId: "",
      latexLog: "",
    });

    if (tab.autoNamed) {
      const title = deriveTitleLocal(tab.jobDescription, tab.question);
      if (title) updateTab(tab.id, (current) => (current.autoNamed ? { name: title } : {}));
    }

    const overrideBody = overrideSettingsBody(tab, settings);
    const effectiveSettings = tab.overrideEnabled ? tab.override ?? settings : settings;
    const model = effectiveEngineModel(effectiveSettings);
    const meta = { tabId: tab.id, tabName: tab.name, tabColor: tab.color };
    const startedAt = Date.now();
    addLog({ ...meta, kind: "generate", engine: effectiveSettings.engine, model, question: tab.question });

    streamPost(
      `/api/tabs/${tab.id}/generate`,
      {
        jobDescription: tab.jobDescription,
        question: tab.question,
        skills: tab.skills,
        rag: tab.rag,
        mode: tab.mode,
        extraContext: tab.extraContext,
        attachmentIds: tab.attachments.filter((a) => !a.expired).map((a) => a.id),
        latex: tab.latex,
        settings: overrideBody,
      },
      {
        phase: (data) => updateTab(tab.id, { phase: data.phase }),
        text: (data) =>
          updateTab(tab.id, (current) =>
            data.phase === "draft" ? { draft: current.draft + data.delta } : { answer: current.answer + data.delta }
          ),
        draft: (data) => updateTab(tab.id, { draft: data.text }),
        activity: (data) => {
          updateTab(tab.id, (current) => ({ activity: [...current.activity, data] }));
          addLog({ ...meta, kind: "tool", detail: `${data.tool} · ${data.input}` });
        },
        notice: (data) => updateTab(tab.id, { notice: data.message }),
        latex: (data) => updateTab(tab.id, latexEventPatch(data)),
        done: (data) => {
          updateTab(tab.id, (current) => ({ answer: data.text, phase: "done", ...(current.latex ? { texSource: data.text } : {}) }));
          addLog({
            ...meta,
            kind: "answer",
            engine: effectiveSettings.engine,
            model,
            question: tab.question,
            durationMs: Date.now() - startedAt,
            chars: data.text.length,
            detail: data.text.slice(0, 280),
          });
        },
        error: (data) => {
          updateTab(tab.id, { error: data.message, phase: "error" });
          addLog({ ...meta, kind: "error", detail: data.message });
        },
        session: () => {},
      },
      controller.signal
    )
      .catch((error) => {
        if (controller.signal.aborted) {
          updateTab(tab.id, (current) => ({ phase: current.answer || current.draft ? "done" : "idle" }));
          return;
        }
        const message = String(error?.message || error);
        updateTab(tab.id, { error: message, phase: "error" });
        addLog({ ...meta, kind: "error", detail: message });
      })
      .finally(() => controllers.delete(tab.id));
  };

  /* Sends a requested revision while preserving the conversation transcript. */
  const runFollowUp = (tab: Tab, text: string) => {
    if (!settings) return;
    const controller = startRequest(controllers, tab.id);
    updateTab(tab.id, (current) => ({
      messages: [...current.messages, { role: "user", text }],
      phase: "followup",
      activity: [],
      answer: "",
      error: undefined,
    }));

    const overrideBody = overrideSettingsBody(tab, settings);
    const effectiveSettings = tab.overrideEnabled ? tab.override ?? settings : settings;
    const model = effectiveEngineModel(effectiveSettings);
    const meta = { tabId: tab.id, tabName: tab.name, tabColor: tab.color };
    const startedAt = Date.now();
    addLog({ ...meta, kind: "followup", engine: effectiveSettings.engine, model, question: text });

    streamPost(
      `/api/tabs/${tab.id}/message`,
      { text, skills: tab.skills, rag: tab.rag, mode: tab.mode, latex: tab.latex, settings: overrideBody },
      {
        phase: (data) => updateTab(tab.id, { phase: data.phase }),
        text: (data) => updateTab(tab.id, (current) => ({ answer: current.answer + data.delta })),
        activity: (data) => {
          updateTab(tab.id, (current) => ({ activity: [...current.activity, data] }));
          addLog({ ...meta, kind: "tool", detail: `${data.tool} · ${data.input}` });
        },
        notice: (data) => updateTab(tab.id, { notice: data.message }),
        latex: (data) => updateTab(tab.id, latexEventPatch(data)),
        done: (data) => {
          updateTab(tab.id, (current) => ({
            answer: data.text,
            phase: "done",
            messages: [...current.messages, { role: "assistant", text: data.text }],
            ...(current.latex ? { texSource: data.text } : {}),
          }));
          addLog({
            ...meta,
            kind: "answer",
            engine: effectiveSettings.engine,
            model,
            question: text,
            durationMs: Date.now() - startedAt,
            chars: data.text.length,
            detail: data.text.slice(0, 280),
          });
        },
        error: (data) => {
          updateTab(tab.id, { error: data.message, phase: "error" });
          addLog({ ...meta, kind: "error", detail: data.message });
        },
        session: () => {},
      },
      controller.signal
    )
      .catch((error) => {
        if (controller.signal.aborted) {
          updateTab(tab.id, { phase: "done" });
          return;
        }
        const message = String(error?.message || error);
        updateTab(tab.id, { error: message, phase: "error" });
        addLog({ ...meta, kind: "error", detail: message });
      })
      .finally(() => controllers.delete(tab.id));
  };

  /* Sends the current draft or answer through the dedicated cleanup endpoint. */
  const runCleanup = (tab: Tab) => {
    if (!settings) return;
    const sourceText = (tab.answer || tab.draft).trim();
    if (!sourceText) return;
    const controller = startRequest(controllers, tab.id);
    updateTab(tab.id, { phase: "cleanup", activity: [], answer: "", error: undefined, notice: undefined });

    const overrideBody = overrideSettingsBody(tab, settings);
    const effectiveSettings = tab.overrideEnabled ? tab.override ?? settings : settings;
    const model = effectiveCleanupModel(effectiveSettings);
    const meta = { tabId: tab.id, tabName: tab.name, tabColor: tab.color };
    const startedAt = Date.now();
    addLog({ ...meta, kind: "cleanup", engine: effectiveSettings.engine, model });

    streamPost(
      `/api/tabs/${tab.id}/cleanup`,
      { text: sourceText, skills: tab.skills, latex: tab.latex, settings: overrideBody },
      {
        phase: (data) => updateTab(tab.id, { phase: data.phase }),
        text: (data) => updateTab(tab.id, (current) => ({ answer: current.answer + data.delta })),
        activity: (data) => {
          updateTab(tab.id, (current) => ({ activity: [...current.activity, data] }));
          addLog({ ...meta, kind: "tool", detail: `${data.tool} · ${data.input}` });
        },
        notice: (data) => updateTab(tab.id, { notice: data.message }),
        latex: (data) => updateTab(tab.id, latexEventPatch(data)),
        done: (data) => {
          updateTab(tab.id, (current) => ({ answer: data.text || sourceText, phase: "done", ...(current.latex && data.text ? { texSource: data.text } : {}) }));
          addLog({
            ...meta,
            kind: "answer",
            engine: effectiveSettings.engine,
            model,
            durationMs: Date.now() - startedAt,
            chars: (data.text || "").length,
            detail: (data.text || "").slice(0, 280),
          });
        },
        error: (data) => {
          updateTab(tab.id, (current) => ({ error: data.message, phase: "error", answer: current.answer || sourceText }));
          addLog({ ...meta, kind: "error", detail: data.message });
        },
        session: () => {},
      },
      controller.signal
    )
      .catch((error) => {
        if (controller.signal.aborted) {
          updateTab(tab.id, (current) => ({ phase: "done", answer: current.answer || sourceText }));
          return;
        }
        const message = String(error?.message || error);
        updateTab(tab.id, (current) => ({ error: message, phase: "error", answer: current.answer || sourceText }));
        addLog({ ...meta, kind: "error", detail: message });
      })
      .finally(() => controllers.delete(tab.id));
  };

  /* Cancels both the browser fetch and the matching server-side generation. */
  const cancel = (tabId: string) => {
    controllers.get(tabId)?.abort();
    api.cancel(tabId).catch(() => {});
  };

  return { runGenerate, runFollowUp, runCleanup, cancel };
}

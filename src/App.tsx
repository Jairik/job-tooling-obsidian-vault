// Root component. Owns the global state — the open tabs, the merged settings,
// design/theme prefs, the activity log, split-view layout — and persists it to
// localStorage (and the server for settings). It also drives every backend call:
// each run* handler opens an SSE stream to the per-tab API and folds the streamed
// phase / text / activity / done / error events back into that tab's state.
import { useEffect, useRef, useState } from "react";
import {
  loadTabs,
  saveTabs,
  loadSettings,
  saveSettings,
  loadDesignSettings,
  saveDesignSettings,
  newTab,
  cloneTabForNewQuestion,
  overrideSettingsBody,
  deriveTitleLocal,
  loadLogs,
  saveLogs,
  clearLogs,
  mergeLogs,
  uid,
  LOG_CAP,
  DEFAULT_DESIGN,
  type Settings,
  type Tab,
  type TabMode,
  type LogEntry,
  type DesignSettings,
  type SkillInfo,
} from "./lib/store";
import { api, streamPost, type ModelOption } from "./lib/api";
import { TabBar } from "./components/TabBar";
import { TabView } from "./components/TabView";
import { SettingsPanel } from "./components/SettingsPanel";
import { QuickNotes } from "./components/QuickNotes";
import { LogsModal } from "./components/LogsModal";
import { FunBackground } from "./components/FunBackground";

function readLS(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLS(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function App() {
  const [tabs, setTabs] = useState<Tab[]>(() => loadTabs());
  const [activeId, setActiveId] = useState<string>(() => {
    const t = loadTabs();
    return t[0]?.id ?? "";
  });
  const [settings, setSettings] = useState<Settings | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [engines, setEngines] = useState<ModelOption[]>([]);
  const [skills, setSkills] = useState({ humanizer: false, gemini: false, opencode: false, cursor: false, copilot: false });
  const [availableSkills, setAvailableSkills] = useState<SkillInfo[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [toolbarDropOpen, setToolbarDropOpen] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>(() => loadLogs());
  const [theme, setTheme] = useState<"dark" | "light">(
    () => (document.documentElement.dataset.theme as "dark" | "light") || "dark"
  );
  const [density, setDensity] = useState<"comfortable" | "compact">(
    () => (document.documentElement.dataset.density as "comfortable" | "compact") || "comfortable"
  );
  const [design, setDesign] = useState<DesignSettings>(() => loadDesignSettings());
  const [split, setSplit] = useState<boolean>(() => readLS("jt.split") === "on");
  const [rightId, setRightId] = useState<string>("");
  // Mode new tabs open in. Defaults to Ask; persisted like the other UI prefs.
  const [defaultMode, setDefaultMode] = useState<TabMode>(() =>
    readLS("jt.defaultmode") === "job" ? "job" : "ask"
  );

  const controllers = useRef(new Map<string, AbortController>());

  // Reflect theme + density on <html> and persist them.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("jt.theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.density = density;
    try {
      localStorage.setItem("jt.density", density);
    } catch {
      /* ignore */
    }
  }, [density]);

  // Design settings: persist and apply to <html> dataset.
  useEffect(() => {
    saveDesignSettings(design);

    const el = document.documentElement;

    // Fun mode
    if (design.funEnabled) el.dataset.fun = "on";
    else delete el.dataset.fun;

    // Font family
    if (design.fontFamily !== "system") {
      el.dataset.fontFamily = design.fontFamily;
    } else {
      delete el.dataset.fontFamily;
    }

    // Font scale via CSS custom property
    el.style.setProperty("--font-scale", String(design.fontScale));

    // Accent color
    el.dataset.accentHue = String(design.accentHue);
    el.dataset.accentChroma = String(design.accentChroma);

    // Border radius
    el.dataset.radius = design.borderRadius;

    // Spacing
    el.dataset.spacing = design.spacingScale;

    // Shadows
    el.dataset.shadow = design.shadowIntensity;
  }, [design]);

  // Split view persistence.
  useEffect(() => {
    writeLS("jt.split", split ? "on" : "off");
  }, [split]);

  // Default mode for new tabs.
  useEffect(() => {
    writeLS("jt.defaultmode", defaultMode);
  }, [defaultMode]);

  // Initial load: server config (authoritative) merged with anything saved locally.
  useEffect(() => {
    (async () => {
      const [meta, config] = await Promise.all([api.meta(), api.getConfig()]);
      setModels(meta.models);
      setEngines(meta.engines);
      const local = loadSettings();
      const merged: Settings = { ...config, ...(local ?? {}) };
      setSettings(merged);
    })();
  }, []);

  // Persist tabs on change.
  useEffect(() => {
    saveTabs(tabs);
  }, [tabs]);

  // Persist the activity log to localStorage on change (instant, offline cache).
  useEffect(() => {
    saveLogs(logs);
  }, [logs]);

  // Hydrate from the durable server-side log file once on mount, merging it with
  // whatever the localStorage cache already holds.
  useEffect(() => {
    api
      .getLogs()
      .then((serverLogs) => {
        if (Array.isArray(serverLogs) && serverLogs.length) {
          setLogs((prev) => mergeLogs(prev, serverLogs));
        }
      })
      .catch(() => {});
  }, []);

  // Append a log entry: update local state (capped) and persist it to the local
  // log file on disk (best-effort — a failed write never blocks the UI).
  const addLog = (entry: Omit<LogEntry, "id" | "ts">) => {
    const full: LogEntry = { ...entry, id: uid(), ts: Date.now() };
    setLogs((prev) => [...prev, full].slice(-LOG_CAP));
    api.appendLog(full).catch(() => {});
  };

  // Refresh skill availability + the installed-skill list whenever the vault changes.
  useEffect(() => {
    if (!settings?.vaultDir) return;
    api.skills(settings.vaultDir).then(setSkills).catch(() => {});
    api.listSkills(settings.vaultDir).then(setAvailableSkills).catch(() => {});
  }, [settings?.vaultDir]);

  // Re-fetch skill status + list (e.g. after creating a new skill).
  const refreshSkills = () => {
    const vault = settings?.vaultDir;
    if (!vault) return;
    api.skills(vault).then(setSkills).catch(() => {});
    api.listSkills(vault).then(setAvailableSkills).catch(() => {});
  };

  // Create a skill from the Settings form, then refresh the list on success.
  const createSkill = async (payload: { name: string; description: string; body: string; scope: "user" | "vault" }) => {
    const res = await api.createSkill(payload);
    if (res.ok) refreshSkills();
    return res;
  };

  const updateTab = (id: string, patch: Partial<Tab> | ((t: Tab) => Partial<Tab>)) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...(typeof patch === "function" ? patch(t) : patch) } : t))
    );
  };

  const changeSettings = (patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...(prev as Settings), ...patch };
      saveSettings(next);
      api.saveConfig(patch).catch(() => {});
      return next;
    });
  };

  const changeDesign = (patch: Partial<DesignSettings>) => {
    setDesign((prev) => ({ ...prev, ...patch }));
  };

  const addTab = () => {
    const t = newTab(tabs, settings?.rag ?? false, defaultMode);
    setTabs((prev) => [...prev, t]);
    setActiveId(t.id);
  };

  // Ask another question about the same job: a fresh conversation that reuses the
  // source tab's job description + RAG/YC/override context, with a blank question.
  const addQuestionTab = (source: Tab) => {
    const t = cloneTabForNewQuestion(source, tabs);
    setTabs((prev) => [...prev, t]);
    setActiveId(t.id);
  };

  const closeTab = (id: string) => {
    controllers.current.get(id)?.abort();
    api.cancel(id).catch(() => {});
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (id === activeId && next.length) setActiveId(next[0].id);
      return next.length ? next : [newTab()];
    });
  };

  // Close every tab and reset to a single fresh one. Aborts any in-flight runs
  // (locally and server-side) first. Confirms when more than one tab is open,
  // since the open conversations are discarded.
  const clearAllTabs = () => {
    if (tabs.length > 1 && !window.confirm(`Close all ${tabs.length} tabs and start fresh?`)) return;
    for (const t of tabs) {
      controllers.current.get(t.id)?.abort();
      api.cancel(t.id).catch(() => {});
    }
    controllers.current.clear();
    const fresh = newTab([], settings?.rag ?? false, defaultMode);
    setTabs([fresh]);
    setActiveId(fresh.id);
    setRightId("");
  };

  const runGenerate = (tab: Tab) => {
    if (!settings) return;
    controllers.current.get(tab.id)?.abort();
    const controller = new AbortController();
    controllers.current.set(tab.id, controller);
    updateTab(tab.id, {
      draft: "",
      answer: "",
      activity: [],
      messages: [],
      notice: undefined,
      error: undefined,
      phase: "draft",
    });

    // Auto-name the tab from its content (fully offline — company name or topic).
    if (tab.autoNamed) {
      const title = deriveTitleLocal(tab.jobDescription, tab.question);
      if (title) updateTab(tab.id, (t) => (t.autoNamed ? { name: title } : {}));
    }

    const overrideBody = overrideSettingsBody(tab, settings);
    const eff = tab.overrideEnabled ? tab.override ?? settings : settings;
    const meta = { tabId: tab.id, tabName: tab.name, tabColor: tab.color };
    const startedAt = Date.now();
    addLog({ ...meta, kind: "generate", engine: eff.engine, model: eff.model, question: tab.question });

    streamPost(
      `/api/tabs/${tab.id}/generate`,
      { jobDescription: tab.jobDescription, question: tab.question, skills: tab.skills, rag: tab.rag, mode: tab.mode, settings: overrideBody },
      {
        phase: (d) => updateTab(tab.id, { phase: d.phase }),
        text: (d) =>
          updateTab(tab.id, (t) =>
            d.phase === "draft" ? { draft: t.draft + d.delta } : { answer: t.answer + d.delta }
          ),
        draft: (d) => updateTab(tab.id, { draft: d.text }),
        activity: (d) => {
          updateTab(tab.id, (t) => ({ activity: [...t.activity, d] }));
          addLog({ ...meta, kind: "tool", detail: `${d.tool} · ${d.input}` });
        },
        notice: (d) => updateTab(tab.id, { notice: d.message }),
        done: (d) => {
          updateTab(tab.id, { answer: d.text, phase: "done" });
          addLog({
            ...meta,
            kind: "answer",
            engine: eff.engine,
            model: eff.model,
            question: tab.question,
            durationMs: Date.now() - startedAt,
            chars: d.text.length,
            detail: d.text.slice(0, 280),
          });
        },
        error: (d) => {
          updateTab(tab.id, { error: d.message, phase: "error" });
          addLog({ ...meta, kind: "error", detail: d.message });
        },
        session: () => {},
      },
      controller.signal
    )
      .catch((e) => {
        if (controller.signal.aborted) {
          updateTab(tab.id, (t) => ({ phase: t.answer || t.draft ? "done" : "idle" }));
        } else {
          const message = String(e?.message || e);
          updateTab(tab.id, { error: message, phase: "error" });
          addLog({ ...meta, kind: "error", detail: message });
        }
      })
      .finally(() => controllers.current.delete(tab.id));
  };

  const runFollowUp = (tab: Tab, text: string) => {
    if (!settings) return;
    controllers.current.get(tab.id)?.abort();
    const controller = new AbortController();
    controllers.current.set(tab.id, controller);
    updateTab(tab.id, (t) => ({
      messages: [...t.messages, { role: "user", text }],
      phase: "followup",
      activity: [],
      answer: "",
      error: undefined,
    }));
    const overrideBody = overrideSettingsBody(tab, settings);
    const eff = tab.overrideEnabled ? tab.override ?? settings : settings;
    const meta = { tabId: tab.id, tabName: tab.name, tabColor: tab.color };
    const startedAt = Date.now();
    addLog({ ...meta, kind: "followup", engine: eff.engine, model: eff.model, question: text });

    streamPost(
      `/api/tabs/${tab.id}/message`,
      { text, skills: tab.skills, rag: tab.rag, mode: tab.mode, settings: overrideBody },
      {
        phase: (d) => updateTab(tab.id, { phase: d.phase }),
        text: (d) => updateTab(tab.id, (t) => ({ answer: t.answer + d.delta })),
        activity: (d) => {
          updateTab(tab.id, (t) => ({ activity: [...t.activity, d] }));
          addLog({ ...meta, kind: "tool", detail: `${d.tool} · ${d.input}` });
        },
        done: (d) => {
          updateTab(tab.id, (t) => ({
            answer: d.text,
            phase: "done",
            messages: [...t.messages, { role: "assistant", text: d.text }],
          }));
          addLog({
            ...meta,
            kind: "answer",
            engine: eff.engine,
            model: eff.model,
            question: text,
            durationMs: Date.now() - startedAt,
            chars: d.text.length,
            detail: d.text.slice(0, 280),
          });
        },
        error: (d) => {
          updateTab(tab.id, { error: d.message, phase: "error" });
          addLog({ ...meta, kind: "error", detail: d.message });
        },
        session: () => {},
      },
      controller.signal
    )
      .catch((e) => {
        if (controller.signal.aborted) updateTab(tab.id, { phase: "done" });
        else {
          const message = String(e?.message || e);
          updateTab(tab.id, { error: message, phase: "error" });
          addLog({ ...meta, kind: "error", detail: message });
        }
      })
      .finally(() => controllers.current.delete(tab.id));
  };

  // Polish the current (possibly hand-edited) answer with the lightweight cleanup
  // model: fix grammar + humanize. Streams a replacement into the answer panel;
  // the original text is restored if the run is stopped or errors.
  const runCleanup = (tab: Tab) => {
    if (!settings) return;
    const sourceText = (tab.answer || tab.draft).trim();
    if (!sourceText) return;
    controllers.current.get(tab.id)?.abort();
    const controller = new AbortController();
    controllers.current.set(tab.id, controller);
    updateTab(tab.id, { phase: "cleanup", activity: [], answer: "", error: undefined, notice: undefined });

    const overrideBody = overrideSettingsBody(tab, settings);
    const eff = tab.overrideEnabled ? tab.override ?? settings : settings;
    const meta = { tabId: tab.id, tabName: tab.name, tabColor: tab.color };
    const startedAt = Date.now();
    addLog({ ...meta, kind: "cleanup", engine: eff.engine, model: eff.cleanupModel });

    streamPost(
      `/api/tabs/${tab.id}/cleanup`,
      { text: sourceText, skills: tab.skills, settings: overrideBody },
      {
        phase: (d) => updateTab(tab.id, { phase: d.phase }),
        text: (d) => updateTab(tab.id, (t) => ({ answer: t.answer + d.delta })),
        activity: (d) => {
          updateTab(tab.id, (t) => ({ activity: [...t.activity, d] }));
          addLog({ ...meta, kind: "tool", detail: `${d.tool} · ${d.input}` });
        },
        notice: (d) => updateTab(tab.id, { notice: d.message }),
        done: (d) => {
          updateTab(tab.id, { answer: d.text || sourceText, phase: "done" });
          addLog({
            ...meta,
            kind: "answer",
            engine: eff.engine,
            model: eff.cleanupModel,
            durationMs: Date.now() - startedAt,
            chars: (d.text || "").length,
            detail: (d.text || "").slice(0, 280),
          });
        },
        error: (d) => {
          updateTab(tab.id, (t) => ({ error: d.message, phase: "error", answer: t.answer || sourceText }));
          addLog({ ...meta, kind: "error", detail: d.message });
        },
        session: () => {},
      },
      controller.signal
    )
      .catch((e) => {
        if (controller.signal.aborted) {
          updateTab(tab.id, (t) => ({ phase: "done", answer: t.answer || sourceText }));
        } else {
          const message = String(e?.message || e);
          updateTab(tab.id, (t) => ({ error: message, phase: "error", answer: t.answer || sourceText }));
          addLog({ ...meta, kind: "error", detail: message });
        }
      })
      .finally(() => controllers.current.delete(tab.id));
  };

  const cancel = (id: string) => {
    controllers.current.get(id)?.abort();
    api.cancel(id).catch(() => {});
  };

  // ── Vault Writer Handlers ─────────────────────────────────────────────────

  const runSummarize = async (tab: Tab) => {
    if (!settings) return;
    controllers.current.get(tab.id)?.abort();
    const controller = new AbortController();
    controllers.current.set(tab.id, controller);
    
    updateTab(tab.id, { phase: "draft", error: undefined, writePreview: "", writeConfirmed: false });
    
    const input = tab.writeInput.trim();
    const isUrl = /^https?:\/\//i.test(input);
    let finalInput = input;
    
    if (isUrl) {
      try {
        const res = await api.fetchUrl(input, settings.urlFetchMethod);
        if (res.error) throw new Error(res.error);
        finalInput = res.text;
      } catch (err: any) {
        updateTab(tab.id, { phase: "error", error: err.message });
        controllers.current.delete(tab.id);
        return;
      }
    }
    
    const overrideBody = overrideSettingsBody(tab, settings);
    
    streamPost(
      `/api/tabs/${tab.id}/summarize`,
      { input: finalInput, isUrl, skills: tab.skills, settings: overrideBody },
      {
        phase: (d) => updateTab(tab.id, { phase: d.phase }),
        text: (d) => updateTab(tab.id, (t) => ({ writePreview: (t.writePreview || "") + d.delta })),
        done: (d) => updateTab(tab.id, { phase: "done", writePreview: d.text }),
        error: (d) => updateTab(tab.id, { phase: "error", error: d.message }),
      },
      controller.signal
    ).catch((e) => {
      if (!controller.signal.aborted) updateTab(tab.id, { phase: "error", error: String(e) });
    }).finally(() => controllers.current.delete(tab.id));
  };

  const runAutoPlace = (tab: Tab) => {
    if (!settings) return;
    controllers.current.get(tab.id)?.abort();
    const controller = new AbortController();
    controllers.current.set(tab.id, controller);
    
    updateTab(tab.id, { phase: "draft", error: undefined, writeConfirmed: false });
    const overrideBody = overrideSettingsBody(tab, settings);
    
    streamPost(
      `/api/tabs/${tab.id}/auto-place`,
      { content: tab.writeInput, settings: overrideBody },
      {
        phase: (d) => updateTab(tab.id, { phase: d.phase }),
        done: (d) => updateTab(tab.id, { phase: "done", writePath: d.text }),
        error: (d) => updateTab(tab.id, { phase: "error", error: d.message }),
      },
      controller.signal
    ).catch((e) => {
      if (!controller.signal.aborted) updateTab(tab.id, { phase: "error", error: String(e) });
    }).finally(() => controllers.current.delete(tab.id));
  };

  const runFillinScan = (tab: Tab) => {
    if (!settings) return;
    controllers.current.get(tab.id)?.abort();
    const controller = new AbortController();
    controllers.current.set(tab.id, controller);
    
    updateTab(tab.id, { phase: "draft", error: undefined, writeConfirmed: false });
    const overrideBody = overrideSettingsBody(tab, settings);
    
    streamPost(
      `/api/tabs/${tab.id}/fillin-scan`,
      { prompt: tab.writeInput, dir: tab.fillinDir, settings: overrideBody },
      {
        phase: (d) => updateTab(tab.id, { phase: d.phase }),
        done: (d) => {
          try {
            const raw = d.text.trim();
            const firstBracket = raw.indexOf('[');
            const lastBracket = raw.lastIndexOf(']');
            if (firstBracket === -1 || lastBracket === -1) throw new Error("Invalid JSON returned");
            const qs = JSON.parse(raw.substring(firstBracket, lastBracket + 1));
            updateTab(tab.id, { phase: "done", fillinQuestions: qs.map((q: any) => ({ ...q, id: uid(), answer: "", written: false })) });
          } catch (err: any) {
            updateTab(tab.id, { phase: "error", error: "Failed to parse questions: " + err.message });
          }
        },
        error: (d) => updateTab(tab.id, { phase: "error", error: d.message }),
      },
      controller.signal
    ).catch((e) => {
      if (!controller.signal.aborted) updateTab(tab.id, { phase: "error", error: String(e) });
    }).finally(() => controllers.current.delete(tab.id));
  };

  const runFillinWrite = (tab: Tab, questionId: string) => {
    if (!settings) return;
    const q = tab.fillinQuestions?.find(x => x.id === questionId);
    if (!q) return;
    
    controllers.current.get(tab.id)?.abort();
    const controller = new AbortController();
    controllers.current.set(tab.id, controller);
    
    updateTab(tab.id, (t) => ({
      phase: "draft", error: undefined, writeConfirmed: false,
      fillinQuestions: t.fillinQuestions?.map(xq => xq.id === questionId ? { ...xq, preview: "" } : xq)
    }));
    const overrideBody = overrideSettingsBody(tab, settings);
    
    streamPost(
      `/api/tabs/${tab.id}/fillin-write`,
      { question: q.question, answer: q.answer, targetPath: q.targetPath, skills: tab.skills, settings: overrideBody },
      {
        phase: (d) => updateTab(tab.id, { phase: d.phase }),
        text: (d) => updateTab(tab.id, (t) => ({
          fillinQuestions: t.fillinQuestions?.map(xq => xq.id === questionId ? { ...xq, preview: (xq.preview || "") + d.delta } : xq)
        })),
        done: (d) => updateTab(tab.id, (t) => ({
          phase: "done",
          fillinQuestions: t.fillinQuestions?.map(xq => xq.id === questionId ? { ...xq, preview: d.text } : xq)
        })),
        error: (d) => updateTab(tab.id, { phase: "error", error: d.message }),
      },
      controller.signal
    ).catch((e) => {
      if (!controller.signal.aborted) updateTab(tab.id, { phase: "error", error: String(e) });
    }).finally(() => controllers.current.delete(tab.id));
  };

  const confirmFillinWrite = async (tab: Tab, questionId: string) => {
    const q = tab.fillinQuestions?.find(x => x.id === questionId);
    if (!q || !q.targetPath || !q.preview) return;
    try {
      const res = await api.vaultWrite(q.targetPath, q.preview);
      if (res.ok) {
        updateTab(tab.id, t => ({
          writeConfirmed: true,
          fillinQuestions: t.fillinQuestions?.map(xq => xq.id === questionId ? { ...xq, written: true } : xq)
        }));
      } else throw new Error("API failed");
    } catch (err: any) {
      updateTab(tab.id, { error: err.message });
    }
  };

  const runWriteCleanup = (tab: Tab) => {
    if (!settings) return;
    controllers.current.get(tab.id)?.abort();
    const controller = new AbortController();
    controllers.current.set(tab.id, controller);
    
    updateTab(tab.id, { phase: "cleanup", error: undefined, writePreview: "", writeConfirmed: false });
    const overrideBody = overrideSettingsBody(tab, settings);
    
    streamPost(
      `/api/tabs/${tab.id}/write-cleanup`,
      { text: tab.writeInput, skills: tab.skills, settings: overrideBody },
      {
        phase: (d) => updateTab(tab.id, { phase: d.phase }),
        text: (d) => updateTab(tab.id, (t) => ({ writePreview: (t.writePreview || "") + d.delta })),
        done: (d) => updateTab(tab.id, { phase: "done", writePreview: d.text }),
        error: (d) => updateTab(tab.id, { phase: "error", error: d.message }),
      },
      controller.signal
    ).catch((e) => {
      if (!controller.signal.aborted) updateTab(tab.id, { phase: "error", error: String(e) });
    }).finally(() => controllers.current.delete(tab.id));
  };

  const confirmWrite = async (tab: Tab) => {
    if (!tab.writePath) return;
    const content = tab.writePreview || tab.writeInput;
    if (!content) return;
    try {
      const res = await api.vaultWrite(tab.writePath, content);
      if (res.ok) updateTab(tab.id, { writeConfirmed: true });
      else throw new Error("API failed");
    } catch (err: any) {
      updateTab(tab.id, { error: err.message });
    }
  };

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];
  // Right split pane: its chosen tab, falling back to any other tab, else active.
  const right =
    tabs.find((t) => t.id === rightId) ?? tabs.find((t) => t.id !== active?.id) ?? active;

  // Patch a tab by id; live-rename it from content while it is still auto-named.
  const patchTab = (id: string, patch: Partial<Tab>) => {
    updateTab(id, (t) => {
      const next: Partial<Tab> = { ...patch };
      if ((patch.question !== undefined || patch.jobDescription !== undefined) && t.autoNamed) {
        const title = deriveTitleLocal(
          patch.jobDescription ?? t.jobDescription,
          patch.question ?? t.question
        );
        if (title) next.name = title;
      }
      return next;
    });
  };

  // Open the second pane; seed it with a tab other than the active one.
  const toggleSplit = () => {
    setSplit((s) => !s);
    setRightId((prev) => {
      if (prev && tabs.some((t) => t.id === prev && t.id !== activeId)) return prev;
      const other = tabs.find((t) => t.id !== activeId);
      return other ? other.id : activeId;
    });
  };

  if (!settings) {
    return <div className="loading">Loading…</div>;
  }

  const engineLabel = engines.find((e) => e.id === settings.engine)?.label?.toLowerCase() || settings.engine;
  const phase = active?.phase ?? "idle";
  const phaseTone =
    phase === "done" ? "ok" : phase === "error" ? "bad" : phase === "idle" ? "" : "warn";
  const phaseText: Record<string, string> = {
    idle: "idle",
    draft: "working",
    humanize: "humanizing",
    cleanup: "cleaning up",
    followup: "revising",
    done: "ready",
    error: "error",
  };

  const renderPane = (paneTab: Tab) => (
    <TabView
      key={paneTab.id}
      tab={paneTab}
      globalSettings={settings}
      models={models}
      engines={engines}
      skills={skills}
      availableSkills={availableSkills}
      onPatch={(patch) => patchTab(paneTab.id, patch)}
      onGenerate={() => runGenerate(paneTab)}
      onFollowUp={(text) => runFollowUp(paneTab, text)}
      onCleanup={() => runCleanup(paneTab)}
      onNewQuestion={() => addQuestionTab(paneTab)}
      onCancel={() => cancel(paneTab.id)}
      onSummarize={() => runSummarize(paneTab)}
      onAutoPlace={() => runAutoPlace(paneTab)}
      onFillinScan={() => runFillinScan(paneTab)}
      onFillinWrite={(qid) => runFillinWrite(paneTab, qid)}
      onConfirmFillinWrite={(qid) => confirmFillinWrite(paneTab, qid)}
      onWriteCleanup={() => runWriteCleanup(paneTab)}
      onConfirmWrite={() => confirmWrite(paneTab)}
    />
  );

  return (
    <div className="app">
      {design.funEnabled && <FunBackground variant={design.funVariant} />}
      <header className="topbar">
        <div className="brand">
          <span className="app-icon" title="Vault Assistant">
            <span className="app-icon-mark">VA</span>
          </span>
          <div className="brand-text">
            <span className="kicker">grounded · obsidian vault</span>
            <span className="brand-title">Vault Assistant</span>
          </div>
        </div>
        {design.toolbarDropdown ? (
          <div className="topbar-meta">
            <div className="toolbar-dropdown-wrap">
              <button
                className={`icon-btn ${toolbarDropOpen ? "active" : ""}`}
                title="Toolbar menu"
                onClick={() => setToolbarDropOpen((o) => !o)}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <line x1="4" y1="6" x2="20" y2="6" />
                  <line x1="4" y1="12" x2="20" y2="12" />
                  <line x1="4" y1="18" x2="20" y2="18" />
                </svg>
              </button>
              {toolbarDropOpen && (
                <>
                  <div className="toolbar-dropdown-backdrop" onClick={() => setToolbarDropOpen(false)} />
                  <div className="toolbar-dropdown-menu">
                    <div className="toolbar-dropdown-section">
                      <span className="toolbar-dropdown-label">Engine</span>
                      <div className="toolbar-dropdown-pills">
                        <span className="pill">{engineLabel}</span>
                        {settings.engine === "claude" && (
                          <>
                            <span className="pill">{settings.model.replace("claude-", "")}</span>
                            <span className="pill">{settings.effort} reasoning</span>
                          </>
                        )}
                        {active?.rag && (
                          <span
                            className="pill pill--accent"
                            title="Retrieval-augmented — only relevant vault excerpts are sent"
                          >
                            <span className="dot accent" />
                            RAG
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="toolbar-dropdown-divider" />
                    <button
                      className={`toolbar-dropdown-item ${split ? "active" : ""}`}
                      onClick={() => { toggleSplit(); setToolbarDropOpen(false); }}
                    >
                      <span className="toolbar-dropdown-item-icon">◫</span>
                      {split ? "Close split view" : "Split view"}
                    </button>
                    <button
                      className="toolbar-dropdown-item"
                      onClick={() => { setTheme((t) => (t === "dark" ? "light" : "dark")); setToolbarDropOpen(false); }}
                    >
                      <span className="toolbar-dropdown-item-icon">{theme === "dark" ? "☾" : "☀"}</span>
                      {theme === "dark" ? "Light theme" : "Dark theme"}
                    </button>
                    <button
                      className="toolbar-dropdown-item"
                      onClick={() => { setDensity((d) => (d === "compact" ? "comfortable" : "compact")); setToolbarDropOpen(false); }}
                    >
                      <span className="toolbar-dropdown-item-icon">{density === "compact" ? "▣" : "▢"}</span>
                      {density === "compact" ? "Comfortable density" : "Compact density"}
                    </button>
                    <div className="toolbar-dropdown-divider" />
                    <button
                      className="toolbar-dropdown-item"
                      onClick={() => { setQuickOpen(true); setToolbarDropOpen(false); }}
                    >
                      <span className="toolbar-dropdown-item-icon">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                          <path d="M14 3v5h5M9 13h6M9 17h4" />
                        </svg>
                      </span>
                      Quick Notes
                    </button>
                    <button
                      className="toolbar-dropdown-item"
                      onClick={() => { setLogsOpen(true); setToolbarDropOpen(false); }}
                    >
                      <span className="toolbar-dropdown-item-icon">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M3 3v18h18" />
                          <path d="M7 14l3-4 3 3 4-6" />
                        </svg>
                      </span>
                      Logs
                    </button>
                    <button
                      className="toolbar-dropdown-item"
                      onClick={() => { setSettingsOpen(true); setToolbarDropOpen(false); }}
                    >
                      <span className="toolbar-dropdown-item-icon">⚙</span>
                      Settings
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="topbar-meta">
            <span className="pill">{engineLabel}</span>
            {settings.engine === "claude" && (
              <>
                <span className="pill">{settings.model.replace("claude-", "")}</span>
                <span className="pill">{settings.effort} reasoning</span>
              </>
            )}
            {active?.rag && (
              <span
                className="pill pill--accent"
                title="Retrieval-augmented — only relevant vault excerpts are sent"
              >
                <span className="dot accent" />
                RAG
              </span>
            )}
            <button
              className={`icon-btn ${split ? "active" : ""}`}
              title={split ? "Close split view" : "Split view"}
              onClick={toggleSplit}
            >
              ◫
            </button>
            <button
              className="icon-btn"
              title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            >
              {theme === "dark" ? "☾" : "☀"}
            </button>
            <button
              className="icon-btn"
              title={density === "compact" ? "Comfortable density" : "Compact density"}
              onClick={() => setDensity((d) => (d === "compact" ? "comfortable" : "compact"))}
            >
              {density === "compact" ? "▣" : "▢"}
            </button>
            <button
              className={`icon-btn ${quickOpen ? "active" : ""}`}
              title="Quick notes — reusable links & snippets"
              onClick={() => setQuickOpen(true)}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                <path d="M14 3v5h5M9 13h6M9 17h4" />
              </svg>
            </button>
            <button
              className={`icon-btn ${logsOpen ? "active" : ""}`}
              title="Logs — recent activity & stats"
              onClick={() => setLogsOpen(true)}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 3v18h18" />
                <path d="M7 14l3-4 3 3 4-6" />
              </svg>
            </button>
            <button className="icon-btn" title="Settings" onClick={() => setSettingsOpen(true)}>
              ⚙
            </button>
          </div>
        )}
      </header>

      <TabBar
        tabs={tabs}
        activeId={active?.id ?? ""}
        onSelect={setActiveId}
        onAdd={addTab}
        onClose={closeTab}
        onClearAll={clearAllTabs}
        onRename={(id, name) => updateTab(id, { name, autoNamed: false })}
      />

      {split ? (
        <main className="content content-split">
          <section className="pane">
            <div className="pane-head">
              <span className="pane-label">Left</span>
              <span className="pane-current" style={{ color: active?.color }}>
                {active?.name}
              </span>
              <span className="pane-hint">follows the tab bar</span>
            </div>
            {active && renderPane(active)}
          </section>
          <div className="pane-divider" />
          <section className="pane">
            <div className="pane-head">
              <span className="pane-label">Right</span>
              <div className="pane-switch">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    className={`pane-chip ${t.id === right?.id ? "active" : ""}`}
                    style={t.id === right?.id ? { borderColor: t.color } : undefined}
                    onClick={() => setRightId(t.id)}
                    title={t.name}
                  >
                    <span className="dot" style={{ background: t.color }} />
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
            {right && renderPane(right)}
          </section>
        </main>
      ) : (
        <main className="content">{active && renderPane(active)}</main>
      )}

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          models={models}
          engines={engines}
          skills={skills}
          availableSkills={availableSkills}
          defaultMode={defaultMode}
          design={design}
          onDefaultModeChange={setDefaultMode}
          onChange={changeSettings}
          onDesignChange={changeDesign}
          onCreateSkill={createSkill}
          onRefreshSkills={refreshSkills}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {quickOpen && <QuickNotes onClose={() => setQuickOpen(false)} />}

      {logsOpen && (
        <LogsModal
          logs={logs}
          onClear={() => {
            clearLogs();
            api.clearLogs().catch(() => {});
            setLogs([]);
          }}
          onClose={() => setLogsOpen(false)}
        />
      )}

      <footer className="statusbar">
        <div className="statusbar-left">
          <span className="status-pill">
            <span className={`status-dot ${phaseTone}`} />
            {phaseText[phase] ?? phase}
          </span>
          <span className="sb-sep">·</span>
          <span className="sb-dim">{engineLabel}</span>
          {active?.rag && (
            <>
              <span className="sb-sep">·</span>
              <span>RAG</span>
            </>
          )}
        </div>
        <div className="statusbar-right">
          <span className="sb-dim">
            {tabs.length} tab{tabs.length === 1 ? "" : "s"}
          </span>
          <span className="sb-sep">·</span>
          <span className="sb-dim">bun · sse</span>
        </div>
      </footer>
    </div>
  );
}

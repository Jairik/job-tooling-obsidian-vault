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
  mergeSettings,
  normalizeSettings,
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
import { effectiveEngineModel, effectiveEngineReasoning } from "../shared/settings";
import { api, streamPost, type ModelOption, type SSEHandlers } from "./lib/api";
import { TabBar } from "./components/TabBar";
import { TabView } from "./components/TabView";
import { SettingsPanel } from "./components/SettingsPanel";
import { Onboarding } from "./components/Onboarding";
import { HelpGuide } from "./components/HelpGuide";
import { QuickNotes } from "./components/QuickNotes";
import { FunBackground } from "./components/FunBackground";
import { createConversationActions } from "./lib/conversation-actions";

/* Reads localStorage safely for browsers that block or clear client storage. */
function readLS(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/* Writes a UI preference without letting a storage error interrupt rendering. */
function writeLS(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/* Owns global UI state, persistence, tab lifecycle, and the application layout. */
export function App() {
  const [tabs, setTabs] = useState<Tab[]>(() => loadTabs());
  const [activeId, setActiveId] = useState<string>(() => {
    const t = loadTabs();
    return t[0]?.id ?? "";
  });
  const [settings, setSettings] = useState<Settings | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [engines, setEngines] = useState<ModelOption[]>([]);
  const [skills, setSkills] = useState({ humanizer: false, gemini: false, opencode: false, cursor: false, copilot: false, codex: false });
  const [availableSkills, setAvailableSkills] = useState<SkillInfo[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // When true, the Settings panel opens straight to the Help page (set by the
  // first-run welcome modal's "Explore settings" action).
  const [settingsToHelp, setSettingsToHelp] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  // First-run walkthrough: shown once after onboarding, tracked by a local flag so
  // it never re-appears. The same content also lives under Settings → Help.
  const [helpSeen, setHelpSeen] = useState<boolean>(() => readLS("jt.help.v1") === "seen");
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

    // Accent color: the token --accent reads these CSS vars (oklch hue + chroma),
    // so the Appearance sliders drive the accent live across the whole UI.
    el.style.setProperty("--accent-hue", String(design.accentHue));
    el.style.setProperty("--accent-chroma", String(design.accentChroma));

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

  // Dismiss the first-run walkthrough and remember it so it never shows again.
  const dismissHelp = () => {
    writeLS("jt.help.v1", "seen");
    setHelpSeen(true);
  };

  // Escape closes the first-run walkthrough, but only while it is the modal on top
  // (onboarding owns Escape until the user is onboarded).
  useEffect(() => {
    if (helpSeen || !settings?.onboarded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismissHelp();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [helpSeen, settings?.onboarded]);

  // Initial load: server config (authoritative) merged with anything saved locally.
  useEffect(() => {
    (async () => {
      const [meta, config] = await Promise.all([api.meta(), api.getConfig()]);
      setModels(meta.models);
      setEngines(meta.engines);
      const local = loadSettings();
      const base = normalizeSettings(config);
      const merged: Settings = local ? mergeSettings(base, local) : base;
      // The server (config.json) is authoritative for first-run state, so stale
      // localStorage from before this field existed can't re-trigger onboarding.
      merged.onboarded = base.onboarded;
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

  /* Applies a static or state-derived patch to exactly one tab. */
  const updateTab = (id: string, patch: Partial<Tab> | ((t: Tab) => Partial<Tab>)) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...(typeof patch === "function" ? patch(t) : patch) } : t))
    );
  };

  /* Updates settings optimistically, then persists the small patch to the server. */
  const changeSettings = (patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = mergeSettings(prev as Settings, patch);
      saveSettings(next);
      api.saveConfig(patch).catch(() => {});
      return next;
    });
  };

  /* Updates visual preferences separately from model and vault configuration. */
  const changeDesign = (patch: Partial<DesignSettings>) => {
    setDesign((prev) => ({ ...prev, ...patch }));
  };

  /* Opens an independent tab using the active default mode and RAG preference. */
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

  /* Cancels work, removes the tab, and selects a sensible remaining tab. */
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
  // (locally and server-side) first.
  const clearAllTabs = () => {
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

  const { runGenerate, runFollowUp, runCleanup, cancel } = createConversationActions({
    settings,
    controllers: controllers.current,
    updateTab,
    addLog,
  });

  /* Shares abort, phase, error, and final cleanup handling across writer endpoints. */
  const runWriterStream = (
    tab: Tab,
    endpoint: string,
    body: unknown,
    initial: Partial<Tab> | ((current: Tab) => Partial<Tab>),
    handlers: Omit<SSEHandlers, "phase" | "error">
  ) => {
    controllers.current.get(tab.id)?.abort();
    const controller = new AbortController();
    controllers.current.set(tab.id, controller);
    // Clear any prior tool activity so the log reflects only this run.
    updateTab(tab.id, (current) => ({
      activity: [],
      ...(typeof initial === "function" ? initial(current) : initial),
    }));

    streamPost(
      `/api/tabs/${tab.id}/${endpoint}`,
      body,
      {
        phase: (data) => updateTab(tab.id, { phase: data.phase }),
        error: (data) => updateTab(tab.id, { phase: "error", error: data.message }),
        activity: (data) => updateTab(tab.id, (current) => ({ activity: [...current.activity, data] })),
        ...handlers,
      },
      controller.signal
    )
      .catch((error) => {
        if (!controller.signal.aborted) updateTab(tab.id, { phase: "error", error: String(error) });
      })
      .finally(() => controllers.current.delete(tab.id));
  };

  // ── Vault Writer Handlers ─────────────────────────────────────────────────

  /* Fetches URL content when needed, then streams a vault-ready summary. */
  const runSummarize = async (tab: Tab) => {
    if (!settings) return;
    controllers.current.get(tab.id)?.abort();
    const controller = new AbortController();
    controllers.current.set(tab.id, controller);
    
    updateTab(tab.id, { phase: "draft", error: undefined, writePreview: "", writeConfirmed: false, activity: [] });

    const input = tab.writeInput.trim();
    const isUrl = /^https?:\/\//i.test(input);
    let finalInput = input;
    
    /* URLs are fetched server-side so the model receives text instead of a remote reference. */
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
        activity: (d) => updateTab(tab.id, (t) => ({ activity: [...t.activity, d] })),
        done: (d) => updateTab(tab.id, { phase: "done", writePreview: d.text }),
        error: (d) => updateTab(tab.id, { phase: "error", error: d.message }),
      },
      controller.signal
    ).catch((e) => {
      if (!controller.signal.aborted) updateTab(tab.id, { phase: "error", error: String(e) });
    }).finally(() => controllers.current.delete(tab.id));
  };

  /* Asks the writer workflow to choose a destination path for the current content. */
  const runAutoPlace = (tab: Tab) => {
    if (!settings) return;
    runWriterStream(
      tab,
      "auto-place",
      { content: tab.writeInput, settings: overrideSettingsBody(tab, settings) },
      { phase: "draft", error: undefined, writeConfirmed: false },
      { done: (data) => updateTab(tab.id, { phase: "done", writePath: data.text }) }
    );
  };

  /* Scans the selected vault area and converts the model's JSON response into UI records. */
  const runFillinScan = (tab: Tab) => {
    if (!settings) return;
    runWriterStream(
      tab,
      "fillin-scan",
      { prompt: tab.writeInput, dir: tab.fillinDir, settings: overrideSettingsBody(tab, settings) },
      { phase: "draft", error: undefined, writeConfirmed: false },
      {
        done: (data) => {
          try {
            /* Accept JSON wrapped in model prose by extracting the outer array first. */
            const raw = data.text.trim();
            const firstBracket = raw.indexOf('[');
            const lastBracket = raw.lastIndexOf(']');
            if (firstBracket === -1 || lastBracket === -1) throw new Error("Invalid JSON returned");
            const qs = JSON.parse(raw.substring(firstBracket, lastBracket + 1));
            updateTab(tab.id, { phase: "done", fillinQuestions: qs.map((q: any) => ({ ...q, id: uid(), answer: "", written: false })) });
          } catch (err: any) {
            updateTab(tab.id, { phase: "error", error: "Failed to parse questions: " + err.message });
          }
        },
      }
    );
  };

  /* Streams a proposed answer into just the selected fill-in question. */
  const runFillinWrite = (tab: Tab, questionId: string) => {
    if (!settings) return;
    const q = tab.fillinQuestions?.find(x => x.id === questionId);
    if (!q) return;
    runWriterStream(
      tab,
      "fillin-write",
      { question: q.question, answer: q.answer, targetPath: q.targetPath, skills: tab.skills, settings: overrideSettingsBody(tab, settings) },
      (current) => ({
        phase: "draft", error: undefined, writeConfirmed: false,
        fillinQuestions: current.fillinQuestions?.map(xq => xq.id === questionId ? { ...xq, preview: "" } : xq)
      }),
      {
        text: (data) => updateTab(tab.id, (current) => ({
          fillinQuestions: current.fillinQuestions?.map(xq => xq.id === questionId ? { ...xq, preview: (xq.preview || "") + data.delta } : xq)
        })),
        done: (data) => updateTab(tab.id, (current) => ({
          phase: "done",
          fillinQuestions: current.fillinQuestions?.map(xq => xq.id === questionId ? { ...xq, preview: data.text } : xq)
        })),
      }
    );
  };

  /* Writes an approved fill-in preview to disk and marks only that question complete. */
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

  /* Sends a writer draft through the formatting and clarity cleanup pass. */
  const runWriteCleanup = (tab: Tab) => {
    if (!settings) return;
    runWriterStream(
      tab,
      "write-cleanup",
      { text: tab.writeInput, skills: tab.skills, settings: overrideSettingsBody(tab, settings) },
      { phase: "cleanup", error: undefined, writePreview: "", writeConfirmed: false },
      {
        text: (data) => updateTab(tab.id, (current) => ({ writePreview: (current.writePreview || "") + data.delta })),
        done: (data) => updateTab(tab.id, { phase: "done", writePreview: data.text }),
      }
    );
  };

  /* Persists the approved preview, or the raw input when no preview is present. */
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
  /* Updates a tab and refreshes its local title while it remains automatically named. */
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
  /* Toggles split view and ensures the right pane never points at the active left tab. */
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
  const currentModel = effectiveEngineModel(settings);
  const currentReasoning = effectiveEngineReasoning(settings);

  /* Supplies one tab and its callbacks to either the primary or secondary pane. */
  const renderPane = (paneTab: Tab) => (
    <TabView
      key={paneTab.id}
      tab={paneTab}
      globalSettings={settings}
      models={models}
      engines={engines}
      skills={skills}
      availableSkills={availableSkills}
      engineLabel={engineLabel}
      model={currentModel}
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
      <header className="toolbar">
        <a className="logo" href="#" onClick={(e) => e.preventDefault()} title="Vault Assistant">
          <span className="logo-mark">VA</span>
          <span className="logo-text">Vault</span>
        </a>

        <TabBar
          tabs={tabs}
          activeId={active?.id ?? ""}
          onSelect={setActiveId}
          onAdd={addTab}
          onClose={closeTab}
          onClearAll={clearAllTabs}
          onRename={(id, name) => updateTab(id, { name, autoNamed: false })}
        />

        <div className="t-actions">
          {design.toolbarDropdown ? (
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
                        {currentModel && (
                          <span className="pill">{currentModel.replace("claude-", "")}</span>
                        )}
                        {currentReasoning && (
                          <span className="pill">{currentReasoning} reasoning</span>
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
                      <span className="toolbar-dropdown-item-icon">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <rect x="3" y="4" width="18" height="16" rx="2" />
                          <line x1="12" y1="4" x2="12" y2="20" />
                        </svg>
                      </span>
                      {split ? "Close split view" : "Split view"}
                    </button>

                    <button
                      className="toolbar-dropdown-item"
                      onClick={() => { setDensity((d) => (d === "compact" ? "comfortable" : "compact")); setToolbarDropOpen(false); }}
                    >
                      <span className="toolbar-dropdown-item-icon">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <rect x="3" y="4" width="18" height="6" rx="1.5" />
                          <rect x="3" y="14" width="18" height="6" rx="1.5" />
                        </svg>
                      </span>
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
                      onClick={() => { setSettingsOpen(true); setToolbarDropOpen(false); }}
                    >
                      <span className="toolbar-dropdown-item-icon">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <circle cx="12" cy="12" r="3" />
                          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                        </svg>
                      </span>
                      Settings
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
              <button
                className={`icon-btn ${split ? "active" : ""}`}
                title={split ? "Close split view" : "Split view"}
                onClick={toggleSplit}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <line x1="12" y1="4" x2="12" y2="20" />
                </svg>
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

              <button className="icon-btn" title="Settings" onClick={() => setSettingsOpen(true)}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
            </>
          )}
        </div>
      </header>

      {split ? (
        <main className="main content-split">
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
        <main className="main">{active && renderPane(active)}</main>
      )}

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          models={models}
          engines={engines}
          skills={skills}
          availableSkills={availableSkills}
          logs={logs}
          defaultMode={defaultMode}
          design={design}
          theme={theme}
          density={density}
          onThemeChange={setTheme}
          onDensityChange={setDensity}
          onDefaultModeChange={setDefaultMode}
          onChange={changeSettings}
          onDesignChange={changeDesign}
          onCreateSkill={createSkill}
          onRefreshSkills={refreshSkills}
          onClearLogs={() => {
            clearLogs();
            api.clearLogs().catch(() => {});
            setLogs([]);
          }}
          initialPage={settingsToHelp ? "help" : "general"}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsToHelp(false);
          }}
        />
      )}

      {quickOpen && <QuickNotes onClose={() => setQuickOpen(false)} />}

      {settings && !settings.onboarded && (
        <Onboarding
          initial={settings}
          onComplete={(patch) => changeSettings(patch)}
          onSkip={() => changeSettings({ onboarded: true })}
        />
      )}

      {/* First-run walkthrough: shown once after onboarding completes. The same
          content is always available under Settings → Help. */}
      {settings && settings.onboarded && !helpSeen && (
        <div className="modal-wrap" onClick={dismissHelp}>
          <div className="onboard-card help-welcome" onClick={(e) => e.stopPropagation()}>
            <div className="onboard-hd">
              <h2 className="onboard-title">How Vault Assistant works</h2>
              <p className="onboard-sub">
                A quick tour of what you can do. You can reopen this anytime from Settings → Help.
              </p>
            </div>
            <div className="onboard-body">
              <HelpGuide />
            </div>
            <div className="onboard-foot">
              <button
                className="btn btn-ghost"
                onClick={() => {
                  dismissHelp();
                  setSettingsToHelp(true);
                  setSettingsOpen(true);
                }}
              >
                Explore settings
              </button>
              <button className="btn btn-primary" onClick={dismissHelp}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

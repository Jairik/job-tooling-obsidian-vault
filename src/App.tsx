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
  type AttachmentMeta,
} from "./lib/store";
import { effectiveEngineModel, effectiveEngineReasoning } from "../shared/settings";
import type { EngineScanResult } from "../shared/engine-scan";
import { api, streamPost, type ModelOption, type SSEHandlers } from "./lib/api";
import { TabBar } from "./components/TabBar";
import { TabView } from "./components/TabView";
import { ApprovalModal } from "./components/ApprovalModal";
import { SettingsPanel } from "./components/SettingsPanel";
import { Onboarding } from "./components/Onboarding";
import { HelpGuide } from "./components/HelpGuide";
import { QuickNotes } from "./components/QuickNotes";
import { FunBackground } from "./components/FunBackground";
import { ShortcutsOverlay } from "./components/ShortcutsOverlay";
import { isEditableTarget } from "./lib/shortcuts";
import { createConversationActions } from "./lib/conversation-actions";
import logoUrl from "./assets/vault-assistant-logo-v2.png";

const logoSrc = (typeof logoUrl === "string" && logoUrl.startsWith("/") && !logoUrl.startsWith("/assets/"))
  ? "/assets/vault-assistant-logo-v2.png"
  : logoUrl;

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

// One vault write awaiting the user's explicit approval. Every write flows
// through this modal: the server refuses writes without the preview token.
interface PendingApproval {
  tabId: string;
  path: string;
  exists: boolean;
  existingContent: string;
  tooLarge?: boolean;
  newContent: string;
  token: string;
  busy: boolean;
  error?: string;
  onWritten: () => void;
}

function skillStatusFromEngineScan(scan: EngineScanResult) {
  return {
    gemini: scan.engines.gemini.available,
    opencode: scan.engines.opencode.available,
    cursor: scan.engines.cursor.available,
    copilot: scan.engines.copilot.available,
    codex: scan.engines.codex.available,
  };
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
  const [engineScan, setEngineScan] = useState<EngineScanResult | null>(null);
  const [skills, setSkills] = useState({ humanizer: false, gemini: false, opencode: false, cursor: false, copilot: false, codex: false });
  const [availableSkills, setAvailableSkills] = useState<SkillInfo[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaveError, setSettingsSaveError] = useState<string | null>(null);
  const settingsSaveSeq = useRef(0);
  // When true, the Settings panel opens straight to the Help page (set by the
  // first-run welcome modal's "Explore settings" action).
  const [settingsToHelp, setSettingsToHelp] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  // The keyboard-shortcut cheat-sheet (opened with "?").
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // First-run walkthrough: shown once after onboarding, tracked by a local flag so
  // it never re-appears. The same content also lives under Settings → Help.
  const [helpSeen, setHelpSeen] = useState<boolean>(() => readLS("jt.help.v1") === "seen");
  const [toolbarDropOpen, setToolbarDropOpen] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>(() => loadLogs());
  // The one write awaiting explicit approval, or null when no modal is open.
  const [approval, setApproval] = useState<PendingApproval | null>(null);
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

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];
  // Right split pane: its chosen tab, falling back to any other tab, else active.
  const right =
    tabs.find((t) => t.id === rightId) ?? tabs.find((t) => t.id !== active?.id) ?? active;

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
      const [meta, config, scan] = await Promise.all([api.meta(), api.getConfig(), api.engineScan()]);
      setModels(meta.models);
      setEngines(meta.engines);
      setEngineScan(scan);
      setSkills((prev) => ({ ...prev, ...skillStatusFromEngineScan(scan) }));
      const local = loadSettings();
      const base = normalizeSettings(config);
      const merged: Settings = local ? mergeSettings(base, local) : base;
      // The server (config.json) is authoritative for first-run state, so stale
      // localStorage from before this field existed can't re-trigger onboarding.
      merged.onboarded = base.onboarded;
      setSettings(merged);
    })();
  }, []);

  // Attachments live only in server-side memory/disk for the session; a restart
  // (or `bun --hot` reload) can leave a restored tab pointing at an id that no
  // longer exists. Check once on load so stale chips show "expired" instead of
  // silently failing on the next generate.
  useEffect(() => {
    const ids = new Set<string>();
    for (const t of tabs) {
      for (const a of t.attachments) ids.add(a.id);
      if (t.docAttachment) ids.add(t.docAttachment.id);
    }
    if (!ids.size) return;
    Promise.all([...ids].map((id) => api.getAttachment(id).then((r) => [id, r.ok] as const)))
      .then((results) => {
        const missing = new Set(results.filter(([, ok]) => !ok).map(([id]) => id));
        if (!missing.size) return;
        setTabs((cur) =>
          cur.map((t) => ({
            ...t,
            attachments: t.attachments.map((a) => (missing.has(a.id) ? { ...a, expired: true } : a)),
            docAttachment: t.docAttachment && missing.has(t.docAttachment.id) ? { ...t.docAttachment, expired: true } : t.docAttachment,
          }))
        );
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    api
      .engineScan()
      .then((scan) => {
        setEngineScan(scan);
        setSkills((prev) => ({ ...prev, ...skillStatusFromEngineScan(scan) }));
      })
      .catch(() => {});
    api.listSkills(settings.vaultDir).then(setAvailableSkills).catch(() => {});
  }, [settings?.vaultDir]);

  // Re-fetch skill status + list (e.g. after creating a new skill).
  const refreshSkills = () => {
    const vault = settings?.vaultDir;
    if (!vault) return;
    api.skills(vault).then(setSkills).catch(() => {});
    api.listSkills(vault).then(setAvailableSkills).catch(() => {});
  };

  // Re-scan CLI paths and the model/reasoning options exposed by each agent.
  const refreshEnginePaths = async () => {
    const vault = settings?.vaultDir;
    const scan = await api.engineScan();
    setEngineScan(scan);
    setSkills((prev) => ({ ...prev, ...skillStatusFromEngineScan(scan) }));
    if (vault) {
      const [skillStatus, skillList] = await Promise.allSettled([api.skills(vault), api.listSkills(vault)]);
      if (skillStatus.status === "fulfilled") {
        setSkills((prev) => ({ ...prev, ...skillStatus.value, ...skillStatusFromEngineScan(scan) }));
      }
      if (skillList.status === "fulfilled") setAvailableSkills(skillList.value);
    }
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

  /* Updates settings optimistically, then persists the small patch to the server.
     localStorage is only updated once the server confirms the save, so a failed
     save (e.g. an unwritable config path) doesn't leave localStorage claiming a
     value that was never actually persisted. Rapid edits (e.g. typing in a text
     field) fire one save per keystroke; settingsSaveSeq tags each request so an
     older response that resolves after a newer one is ignored instead of
     clobbering localStorage/the error banner with stale data. */
  const changeSettings = (patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = mergeSettings(prev as Settings, patch);
      const seq = ++settingsSaveSeq.current;
      api.saveConfig(patch)
        .then(() => {
          if (seq !== settingsSaveSeq.current) return;
          saveSettings(next);
          setSettingsSaveError(null);
        })
        .catch((err) => {
          if (seq !== settingsSaveSeq.current) return;
          setSettingsSaveError(`Settings could not be saved: ${String(err?.message || err)}`);
        });
      return next;
    });
  };

  /* Updates visual preferences separately from model and vault configuration. */
  const changeDesign = (patch: Partial<DesignSettings>) => {
    setDesign((prev) => ({ ...prev, ...patch }));
  };

  /* Opens an independent tab using the active default mode and RAG preference. */
  const addTab = () => {
    const t = newTab(tabs, settings?.rag ?? false, defaultMode, settings?.vaultDir, active);
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
      return next.length ? next : [newTab([], settings?.rag ?? false, defaultMode, settings?.vaultDir)];
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
    const fresh = newTab([], settings?.rag ?? false, defaultMode, settings?.vaultDir);
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
  const confirmFillinWrite = (tab: Tab, questionId: string) => {
    const q = tab.fillinQuestions?.find(x => x.id === questionId);
    if (!q || !q.targetPath || !q.preview) return;
    requestVaultWrite(tab, q.targetPath, q.preview, "create", () => {
      updateTab(tab.id, t => ({
        writeConfirmed: true,
        fillinQuestions: t.fillinQuestions?.map(xq => xq.id === questionId ? { ...xq, written: true } : xq)
      }));
    });
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
  const confirmWrite = (tab: Tab) => {
    if (!tab.writePath) return;
    const content = tab.writePreview || tab.writeInput;
    if (!content) return;
    requestVaultWrite(tab, tab.writePath, content, "create", () => {
      updateTab(tab.id, { writeConfirmed: true });
    });
  };

  // ── Approval gateway ─────────────────────────────────────────────────────
  // The single path every vault write goes through: preview the target (server
  // mints a one-time token), let the user review a diff, and only then send the
  // tokened write. The server independently refuses any write without a valid,
  // path-matched, unexpired token, so this is enforced even if a future caller
  // forgets to route through here.

  /* Previews one write and opens the approval modal; does nothing until approved. */
  const requestVaultWrite = async (
    tab: Tab,
    path: string,
    content: string,
    action: "create" | "append" | "update",
    onWritten: () => void
  ) => {
    try {
      const p = await api.vaultPreview(path);
      if (!p.ok) {
        updateTab(tab.id, { error: p.error || "Could not preview this write." });
        return;
      }
      const newContent =
        action === "append" && p.exists && !p.tooLarge
          ? `${p.existingContent.replace(/\s+$/, "")}\n\n${content}`
          : content;
      setApproval({
        tabId: tab.id,
        path: p.path,
        exists: p.exists,
        existingContent: p.existingContent,
        tooLarge: p.tooLarge,
        newContent,
        token: p.token,
        busy: false,
        onWritten,
      });
    } catch (err: any) {
      updateTab(tab.id, { error: String(err?.message || err) });
    }
  };

  /* Consumes the approval token and performs the write the user just reviewed. */
  const approveWrite = async () => {
    if (!approval) return;
    setApproval((a) => (a ? { ...a, busy: true, error: undefined } : a));
    try {
      const res = await api.vaultWrite(approval.path, approval.newContent, approval.token);
      if (!res.ok) throw new Error(res.error || "Write failed");
      approval.onWritten();
      setApproval(null);
    } catch (err: any) {
      setApproval((a) => (a ? { ...a, busy: false, error: String(err?.message || err) } : a));
    }
  };

  const rejectWrite = () => setApproval(null);

  // ── Drafting-mode attachments ────────────────────────────────────────────

  /* Uploads a document; the server extracts its text and returns metadata only. */
  const handleAttach = async (tab: Tab, file: File) => {
    const res = await api.uploadAttachment(file);
    if (!res.ok || !res.id) {
      updateTab(tab.id, { error: res.error || "Upload failed." });
      return;
    }
    const meta: AttachmentMeta = { id: res.id, name: res.name!, size: res.size!, chars: res.chars!, truncated: Boolean(res.truncated) };
    updateTab(tab.id, (current) => ({ attachments: [...current.attachments, meta], error: undefined }));
  };

  const removeAttachment = (tab: Tab, id: string) => {
    updateTab(tab.id, (current) => ({ attachments: current.attachments.filter((a) => a.id !== id) }));
    api.deleteAttachment(id).catch(() => {});
  };

  // ── Write-to-vault document mode ─────────────────────────────────────────

  /* Uploads the document that Write to Vault's Document sub-mode analyzes. */
  const handleDocUpload = async (tab: Tab, file: File) => {
    const res = await api.uploadAttachment(file);
    if (!res.ok || !res.id) {
      updateTab(tab.id, { error: res.error || "Upload failed." });
      return;
    }
    const meta: AttachmentMeta = { id: res.id, name: res.name!, size: res.size!, chars: res.chars!, truncated: Boolean(res.truncated) };
    updateTab(tab.id, { docAttachment: meta, docProposals: [], error: undefined });
  };

  /* Analyzes the uploaded document and proposes vault writes for review. */
  const runDocPropose = (tab: Tab) => {
    if (!settings || !tab.docAttachment) return;
    runWriterStream(
      tab,
      "doc-propose",
      { attachmentId: tab.docAttachment.id, focus: tab.writeInput, settings: overrideSettingsBody(tab, settings) },
      { phase: "draft", error: undefined, writeConfirmed: false, docProposals: [] },
      {
        done: (data) => {
          try {
            const raw = data.text.trim();
            const firstBracket = raw.indexOf("[");
            const lastBracket = raw.lastIndexOf("]");
            if (firstBracket === -1 || lastBracket === -1) throw new Error("Invalid JSON returned");
            const proposals = JSON.parse(raw.substring(firstBracket, lastBracket + 1));
            updateTab(tab.id, {
              phase: "done",
              docProposals: proposals.map((p: any) => ({ ...p, id: uid(), status: "pending" })),
            });
          } catch (err: any) {
            updateTab(tab.id, { phase: "error", error: "Failed to parse proposals: " + err.message });
          }
        },
      }
    );
  };

  /* Sends one approved document proposal through the write-approval gateway. */
  const confirmDocWrite = (tab: Tab, proposalId: string) => {
    const p = tab.docProposals.find((x) => x.id === proposalId);
    if (!p || !p.targetPath || !p.content) return;
    requestVaultWrite(tab, p.targetPath, p.content, p.action, () => {
      updateTab(tab.id, (t) => ({
        writeConfirmed: true,
        docProposals: t.docProposals.map((xp) => (xp.id === proposalId ? { ...xp, status: "written" } : xp)),
      }));
    });
  };

  const dismissDocProposal = (tab: Tab, proposalId: string) => {
    updateTab(tab.id, (t) => ({
      docProposals: t.docProposals.map((xp) => (xp.id === proposalId ? { ...xp, status: "rejected" } : xp)),
    }));
  };

  // ── LaTeX output mode ─────────────────────────────────────────────────────

  /* Recompiles the (possibly edited) LaTeX source for a tab's answer. */
  const runLatexRecompile = async (tab: Tab, tex: string) => {
    updateTab(tab.id, { latexBusy: true, texSource: tex });
    try {
      const res = await api.latexCompile(tex);
      if (res.ok && res.compileId) {
        updateTab(tab.id, { latexCompileId: res.compileId, latexLog: "", latexBusy: false });
      } else {
        updateTab(tab.id, { latexCompileId: "", latexLog: res.log || res.hint || res.error || "Compilation failed.", latexBusy: false });
      }
    } catch (err: any) {
      updateTab(tab.id, { latexLog: String(err?.message || err), latexBusy: false });
    }
  };

  // active and right are declared at the top of App

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

  // Global keyboard shortcuts. Escape is left to each modal; while any dialog is
  // open we stay out of the way. Combos are chosen to avoid browser-reserved keys
  // (Ctrl+T/W/N/1-9), and both Ctrl and ⌘ are accepted so it works on every OS.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return;

      // The onboarding / first-run modals own the screen — nothing punches through them.
      const onboardingUp = !settings?.onboarded || (settings?.onboarded && !helpSeen);
      if (onboardingUp) return;

      // Settings toggles even while it's open, so the same key closes it again.
      if ((e.metaKey || e.ctrlKey) && e.key === "," && !quickOpen && !shortcutsOpen) {
        e.preventDefault();
        setSettingsOpen((o) => !o);
        return;
      }

      // Otherwise stay out of the way while any dialog is open (Escape closes them).
      if (settingsOpen || quickOpen || shortcutsOpen) return;

      // "?" opens the cheat-sheet, but never while typing in a field.
      if (e.key === "?" && !isEditableTarget(e.target)) {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }

      if (e.metaKey || e.ctrlKey) {
        if (e.key === "\\") { e.preventDefault(); toggleSplit(); return; }
        if (e.key === "." && active) {
          e.preventDefault();
          const order: TabMode[] = ["ask", "job", "write"];
          const next = order[(order.indexOf(active.mode) + 1) % order.length];
          patchTab(active.id, { mode: next });
          return;
        }
        return;
      }

      if (e.altKey) {
        if (e.key >= "1" && e.key <= "9") {
          const idx = Number(e.key) - 1;
          if (idx < tabs.length) { e.preventDefault(); setActiveId(tabs[idx].id); }
          return;
        }
        // e.code keeps the letter layout-stable (Alt can emit accented chars).
        if (e.code === "KeyT") { e.preventDefault(); addTab(); return; }
        if (e.code === "KeyW" && active) { e.preventDefault(); closeTab(active.id); return; }
        if (e.code === "KeyN") { e.preventDefault(); setQuickOpen((o) => !o); return; }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [settingsOpen, quickOpen, shortcutsOpen, settings?.onboarded, helpSeen, tabs, active, defaultMode]);

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
      engineScan={engineScan}
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
      onAttach={(file) => handleAttach(paneTab, file)}
      onRemoveAttachment={(id) => removeAttachment(paneTab, id)}
      onLatexRecompile={(tex) => runLatexRecompile(paneTab, tex)}
      onSummarize={() => runSummarize(paneTab)}
      onAutoPlace={() => runAutoPlace(paneTab)}
      onFillinScan={() => runFillinScan(paneTab)}
      onFillinWrite={(qid) => runFillinWrite(paneTab, qid)}
      onConfirmFillinWrite={(qid) => confirmFillinWrite(paneTab, qid)}
      onWriteCleanup={() => runWriteCleanup(paneTab)}
      onConfirmWrite={() => confirmWrite(paneTab)}
      onDocUpload={(file) => handleDocUpload(paneTab, file)}
      onDocPropose={() => runDocPropose(paneTab)}
      onDocWrite={(pid) => confirmDocWrite(paneTab, pid)}
      onDocDismiss={(pid) => dismissDocProposal(paneTab, pid)}
    />
  );

  return (
    <div className="app">
      {design.funEnabled && <FunBackground variant={design.funVariant} />}
      <header className="toolbar">
        <a className="logo" href="#" onClick={(e) => e.preventDefault()} title="Vault Assistant">
          <img className="logo-mark" src={logoSrc} alt="" aria-hidden="true" />
          {/* className="logo-mark" src={logoUrl} */}
          <span className="logo-text" aria-label="vault assistant">
            <span>vault</span>
            <span>assistant</span>
          </span>
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
                      title="Ctrl+\"
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
                      title="Alt+N"
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
                      title="Ctrl+,"
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
                title={`${split ? "Close split view" : "Split view"} (Ctrl+\\)`}
                onClick={toggleSplit}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <line x1="12" y1="4" x2="12" y2="20" />
                </svg>
              </button>
              <button
                className={`icon-btn ${quickOpen ? "active" : ""}`}
                title="Quick notes — reusable links & snippets (Alt+N)"
                onClick={() => setQuickOpen(true)}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                  <path d="M14 3v5h5M9 13h6M9 17h4" />
                </svg>
              </button>

              <button className="icon-btn" title="Settings (Ctrl+,)" onClick={() => setSettingsOpen(true)}>
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
          engineScan={engineScan}
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
          saveError={settingsSaveError}
          onDismissSaveError={() => setSettingsSaveError(null)}
          onDesignChange={changeDesign}
          onCreateSkill={createSkill}
          onRefreshSkills={refreshSkills}
          onRescanPaths={refreshEnginePaths}
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

      {shortcutsOpen && <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} />}

      {approval && (
        <ApprovalModal
          path={approval.path}
          exists={approval.exists}
          existingContent={approval.existingContent}
          tooLarge={approval.tooLarge}
          newContent={approval.newContent}
          busy={approval.busy}
          error={approval.error}
          onApprove={approveWrite}
          onReject={rejectWrite}
        />
      )}

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

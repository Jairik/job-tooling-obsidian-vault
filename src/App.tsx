import { useEffect, useRef, useState } from "react";
import {
  loadTabs,
  saveTabs,
  loadSettings,
  saveSettings,
  newTab,
  deriveTitleLocal,
  type Settings,
  type Tab,
} from "./lib/store";
import { api, streamPost, type ModelOption } from "./lib/api";
import { TabBar } from "./components/TabBar";
import { TabView } from "./components/TabView";
import { SettingsPanel } from "./components/SettingsPanel";
import { FunBackground, nextFunVariant, funLabel, type FunVariant } from "./components/FunBackground";

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
  const [skills, setSkills] = useState({ yc: false, humanizer: false, gemini: false });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">(
    () => (document.documentElement.dataset.theme as "dark" | "light") || "dark"
  );
  const [density, setDensity] = useState<"comfortable" | "compact">(
    () => (document.documentElement.dataset.density as "comfortable" | "compact") || "comfortable"
  );
  const [fun, setFun] = useState<boolean>(() => readLS("jt.fun") === "on");
  const [funVariant, setFunVariant] = useState<FunVariant>(
    () => (readLS("jt.funbg") as FunVariant) || "aurora"
  );
  const [split, setSplit] = useState<boolean>(() => readLS("jt.split") === "on");
  const [rightId, setRightId] = useState<string>("");

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

  // Fun mode (animated background) + its current variant.
  useEffect(() => {
    if (fun) document.documentElement.dataset.fun = "on";
    else delete document.documentElement.dataset.fun;
    writeLS("jt.fun", fun ? "on" : "off");
  }, [fun]);

  useEffect(() => {
    writeLS("jt.funbg", funVariant);
  }, [funVariant]);

  // Split view persistence.
  useEffect(() => {
    writeLS("jt.split", split ? "on" : "off");
  }, [split]);

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

  // Refresh skill availability whenever the vault changes.
  useEffect(() => {
    if (!settings?.vaultDir) return;
    api.skills(settings.vaultDir).then(setSkills).catch(() => {});
  }, [settings?.vaultDir]);

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

  const addTab = () => {
    const t = newTab(tabs, settings?.rag ?? false);
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

  const runGenerate = (tab: Tab) => {
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

    const overrideBody = tab.overrideEnabled ? tab.override : undefined;

    streamPost(
      `/api/tabs/${tab.id}/generate`,
      { jobDescription: tab.jobDescription, question: tab.question, yc: tab.yc, rag: tab.rag, settings: overrideBody },
      {
        phase: (d) => updateTab(tab.id, { phase: d.phase }),
        text: (d) =>
          updateTab(tab.id, (t) =>
            d.phase === "draft" ? { draft: t.draft + d.delta } : { answer: t.answer + d.delta }
          ),
        draft: (d) => updateTab(tab.id, { draft: d.text }),
        activity: (d) => updateTab(tab.id, (t) => ({ activity: [...t.activity, d] })),
        notice: (d) => updateTab(tab.id, { notice: d.message }),
        done: (d) => updateTab(tab.id, { answer: d.text, phase: "done" }),
        error: (d) => updateTab(tab.id, { error: d.message, phase: "error" }),
        session: () => {},
      },
      controller.signal
    )
      .catch((e) => {
        if (controller.signal.aborted) {
          updateTab(tab.id, (t) => ({ phase: t.answer || t.draft ? "done" : "idle" }));
        } else {
          updateTab(tab.id, { error: String(e?.message || e), phase: "error" });
        }
      })
      .finally(() => controllers.current.delete(tab.id));
  };

  const runFollowUp = (tab: Tab, text: string) => {
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
    const overrideBody = tab.overrideEnabled ? tab.override : undefined;

    streamPost(
      `/api/tabs/${tab.id}/message`,
      { text, rag: tab.rag, settings: overrideBody },
      {
        phase: (d) => updateTab(tab.id, { phase: d.phase }),
        text: (d) => updateTab(tab.id, (t) => ({ answer: t.answer + d.delta })),
        activity: (d) => updateTab(tab.id, (t) => ({ activity: [...t.activity, d] })),
        done: (d) =>
          updateTab(tab.id, (t) => ({
            answer: d.text,
            phase: "done",
            messages: [...t.messages, { role: "assistant", text: d.text }],
          })),
        error: (d) => updateTab(tab.id, { error: d.message, phase: "error" }),
        session: () => {},
      },
      controller.signal
    )
      .catch((e) => {
        if (controller.signal.aborted) updateTab(tab.id, { phase: "done" });
        else updateTab(tab.id, { error: String(e?.message || e), phase: "error" });
      })
      .finally(() => controllers.current.delete(tab.id));
  };

  const cancel = (id: string) => {
    controllers.current.get(id)?.abort();
    api.cancel(id).catch(() => {});
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

  const engineLabel = settings.engine === "gemini" ? "gemini · agy" : "claude code";
  const phase = active?.phase ?? "idle";
  const phaseTone =
    phase === "done" ? "ok" : phase === "error" ? "bad" : phase === "idle" ? "" : "warn";
  const phaseText: Record<string, string> = {
    idle: "idle",
    draft: "drafting",
    humanize: "humanizing",
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
      onPatch={(patch) => patchTab(paneTab.id, patch)}
      onGenerate={() => runGenerate(paneTab)}
      onFollowUp={(text) => runFollowUp(paneTab, text)}
      onCancel={() => cancel(paneTab.id)}
    />
  );

  return (
    <div className="app">
      {fun && <FunBackground variant={funVariant} />}
      <header className="topbar">
        <div className="brand">
          <span className="app-icon" title="Job Tooling">
            <span className="app-icon-mark">JT</span>
          </span>
          <div className="brand-text">
            <span className="kicker">grounded · obsidian vault</span>
            <span className="brand-title">Job Tooling</span>
          </div>
        </div>
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
          {fun && (
            <button
              className="pill pill--accent fun-cycle"
              title="Cycle background"
              onClick={() => setFunVariant((v) => nextFunVariant(v))}
            >
              ✨ {funLabel(funVariant)} ▸
            </button>
          )}
          <button
            className={`icon-btn ${split ? "active" : ""}`}
            title={split ? "Close split view" : "Split view"}
            onClick={toggleSplit}
          >
            ◫
          </button>
          <button
            className={`icon-btn ${fun ? "active" : ""}`}
            title={fun ? "Turn off fun mode" : "Fun mode"}
            onClick={() => setFun((f) => !f)}
          >
            ✨
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
          <button className="icon-btn" title="Settings" onClick={() => setSettingsOpen(true)}>
            ⚙
          </button>
        </div>
      </header>

      <TabBar
        tabs={tabs}
        activeId={active?.id ?? ""}
        onSelect={setActiveId}
        onAdd={addTab}
        onClose={closeTab}
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
          onChange={changeSettings}
          onClose={() => setSettingsOpen(false)}
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

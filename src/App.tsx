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

  const controllers = useRef(new Map<string, AbortController>());

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

  // Patch the active tab; live-rename it from content while it is still auto-named.
  const patchActive = (patch: Partial<Tab>) => {
    updateTab(active.id, (t) => {
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

  if (!settings) {
    return <div className="loading">Loading…</div>;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◆</span> Job Answer Studio
        </div>
        <div className="topbar-meta">
          <span className="meta-chip">
            {settings.engine === "gemini" ? "gemini · agy" : "claude code"}
          </span>
          {settings.engine === "claude" && (
            <>
              <span className="meta-chip">{settings.model.replace("claude-", "")}</span>
              <span className="meta-chip">{settings.effort} reasoning</span>
            </>
          )}
          {active?.rag && <span className="meta-chip meta-chip-rag" title="Retrieval-augmented — only relevant vault excerpts are sent">RAG</span>}
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

      <main className="content">
        {active && (
          <TabView
            key={active.id}
            tab={active}
            globalSettings={settings}
            models={models}
            engines={engines}
            skills={skills}
            onPatch={patchActive}
            onGenerate={() => runGenerate(active)}
            onFollowUp={(text) => runFollowUp(active, text)}
            onCancel={() => cancel(active.id)}
          />
        )}
      </main>

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
    </div>
  );
}

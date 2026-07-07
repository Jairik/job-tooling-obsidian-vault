#!/usr/bin/env bun
import React, { useEffect, useMemo, useRef, useState } from "react";
import { render, Box, Text, useApp, useInput, useStdin } from "ink";
import { api, getBaseUrl, type LogEntry, type MetaResult, type ServerSettings, type SkillInfo, type SkillStatus } from "./lib/api";
import { connectServer, ensureServer, type ServerHandle } from "./lib/server";
import { formatTuiHelp, parseTuiArgs } from "./lib/cli";
import { loadDotEnv } from "../shared/ports";
import { toBackendMode, nextBackendMode, type TuiMode, getTabBarInfo } from "./lib/modes";
import { newSession, uid, isRunning, type DocAction, type Session, type WriteMode } from "./lib/session";
import { createActions } from "./lib/actions";
import { createPendingApproval, approvalWritePayload, type PendingWriteApproval, type VaultPreview } from "./lib/approval";
import { mergeTuiSettings } from "./lib/settings";
import { useTerminalSize } from "./lib/use-terminal";
import { editInEditor } from "./lib/editor";
import { copyToClipboard } from "./lib/clipboard";
import { Header } from "./components/Header";
import { StatusBar } from "./components/StatusBar";
import { ConversationView } from "./components/ConversationView";
import { WriteView } from "./components/WriteView";
import { ApprovalView } from "./components/ApprovalView";
import { SettingsView } from "./components/SettingsView";
import { SkillsView } from "./components/SkillsView";
import { LogsView } from "./components/LogsView";
import { AttachView } from "./components/AttachView";

type Screen = "main" | "settings" | "skills" | "logs" | "attach";

interface PendingApproval extends PendingWriteApproval {
  busy?: boolean;
  error?: string;
  onWritten: () => void;
}

interface AppProps {
  server: ServerHandle;
  initialMode: TuiMode;
}

const WRITE_MODES: WriteMode[] = ["manual", "summarize", "fillin", "document"];

export function isTextInput(id: string): boolean {
  return (
    ["job", "extra", "question", "wsource", "wcontent", "followup", "wfocus", "docfocus", "docpath"].includes(id) ||
    id.startsWith("q:")
  );
}

export function isShortcutHintsToggle(
  input: string,
  key: { ctrl?: boolean; backspace?: boolean; delete?: boolean }
): boolean {
  if (!key.ctrl || key.backspace || key.delete) return false;
  return input === "h" || input === "\b" || input === "\x08";
}

function sessionFocusIds(session: Session): string[] {
  if (session.mode === "write") {
    if (session.writeMode === "summarize") return ["wsource", ...(session.writePreview ? ["wpath"] : [])];
    if (session.writeMode === "manual") return ["wpath", "wcontent", ...(session.writePreview ? ["answer"] : [])];
    if (session.writeMode === "fillin") return ["wfocus", "wdir", ...session.fillinQuestions.map((q) => `q:${q.id}`)];
    return ["docpath", "docfocus", ...session.docProposals.map((p) => `p:${p.id}`)];
  }
  const ids = session.mode === "job" ? ["job", "extra", "question"] : ["question"];
  if (session.answer || session.draft) ids.push("answer");
  if (session.phase === "done" && session.answer) ids.push("followup");
  return ids;
}

function answerHeight(rows: number, session: Session): number {
  const base = session.mode === "write" ? rows - 15 : rows - (session.mode === "job" ? 18 : 11);
  return Math.max(5, Math.min(18, base));
}

function TuiApp({ server, initialMode }: AppProps) {
  const { exit, suspendTerminal } = useApp();
  const { setRawMode } = useStdin();
  const size = useTerminalSize();
  const controllers = useRef(new Map<string, AbortController>());
  const [session, setSession] = useState<Session>(() => newSession(toBackendMode(initialMode)));
  const [screen, setScreen] = useState<Screen>("main");
  const [focusIndex, setFocusIndex] = useState(0);
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const settingsSaveSeq = useRef(0);
  const [meta, setMeta] = useState<MetaResult | null>(null);
  const [skills, setSkills] = useState<SkillStatus | null>(null);
  const [availableSkills, setAvailableSkills] = useState<SkillInfo[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [usage, setUsage] = useState<any>(null);
  const [defaultMode, setDefaultMode] = useState<TuiMode>(initialMode);
  const [viewDraft, setViewDraft] = useState(false);
  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const [notice, setNotice] = useState<string | undefined>();

  const focusIds = useMemo(() => sessionFocusIds(session), [session]);
  const focusId = focusIds[Math.min(focusIndex, Math.max(0, focusIds.length - 1))] || "";

  const update = (fn: (s: Session) => Partial<Session>) => {
    setSession((cur) => ({ ...cur, ...fn(cur) }));
  };

  const refreshSkills = (vault = settings?.vaultDir) => {
    if (!vault) return;
    api.skillStatus(vault).then(setSkills).catch(() => {});
    api.listSkills(vault).then(setAvailableSkills).catch(() => {});
  };

  const refreshLogs = () => {
    api.getLogs().then(setLogs).catch(() => {});
  };

  const refreshUsage = () => {
    if (!settings) return;
    const model = settings.engineModels?.[settings.engine] || settings.model || "";
    api.usage({ engine: settings.engine, model }).then(setUsage).catch((err) => setUsage({ ok: false, error: String(err?.message || err) }));
  };

  useEffect(() => {
    Promise.all([api.meta(), api.getConfig()])
      .then(([loadedMeta, config]) => {
        setMeta(loadedMeta);
        setSettings(config);
        setSession((cur) => ({ ...cur, rag: config.rag }));
        refreshSkills(config.vaultDir);
        refreshLogs();
      })
      .catch((err) => {
        setNotice(`Could not load config: ${String(err?.message || err)}`);
      });
    return () => {
      for (const [id, controller] of controllers.current) {
        controller.abort();
        api.cancel(id).catch(() => {});
      }
      controllers.current.clear();
      server.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setFocusIndex((idx) => Math.min(idx, Math.max(0, focusIds.length - 1)));
  }, [focusIds.length]);

  // settingsSaveSeq tags each save so an older response that resolves after a
  // newer one (e.g. rapid edits to a text field) is ignored instead of
  // clobbering the settings state with stale data.
  const changeSettings = (patch: Partial<ServerSettings>) => {
    setSettings((prev) => {
      if (!prev) return prev;
      const next = mergeTuiSettings(prev, patch);
      const seq = ++settingsSaveSeq.current;
      api.saveConfig(patch).then((saved) => {
        if (seq !== settingsSaveSeq.current) return;
        setSettings(saved);
        if (patch.vaultDir) refreshSkills(saved.vaultDir);
      }).catch((err) => {
        if (seq !== settingsSaveSeq.current) return;
        setNotice(`Settings save failed: ${String(err?.message || err)}`);
      });
      return next;
    });
  };

  const requestWrite = async (request: {
    path: string;
    content: string;
    action: DocAction;
    onWritten: () => void;
  }) => {
    try {
      const preview = (await api.vaultPreview(request.path)) as VaultPreview;
      if (!preview.ok) {
        update(() => ({ error: preview.error || "Could not preview this write." }));
        return;
      }
      setApproval({ ...createPendingApproval(preview, request.content, request.action), onWritten: request.onWritten });
    } catch (err: any) {
      update(() => ({ error: String(err?.message || err) }));
    }
  };

  const approveWrite = async () => {
    if (!approval) return;
    setApproval((cur) => (cur ? { ...cur, busy: true, error: undefined } : cur));
    try {
      const payload = approvalWritePayload(approval);
      const res = await api.vaultWrite(payload.path, payload.content, payload.token);
      if (!res.ok) throw new Error(res.error || "Write failed");
      approval.onWritten();
      setApproval(null);
      setNotice(`Written: ${payload.path}`);
    } catch (err: any) {
      setApproval((cur) => (cur ? { ...cur, busy: false, error: String(err?.message || err) } : cur));
    }
  };

  const actions = settings
    ? createActions({
        settings,
        controllers: controllers.current,
        update,
        requestWrite,
      })
    : null;

  const patchSession = (patch: Partial<Session>) => setSession((cur) => ({ ...cur, ...patch }));

  const cancelSessionRequest = (id: string) => {
    const controller = controllers.current.get(id);
    if (!controller) return;
    controller.abort();
    controllers.current.delete(id);
    api.cancel(id).catch(() => {});
  };

  const switchMode = (mode = nextBackendMode(session.mode)) => {
    cancelSessionRequest(session.id);
    setSession((cur) => ({ ...newSession(mode, cur), mode }));
    setFocusIndex(0);
  };

  const cycleWriteMode = () => {
    cancelSessionRequest(session.id);
    setSession((cur) => {
      const idx = WRITE_MODES.indexOf(cur.writeMode);
      return {
        ...cur,
        id: uid(),
        writeMode: WRITE_MODES[(idx + 1) % WRITE_MODES.length],
        writePreview: "",
        writeConfirmed: false,
        activity: [],
        phase: "idle",
        notice: undefined,
        error: undefined,
      };
    });
    setFocusIndex(0);
  };

  const openEditor = async (field: "question" | "jobDescription" | "extraContext" | "writeInput" | "texSource") => {
    const current = session[field] || "";
    const next = await editInEditor(current, { setRawMode, suspendTerminal, ext: field === "texSource" ? ".tex" : ".md" });
    patchSession({ [field]: next } as Partial<Session>);
  };

  const toggleShortcutHints = () => {
    if (!settings) return;
    const next = settings.tuiShortcutsVisible === false;
    changeSettings({ tuiShortcutsVisible: next });
    setNotice(next ? "Shortcut hints shown" : "Shortcut hints hidden");
  };

  useInput((input, key) => {
    if (isShortcutHintsToggle(input, key)) {
      toggleShortcutHints();
      return;
    }
    if (approval) return;
    if (screen !== "main") return;

    // Shift+Tab cycles Ask → Draft → Write; Tab moves focus between fields.
    // Both always transmit (backtab = \x1b[Z) and never collide with typing.
    if (key.tab && key.shift) return switchMode();
    if (key.tab) {
      setFocusIndex((idx) => (idx + 1) % Math.max(1, focusIds.length));
      return;
    }

    // Plain keys: the only global one is the draft-view toggle, and it must not
    // fire while a text field is focused (otherwise typing "d" flips the pane).
    if (!key.ctrl && !key.meta) {
      if (input === "d" && session.mode === "job" && !isTextInput(focusId)) setViewDraft((v) => !v);
      return;
    }

    // Ctrl-combos. Text inputs ignore Ctrl, so these stay safe while a field is
    // focused. The editor (Ctrl+O) is intentionally NOT handled here — each
    // MultilineInput owns its own Ctrl+O so it opens the right field exactly once.
    const inWrite = session.mode === "write";
    if (input === "q") {
      server.stop();
      exit();
    } else if (input === "s") {
      refreshUsage();
      setScreen("settings");
    } else if (input === "k") {
      setScreen("skills");
    } else if (input === "b") {
      refreshLogs();
      setScreen("logs");
    } else if (input === "t" && inWrite) {
      cycleWriteMode();
    } else if (input === "r") {
      patchSession({ rag: !session.rag });
    } else if (input === "l" && !inWrite) {
      patchSession({ latex: !session.latex });
    } else if (input === "u" && !inWrite && actions) {
      actions.runCleanup(session);
    } else if (input === "x" && actions && !focusId.startsWith("p:")) {
      actions.cancel(session.id);
    } else if (input === "a" && session.mode === "job") {
      setScreen("attach");
    } else if (input === "p" && !(inWrite && session.writeMode === "manual")) {
      // Ctrl+P in Write→manual belongs to auto-place (WriteView); copy elsewhere.
      const text = session.answer || session.draft || session.writePreview || session.writeInput;
      copyToClipboard(text).then((res) => setNotice(res.ok ? `Copied via ${res.method}` : "Copy failed"));
    }
  });

  if (!settings || !meta || !actions) {
    return (
      <Box flexDirection="column">
        <Text color="cyan">Vault Assistant TUI</Text>
        <Text dimColor>Connecting to {getBaseUrl()}…</Text>
        {notice ? <Text color="red">{notice}</Text> : null}
      </Box>
    );
  }

  const showShortcuts = settings.tuiShortcutsVisible !== false;
  const hint = showShortcuts
    ? screen === "main"
      ? `Tab field · Shift+Tab mode${session.mode === "write" ? " · Ctrl+T submode" : ""} · Ctrl+S settings · Ctrl+K skills · Ctrl+B logs · Ctrl+C quit`
      : "Esc close"
    : "";

  return (
    <Box flexDirection="column" width={size.columns}>
      <Header mode={session.mode} settings={settings} skillsCount={session.skills.length} rag={session.rag} />
      <Box borderStyle="single" borderColor="gray" flexDirection="row" justifyContent="space-between" paddingX={1}>
        <Box>
          <Text dimColor>Mode: </Text>
          {getTabBarInfo(session.mode, session.writeMode).modes.map((m, idx, arr) => (
            <React.Fragment key={m.key}>
              <Text bold={m.isActive} color={m.isActive ? "cyan" : "gray"}>
                {m.label}
              </Text>
              {idx < arr.length - 1 ? <Text dimColor> · </Text> : null}
            </React.Fragment>
          ))}
          {session.mode === "write" && (
            <>
              <Text dimColor>  (Submodes: </Text>
              {getTabBarInfo(session.mode, session.writeMode).submodes.map((sm, idx, arr) => (
                <React.Fragment key={sm.key}>
                  <Text bold={sm.isActive} color={sm.isActive ? "yellow" : "gray"}>
                    {sm.label}
                  </Text>
                  {idx < arr.length - 1 ? <Text dimColor> · </Text> : null}
                </React.Fragment>
              ))}
              <Text dimColor>)</Text>
            </>
          )}
        </Box>
        <Box>
          <Text dimColor>Focus: </Text>
          <Text color="cyan">{focusId || "none"}</Text>
        </Box>
      </Box>

      {approval ? (
        <ApprovalView
          approval={approval}
          width={size.columns}
          height={size.rows - 5}
          showShortcuts={showShortcuts}
          onApprove={approveWrite}
          onReject={() => setApproval(null)}
        />
      ) : screen === "settings" ? (
        <SettingsView
          settings={settings}
          models={meta.models}
          engines={meta.engines}
          defaultMode={defaultMode}
          usage={usage}
          onPatch={changeSettings}
          onDefaultModeChange={setDefaultMode}
          onRefreshUsage={refreshUsage}
          showShortcuts={showShortcuts}
          onClose={() => setScreen("main")}
        />
      ) : screen === "skills" ? (
        <SkillsView
          availableSkills={availableSkills}
          selected={session.skills}
          status={skills}
          onSelectedChange={(selected) => patchSession({ skills: selected })}
          onRefresh={() => refreshSkills()}
          showShortcuts={showShortcuts}
          onCreateSkill={async (payload) => {
            const res = await api.createSkill(payload);
            if (!res.ok) throw new Error(res.error || "Skill creation failed.");
            refreshSkills();
          }}
          onClose={() => setScreen("main")}
        />
      ) : screen === "logs" ? (
        <LogsView
          logs={logs}
          onRefresh={refreshLogs}
          onClear={() => {
            api.clearLogs().then(() => setLogs([])).catch(() => {});
          }}
          showShortcuts={showShortcuts}
          onClose={() => setScreen("main")}
        />
      ) : screen === "attach" ? (
        <AttachView
          onSubmit={(path) => {
            actions.attachDraftDocument(session, path).then(() => setScreen("main"));
          }}
          showShortcuts={showShortcuts}
          onClose={() => setScreen("main")}
        />
      ) : session.mode === "write" ? (
        <WriteView
          session={session}
          settings={settings}
          patch={patchSession}
          actions={actions}
          focusId={focusId}
          active={screen === "main"}
          width={size.columns}
          previewHeight={answerHeight(size.rows, session)}
          showShortcuts={showShortcuts}
          openEditor={() => openEditor("writeInput")}
        />
      ) : (
        <ConversationView
          session={session}
          settings={settings}
          patch={patchSession}
          actions={actions}
          focusId={focusId}
          width={size.columns}
          answerHeight={answerHeight(size.rows, session)}
          viewDraft={viewDraft}
          showShortcuts={showShortcuts}
          openEditor={openEditor}
        />
      )}

      <StatusBar
        phase={session.phase}
        hint={hint}
        notice={notice || session.notice}
        error={session.error}
      />
      {showShortcuts && isRunning(session.phase) ? <Text dimColor>Ctrl+X cancels the current request.</Text> : null}
    </Box>
  );
}

async function main() {
  loadDotEnv();
  let parsed;
  try {
    parsed = parseTuiArgs(process.argv.slice(2));
  } catch (err: any) {
    console.error(String(err?.message || err));
    console.error(formatTuiHelp());
    process.exit(1);
  }

  if (parsed.help) {
    console.log(formatTuiHelp());
    return;
  }

  const server = parsed.serverUrl ? await connectServer(parsed.serverUrl) : await ensureServer(parsed.port);
  render(<TuiApp server={server} initialMode={parsed.initialMode} />, { alternateScreen: parsed.fullScreen });
}

// Only launch when run directly (`bun tui/main.tsx`). Guarding this keeps `import`
// side-effect-free so tests can pull in helpers like `isTextInput` without spawning
// a server and rendering the app.
if (import.meta.main) await main();

// The settings modal. A centered dialog with a left-nav of pages that edit the
// global Settings (engine/model/effort, vault dirs, persona, RAG, etc.), the
// theme/density prefs, and the local DesignSettings (Appearance). Changes are
// lifted to App, which persists them; this component holds no source of truth.
import { useEffect, useRef, useState, lazy, Suspense, type ReactNode } from "react";
import type { Settings, TabMode, DesignSettings, SkillInfo, LogEntry } from "../lib/store";
import {
  effectiveCleanupModel,
  effectiveCleanupReasoning,
  effectiveEngineModel,
  effectiveEngineReasoning,
} from "../../shared/settings";
import type { EngineScanResult } from "../../shared/engine-scan";
import { buildJobPersona, buildAskPersona } from "../../shared/persona";
import { PREPACKAGED_SKILLS } from "../../shared/prepackaged-skills";
import { api, type ModelOption } from "../lib/api";
import { OTHER_OPTION, modelOptionsForEngine, optionValue, reasoningOptionsForEngine } from "../lib/engine-options";
import { loadFont } from "../lib/fonts";
import { DesignSettingsSection } from "./DesignSettingsSection";

const UsagePanel = lazy(() => import("./UsagePanel").then((module) => ({ default: module.UsagePanel })));
const LogsView = lazy(() => import("./LogsView").then((module) => ({ default: module.LogsView })));
import { HelpGuide } from "./HelpGuide";

type CreateSkillResult = { ok: boolean; error?: string };
type PageId = "general" | "vault" | "persona" | "engine" | "rag" | "skills" | "appearance" | "logs" | "help";

interface Props {
  settings: Settings;
  models: ModelOption[];
  engines: ModelOption[];
  engineScan: EngineScanResult | null;
  skills: { humanizer: boolean; gemini: boolean; opencode: boolean; cursor: boolean; copilot: boolean; codex: boolean };
  availableSkills: SkillInfo[];
  logs: LogEntry[];
  defaultMode: TabMode;
  design: DesignSettings;
  theme: "dark" | "light";
  density: "comfortable" | "compact";
  onThemeChange: (theme: "dark" | "light") => void;
  onDensityChange: (density: "comfortable" | "compact") => void;
  onDefaultModeChange: (mode: TabMode) => void;
  onChange: (patch: Partial<Settings>) => void;
  onDesignChange: (patch: Partial<DesignSettings>) => void;
  onCreateSkill: (payload: { name: string; description: string; body: string; scope: "user" | "vault" }) => Promise<CreateSkillResult>;
  onRefreshSkills: () => void;
  onRescanPaths: () => Promise<void>;
  onClearLogs: () => void;
  onClose: () => void;
  initialPage?: PageId;
}

interface VaultState {
  valid: boolean;
  foundDirs: string[];
  message?: string;
}

// Compact status indicator: a small colored dot that reveals its full status
// text on hover/focus, keeping the panel uncluttered while detail stays a hover away.
/* Shows a compact available/unavailable indicator with explanatory hover text. */
function StatusTip({ ok, tip, label }: { ok: boolean; tip: string; label?: string }) {
  return (
    <span className={`status-tip ${ok ? "ok" : "bad"}`} data-tip={tip} tabIndex={0} aria-label={tip}>
      {label && <span className="status-tip-label">{label}</span>}
      <span className="status-tip-dot" />
    </span>
  );
}

/* A pill toggle switch matching the redesign's settings rows. */
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle s-row-ctrl">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" />
      <span className="toggle-thumb" />
    </label>
  );
}

const NAV: { group: string; items: { id: PageId; label: string; icon: ReactNode }[] }[] = [
  {
    group: "Workspace",
    items: [
      { id: "general", label: "General", icon: (<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>) },
      { id: "vault", label: "Vault", icon: (<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>) },
      { id: "persona", label: "Persona", icon: (<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>) },
    ],
  },
  {
    group: "AI",
    items: [
      { id: "engine", label: "AI Engine", icon: (<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>) },
      { id: "rag", label: "RAG / Retrieval", icon: (<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>) },
      { id: "skills", label: "Skills", icon: (<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>) },
    ],
  },
  {
    group: "Interface",
    items: [
      { id: "appearance", label: "Appearance", icon: (<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>) },
      { id: "logs", label: "Logs", icon: (<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>) },
    ],
  },
  {
    group: "Help",
    items: [
      { id: "help", label: "Getting started", icon: (<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>) },
    ],
  },
];

const PAGE_TITLE: Record<PageId, string> = {
  general: "General", vault: "Vault", persona: "Persona", engine: "AI Engine",
  rag: "RAG / Retrieval", skills: "Skills", appearance: "Appearance", logs: "Logs",
  help: "Getting started",
};

/* Maps an internal engine identifier to the executable users need to install. */
function engineCliName(engine: Settings["engine"]): string {
  if (engine === "gemini") return "agy";
  return engine;
}

function skillMeta(skill: SkillInfo): string {
  const parts: string[] = [];
  if (skill.estimatedTokens) {
    parts.push(`~${skill.estimatedTokens.toLocaleString()} tokens`);
  } else if (skill.chars) {
    parts.push(`${skill.chars.toLocaleString()} chars`);
  }
  if (skill.tooLarge) parts.push("too large to embed");
  if (skill.hasSupportingFiles) parts.push("SKILL.md only; supporting files are not embedded");
  return parts.join(" | ");
}

/* Provides configuration for engines, retrieval, vault paths, skills, and visual design. */
export function SettingsPanel({
  settings,
  models,
  engines,
  engineScan,
  skills,
  availableSkills,
  logs,
  defaultMode,
  design,
  theme,
  density,
  onThemeChange,
  onDensityChange,
  onDefaultModeChange,
  onChange,
  onDesignChange,
  onCreateSkill,
  onRefreshSkills,
  onRescanPaths,
  onClearLogs,
  onClose,
  initialPage = "general",
}: Props) {
  const [page, setPage] = useState<PageId>(initialPage);
  const [vaultInput, setVaultInput] = useState(settings.vaultDir);
  const [vault, setVault] = useState<VaultState | null>(null);
  const [skillFilter, setSkillFilter] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
  const [scanError, setScanError] = useState("");
  const [customModelEngine, setCustomModelEngine] = useState<Settings["engine"] | null>(null);
  const [customReasoningEngine, setCustomReasoningEngine] = useState<Settings["engine"] | null>(null);
  const [customCleanupModelEngine, setCustomCleanupModelEngine] = useState<Settings["engine"] | null>(null);
  const [customCleanupReasoningEngine, setCustomCleanupReasoningEngine] = useState<Settings["engine"] | null>(null);

  // "Create skill" flow: describe → agent writes → edit or agent-rewrite → save.
  const [skillFormOpen, setSkillFormOpen] = useState(false);
  const [skillDescribe, setSkillDescribe] = useState(""); // plain-language request
  const [skillFeedback, setSkillFeedback] = useState(""); // agent-rewrite instructions
  const [skillName, setSkillName] = useState("");
  const [skillDesc, setSkillDesc] = useState("");
  const [skillBody, setSkillBody] = useState("");
  const [skillScope, setSkillScope] = useState<"user" | "vault">("user");
  const [skillDraftReady, setSkillDraftReady] = useState(false); // a draft exists to edit/save
  const [skillGenBusy, setSkillGenBusy] = useState(false); // a generate/rewrite stream is live
  const [skillPreview, setSkillPreview] = useState(""); // live document while it streams
  const [skillBusy, setSkillBusy] = useState(false); // save in progress
  const [skillError, setSkillError] = useState("");
  const [skillOk, setSkillOk] = useState("");
  const skillAbort = useRef<AbortController | null>(null);
  const currentModel = effectiveEngineModel(settings);
  const currentReasoning = effectiveEngineReasoning(settings);
  const currentCleanupModel = effectiveCleanupModel(settings);
  const currentCleanupReasoning = effectiveCleanupReasoning(settings);
  const currentEngineScan = engineScan?.engines?.[settings.engine];
  const modelOptions = modelOptionsForEngine(engineScan, settings.engine, models);
  const reasoningOptions = reasoningOptionsForEngine(engineScan, settings.engine);
  const cleanupModelOptions = modelOptionsForEngine(engineScan, settings.engine, models);
  const cleanupReasoningOptions = reasoningOptionsForEngine(engineScan, settings.engine);
  const modelSelectValue = optionValue(currentModel, modelOptions, customModelEngine === settings.engine);
  const reasoningSelectValue = optionValue(currentReasoning, reasoningOptions, customReasoningEngine === settings.engine);
  const cleanupModelSelectValue = optionValue(
    currentCleanupModel,
    cleanupModelOptions,
    customCleanupModelEngine === settings.engine
  );
  const cleanupReasoningSelectValue = optionValue(
    currentCleanupReasoning,
    cleanupReasoningOptions,
    customCleanupReasoningEngine === settings.engine
  );
  const selectedEngineAvailable = Boolean(
    settings.engine === "claude" ||
    currentEngineScan?.available ||
    Boolean(skills[settings.engine as keyof typeof skills])
  );

  /* Updates only the selected engine's model, preserving choices for other engines. */
  const setEngineModel = (model: string) => {
    const engineModels = { ...(settings.engineModels ?? {}), [settings.engine]: model };
    onChange({
      engineModels,
      ...(settings.engine === "claude" ? { model } : {}),
    });
  };

  /* Updates only the selected engine's reasoning preference. */
  const setEngineReasoning = (reasoning: string) => {
    const engineReasoning = { ...(settings.engineReasoning ?? {}), [settings.engine]: reasoning };
    const effort =
      reasoning === "low" || reasoning === "medium" || reasoning === "high" ? reasoning : settings.effort;
    onChange({
      engineReasoning,
      ...(settings.engine === "claude" ? { effort } : {}),
    });
  };

  /* Updates only the selected engine's cleanup model. */
  const setCleanupModel = (model: string) => {
    const cleanupModels = { ...(settings.cleanupModels ?? {}), [settings.engine]: model };
    onChange({
      cleanupModels,
      ...(settings.engine === "claude" ? { cleanupModel: model } : {}),
    });
  };

  /* Updates only the selected engine's cleanup reasoning preference. */
  const setCleanupReasoning = (reasoning: string) => {
    const cleanupReasoning = { ...(settings.cleanupReasoning ?? {}), [settings.engine]: reasoning };
    onChange({ cleanupReasoning });
  };

  /* Refreshes local CLI path detection and the model/reasoning option scan. */
  const rescanPaths = async () => {
    if (scanBusy) return;
    setScanBusy(true);
    setScanError("");
    try {
      await onRescanPaths();
    } catch (err) {
      setScanError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanBusy(false);
    }
  };

  /* Stops an in-flight generation both locally and on the server. */
  const stopSkillGeneration = () => {
    skillAbort.current?.abort();
    api.cancel("__skill_creator__").catch(() => {});
    setSkillGenBusy(false);
  };

  // Stream a generated or rewritten SKILL.md into the editable draft fields. The
  // document is shown live as it streams; the parsed name/description/body land in
  // the editable fields when the run finishes.
  /* Runs the skill-creator over the description (generate) or current draft (rewrite). */
  const runSkillGeneration = (mode: "generate" | "rewrite") => {
    if (skillGenBusy) return;
    setSkillError("");
    setSkillOk("");
    setSkillPreview("");
    setSkillGenBusy(true);
    const controller = new AbortController();
    skillAbort.current = controller;

    const payload =
      mode === "rewrite"
        ? {
            description: skillDescribe,
            current: { name: skillName, description: skillDesc, body: skillBody },
            feedback: skillFeedback,
          }
        : { description: skillDescribe };

    api
      .generateSkill(
        payload,
        {
          text: (d) => setSkillPreview((p) => p + (d.delta ?? "")),
          done: (d) => {
            setSkillName(d.name ?? "");
            setSkillDesc(d.description ?? "");
            setSkillBody(d.body ?? "");
            setSkillDraftReady(true);
            setSkillGenBusy(false);
            if (mode === "rewrite") setSkillFeedback("");
            if (!d.name) setSkillError("Generated a skill but couldn't read a name. Set one before saving.");
          },
          error: (d) => {
            setSkillError(d.message || "Skill generation failed.");
            setSkillGenBusy(false);
          },
        },
        controller.signal
      )
      .catch((e) => {
        if (!controller.signal.aborted) setSkillError(String(e));
        setSkillGenBusy(false);
      })
      .finally(() => {
        skillAbort.current = null;
      });
  };

  /* Clears the entire create-skill flow back to its initial state. */
  const resetSkillForm = () => {
    stopSkillGeneration();
    setSkillFormOpen(false);
    setSkillDescribe("");
    setSkillFeedback("");
    setSkillName("");
    setSkillDesc("");
    setSkillBody("");
    setSkillPreview("");
    setSkillDraftReady(false);
    setSkillError("");
  };

  /* Persists the current (possibly hand-edited) draft via the create endpoint. */
  const submitSkill = async () => {
    setSkillBusy(true);
    setSkillError("");
    setSkillOk("");
    const res = await onCreateSkill({ name: skillName, description: skillDesc, body: skillBody, scope: skillScope });
    setSkillBusy(false);
    if (res.ok) {
      setSkillOk(`Created "${skillName.trim().toLowerCase()}".`);
      resetSkillForm();
    } else {
      setSkillError(res.error || "Failed to create skill.");
    }
  };

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(async () => {
      const res = await api.validateVault(vaultInput);
      if (!cancelled) setVault(res);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [vaultInput]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Load selected font when it changes.
  useEffect(() => {
    if (design.fontFamily !== "system") {
      loadFont(design.fontFamily);
    }
  }, [design.fontFamily]);

  // Abort any in-flight skill generation if the panel unmounts mid-stream.
  useEffect(() => () => skillAbort.current?.abort(), []);

  const fq = skillFilter.trim().toLowerCase();
  const shownSkills = fq
    ? availableSkills.filter((s) => s.name.toLowerCase().includes(fq) || (s.description ?? "").toLowerCase().includes(fq))
    : availableSkills;

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="settings-dialog" onClick={(e) => e.stopPropagation()}>
        <nav className="s-nav">
          <div className="s-nav-hd">Settings</div>
          {NAV.map((grp) => (
            <div className="s-nav-group" key={grp.group}>
              <span className="s-nav-group-lbl">{grp.group}</span>
              {grp.items.map((item) => (
                <button
                  key={item.id}
                  className={`s-nav-item ${page === item.id ? "active" : ""}`}
                  onClick={() => setPage(item.id)}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="s-pane">
          <div className="s-pane-hd">
            <span className="s-pane-title">{PAGE_TITLE[page]}</span>
            <button className="s-close" onClick={onClose} aria-label="Close settings">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className="s-body">
            {/* ── GENERAL ── */}
            {page === "general" && (
              <div className="s-page">
                <div className="s-section">
                  <span className="s-section-lbl">Behavior</span>
                  <div className="s-row">
                    <div>
                      <div className="s-row-label">Default tab mode</div>
                      <div className="s-row-desc">Mode new tabs open in (each tab still has its own toggle)</div>
                    </div>
                    <select
                      className="s-select s-row-ctrl"
                      value={defaultMode}
                      onChange={(e) => onDefaultModeChange(e.target.value as TabMode)}
                    >
                      <option value="ask">Ask the vault</option>
                      <option value="job">Drafting mode</option>
                    </select>
                  </div>
                  <div className="s-row">
                    <div>
                      <div className="s-row-label">Toolbar dropdown</div>
                      <div className="s-row-desc">Collapse the toolbar controls into a compact menu</div>
                    </div>
                    <Toggle checked={design.toolbarDropdown} onChange={(v) => onDesignChange({ toolbarDropdown: v })} />
                  </div>
                </div>
              </div>
            )}

            {/* ── VAULT ── */}
            {page === "vault" && (
              <div className="s-page">
                <div className="s-section">
                  <span className="s-section-lbl">Location</span>
                  <div className="s-field">
                    <div className="s-field-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      Vault / context repo
                      {vault && (
                        <span style={{ marginLeft: "auto" }}>
                          <StatusTip
                            ok={vault.valid}
                            tip={
                              vault.valid
                                ? `Valid: ${vault.foundDirs.length} context dir${vault.foundDirs.length === 1 ? "" : "s"} found`
                                : vault.message || "Invalid path"
                            }
                          />
                        </span>
                      )}
                    </div>
                    <div className="s-field-desc">Path to your Obsidian vault root</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        className="s-input"
                        type="text"
                        value={vaultInput}
                        spellCheck={false}
                        onChange={(e) => setVaultInput(e.target.value)}
                        onBlur={() => onChange({ vaultDir: vaultInput })}
                        style={{ flex: 1 }}
                      />
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: "6px 12px", whiteSpace: "nowrap" }}
                        onClick={async () => {
                          const res = await api.selectDirectory("Select Vault Directory", vaultInput);
                          if (res && res.path) {
                            setVaultInput(res.path);
                            onChange({ vaultDir: res.path });
                          }
                        }}
                      >
                        Browse...
                      </button>
                    </div>
                  </div>
                  <div className="s-field">
                    <div className="s-field-label">Extra context dirs</div>
                    <div className="s-field-desc">Extra directories to include, one per line</div>
                    <div style={{ display: "flex", gap: 8, flexDirection: "column" }}>
                      <textarea
                        className="s-textarea"
                        rows={3}
                        spellCheck={false}
                        value={settings.extraDirs.join("\n")}
                        onChange={(e) =>
                          onChange({ extraDirs: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })
                        }
                      />
                      <button
                        type="button"
                        className="btn"
                        style={{ alignSelf: "flex-start", padding: "6px 12px" }}
                        onClick={async () => {
                          const res = await api.selectDirectory("Select Extra Context Directory");
                          if (res && res.path) {
                            const newDirs = [...settings.extraDirs, res.path];
                            const uniqueDirs = Array.from(new Set(newDirs)).map((s) => s.trim()).filter(Boolean);
                            onChange({ extraDirs: uniqueDirs });
                          }
                        }}
                      >
                        Browse and add...
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── PERSONA ── */}
            {page === "persona" && (
              <div className="s-page">
                <div className="s-section">
                  <span className="s-section-lbl">Profile</span>
                  <div className="s-field">
                    <div className="s-field-label">Your name</div>
                    <div className="s-field-desc">Used when generating the system prompt.</div>
                    <input
                      className="s-input"
                      type="text"
                      value={settings.userName}
                      spellCheck={false}
                      placeholder="Jane Doe"
                      onChange={(e) => onChange({ userName: e.target.value })}
                    />
                  </div>
                  <div className="s-field">
                    <div className="s-field-label">Your role</div>
                    <div className="s-field-desc">How you'd describe yourself professionally.</div>
                    <input
                      className="s-input"
                      type="text"
                      value={settings.userRole}
                      spellCheck={false}
                      placeholder="a software engineer"
                      onChange={(e) => onChange({ userRole: e.target.value })}
                    />
                  </div>
                  <div className="s-field">
                    <div className="s-field-label">Voice notes</div>
                    <div className="s-field-desc">Optional tone/background notes folded into the prompt.</div>
                    <textarea
                      className="s-textarea"
                      rows={2}
                      spellCheck={false}
                      value={settings.personaNotes}
                      onChange={(e) => onChange({ personaNotes: e.target.value })}
                    />
                  </div>
                </div>
                <div className="s-section">
                  <span className="s-section-lbl">Ask prompt</span>
                  <div className="s-field">
                    <div className="s-field-label">System Prompt Ask Mode</div>
                    <div className="s-field-desc">
                      Injected into every Ask-mode answer. This is the default mode for new tabs.
                    </div>
                    <textarea
                      className="s-textarea"
                      rows={9}
                      spellCheck={false}
                      value={settings.askPersona}
                      onChange={(e) => onChange({ askPersona: e.target.value })}
                    />
                    <button
                      className="btn"
                      onClick={() =>
                        onChange({
                          askPersona: buildAskPersona({
                            userName: settings.userName,
                            userRole: settings.userRole,
                            personaNotes: settings.personaNotes,
                          }),
                        })
                      }
                    >
                      Regenerate from profile
                    </button>
                  </div>
                </div>
                <div className="s-section">
                  <span className="s-section-lbl">Drafting prompt</span>
                  <div className="s-field">
                    <div className="s-field-label">System Prompt Draft Mode</div>
                    <div className="s-field-desc">
                      Injected into every Draft-mode answer. Use it for first-person drafts written in your voice.
                    </div>
                    <textarea
                      className="s-textarea"
                      rows={9}
                      spellCheck={false}
                      value={settings.persona}
                      onChange={(e) => onChange({ persona: e.target.value })}
                    />
                    <button
                      className="btn"
                      onClick={() =>
                        onChange({
                          persona: buildJobPersona({
                            userName: settings.userName,
                            userRole: settings.userRole,
                            personaNotes: settings.personaNotes,
                          }),
                        })
                      }
                    >
                      Regenerate from profile
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── AI ENGINE ── */}
            {page === "engine" && (
              <div className="s-page">
                <div className="s-section">
                  <div className="s-section-head">
                    <span className="s-section-lbl">Engine &amp; Model</span>
                    <button className="btn-ghost engine-rescan-btn" type="button" onClick={rescanPaths} disabled={scanBusy}>
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
                        <path d="M3 21v-5h5" />
                        <path d="M3 12A9 9 0 0 1 18.5 5.7L21 8" />
                        <path d="M21 3v5h-5" />
                      </svg>
                      {scanBusy ? "Scanning..." : "Rescan paths"}
                    </button>
                  </div>
                  {scanError && <div className="notice small error">Path scan failed: {scanError}</div>}
                  <div className="s-field">
                    <div className="s-field-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      Engine
                      {settings.engine !== "claude" && (
                        <span style={{ marginLeft: "auto" }}>
                          <StatusTip
                            ok={selectedEngineAvailable}
                            tip={
                              selectedEngineAvailable
                                ? `${currentEngineScan?.path ?? engineCliName(settings.engine)} found. Model and reasoning are passed where this CLI supports them.`
                                : `${engineCliName(settings.engine)} CLI not found on PATH. Install it or switch back to Claude.`
                            }
                          />
                        </span>
                      )}
                    </div>
                    <div className="engine-select-row">
                      <select
                        value={settings.engine}
                        onChange={(e) => onChange({ engine: e.target.value as Settings["engine"] })}
                      >
                        {engines.map((en) => {
                          const scanned = engineScan?.engines?.[en.id as Settings["engine"]];
                          const isAvailable = en.id === "claude" || scanned?.available || skills[en.id as keyof typeof skills];
                          const selected = settings.engine === en.id;
                          return (
                            <option key={en.id} value={en.id}>
                              {selected ? "✓ " : ""}{en.label} {isAvailable ? "" : " (not found)"}
                            </option>
                          );
                        })}
                      </select>
                      <button
                        className="default-agent-check"
                        type="button"
                        title="Selected default agent"
                        aria-label="Selected default agent"
                        onClick={() => onChange({ engine: settings.engine })}
                      >
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  <div className="s-field">
                    <div className="s-field-label">Model</div>
                    <select
                      className="s-select"
                      style={{ width: "100%" }}
                      value={modelSelectValue}
                      onChange={(e) => {
                        if (e.target.value === OTHER_OPTION) {
                          setCustomModelEngine(settings.engine);
                          return;
                        }
                        setCustomModelEngine(null);
                        setEngineModel(e.target.value);
                      }}
                    >
                      {modelOptions.map((m) => (
                        <option key={m.id || "__default_model__"} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                      <option value={OTHER_OPTION}>Other...</option>
                    </select>
                    {modelSelectValue === OTHER_OPTION && (
                      <input
                        className="s-input engine-custom-input"
                        type="text"
                        value={currentModel}
                        placeholder={currentEngineScan?.modelPlaceholder ?? (settings.engine === "opencode" ? "provider/model" : "model id")}
                        spellCheck={false}
                        onChange={(e) => setEngineModel(e.target.value)}
                      />
                    )}
                  </div>

                  <div className="s-field">
                    <div className="s-field-label">Reasoning effort</div>
                    <select
                      className="s-select"
                      style={{ width: "100%" }}
                      value={reasoningSelectValue}
                      onChange={(e) => {
                        if (e.target.value === OTHER_OPTION) {
                          setCustomReasoningEngine(settings.engine);
                          return;
                        }
                        setCustomReasoningEngine(null);
                        setEngineReasoning(e.target.value);
                      }}
                    >
                      {reasoningOptions.map((r) => (
                        <option key={r.id || "__default_reasoning__"} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                      <option value={OTHER_OPTION}>Other...</option>
                    </select>
                    {reasoningSelectValue === OTHER_OPTION && (
                      <input
                        className="s-input engine-custom-input"
                        type="text"
                        value={currentReasoning}
                        placeholder={currentEngineScan?.reasoningPlaceholder ?? "low, medium, high, max..."}
                        spellCheck={false}
                        onChange={(e) => setEngineReasoning(e.target.value)}
                      />
                    )}
                  </div>

                  <div className="s-field">
                    <div className="s-field-label">Cleanup model</div>
                    <div className="s-field-desc">Lightweight model used by the answer card's "Clean up" button.</div>
                    <select
                      className="s-select"
                      style={{ width: "100%" }}
                      value={cleanupModelSelectValue}
                      onChange={(e) => {
                        if (e.target.value === OTHER_OPTION) {
                          setCustomCleanupModelEngine(settings.engine);
                          return;
                        }
                        setCustomCleanupModelEngine(null);
                        setCleanupModel(e.target.value);
                      }}
                    >
                      {cleanupModelOptions.map((m) => (
                        <option key={m.id || "__default_cleanup_model__"} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                      <option value={OTHER_OPTION}>Other...</option>
                    </select>
                    {cleanupModelSelectValue === OTHER_OPTION && (
                      <input
                        className="s-input engine-custom-input"
                        type="text"
                        value={currentCleanupModel}
                        placeholder={currentEngineScan?.modelPlaceholder ?? (settings.engine === "opencode" ? "provider/model" : "model id")}
                        spellCheck={false}
                        onChange={(e) => setCleanupModel(e.target.value)}
                      />
                    )}
                  </div>

                  <div className="s-field">
                    <div className="s-field-label">Cleanup reasoning effort</div>
                    <select
                      className="s-select"
                      style={{ width: "100%" }}
                      value={cleanupReasoningSelectValue}
                      onChange={(e) => {
                        if (e.target.value === OTHER_OPTION) {
                          setCustomCleanupReasoningEngine(settings.engine);
                          return;
                        }
                        setCustomCleanupReasoningEngine(null);
                        setCleanupReasoning(e.target.value);
                      }}
                    >
                      {cleanupReasoningOptions.map((r) => (
                        <option key={r.id || "__default_cleanup_reasoning__"} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                      <option value={OTHER_OPTION}>Other...</option>
                    </select>
                    {cleanupReasoningSelectValue === OTHER_OPTION && (
                      <input
                        className="s-input engine-custom-input"
                        type="text"
                        value={currentCleanupReasoning}
                        placeholder={currentEngineScan?.reasoningPlaceholder ?? "low, medium, high, max..."}
                        spellCheck={false}
                        onChange={(e) => setCleanupReasoning(e.target.value)}
                      />
                    )}
                  </div>
                </div>

                <div className="s-section">
                  <span className="s-section-lbl">Usage</span>
                  <Suspense fallback={<div className="loading">Loading usage charts…</div>}>
                    <UsagePanel engine={settings.engine} model={currentModel} />
                  </Suspense>
                </div>
              </div>
            )}

            {/* ── RAG / RETRIEVAL ── */}
            {page === "rag" && (
              <div className="s-page">
                <div className="s-section">
                  <span className="s-section-lbl">Retrieval</span>
                  <div className="s-row">
                    <div>
                      <div className="s-row-label">Enable RAG by default</div>
                      <div className="s-row-desc">Send only the most relevant vault passages (fewer tokens)</div>
                    </div>
                    <Toggle checked={settings.rag} onChange={(v) => onChange({ rag: v })} />
                  </div>
                  <div className="s-field">
                    <div className="s-field-label">Max turns (safety cap)</div>
                    <input
                      className="s-input"
                      type="number"
                      min={4}
                      max={60}
                      value={settings.maxTurns}
                      onChange={(e) => onChange({ maxTurns: Number(e.target.value) || 24 })}
                    />
                  </div>
                  <div className="s-field">
                    <div className="s-field-label">URL fetch method</div>
                    <div className="s-field-desc">How the local resolver extracts URLs in the Vault Writer and agent research.</div>
                    <select
                      className="s-select"
                      style={{ width: "100%" }}
                      value={settings.urlFetchMethod}
                      onChange={(e) => onChange({ urlFetchMethod: e.target.value as Settings["urlFetchMethod"] })}
                    >
                      <option value="readability">Readability (fast, static pages)</option>
                      <option value="auto">Auto (Readability, then local Chromium)</option>
                      <option value="playwright">Chromium (JavaScript-heavy pages)</option>
                    </select>
                  </div>
                  <p className="notice small">
                    Turn web research on or off under <strong>Settings -&gt; Skills</strong>. The Web-search research
                    skill uses the SearXNG endpoint below.
                  </p>
                  <div className="s-field">
                    <div className="s-field-label">Local SearXNG URL</div>
                    <div className="s-field-desc">Must point to a loopback SearXNG server with JSON output enabled. No paid search API is used.</div>
                    <input
                      className="s-input"
                      type="url"
                      placeholder="http://127.0.0.1:8080"
                      value={settings.searxngUrl}
                      onChange={(e) => onChange({ searxngUrl: e.target.value })}
                      spellCheck={false}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ── SKILLS ── */}
            {page === "skills" && (
              <div className="s-page">
                <div className="s-section">
                  <span className="s-section-lbl">Built-in capabilities</span>
                  <p className="notice small">
                    These ship with the app and apply to every tab when enabled.
                  </p>
                  {PREPACKAGED_SKILLS.map((skill) => (
                    <div key={skill.id}>
                      <div className="s-row">
                        <div>
                          <div className="s-row-label">{skill.name}</div>
                          <div className="s-row-desc">{skill.description}</div>
                        </div>
                        <Toggle
                          checked={Boolean(settings[skill.settingKey])}
                          onChange={(v) => onChange({ [skill.settingKey]: v } as Partial<Settings>)}
                        />
                      </div>
                      {skill.note && <div className="notice small">{skill.note}</div>}
                      {skill.id === "humanize" && !skills.humanizer && (
                        <div className="notice small">Native humanizer skill not found; inline cleanup rules will be used.</div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="s-section">
                  <div className="skills-installed-hd">
                    <span className="s-section-lbl" style={{ marginBottom: 0 }}>Portable skills</span>
                    <div className="skills-installed-controls">
                      <input
                        className="skill-filter-input"
                        placeholder="Search skills…"
                        value={skillFilter}
                        onChange={(e) => setSkillFilter(e.target.value)}
                      />
                      <button className="btn-ghost" onClick={onRefreshSkills}>Refresh</button>
                    </div>
                  </div>
                  <div className="skills-list">
                    {availableSkills.length === 0 ? (
                      <div className="notice small error">No portable skills installed yet.</div>
                    ) : shownSkills.length === 0 ? (
                      <div className="notice small">No skills match that search.</div>
                    ) : (
                      shownSkills.map((s) => (
                        <div key={`${s.scope}:${s.name}`} className="skills-list-item">
                          <div className="skills-list-head">
                            <span className="skills-list-name">{s.name}</span>
                            <span className={`skill-scope-badge ${s.scope}`}>{s.scope}</span>
                          </div>
                          {s.description && <div className="skills-list-desc">{s.description}</div>}
                          {skillMeta(s) && <div className="skills-list-meta">{skillMeta(s)}</div>}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="s-section">
                  <span className="s-section-lbl">Create skill</span>
                  <p className="notice small">
                    Describe the skill you want. The agent writes the <code>SKILL.md</code> with the
                    skill-creator skill, then you can edit it or ask for a revision. Skills are saved in
                    Claude-compatible folders, but selected <code>SKILL.md</code> instructions are embedded
                    for every engine.
                  </p>
                  {skillOk && <div className="vault-status ok">{skillOk}</div>}
                  {!skillFormOpen ? (
                    <button
                      className="btn"
                      style={{ width: "fit-content" }}
                      onClick={() => { setSkillFormOpen(true); setSkillError(""); setSkillOk(""); }}
                    >
                      Create skill
                    </button>
                  ) : (
                    <div className="skill-form">
                      <div className="s-field">
                        <div className="s-field-label">Describe the skill</div>
                        <textarea
                          className="s-textarea"
                          rows={3}
                          value={skillDescribe}
                          placeholder="e.g. A skill that turns my rough meeting notes into a clean summary with decisions and action items."
                          onChange={(e) => setSkillDescribe(e.target.value)}
                        />
                        <div className="skills-actions">
                          {skillGenBusy ? (
                            <button className="btn-cancel" onClick={stopSkillGeneration}>Stop</button>
                          ) : (
                            <button
                              className="btn-primary"
                              disabled={!skillDescribe.trim()}
                              onClick={() => runSkillGeneration("generate")}
                            >
                              {skillDraftReady ? "Regenerate" : "Generate skill"}
                            </button>
                          )}
                        </div>
                      </div>

                      {skillGenBusy && (
                        <div className="s-field">
                          <div className="s-field-label">Writing skill…</div>
                          <pre className="skill-preview">{skillPreview || "…"}</pre>
                        </div>
                      )}

                      {skillDraftReady && !skillGenBusy && (
                        <>
                          <div className="s-field">
                            <div className="s-field-label">Name (kebab-case)</div>
                            <input className="s-input" type="text" value={skillName} spellCheck={false} placeholder="e.g. meeting-notes" onChange={(e) => setSkillName(e.target.value)} />
                          </div>
                          <div className="s-field">
                            <div className="s-field-label">Description</div>
                            <textarea className="s-textarea" rows={2} value={skillDesc} placeholder="When should the agent use this skill?" onChange={(e) => setSkillDesc(e.target.value)} />
                          </div>
                          <div className="s-field">
                            <div className="s-field-label">Instructions</div>
                            <textarea className="s-textarea" rows={8} spellCheck={false} value={skillBody} placeholder="Markdown instructions for the skill…" onChange={(e) => setSkillBody(e.target.value)} />
                          </div>
                          <div className="s-field">
                            <div className="s-field-label">Ask the agent to revise</div>
                            <div className="skill-rewrite-row">
                              <input
                                className="s-input"
                                type="text"
                                value={skillFeedback}
                                placeholder="e.g. make it stricter about always listing action items"
                                onChange={(e) => setSkillFeedback(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter" && skillFeedback.trim()) runSkillGeneration("rewrite"); }}
                              />
                              <button className="btn" disabled={!skillFeedback.trim()} onClick={() => runSkillGeneration("rewrite")}>
                                Rewrite
                              </button>
                            </div>
                          </div>
                          <div className="s-field">
                            <div className="s-field-label">Scope</div>
                            <select className="s-select" style={{ width: "100%" }} value={skillScope} onChange={(e) => setSkillScope(e.target.value as "user" | "vault")}>
                              <option value="user">User (~/.claude/skills)</option>
                              <option value="vault">Vault (.claude/skills)</option>
                            </select>
                          </div>
                        </>
                      )}

                      {skillError && <div className="vault-status bad">{skillError}</div>}
                      <div className="skills-actions">
                        <button className="btn-ghost" onClick={resetSkillForm}>Cancel</button>
                        <button
                          className="btn-primary"
                          disabled={skillBusy || skillGenBusy || !skillDraftReady || !skillName.trim() || !skillDesc.trim()}
                          onClick={submitSkill}
                        >
                          {skillBusy ? "Saving…" : "Save skill"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── APPEARANCE ── */}
            {page === "appearance" && (
              <div className="s-page">
                <div className="s-section">
                  <span className="s-section-lbl">Theme</span>
                  <div className="s-row">
                    <div className="s-row-label">Color mode</div>
                    <select
                      className="s-select s-row-ctrl"
                      value={theme}
                      onChange={(e) => onThemeChange(e.target.value as "dark" | "light")}
                    >
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                    </select>
                  </div>
                  <div className="s-row">
                    <div className="s-row-label">Density</div>
                    <select
                      className="s-select s-row-ctrl"
                      value={density}
                      onChange={(e) => onDensityChange(e.target.value as "comfortable" | "compact")}
                    >
                      <option value="comfortable">Comfortable</option>
                      <option value="compact">Compact</option>
                    </select>
                  </div>
                </div>
                <DesignSettingsSection design={design} onChange={onDesignChange} />
              </div>
            )}

            {/* ── LOGS ── */}
            {page === "logs" && (
              <div className="s-page">
                <div className="s-section">
                  <span className="s-section-lbl">Activity</span>
                  <Suspense fallback={<div className="loading">Loading activity logs…</div>}>
                    <LogsView logs={logs} onClear={onClearLogs} />
                  </Suspense>
                </div>
              </div>
            )}

            {/* ── HELP ── */}
            {page === "help" && (
              <div className="s-page">
                <HelpGuide />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

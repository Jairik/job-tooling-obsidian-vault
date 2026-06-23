// The settings modal. A centered dialog with a left-nav of pages that edit the
// global Settings (engine/model/effort, vault dirs, persona, RAG, etc.), the
// theme/density prefs, and the local DesignSettings (Appearance). Changes are
// lifted to App, which persists them; this component holds no source of truth.
import { useEffect, useState, type ReactNode } from "react";
import type { Settings, TabMode, DesignSettings, SkillInfo } from "../lib/store";
import { effectiveEngineModel, effectiveEngineReasoning } from "../../shared/settings";
import { api, type ModelOption } from "../lib/api";
import { loadFont } from "../lib/fonts";
import { UsagePanel } from "./UsagePanel";
import { DesignSettingsSection } from "./DesignSettingsSection";

type CreateSkillResult = { ok: boolean; error?: string };
type PageId = "general" | "vault" | "persona" | "engine" | "rag" | "skills" | "appearance" | "usage";

interface Props {
  settings: Settings;
  models: ModelOption[];
  engines: ModelOption[];
  skills: { humanizer: boolean; gemini: boolean; opencode: boolean; cursor: boolean; copilot: boolean; codex: boolean };
  availableSkills: SkillInfo[];
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
  onClose: () => void;
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

const REASONING_PRESETS = ["low", "medium", "high", "minimal", "max", "xhigh"];

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
      { id: "usage", label: "Usage", icon: (<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>) },
    ],
  },
];

const PAGE_TITLE: Record<PageId, string> = {
  general: "General", vault: "Vault", persona: "Persona", engine: "AI Engine",
  rag: "RAG / Retrieval", skills: "Skills", appearance: "Appearance", usage: "Usage",
};

/* Maps an internal engine identifier to the executable users need to install. */
function engineCliName(engine: Settings["engine"]): string {
  if (engine === "gemini") return "agy";
  return engine;
}

/* Provides configuration for engines, retrieval, vault paths, skills, and visual design. */
export function SettingsPanel({
  settings,
  models,
  engines,
  skills,
  availableSkills,
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
  onClose,
}: Props) {
  const [page, setPage] = useState<PageId>("general");
  const [vaultInput, setVaultInput] = useState(settings.vaultDir);
  const [vault, setVault] = useState<VaultState | null>(null);
  const [skillFilter, setSkillFilter] = useState("");

  // "Add skill" form state.
  const [skillFormOpen, setSkillFormOpen] = useState(false);
  const [skillName, setSkillName] = useState("");
  const [skillDesc, setSkillDesc] = useState("");
  const [skillBody, setSkillBody] = useState("");
  const [skillScope, setSkillScope] = useState<"user" | "vault">("user");
  const [skillBusy, setSkillBusy] = useState(false);
  const [skillError, setSkillError] = useState("");
  const [skillOk, setSkillOk] = useState("");
  const currentModel = effectiveEngineModel(settings);
  const currentReasoning = effectiveEngineReasoning(settings);
  const selectedEngineAvailable =
    settings.engine === "claude" || Boolean(skills[settings.engine as keyof typeof skills]);

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

  /* Validates and submits the small in-panel form used to create a skill. */
  const submitSkill = async () => {
    setSkillBusy(true);
    setSkillError("");
    setSkillOk("");
    const res = await onCreateSkill({ name: skillName, description: skillDesc, body: skillBody, scope: skillScope });
    setSkillBusy(false);
    if (res.ok) {
      setSkillOk(`Created "${skillName.trim().toLowerCase()}".`);
      setSkillName("");
      setSkillDesc("");
      setSkillBody("");
      setSkillFormOpen(false);
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
                      <option value="job">Job mode</option>
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
                                ? `Valid — ${vault.foundDirs.length} context dir${vault.foundDirs.length === 1 ? "" : "s"} found`
                                : vault.message || "Invalid path"
                            }
                          />
                        </span>
                      )}
                    </div>
                    <div className="s-field-desc">Path to your Obsidian vault root</div>
                    <input
                      className="s-input"
                      type="text"
                      value={vaultInput}
                      spellCheck={false}
                      onChange={(e) => setVaultInput(e.target.value)}
                      onBlur={() => onChange({ vaultDir: vaultInput })}
                    />
                  </div>
                  <div className="s-field">
                    <div className="s-field-label">Extra context dirs</div>
                    <div className="s-field-desc">Extra directories to include, one per line</div>
                    <textarea
                      className="s-textarea"
                      rows={3}
                      spellCheck={false}
                      value={settings.extraDirs.join("\n")}
                      onChange={(e) =>
                        onChange({ extraDirs: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })
                      }
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ── PERSONA ── */}
            {page === "persona" && (
              <div className="s-page">
                <div className="s-section">
                  <span className="s-section-lbl">Voice</span>
                  <div className="s-field">
                    <div className="s-field-label">System prompt</div>
                    <div className="s-field-desc">Injected into every generation.</div>
                    <textarea
                      className="s-textarea"
                      rows={10}
                      spellCheck={false}
                      value={settings.persona}
                      onChange={(e) => onChange({ persona: e.target.value })}
                    />
                  </div>
                  <div className="s-row">
                    <div>
                      <div className="s-row-label">Auto-humanize</div>
                      <div className="s-row-desc">Run the humanizer skill after every draft</div>
                    </div>
                    <Toggle checked={settings.humanize} onChange={(v) => onChange({ humanize: v })} />
                  </div>
                  {!skills.humanizer && (
                    <div className="notice small">humanizer skill not found in ~/.claude/skills or the vault.</div>
                  )}
                </div>
              </div>
            )}

            {/* ── AI ENGINE ── */}
            {page === "engine" && (
              <div className="s-page">
                <div className="s-section">
                  <span className="s-section-lbl">Engine &amp; Model</span>
                  <div className="s-field">
                    <div className="s-field-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      Engine
                      {settings.engine !== "claude" && (
                        <span style={{ marginLeft: "auto" }}>
                          <StatusTip
                            ok={selectedEngineAvailable}
                            tip={
                              selectedEngineAvailable
                                ? `${engineCliName(settings.engine)} CLI found. Model and reasoning are passed where this CLI supports flags.`
                                : `${engineCliName(settings.engine)} CLI not found on PATH — install it or switch back to Claude.`
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
                          const isAvailable = en.id === "claude" || skills[en.id as keyof typeof skills];
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
                        ✓
                      </button>
                    </div>
                  </div>

                  <div className="s-field">
                    <div className="s-field-label">Model</div>
                    <input
                      className="s-input"
                      list="engine-model-options"
                      type="text"
                      value={currentModel}
                      placeholder={settings.engine === "opencode" ? "provider/model" : "model id"}
                      spellCheck={false}
                      onChange={(e) => setEngineModel(e.target.value)}
                    />
                    <datalist id="engine-model-options">
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                      <option value="auto" />
                    </datalist>
                  </div>

                  <div className="s-field">
                    <div className="s-field-label">Reasoning effort</div>
                    <input
                      className="s-input"
                      list="engine-reasoning-options"
                      type="text"
                      value={currentReasoning}
                      placeholder="low, medium, high, max..."
                      spellCheck={false}
                      onChange={(e) => setEngineReasoning(e.target.value)}
                    />
                    <datalist id="engine-reasoning-options">
                      {REASONING_PRESETS.map((r) => (
                        <option key={r} value={r} />
                      ))}
                    </datalist>
                  </div>

                  {settings.engine === "claude" && (
                    <div className="s-field">
                      <div className="s-field-label">Cleanup model</div>
                      <div className="s-field-desc">Lightweight model used by the answer card's "Clean up" button.</div>
                      <select
                        className="s-select"
                        style={{ width: "100%" }}
                        value={settings.cleanupModel}
                        onChange={(e) => onChange({ cleanupModel: e.target.value })}
                      >
                        {models.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
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
                    <div className="s-field-desc">How text is extracted from URLs when summarizing in the Vault Writer.</div>
                    <select
                      className="s-select"
                      style={{ width: "100%" }}
                      value={settings.urlFetchMethod || "basic"}
                      onChange={(e) => onChange({ urlFetchMethod: e.target.value as Settings["urlFetchMethod"] })}
                    >
                      <option value="basic">Basic (lightweight fetch)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* ── SKILLS ── */}
            {page === "skills" && (
              <div className="s-page">
                <div className="s-section">
                  <div className="skills-installed-hd">
                    <span className="s-section-lbl" style={{ marginBottom: 0 }}>Installed</span>
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
                      <div className="notice small">No skills installed yet.</div>
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
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="s-section">
                  <span className="s-section-lbl">Create skill</span>
                  <p className="notice small">
                    Skills are <code>SKILL.md</code> folders in <code>~/.claude/skills</code> (user) or the vault's
                    <code> .claude/skills</code> (vault).
                  </p>
                  {skillOk && <div className="vault-status ok">{skillOk}</div>}
                  {!skillFormOpen ? (
                    <button
                      className="btn"
                      style={{ width: "fit-content" }}
                      onClick={() => { setSkillFormOpen(true); setSkillError(""); setSkillOk(""); }}
                    >
                      Add skill
                    </button>
                  ) : (
                    <div className="skill-form">
                      <div className="s-field">
                        <div className="s-field-label">Name (kebab-case)</div>
                        <input className="s-input" type="text" value={skillName} spellCheck={false} placeholder="e.g. tone-check" onChange={(e) => setSkillName(e.target.value)} />
                      </div>
                      <div className="s-field">
                        <div className="s-field-label">Description</div>
                        <input className="s-input" type="text" value={skillDesc} placeholder="When should the agent use this skill?" onChange={(e) => setSkillDesc(e.target.value)} />
                      </div>
                      <div className="s-field">
                        <div className="s-field-label">Instructions</div>
                        <textarea className="s-textarea" rows={5} spellCheck={false} value={skillBody} placeholder="Markdown instructions for the skill…" onChange={(e) => setSkillBody(e.target.value)} />
                      </div>
                      <div className="s-field">
                        <div className="s-field-label">Scope</div>
                        <select className="s-select" style={{ width: "100%" }} value={skillScope} onChange={(e) => setSkillScope(e.target.value as "user" | "vault")}>
                          <option value="user">User (~/.claude/skills)</option>
                          <option value="vault">Vault (.claude/skills)</option>
                        </select>
                      </div>
                      {skillError && <div className="vault-status bad">{skillError}</div>}
                      <div className="skills-actions">
                        <button className="btn-ghost" onClick={() => setSkillFormOpen(false)}>Cancel</button>
                        <button
                          className="btn-primary"
                          disabled={skillBusy || !skillName.trim() || !skillDesc.trim()}
                          onClick={submitSkill}
                        >
                          {skillBusy ? "Creating…" : "Create skill"}
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

            {/* ── USAGE ── */}
            {page === "usage" && (
              <div className="s-page">
                <div className="s-section">
                  <span className="s-section-lbl">Session</span>
                  <UsagePanel />
                  <div className="notice small">
                    Live Claude Code subscription usage — the same limits the CLI's <code>/usage</code> command reports.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// The settings drawer. Edits the global Settings (engine/model/effort, vault dirs,
// persona/system prompt, RAG, etc.) and the local DesignSettings (theme, fonts,
// accent, animated backgrounds). Changes are lifted to App via onChange /
// onDesignChange, which persist them; this component holds no source of truth.
import { useEffect, useState } from "react";
import type { Settings, TabMode, DesignSettings, FontFamily, BorderRadius, SpacingScale, ShadowIntensity, SkillInfo } from "../lib/store";
import { DEFAULT_DESIGN, effectiveEngineModel, effectiveEngineReasoning } from "../lib/store";
import { api, type ModelOption } from "../lib/api";
import { FONT_OPTIONS, loadFont } from "../lib/fonts";
import { FUN_VARIANTS, funLabel, type FunVariant } from "./FunBackground";
import { UsagePanel } from "./UsagePanel";

type CreateSkillResult = { ok: boolean; error?: string };

interface Props {
  settings: Settings;
  models: ModelOption[];
  engines: ModelOption[];
  skills: { humanizer: boolean; gemini: boolean; opencode: boolean; cursor: boolean; copilot: boolean; codex: boolean };
  availableSkills: SkillInfo[];
  defaultMode: TabMode;
  design: DesignSettings;
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
// text on hover/focus, instead of an always-visible green/red line. Keeps the
// settings panel uncluttered while keeping the detail one hover away.
function StatusTip({ ok, tip, label }: { ok: boolean; tip: string; label?: string }) {
  return (
    <span className={`status-tip ${ok ? "ok" : "bad"}`} data-tip={tip} tabIndex={0} aria-label={tip}>
      {label && <span className="status-tip-label">{label}</span>}
      <span className="status-tip-dot" />
    </span>
  );
}

const REASONING_PRESETS = ["low", "medium", "high", "minimal", "max", "xhigh"];

function engineCliName(engine: Settings["engine"]): string {
  if (engine === "gemini") return "agy";
  return engine;
}

export function SettingsPanel({
  settings,
  models,
  engines,
  skills,
  availableSkills,
  defaultMode,
  design,
  onDefaultModeChange,
  onChange,
  onDesignChange,
  onCreateSkill,
  onRefreshSkills,
  onClose,
}: Props) {
  const [vaultInput, setVaultInput] = useState(settings.vaultDir);
  const [vault, setVault] = useState<VaultState | null>(null);

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

  const setEngineModel = (model: string) => {
    const engineModels = { ...(settings.engineModels ?? {}), [settings.engine]: model };
    onChange({
      engineModels,
      ...(settings.engine === "claude" ? { model } : {}),
    });
  };

  const setEngineReasoning = (reasoning: string) => {
    const engineReasoning = { ...(settings.engineReasoning ?? {}), [settings.engine]: reasoning };
    const effort =
      reasoning === "low" || reasoning === "medium" || reasoning === "high" ? reasoning : settings.effort;
    onChange({
      engineReasoning,
      ...(settings.engine === "claude" ? { effort } : {}),
    });
  };

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

  // Load selected font when it changes
  useEffect(() => {
    if (design.fontFamily !== "system") {
      loadFont(design.fontFamily);
    }
  }, [design.fontFamily]);

  const handleReset = () => {
    onDesignChange(DEFAULT_DESIGN);
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="drawer-sub">Global defaults. Each tab can override these.</p>

        {/* General Preferences */}
        <div className="settings-section">
          <div className="settings-section-title">General Preferences</div>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={defaultMode === "job"}
              onChange={(e) => onDefaultModeChange(e.target.checked ? "job" : "ask")}
            />
            <span>Open new tabs in Job mode (off = Ask the vault)</span>
          </label>
          <div className="notice small">
            Each tab still has its own Ask / Job toggle; this only sets the default for new tabs.
          </div>

          <label className="toggle-row" style={{ marginTop: "var(--space-2)" }}>
            <input
              type="checkbox"
              checked={design.toolbarDropdown}
              onChange={(e) => onDesignChange({ toolbarDropdown: e.target.checked })}
            />
            <span>Toolbar dropdown mode (collapse controls into a menu)</span>
          </label>
          <div className="notice small">
            Combines engine info, theme, density, and shortcut buttons into a single dropdown on the top toolbar.
          </div>
        </div>

        {/* AI Engine & Models */}
        <div className="settings-section">
          <div className="settings-section-title">AI Engine & Models</div>
          <label className="field">
            <span className="field-label">
              Engine
              {settings.engine !== "claude" && (
                <span className="field-label-tips">
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
            </span>
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
          </label>

          <label className="field" style={{ marginTop: "var(--space-2)" }}>
            <span>Model</span>
            <input
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
          </label>

          <label className="field" style={{ marginTop: "var(--space-2)" }}>
            <span>Reasoning effort</span>
            <input
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
          </label>

          {settings.engine === "claude" && (
            <>
              <label className="field" style={{ marginTop: "var(--space-2)" }}>
                <span>Cleanup model</span>
                <select
                  value={settings.cleanupModel}
                  onChange={(e) => onChange({ cleanupModel: e.target.value })}
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <div className="notice small">Lightweight model used by the answer card's "Clean up" button (grammar fix + humanize).</div>
              </label>

              <div className="field" style={{ marginTop: "var(--space-2)" }}>
                <span>Usage</span>
                <UsagePanel />
                <div className="notice small">
                  Live Claude Code subscription usage — the same limits the CLI's <code>/usage</code> command reports.
                </div>
              </div>
            </>
          )}
        </div>

        {/* Generation & Retrieval */}
        <div className="settings-section">
          <div className="settings-section-title">Generation & Retrieval</div>

          <label className="field" style={{ marginBottom: "var(--space-4)" }}>
            <span>URL Fetch Method</span>
            <select
              value={settings.urlFetchMethod || "basic"}
              onChange={(e) => onChange({ urlFetchMethod: e.target.value as Settings["urlFetchMethod"] })}
            >
              <option value="basic">Basic (lightweight fetch)</option>
            </select>
            <div className="notice small">Method used to extract text from URLs when summarizing in the Vault Writer.</div>
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.humanize}
              onChange={(e) => onChange({ humanize: e.target.checked })}
            />
            <span>Humanize answers (run the humanizer skill)</span>
          </label>
          {!skills.humanizer && (
            <div className="notice small">humanizer skill not found in ~/.claude/skills or the vault.</div>
          )}

          <label className="toggle-row" style={{ marginTop: "var(--space-2)" }}>
            <input
              type="checkbox"
              checked={settings.rag}
              onChange={(e) => onChange({ rag: e.target.checked })}
            />
            <span>Use RAG retrieval by default (inject only relevant vault excerpts — fewer tokens)</span>
          </label>
          <div className="notice small">
            BM25 retrieval over the vault, in pure Bun. New tabs inherit this; each tab has its own RAG toggle.
          </div>

          <label className="field" style={{ marginTop: "var(--space-2)" }}>
            <span>Max turns (safety cap)</span>
            <input
              type="number"
              min={4}
              max={60}
              value={settings.maxTurns}
              onChange={(e) => onChange({ maxTurns: Number(e.target.value) || 24 })}
            />
          </label>
        </div>

        {/* Vault & Context */}
        <div className="settings-section">
          <div className="settings-section-title">Vault & Context</div>
          <div className="field">
            <span className="field-label">
              Vault / context repo
              <span className="field-label-tips">
                {vault && (
                  <StatusTip
                    ok={vault.valid}
                    tip={
                      vault.valid
                        ? `Valid — ${vault.foundDirs.length} context dir${vault.foundDirs.length === 1 ? "" : "s"} found`
                        : vault.message || "Invalid path"
                    }
                  />
                )}
              </span>
            </span>
            <input
              type="text"
              value={vaultInput}
              spellCheck={false}
              onChange={(e) => setVaultInput(e.target.value)}
              onBlur={() => onChange({ vaultDir: vaultInput })}
            />
          </div>

          <label className="field" style={{ marginTop: "var(--space-2)" }}>
            <span>Extra context dirs (one per line)</span>
            <textarea
              rows={2}
              spellCheck={false}
              value={settings.extraDirs.join("\n")}
              onChange={(e) =>
                onChange({ extraDirs: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })
              }
            />
          </label>
        </div>

        {/* Persona System Prompt */}
        <div className="settings-section">
          <div className="settings-section-title">Persona Prompt</div>
          <label className="field">
            <span>Persona / system prompt</span>
            <textarea
              rows={12}
              className="mono"
              spellCheck={false}
              value={settings.persona}
              onChange={(e) => onChange({ persona: e.target.value })}
            />
          </label>
        </div>

        {/* Skills */}
        <div className="settings-section">
          <div className="settings-section-title">Skills</div>
          <p className="notice small">
            Skills are <code>SKILL.md</code> folders in <code>~/.claude/skills</code> (user) or the vault's
            <code> .claude/skills</code> (vault). Pick which to apply per interaction from the Skills button on each tab.
          </p>

          <div className="skills-list">
            {availableSkills.length === 0 ? (
              <div className="notice small">No skills installed yet.</div>
            ) : (
              availableSkills.map((s) => (
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

          <div className="skills-actions">
            <button className="btn btn-ghost" onClick={onRefreshSkills}>
              Refresh
            </button>
            <button
              className="btn"
              onClick={() => {
                setSkillFormOpen((o) => !o);
                setSkillError("");
                setSkillOk("");
              }}
            >
              {skillFormOpen ? "Cancel" : "Add skill"}
            </button>
          </div>

          {skillOk && <div className="vault-status ok">{skillOk}</div>}

          {skillFormOpen && (
            <div className="skill-form">
              <label className="field">
                <span>Name (kebab-case)</span>
                <input
                  type="text"
                  value={skillName}
                  spellCheck={false}
                  placeholder="e.g. tone-check"
                  onChange={(e) => setSkillName(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Description</span>
                <input
                  type="text"
                  value={skillDesc}
                  placeholder="When should the agent use this skill?"
                  onChange={(e) => setSkillDesc(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Instructions</span>
                <textarea
                  rows={6}
                  className="mono"
                  spellCheck={false}
                  value={skillBody}
                  placeholder="Markdown instructions for the skill…"
                  onChange={(e) => setSkillBody(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Scope</span>
                <select value={skillScope} onChange={(e) => setSkillScope(e.target.value as "user" | "vault")}>
                  <option value="user">User (~/.claude/skills)</option>
                  <option value="vault">Vault (.claude/skills)</option>
                </select>
              </label>
              {skillError && <div className="vault-status bad">{skillError}</div>}
              <div className="skills-actions">
                <button
                  className="btn btn-primary"
                  disabled={skillBusy || !skillName.trim() || !skillDesc.trim()}
                  onClick={submitSkill}
                >
                  {skillBusy ? "Creating…" : "Create skill"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Background Section */}
        <div className="settings-section">
          <div className="settings-section-title">Background</div>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={design.funEnabled}
              onChange={(e) => onDesignChange({ funEnabled: e.target.checked })}
            />
            <span>Animated background (fun mode)</span>
          </label>

          {design.funEnabled && (
            <div className="fun-variant-grid">
              {FUN_VARIANTS.map((v) => (
                <button
                  key={v.id}
                  className={`fun-variant-option ${design.funVariant === v.id ? "active" : ""}`}
                  onClick={() => onDesignChange({ funVariant: v.id as FunVariant })}
                >
                  {v.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Typography Section */}
        <div className="settings-section">
          <div className="settings-section-title">Typography</div>

          <label className="field">
            <span>Font family</span>
            <select
              value={design.fontFamily}
              onChange={(e) => onDesignChange({ fontFamily: e.target.value as FontFamily })}
            >
              {FONT_OPTIONS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Font scale ({design.fontScale.toFixed(2)}x)</span>
            <input
              type="range"
              min={0.8}
              max={1.2}
              step={0.05}
              value={design.fontScale}
              onChange={(e) => onDesignChange({ fontScale: Number(e.target.value) })}
            />
          </label>
        </div>

        {/* Colors Section */}
        <div className="settings-section">
          <div className="settings-section-title">Colors</div>

          <label className="field">
            <span>Accent hue ({design.accentHue}°)</span>
            <input
              type="range"
              min={0}
              max={360}
              step={1}
              value={design.accentHue}
              onChange={(e) => onDesignChange({ accentHue: Number(e.target.value) })}
            />
          </label>

          <label className="field">
            <span>Accent intensity ({(design.accentChroma * 100).toFixed(0)}%)</span>
            <input
              type="range"
              min={0.05}
              max={0.2}
              step={0.01}
              value={design.accentChroma}
              onChange={(e) => onDesignChange({ accentChroma: Number(e.target.value) })}
            />
          </label>

          <div
            className="color-swatch"
            style={{
              background: `oklch(72% ${design.accentChroma} ${design.accentHue})`,
            }}
            title="Accent color preview"
          />
        </div>

        {/* Layout Section */}
        <div className="settings-section">
          <div className="settings-section-title">Layout</div>

          <label className="field">
            <span>Border radius</span>
          </label>
          <div className="radius-preview">
            {(["sharp", "rounded", "pill", "circle"] as BorderRadius[]).map((r) => (
              <button
                key={r}
                className={`radius-option ${design.borderRadius === r ? "active" : ""}`}
                data-radius={r}
                onClick={() => onDesignChange({ borderRadius: r })}
                title={r}
              >
                {r === "sharp" ? "▢" : r === "rounded" ? "▢" : r === "pill" ? "⬭" : "○"}
              </button>
            ))}
          </div>

          <label className="field" style={{ marginTop: "var(--space-2)" }}>
            <span>Spacing</span>
          </label>
          <div className="shadow-preview">
            {(["compact", "comfortable", "spacious"] as SpacingScale[]).map((s) => (
              <button
                key={s}
                className={`shadow-option ${design.spacingScale === s ? "active" : ""}`}
                onClick={() => onDesignChange({ spacingScale: s })}
                title={s}
              >
                {s === "compact" ? "▪" : s === "comfortable" ? "▫" : "□"}
              </button>
            ))}
          </div>

          <label className="field" style={{ marginTop: "var(--space-2)" }}>
            <span>Shadow intensity</span>
          </label>
          <div className="shadow-preview">
            {(["none", "subtle", "medium", "strong"] as ShadowIntensity[]).map((s) => (
              <button
                key={s}
                className={`shadow-option ${design.shadowIntensity === s ? "active" : ""}`}
                data-shadow={s}
                onClick={() => onDesignChange({ shadowIntensity: s })}
                title={s}
              >
                {s === "none" ? "○" : s === "subtle" ? "◦" : s === "medium" ? "●" : "◉"}
              </button>
            ))}
          </div>
        </div>

        {/* Reset Section */}
        <div className="settings-reset">
          <button onClick={handleReset}>Reset Design to Defaults</button>
        </div>
      </aside>
    </div>
  );
}

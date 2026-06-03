// The settings drawer. Edits the global Settings (engine/model/effort, vault dirs,
// persona/system prompt, RAG, etc.) and the local DesignSettings (theme, fonts,
// accent, animated backgrounds). Changes are lifted to App via onChange /
// onDesignChange, which persist them; this component holds no source of truth.
import { useEffect, useState } from "react";
import type { Settings, TabMode, DesignSettings, FontFamily, BorderRadius, SpacingScale, ShadowIntensity } from "../lib/store";
import { DEFAULT_DESIGN } from "../lib/store";
import { api, type ModelOption } from "../lib/api";
import { FONT_OPTIONS, loadFont } from "../lib/fonts";
import { FUN_VARIANTS, funLabel, type FunVariant } from "./FunBackground";

interface Props {
  settings: Settings;
  models: ModelOption[];
  engines: ModelOption[];
  skills: { yc: boolean; humanizer: boolean; gemini: boolean; opencode: boolean; cursor: boolean; copilot: boolean };
  defaultMode: TabMode;
  design: DesignSettings;
  onDefaultModeChange: (mode: TabMode) => void;
  onChange: (patch: Partial<Settings>) => void;
  onDesignChange: (patch: Partial<DesignSettings>) => void;
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

export function SettingsPanel({
  settings,
  models,
  engines,
  skills,
  defaultMode,
  design,
  onDefaultModeChange,
  onChange,
  onDesignChange,
  onClose,
}: Props) {
  const [vaultInput, setVaultInput] = useState(settings.vaultDir);
  const [vault, setVault] = useState<VaultState | null>(null);

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
                    ok={!!skills[settings.engine as keyof typeof skills]}
                    tip={
                      skills[settings.engine as keyof typeof skills]
                        ? `${settings.engine === "gemini" ? "agy" : settings.engine} CLI found. Model & reasoning effort are Claude-only and ignored here.`
                        : `${settings.engine === "gemini" ? "agy" : settings.engine} CLI not found on PATH — install it or switch back to Claude.`
                    }
                  />
                </span>
              )}
            </span>
            <select
              value={settings.engine}
              onChange={(e) => onChange({ engine: e.target.value as Settings["engine"] })}
            >
              {engines.map((en) => {
                const isAvailable = en.id === "claude" || skills[en.id as keyof typeof skills];
                return (
                  <option key={en.id} value={en.id}>
                    {en.label} {isAvailable ? "" : " (not found)"}
                  </option>
                );
              })}
            </select>
          </label>

          {settings.engine === "claude" && (
            <>
              <label className="field" style={{ marginTop: "var(--space-2)" }}>
                <span>Model</span>
                <select value={settings.model} onChange={(e) => onChange({ model: e.target.value })}>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field" style={{ marginTop: "var(--space-2)" }}>
                <span>Reasoning effort</span>
                <select
                  value={settings.effort}
                  onChange={(e) => onChange({ effort: e.target.value as Settings["effort"] })}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>

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
                <StatusTip
                  ok={skills.yc}
                  label="yc"
                  tip={
                    skills.yc
                      ? "yc-combinator skill found"
                      : "yc-combinator skill not found in ~/.claude/skills or the vault"
                  }
                />
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

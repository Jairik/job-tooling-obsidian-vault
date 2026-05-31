import { useEffect, useState } from "react";
import type { Settings } from "../lib/store";
import { api, type ModelOption } from "../lib/api";

interface Props {
  settings: Settings;
  models: ModelOption[];
  engines: ModelOption[];
  skills: { yc: boolean; humanizer: boolean; gemini: boolean };
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
}

interface VaultState {
  valid: boolean;
  foundDirs: string[];
  message?: string;
}

export function SettingsPanel({ settings, models, engines, skills, onChange, onClose }: Props) {
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

        <label className="field">
          <span>Engine</span>
          <select
            value={settings.engine}
            onChange={(e) => onChange({ engine: e.target.value as Settings["engine"] })}
          >
            {engines.map((en) => (
              <option key={en.id} value={en.id}>
                {en.label}
              </option>
            ))}
          </select>
          {settings.engine === "gemini" && (
            <div className={`vault-status ${skills.gemini ? "ok" : "bad"}`}>
              {skills.gemini
                ? "agy CLI found. Model & reasoning effort are Claude-only and ignored here."
                : "agy CLI not found on PATH — install Gemini Antigravity or switch back to Claude."}
            </div>
          )}
        </label>

        {settings.engine === "claude" && (
          <>
            <label className="field">
              <span>Model</span>
              <select value={settings.model} onChange={(e) => onChange({ model: e.target.value })}>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
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
          </>
        )}

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

        <label className="toggle-row">
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

        <label className="field">
          <span>Max turns (safety cap)</span>
          <input
            type="number"
            min={4}
            max={60}
            value={settings.maxTurns}
            onChange={(e) => onChange({ maxTurns: Number(e.target.value) || 24 })}
          />
        </label>

        <div className="field">
          <span>Vault / context repo</span>
          <input
            type="text"
            value={vaultInput}
            spellCheck={false}
            onChange={(e) => setVaultInput(e.target.value)}
            onBlur={() => onChange({ vaultDir: vaultInput })}
          />
          {vault && (
            <div className={`vault-status ${vault.valid ? "ok" : "bad"}`}>
              {vault.valid
                ? `valid — ${vault.foundDirs.length} context dir${vault.foundDirs.length === 1 ? "" : "s"} found`
                : vault.message || "invalid path"}
            </div>
          )}
          <div className="vault-skills">
            yc-combinator skill: <b className={skills.yc ? "ok" : "bad"}>{skills.yc ? "found" : "not found"}</b>
          </div>
        </div>

        <label className="field">
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
      </aside>
    </div>
  );
}

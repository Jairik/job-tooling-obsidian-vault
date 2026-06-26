// First-run setup modal. Shown once (when settings.onboarded is false) to collect
// who the user is and point the assistant at their vault, then generate a
// personalized system prompt. Everything here is editable later in Settings; the
// saved patch persists to config.json so it survives updates.
import { useEffect, useRef, useState } from "react";
import type { Settings } from "../lib/store";
import { buildJobPersona, buildAskPersona } from "../../shared/persona";
import { api } from "../lib/api";

interface VaultState {
  valid: boolean;
  foundDirs: string[];
  message?: string;
}

interface OnboardingProps {
  initial: Settings;
  onComplete: (patch: Partial<Settings>) => void;
  onSkip: () => void;
}

/* Collects name/role/vault/voice on first run and previews the generated prompt. */
export function Onboarding({ initial, onComplete, onSkip }: OnboardingProps) {
  const [name, setName] = useState(initial.userName ?? "");
  const [role, setRole] = useState(initial.userRole ?? "");
  const [notes, setNotes] = useState(initial.personaNotes ?? "");
  const [vaultDir, setVaultDir] = useState(initial.vaultDir ?? "");
  const profile = { userName: initial.userName, userRole: initial.userRole, personaNotes: initial.personaNotes };
  const [askPersona, setAskPersona] = useState(() => buildAskPersona(profile));
  const [persona, setPersona] = useState(() => buildJobPersona(profile));
  // Once the user hand-edits a prompt, stop regenerating it from the fields.
  const [askPersonaEdited, setAskPersonaEdited] = useState(false);
  const [personaEdited, setPersonaEdited] = useState(false);
  const [vault, setVault] = useState<VaultState | null>(null);

  // Keep each preview in sync with the profile fields until the user edits it.
  useEffect(() => {
    if (askPersonaEdited) return;
    setAskPersona(buildAskPersona({ userName: name, userRole: role, personaNotes: notes }));
  }, [name, role, notes, askPersonaEdited]);

  useEffect(() => {
    if (personaEdited) return;
    setPersona(buildJobPersona({ userName: name, userRole: role, personaNotes: notes }));
  }, [name, role, notes, personaEdited]);

  // Live vault validation, mirroring Settings → Vault.
  useEffect(() => {
    if (!vaultDir.trim()) {
      setVault(null);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      const res = await api.validateVault(vaultDir);
      if (!cancelled) setVault(res);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [vaultDir]);

  const finish = () => {
    onComplete({
      userName: name.trim(),
      userRole: role.trim(),
      personaNotes: notes.trim(),
      vaultDir: vaultDir.trim() || initial.vaultDir,
      persona,
      askPersona,
      onboarded: true,
    });
  };

  // Close on Escape = skip (mirrors the Settings modal's Escape-to-close).
  const skipRef = useRef(onSkip);
  skipRef.current = onSkip;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") skipRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="modal-wrap" onClick={onSkip}>
      <div className="onboard-card" onClick={(e) => e.stopPropagation()}>
        <div className="onboard-hd">
          <h2 className="onboard-title">Welcome to Vault Assistant</h2>
          <p className="onboard-sub">
            Tell me who you are so answers sound like you. You can change all of this later in Settings.
          </p>
        </div>

        <div className="onboard-body">
          <div className="s-field">
            <div className="s-field-label">Your name</div>
            <div className="s-field-desc">Used to write answers in your voice.</div>
            <input
              className="s-input"
              type="text"
              value={name}
              spellCheck={false}
              placeholder="Jane Doe"
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="s-field">
            <div className="s-field-label">Your role</div>
            <div className="s-field-desc">How you'd describe yourself professionally.</div>
            <input
              className="s-input"
              type="text"
              value={role}
              spellCheck={false}
              placeholder="a software engineer"
              onChange={(e) => setRole(e.target.value)}
            />
          </div>

          <div className="s-field">
            <div className="s-field-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              Vault path
              {vault && (
                <span
                  className={`status-tip ${vault.valid ? "ok" : "bad"}`}
                  style={{ marginLeft: "auto" }}
                  data-tip={
                    vault.valid
                      ? `Valid — ${vault.foundDirs.length} folder${vault.foundDirs.length === 1 ? "" : "s"} found`
                      : vault.message || "Invalid path"
                  }
                  tabIndex={0}
                >
                  <span className="status-tip-dot" />
                </span>
              )}
            </div>
            <div className="s-field-desc">Absolute path to your knowledge vault / context repo.</div>
            <input
              className="s-input"
              type="text"
              value={vaultDir}
              spellCheck={false}
              placeholder="/home/you/vault"
              onChange={(e) => setVaultDir(e.target.value)}
            />
          </div>

          <div className="s-field">
            <div className="s-field-label">Voice notes <span className="onboard-optional">(optional)</span></div>
            <div className="s-field-desc">Anything about your tone or background to fold into the prompt.</div>
            <textarea
              className="s-textarea"
              rows={2}
              spellCheck={false}
              value={notes}
              placeholder="e.g. I write concisely and lean technical; I'm a backend-leaning full-stack engineer."
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="s-field">
            <div className="s-field-label">Ask system prompt</div>
            <div className="s-field-desc">
              Governs Ask mode (general questions answered from your vault) — the mode new tabs open in.
              Built from the fields above; edit freely.
            </div>
            <textarea
              className="s-textarea"
              rows={7}
              spellCheck={false}
              value={askPersona}
              onChange={(e) => {
                setAskPersona(e.target.value);
                setAskPersonaEdited(true);
              }}
            />
          </div>

          <div className="s-field">
            <div className="s-field-label">Drafting system prompt</div>
            <div className="s-field-desc">
              Governs Job mode (first-person application drafts written in your voice).
              Built from the fields above; edit freely.
            </div>
            <textarea
              className="s-textarea"
              rows={7}
              spellCheck={false}
              value={persona}
              onChange={(e) => {
                setPersona(e.target.value);
                setPersonaEdited(true);
              }}
            />
          </div>
        </div>

        <div className="onboard-foot">
          <button className="btn btn-ghost" onClick={onSkip}>Skip</button>
          <button className="btn btn-primary" onClick={finish}>Get started</button>
        </div>
      </div>
    </div>
  );
}

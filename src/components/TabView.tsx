// One tab's main view. Renders the mode bar (Ask / Job / Write) with a model
// badge and, for Ask/Job, the input card (job description, question, RAG /
// Override / Skills controls) plus the streamed answer, activity log and
// follow-up bar. In Write mode the input card is replaced by the VaultWriter.
import { useState } from "react";
import type { Settings, Tab, SkillInfo } from "../lib/store";
import { effectiveEngineModel, effectiveEngineReasoning } from "../../shared/settings";
import type { ModelOption } from "../lib/api";
import { AnswerStream } from "./AnswerStream";
import { ActivityLog } from "./ActivityLog";
import { VaultWriter } from "./VaultWriter";
import { SkillPicker } from "./SkillPicker";

interface Props {
  tab: Tab;
  globalSettings: Settings;
  models: ModelOption[];
  engines: ModelOption[];
  skills: { humanizer: boolean; gemini: boolean; opencode: boolean; cursor: boolean; copilot: boolean; codex: boolean };
  availableSkills: SkillInfo[];
  engineLabel: string;
  model: string;
  onPatch: (patch: Partial<Tab>) => void;
  onGenerate: () => void;
  onFollowUp: (text: string) => void;
  onCleanup: () => void;
  onNewQuestion: () => void;
  onCancel: () => void;
  // Vault Writer callbacks
  onSummarize: () => void;
  onAutoPlace: () => void;
  onFillinScan: () => void;
  onFillinWrite: (questionId: string) => void;
  onConfirmFillinWrite: (questionId: string) => void;
  onWriteCleanup: () => void;
  onConfirmWrite: () => void;
}

const ASK_ICON = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M9.6 9.2a2.5 2.5 0 0 1 4.6 1.3c0 1.6-2.2 1.9-2.2 3.3" />
    <path d="M12 17.2h.01" />
  </svg>
);
const JOB_ICON = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);
const WRITE_ICON = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
  </svg>
);

/* Displays one tab's mode-specific editor, controls, streamed result, and activity. */
export function TabView({ tab, globalSettings, models, engines, skills, availableSkills, engineLabel, model, onPatch, onGenerate, onFollowUp, onCleanup, onNewQuestion, onCancel, onSummarize, onAutoPlace, onFillinScan, onFillinWrite, onConfirmFillinWrite, onWriteCleanup, onConfirmWrite }: Props) {
  const [followText, setFollowText] = useState("");
  const running =
    tab.phase === "draft" || tab.phase === "humanize" || tab.phase === "cleanup" || tab.phase === "followup";
  const isAsk = tab.mode === "ask";
  const isWrite = tab.mode === "write";
  const canGenerate = tab.question.trim().length > 0 && !running;
  const hasAnswer = Boolean(tab.answer || tab.draft);

  const ov = tab.override ?? globalSettings;
  const setOverride = (patch: Partial<Settings>) =>
    onPatch({ override: { ...(tab.override ?? globalSettings), ...patch } });
  const ovModel = effectiveEngineModel(ov);
  const ovReasoning = effectiveEngineReasoning(ov);

  const setOverrideModel = (m: string) => {
    setOverride({
      engineModels: { ...(ov.engineModels ?? {}), [ov.engine]: m },
      ...(ov.engine === "claude" ? { model: m } : {}),
    });
  };

  const setOverrideReasoning = (reasoning: string) => {
    const effort =
      reasoning === "low" || reasoning === "medium" || reasoning === "high" ? reasoning : ov.effort;
    setOverride({
      engineReasoning: { ...(ov.engineReasoning ?? {}), [ov.engine]: reasoning },
      ...(ov.engine === "claude" ? { effort } : {}),
    });
  };

  const toggleOverride = (on: boolean) =>
    onPatch({ overrideEnabled: on, override: on ? tab.override ?? { ...globalSettings } : tab.override });

  const sendFollow = () => {
    const t = followText.trim();
    if (!t || running) return;
    onFollowUp(t);
    setFollowText("");
  };

  return (
    <div className="tab-content">
      {/* Mode bar */}
      <div className="mode-bar">
        <button className={`mode-btn ${isAsk ? "active" : ""}`} onClick={() => onPatch({ mode: "ask" })} title="Ask general questions about your vault">
          {ASK_ICON}
          Ask the vault
        </button>
        <button className={`mode-btn ${tab.mode === "job" ? "active" : ""}`} onClick={() => onPatch({ mode: "job" })} title="Draft a job-application answer (grounded + humanized)">
          {JOB_ICON}
          Job mode
        </button>
        <button className={`mode-btn ${isWrite ? "active" : ""}`} onClick={() => onPatch({ mode: "write" })} title="Write new entries to your vault">
          {WRITE_ICON}
          Write to vault
        </button>
        <span className="mode-spacer" />
        <span className="model-badge" title={`${engineLabel} · ${model || "auto"}`}>
          <span className="model-badge-dot" />
          {model || engineLabel}
        </span>
      </div>

      {isWrite ? (
        <VaultWriter
          tab={tab}
          globalSettings={globalSettings}
          availableSkills={availableSkills}
          onPatch={onPatch}
          onSummarize={onSummarize}
          onAutoPlace={onAutoPlace}
          onFillinScan={onFillinScan}
          onFillinWrite={onFillinWrite}
          onConfirmFillinWrite={onConfirmFillinWrite}
          onWriteCleanup={onWriteCleanup}
          onConfirmWrite={onConfirmWrite}
          onCancel={onCancel}
        />
      ) : (
        <>
          {/* Input card */}
          <div className="input-card">
            {!isAsk && (
              <div>
                <label className="field-lbl">Job description</label>
                <textarea
                  className="f-area"
                  rows={5}
                  placeholder="Paste the job description (optional but recommended)…"
                  value={tab.jobDescription}
                  onChange={(e) => onPatch({ jobDescription: e.target.value })}
                />
              </div>
            )}

            <div>
              <label className="field-lbl">Question</label>
              <textarea
                className="f-area"
                rows={3}
                placeholder={isAsk ? "Ask anything about your vault…" : "The specific application question to answer…"}
                value={tab.question}
                onChange={(e) => onPatch({ question: e.target.value })}
              />
            </div>

            <div className="input-footer">
              {running ? (
                <button className="btn-cancel" onClick={onCancel}>
                  Stop
                </button>
              ) : (
                <button className="btn-primary" disabled={!canGenerate} onClick={onGenerate}>
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  {hasAnswer ? "Regenerate" : isAsk ? "Ask" : "Generate"}
                </button>
              )}
              <span className="gap-auto" />
              <button
                className={`pill-toggle ${tab.rag ? "on" : ""}`}
                onClick={() => onPatch({ rag: !tab.rag })}
                title="Retrieve only the most relevant vault excerpts instead of reading the whole vault — fewer tokens."
              >
                RAG
              </button>
              <button
                className={`pill-toggle ${tab.overrideEnabled ? "on" : ""}`}
                onClick={() => toggleOverride(!tab.overrideEnabled)}
                title="Override engine / model / vault for just this tab"
              >
                Override
              </button>
              <SkillPicker
                availableSkills={availableSkills}
                selected={tab.skills}
                onChange={(s) => onPatch({ skills: s })}
              />
            </div>

            {tab.overrideEnabled && (
              <div className="override-panel">
                <label className="field">
                  <span>Engine</span>
                  <select value={ov.engine} onChange={(e) => setOverride({ engine: e.target.value as Settings["engine"] })}>
                    {engines.map((en) => (
                      <option key={en.id} value={en.id}>
                        {en.label}
                      </option>
                    ))}
                  </select>
                </label>
                {ov.engine !== "claude" && !skills[ov.engine as keyof typeof skills] && (
                  <div className="vault-status bad">{ov.engine === "gemini" ? "agy" : ov.engine} CLI not found on PATH</div>
                )}
                <label className="field">
                  <span>Model</span>
                  <input
                    list={`override-model-options-${tab.id}`}
                    type="text"
                    value={ovModel}
                    placeholder={ov.engine === "opencode" ? "provider/model" : "model id"}
                    spellCheck={false}
                    onChange={(e) => setOverrideModel(e.target.value)}
                  />
                  <datalist id={`override-model-options-${tab.id}`}>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                    <option value="auto" />
                  </datalist>
                </label>
                <label className="field">
                  <span>Effort</span>
                  <input
                    list={`override-reasoning-options-${tab.id}`}
                    type="text"
                    value={ovReasoning}
                    placeholder="low, medium, high, max..."
                    spellCheck={false}
                    onChange={(e) => setOverrideReasoning(e.target.value)}
                  />
                  <datalist id={`override-reasoning-options-${tab.id}`}>
                    <option value="low" />
                    <option value="medium" />
                    <option value="high" />
                    <option value="minimal" />
                    <option value="max" />
                    <option value="xhigh" />
                  </datalist>
                </label>
                {!isAsk && (
                  <label className="field-row">
                    <input type="checkbox" checked={ov.humanize} onChange={(e) => setOverride({ humanize: e.target.checked })} />
                    <span>Humanize</span>
                  </label>
                )}
                <label className="field wide">
                  <span>Vault / context repo (this tab)</span>
                  <input type="text" value={ov.vaultDir} spellCheck={false} onChange={(e) => setOverride({ vaultDir: e.target.value })} />
                </label>
              </div>
            )}
          </div>

          <AnswerStream
            phase={tab.phase}
            mode={tab.mode}
            draft={tab.draft}
            answer={tab.answer}
            notice={tab.notice}
            error={tab.error}
            onEditAnswer={(text) => onPatch({ answer: text })}
            onCleanup={onCleanup}
            onRegenerate={onGenerate}
          />

          <ActivityLog activity={tab.activity} />

          {hasAnswer && (
            <div className="followup">
              <div className="followup-actions">
                <span className="followup-label">Same job, another question?</span>
                <button
                  className="btn-ghost"
                  title="Open a new tab with this job description — a fresh conversation"
                  onClick={onNewQuestion}
                >
                  + New question
                </button>
              </div>
              {tab.messages.filter((m) => m.role === "user").length > 0 && (
                <div className="follow-thread">
                  {tab.messages
                    .filter((m) => m.role === "user")
                    .map((m, i) => (
                      <div key={i} className="follow-bubble">
                        {m.text}
                      </div>
                    ))}
                </div>
              )}
              <div className="followup-bar">
                <input
                  className="followup-input"
                  type="text"
                  placeholder="Follow-up tweak — e.g. “make it shorter, lead with Lunara”…"
                  value={followText}
                  disabled={running}
                  onChange={(e) => setFollowText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") sendFollow();
                  }}
                />
                <button className="followup-send" disabled={running || !followText.trim()} onClick={sendFollow} title="Send follow-up" aria-label="Send follow-up">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

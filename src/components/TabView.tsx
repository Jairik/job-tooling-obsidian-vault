// One tab's main view. Renders the mode switch (Ask / Job / Write) and, for
// Ask/Job, the input card (job description, question, YC/RAG/Override controls)
// plus the streamed answer, activity log and follow-up box. In Write mode the
// inputs are replaced by the VaultWriter. Settings can be overridden per tab.
import { useState } from "react";
import type { Settings, Tab, SkillInfo } from "../lib/store";
import { effectiveEngineModel, effectiveEngineReasoning } from "../lib/store";
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

export function TabView({ tab, globalSettings, models, engines, skills, availableSkills, onPatch, onGenerate, onFollowUp, onCleanup, onNewQuestion, onCancel, onSummarize, onAutoPlace, onFillinScan, onFillinWrite, onConfirmFillinWrite, onWriteCleanup, onConfirmWrite }: Props) {
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

  const setOverrideModel = (model: string) => {
    setOverride({
      engineModels: { ...(ov.engineModels ?? {}), [ov.engine]: model },
      ...(ov.engine === "claude" ? { model } : {}),
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
    <div className="tabview">
      <div className={`card inputs${isWrite ? " inputs-write" : ""}`}>
        <div className="card-h">
          <h2>{isWrite ? "Write to vault" : isAsk ? "Ask the vault" : "New answer"}</h2>
          <div className="mode-switch" role="group" aria-label="Mode">
            <button
              className={isAsk ? "active" : ""}
              onClick={() => onPatch({ mode: "ask" })}
              title="Ask general questions about your vault"
            >
              Ask
            </button>
            <button
              className={tab.mode === "job" ? "active" : ""}
              onClick={() => onPatch({ mode: "job" })}
              title="Draft a job-application answer (grounded + humanized)"
            >
              Job
            </button>
            <button
              className={isWrite ? "active" : ""}
              onClick={() => onPatch({ mode: "write" })}
              title="Write new entries to your vault"
            >
              Write
            </button>
          </div>
        </div>
        {!isWrite && (
        <div className="card-b">
        {!isAsk && (
          <label className="field">
            <div className="field-head">
              <span>Job description</span>
              <span className="aux">optional</span>
            </div>
            <textarea
              rows={6}
              placeholder="Paste the job description (optional but recommended)…"
              value={tab.jobDescription}
              onChange={(e) => onPatch({ jobDescription: e.target.value })}
            />
          </label>
        )}

        <label className="field">
          <div className="field-head">
            <span>Question</span>
            <span className="aux">required</span>
          </div>
          <textarea
            rows={3}
            placeholder={isAsk ? "Ask anything about your vault…" : "The specific application question to answer…"}
            value={tab.question}
            onChange={(e) => onPatch({ question: e.target.value })}
          />
        </label>

        <div className="controls">
          <SkillPicker
            availableSkills={availableSkills}
            selected={tab.skills}
            onChange={(s) => onPatch({ skills: s })}
          />

          <label className="chip" title="Retrieve only the most relevant vault excerpts instead of reading the whole vault — fewer tokens.">
            <input type="checkbox" checked={tab.rag} onChange={(e) => onPatch({ rag: e.target.checked })} />
            <span>RAG</span>
            {tab.rag && <span className="chip-note muted">fewer tokens</span>}
          </label>

          <label className="chip">
            <input
              type="checkbox"
              checked={tab.overrideEnabled}
              onChange={(e) => toggleOverride(e.target.checked)}
            />
            <span>Override</span>
          </label>

          <div className="spacer" />

          {running ? (
            <button className="btn btn-cancel" onClick={onCancel}>
              Stop
            </button>
          ) : (
            <button className="btn btn-primary" disabled={!canGenerate} onClick={onGenerate}>
              {hasAnswer ? "Regenerate" : isAsk ? "Ask" : "Generate"}
            </button>
          )}
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
        )}
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
                  className="btn btn-ghost"
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
              <div className="follow-input">
                <input
                  type="text"
                  placeholder="Follow-up tweak — e.g. “make it shorter, lead with Lunara”…"
                  value={followText}
                  disabled={running}
                  onChange={(e) => setFollowText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") sendFollow();
                  }}
                />
                <button className="btn" disabled={running || !followText.trim()} onClick={sendFollow}>
                  Send
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

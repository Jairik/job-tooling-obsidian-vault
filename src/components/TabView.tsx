import { useState } from "react";
import type { Settings, Tab } from "../lib/store";
import type { ModelOption } from "../lib/api";
import { AnswerStream } from "./AnswerStream";
import { ActivityLog } from "./ActivityLog";

interface Props {
  tab: Tab;
  globalSettings: Settings;
  models: ModelOption[];
  engines: ModelOption[];
  skills: { yc: boolean; humanizer: boolean; gemini: boolean };
  onPatch: (patch: Partial<Tab>) => void;
  onGenerate: () => void;
  onFollowUp: (text: string) => void;
  onCancel: () => void;
}

export function TabView({ tab, globalSettings, models, engines, skills, onPatch, onGenerate, onFollowUp, onCancel }: Props) {
  const [followText, setFollowText] = useState("");
  const running = tab.phase === "draft" || tab.phase === "humanize" || tab.phase === "followup";
  const canGenerate = tab.question.trim().length > 0 && !running;
  const hasAnswer = Boolean(tab.answer || tab.draft);

  const ov = tab.override ?? globalSettings;
  const setOverride = (patch: Partial<Settings>) =>
    onPatch({ override: { ...(tab.override ?? globalSettings), ...patch } });

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
      <div className="card inputs">
        <div className="card-h">
          <h2>New answer</h2>
          <span className="hint">grounded in your vault</span>
        </div>
        <div className="card-b">
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

        <label className="field">
          <div className="field-head">
            <span>Question</span>
            <span className="aux">required</span>
          </div>
          <textarea
            rows={3}
            placeholder="The specific application question to answer…"
            value={tab.question}
            onChange={(e) => onPatch({ question: e.target.value })}
          />
        </label>

        <div className="controls">
          <label className="chip">
            <input type="checkbox" checked={tab.yc} onChange={(e) => onPatch({ yc: e.target.checked })} />
            <span>YC</span>
            {tab.yc && !skills.yc && <span className="chip-note warn">skill not found</span>}
          </label>

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
              {hasAnswer ? "Regenerate" : "Generate"}
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
            {ov.engine === "gemini" && !skills.gemini && (
              <div className="vault-status bad">agy CLI not found on PATH</div>
            )}
            {ov.engine === "claude" && (
              <>
                <label className="field">
                  <span>Model</span>
                  <select value={ov.model} onChange={(e) => setOverride({ model: e.target.value })}>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Effort</span>
                  <select value={ov.effort} onChange={(e) => setOverride({ effort: e.target.value as Settings["effort"] })}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
              </>
            )}
            <label className="field-row">
              <input type="checkbox" checked={ov.humanize} onChange={(e) => setOverride({ humanize: e.target.checked })} />
              <span>Humanize</span>
            </label>
            <label className="field wide">
              <span>Vault / context repo (this tab)</span>
              <input type="text" value={ov.vaultDir} spellCheck={false} onChange={(e) => setOverride({ vaultDir: e.target.value })} />
            </label>
          </div>
        )}
        </div>
      </div>

      <AnswerStream phase={tab.phase} draft={tab.draft} answer={tab.answer} notice={tab.notice} error={tab.error} />

      <ActivityLog activity={tab.activity} />

      {hasAnswer && (
        <div className="followup">
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
    </div>
  );
}

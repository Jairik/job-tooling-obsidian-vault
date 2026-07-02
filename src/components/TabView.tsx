// One tab's main view. Renders the mode bar (Ask / Job / Write) with a model
// badge and, for Ask/Job, the input card (job description, question, RAG /
// Override / Skills controls) plus the streamed answer, activity log and
// follow-up bar. In Write mode the input card is replaced by the VaultWriter.
import { useRef, useState, type KeyboardEvent } from "react";
import type { Settings, Tab, SkillInfo } from "../lib/store";
import { effectiveEngineModel, effectiveEngineReasoning } from "../../shared/settings";
import type { ModelOption } from "../lib/api";
import { AnswerStream } from "./AnswerStream";
import { ActivityLog } from "./ActivityLog";
import { VaultWriter } from "./VaultWriter";
import { SkillPicker } from "./SkillPicker";
import { formatSize } from "../lib/format";

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
  // Additional context (drafting mode) + LaTeX output
  onAttach: (file: File) => Promise<void>;
  onRemoveAttachment: (id: string) => void;
  onLatexRecompile: (tex: string) => void;
  // Vault Writer callbacks
  onSummarize: () => void;
  onAutoPlace: () => void;
  onFillinScan: () => void;
  onFillinWrite: (questionId: string) => void;
  onConfirmFillinWrite: (questionId: string) => void;
  onWriteCleanup: () => void;
  onConfirmWrite: () => void;
  onDocUpload: (file: File) => Promise<void>;
  onDocPropose: () => void;
  onDocWrite: (proposalId: string) => void;
  onDocDismiss: (proposalId: string) => void;
}

const ASK_ICON = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M9.6 9.2a2.5 2.5 0 0 1 4.6 1.3c0 1.6-2.2 1.9-2.2 3.3" />
    <path d="M12 17.2h.01" />
  </svg>
);
const DRAFT_ICON = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);
const WRITE_ICON = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
  </svg>
);

/* Displays one tab's mode-specific editor, controls, streamed result, and activity. */
export function TabView({ tab, globalSettings, models, engines, skills, availableSkills, engineLabel, model, onPatch, onGenerate, onFollowUp, onCleanup, onNewQuestion, onCancel, onAttach, onRemoveAttachment, onLatexRecompile, onSummarize, onAutoPlace, onFillinScan, onFillinWrite, onConfirmFillinWrite, onWriteCleanup, onConfirmWrite, onDocUpload, onDocPropose, onDocWrite, onDocDismiss }: Props) {
  const [followText, setFollowText] = useState("");
  // Lets a keyboard shortcut (Ctrl/Cmd+/) open the Skills picker for this pane.
  const [skillsOpen, setSkillsOpen] = useState(false);
  // "Additional context" chevron dropdown + its hidden file input.
  const [ctxMenuOpen, setCtxMenuOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const running =
    tab.phase === "draft" || tab.phase === "humanize" || tab.phase === "cleanup" || tab.phase === "followup" || tab.phase === "render";
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

  // Pane-level shortcuts that should work from anywhere in this tab's editor:
  // Ctrl/Cmd+Enter submits (handy from the multi-line context field), and
  // Ctrl/Cmd+/ opens the Skills picker. The Question field's own handler claims
  // plain Enter (submit) and stops Ctrl/Cmd/Shift+Enter from bubbling here so it
  // can insert a newline instead.
  const onPaneKeyDown = (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      if (canGenerate) onGenerate();
    } else if (e.key === "/") {
      e.preventDefault();
      setSkillsOpen(true);
    }
  };

  // Question field: Enter sends; Shift/Ctrl/Cmd+Enter inserts a newline.
  const onQuestionKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      e.stopPropagation(); // let the textarea insert a newline; don't let the pane handler submit
      return;
    }
    e.preventDefault();
    if (canGenerate) onGenerate();
  };

  /* Uploads the picked document; the chip appears when extraction succeeds. */
  const handleFilePicked = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await onAttach(file);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="tab-content" onKeyDown={onPaneKeyDown}>
      {/* Mode bar */}
      <div className="mode-bar">
        <button className={`mode-btn ${isAsk ? "active" : ""}`} onClick={() => onPatch({ mode: "ask" })} title="Ask general questions about your vault">
          {ASK_ICON}
          Ask the vault
        </button>
        <button className={`mode-btn ${tab.mode === "job" ? "active" : ""}`} onClick={() => onPatch({ mode: "job" })} title="Create a grounded + humanized draft">
          {DRAFT_ICON}
          Drafting mode
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
          skillsOpen={skillsOpen}
          onSkillsOpenChange={setSkillsOpen}
          onPatch={onPatch}
          onSummarize={onSummarize}
          onAutoPlace={onAutoPlace}
          onFillinScan={onFillinScan}
          onFillinWrite={onFillinWrite}
          onConfirmFillinWrite={onConfirmFillinWrite}
          onWriteCleanup={onWriteCleanup}
          onConfirmWrite={onConfirmWrite}
          onDocUpload={onDocUpload}
          onDocPropose={onDocPropose}
          onDocWrite={onDocWrite}
          onDocDismiss={onDocDismiss}
          onCancel={onCancel}
        />
      ) : (
        <>
          {/* Input card */}
          <div className="input-card">
            {!isAsk && (
              <div>
                <label className="field-lbl">Draft context / details</label>
                <textarea
                  className="f-area"
                  rows={5}
                  placeholder="Paste context, details, or a job description (optional but recommended)…"
                  value={tab.jobDescription}
                  onChange={(e) => onPatch({ jobDescription: e.target.value })}
                />
              </div>
            )}

            {!isAsk && tab.extraContextOpen && (
              <div>
                <div className="field-head">
                  <label className="field-lbl">Additional context</label>
                  <button
                    className="ctx-remove-btn"
                    title="Remove the additional context field"
                    aria-label="Remove additional context"
                    onClick={() => onPatch({ extraContextOpen: false, extraContext: "" })}
                  >
                    ×
                  </button>
                </div>
                <textarea
                  className="f-area"
                  rows={4}
                  placeholder="Extra material to ground the draft — notes, prior answers, background…"
                  value={tab.extraContext}
                  onChange={(e) => onPatch({ extraContext: e.target.value })}
                />
              </div>
            )}

            <div>
              <div className="field-head">
                <label className="field-lbl">Question</label>
                {!isAsk && (
                  <div className="ctx-add-wrap">
                    <button
                      className={`ctx-add-btn ${ctxMenuOpen ? "active" : ""}`}
                      title="Add additional context — an extra text field or a document"
                      aria-label="Add additional context"
                      disabled={uploading}
                      onClick={() => setCtxMenuOpen((o) => !o)}
                    >
                      {uploading ? (
                        <span className="ctx-uploading">Extracting…</span>
                      ) : (
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      )}
                    </button>
                    {ctxMenuOpen && (
                      <>
                        <div className="ctx-menu-backdrop" onClick={() => setCtxMenuOpen(false)} />
                        <div className="ctx-menu">
                          <button
                            onClick={() => {
                              onPatch({ extraContextOpen: true });
                              setCtxMenuOpen(false);
                            }}
                          >
                            Additional text field
                          </button>
                          <button
                            onClick={() => {
                              setCtxMenuOpen(false);
                              fileInputRef.current?.click();
                            }}
                          >
                            Attach document (PDF / DOCX)
                          </button>
                        </div>
                      </>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        void handleFilePicked(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </div>
                )}
              </div>
              <textarea
                className="f-area"
                rows={3}
                placeholder={isAsk ? "Ask anything about your vault…" : "The specific application question to answer…"}
                value={tab.question}
                onChange={(e) => onPatch({ question: e.target.value })}
                onKeyDown={onQuestionKeyDown}
              />
              {!isAsk && tab.attachments.length > 0 && (
                <div className="attach-row">
                  {tab.attachments.map((a) => (
                    <span key={a.id} className={`attach-chip ${a.expired ? "expired" : ""}`} title={a.expired ? "No longer on the server — re-attach it" : `${a.chars.toLocaleString()} characters extracted`}>
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                      {a.name} · {formatSize(a.size)}
                      {a.truncated && <span className="aux">truncated</span>}
                      {a.expired && <span className="aux">expired</span>}
                      <button className="attach-x" title="Remove attachment" aria-label={`Remove ${a.name}`} onClick={() => onRemoveAttachment(a.id)}>
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
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
                className={`pill-toggle ${tab.latex ? "on" : ""}`}
                onClick={() => onPatch({ latex: !tab.latex })}
                title="Return the answer as a compiled PDF document (LaTeX via tectonic), with .tex and .pdf downloads."
              >
                LaTeX
              </button>
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
                open={skillsOpen}
                onOpenChange={setSkillsOpen}
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
            latex={
              tab.latex
                ? {
                    tex: tab.texSource,
                    pdfUrl: tab.latexCompileId ? `/api/latex/${tab.latexCompileId}/pdf` : "",
                    log: tab.latexLog,
                    compiling: Boolean(tab.latexBusy),
                    onRecompile: onLatexRecompile,
                  }
                : undefined
            }
            onEditAnswer={(text) => onPatch({ answer: text })}
            onCleanup={onCleanup}
            onRegenerate={onGenerate}
          />

          <ActivityLog activity={tab.activity} />

          {hasAnswer && (
            <div className="followup">
              <div className="followup-actions">
                <span className="followup-label">Same context, another question?</span>
                <button
                  className="btn-ghost"
                  title="Open a new tab with this draft context — a fresh conversation"
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

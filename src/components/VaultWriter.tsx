// The "Write to vault" UI, shown when a tab is in write mode. Four sub-modes:
//   summarize — condense pasted text or a fetched URL into a markdown note
//   manual    — write a note by hand, optionally cleaning it up or auto-placing it
//   fillin    — scan the vault for gaps, then draft answers to fill them in
//   document  — upload a PDF/DOCX; the model proposes vault writes from its text
// Drafting streams a preview into the tab; nothing touches disk until the user
// explicitly approves each write (the parent surfaces a diff + approval modal).
import { useRef, useState } from "react";
import { type Tab, type Settings, type SkillInfo } from "../lib/store";
import { VaultPathPicker } from "./VaultPathPicker";
import { SkillPicker } from "./SkillPicker";
import { ActivityLog } from "./ActivityLog";
import { formatSize } from "../lib/format";

interface Props {
  tab: Tab;
  globalSettings: Settings;
  availableSkills: SkillInfo[];
  // Lets the parent open the Skills picker via the Ctrl/Cmd+/ shortcut.
  skillsOpen?: boolean;
  onSkillsOpenChange?: (open: boolean) => void;
  onPatch: (patch: Partial<Tab>) => void;
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
  onCancel: () => void;
}

/* Provides the summarize, placement, fill-in, cleanup, and write-to-vault workflow. */
export function VaultWriter({
  tab,
  globalSettings,
  availableSkills,
  skillsOpen,
  onSkillsOpenChange,
  onPatch,
  onSummarize,
  onAutoPlace,
  onFillinScan,
  onFillinWrite,
  onConfirmFillinWrite,
  onWriteCleanup,
  onConfirmWrite,
  onDocUpload,
  onDocPropose,
  onDocWrite,
  onDocDismiss,
  onCancel,
}: Props) {
  const running =
    tab.phase === "draft" || tab.phase === "humanize" || tab.phase === "cleanup" || tab.phase === "followup" || tab.phase === "render";
  // Document sub-mode: hidden file input + in-flight upload state.
  const docInputRef = useRef<HTMLInputElement>(null);
  const [docUploading, setDocUploading] = useState(false);
  // "Edit manually" toggles per proposal card.
  const [editingProposals, setEditingProposals] = useState<Record<string, boolean>>({});

  const handleDocPicked = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setDocUploading(true);
    try {
      await onDocUpload(file);
    } finally {
      setDocUploading(false);
    }
  };

  const patchProposal = (id: string, patch: Partial<Tab["docProposals"][number]>) =>
    onPatch({ docProposals: tab.docProposals.map((p) => (p.id === id ? { ...p, ...patch } : p)) });

  const renderSummarize = () => (
    <div className="vw-submode">
      <label className="field">
        <div className="field-head">
          <span>Source Content or URL</span>
        </div>
        <textarea
          rows={5}
          placeholder="Paste an article, text, or a URL starting with http:// or https://..."
          value={tab.writeInput}
          onChange={(e) => onPatch({ writeInput: e.target.value })}
          disabled={running}
          className="vw-input"
        />
      </label>
      <div className="vw-actions">
        {running ? (
          <button className="btn btn-cancel" onClick={onCancel}>Stop</button>
        ) : (
          <button 
            className="btn btn-primary" 
            onClick={onSummarize}
            disabled={!tab.writeInput.trim()}
          >
            Summarize
          </button>
        )}
      </div>

      {tab.writePreview && (
        <div className="vw-preview-section">
          <label className="field">
            <div className="field-head"><span>Summary Preview</span></div>
            <div className="vw-preview">{tab.writePreview}</div>
          </label>
          <label className="field">
            <div className="field-head"><span>Save Path</span></div>
            <VaultPathPicker
              vaultDir={globalSettings.vaultDir}
              value={tab.writePath}
              onChange={(path) => onPatch({ writePath: path })}
              allowNewFile={true}
              placeholder="e.g. Topics/summary.md"
            />
          </label>
          <div className="vw-actions vw-confirm-actions">
            <button 
              className="btn vw-confirm-btn" 
              onClick={onConfirmWrite}
              disabled={!tab.writePath || running}
            >
              Write to Vault
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const renderManual = () => (
    <div className="vw-submode">
      <label className="field">
        <div className="field-head"><span>Target Path</span></div>
        <VaultPathPicker
          vaultDir={globalSettings.vaultDir}
          value={tab.writePath}
          onChange={(path) => onPatch({ writePath: path })}
          allowNewFile={true}
          placeholder="e.g. Projects/new-project.md"
        />
      </label>
      <label className="field">
        <div className="field-head"><span>Content</span></div>
        <textarea
          rows={10}
          placeholder="Write your vault entry here..."
          value={tab.writeInput}
          onChange={(e) => onPatch({ writeInput: e.target.value })}
          disabled={running}
          className="vw-input"
        />
      </label>
      <div className="vw-actions">
        {running ? (
          <button className="btn btn-cancel" onClick={onCancel}>Stop</button>
        ) : (
          <>
            <button 
              className="btn btn-ghost" 
              onClick={onWriteCleanup}
              disabled={!tab.writeInput.trim()}
            >
              Clean up / Format
            </button>
            <button 
              className="btn btn-ghost" 
              onClick={onAutoPlace}
              disabled={!tab.writeInput.trim()}
            >
              Auto-place
            </button>
            <div className="spacer" />
            <button 
              className="btn btn-primary vw-confirm-btn" 
              onClick={onConfirmWrite}
              disabled={!tab.writePath || !tab.writeInput.trim()}
            >
              Write to Vault
            </button>
          </>
        )}
      </div>
      {tab.writePreview && (
        <div className="vw-preview-section">
          <label className="field">
            <div className="field-head">
              <span>Formatted Preview</span>
              <button 
                className="btn btn-ghost vw-use-preview" 
                onClick={() => onPatch({ writeInput: tab.writePreview, writePreview: "" })}
              >
                Use this
              </button>
            </div>
            <div className="vw-preview">{tab.writePreview}</div>
          </label>
        </div>
      )}
    </div>
  );

  const renderFillin = () => (
    <div className="vw-submode">
      <label className="field">
        <div className="field-head">
          <span>Focus Area</span>
          <span className="aux">optional</span>
        </div>
        <textarea
          rows={2}
          placeholder="What area should I focus on finding gaps in?"
          value={tab.writeInput}
          onChange={(e) => onPatch({ writeInput: e.target.value })}
          disabled={running}
          className="vw-input"
        />
      </label>
      <label className="field">
        <div className="field-head">
          <span>Directory Scope</span>
          <span className="aux">optional</span>
        </div>
        <VaultPathPicker
          vaultDir={globalSettings.vaultDir}
          value={tab.fillinDir || ""}
          onChange={(path) => onPatch({ fillinDir: path })}
          allowNewFile={false}
          placeholder="Entire vault"
        />
      </label>
      <div className="vw-actions">
        {running ? (
          <button className="btn btn-cancel" onClick={onCancel}>Stop</button>
        ) : (
          <button 
            className="btn btn-primary" 
            onClick={onFillinScan}
          >
            Scan Vault for Gaps
          </button>
        )}
      </div>

      {tab.fillinQuestions && tab.fillinQuestions.length > 0 && (
        <div className="vw-fillin-questions">
          {tab.fillinQuestions.map((q) => (
            <div key={q.id} className="vw-fillin-card card">
              <div className="card-h">
                <span className="vw-fillin-question">{q.question}</span>
                <span className={`vw-fillin-status ${q.written ? 'ok' : ''}`}>
                  {q.written ? (
                    <>
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      Written
                    </>
                  ) : 'Pending'}
                </span>
              </div>
              {!q.written && (
                <div className="card-b">
                  <textarea
                    rows={3}
                    placeholder="Type your answer here..."
                    value={q.answer}
                    onChange={(e) => {
                      const newQs = tab.fillinQuestions.map(xq => xq.id === q.id ? { ...xq, answer: e.target.value } : xq);
                      onPatch({ fillinQuestions: newQs });
                    }}
                    disabled={running}
                    className="vw-fillin-answer"
                  />
                  <div className="vw-actions" style={{ marginTop: 8 }}>
                    <button 
                      className="btn btn-ghost" 
                      onClick={() => onFillinWrite(q.id)}
                      disabled={!q.answer.trim() || running}
                    >
                      {q.preview ? 'Regenerate Draft' : 'Draft Entry'}
                    </button>
                    {q.targetPath && <span className="aux">Target: {q.targetPath}</span>}
                  </div>
                  {q.preview && (
                    <div className="vw-preview-section" style={{ marginTop: '16px' }}>
                      <label className="field">
                        <div className="field-head">
                          <span>Draft Preview</span>
                          <button 
                            className="btn btn-ghost vw-use-preview" 
                            onClick={() => {
                              const newQs = tab.fillinQuestions?.map(xq => xq.id === q.id ? { ...xq, answer: q.preview || "", preview: undefined } : xq);
                              onPatch({ fillinQuestions: newQs });
                            }}
                            title="Edit this draft manually"
                          >
                            Edit Manually
                          </button>
                        </div>
                        <div className="vw-preview">{q.preview}</div>
                      </label>
                      <div className="vw-actions vw-confirm-actions">
                        <button 
                          className="btn btn-primary vw-confirm-btn" 
                          onClick={() => onConfirmFillinWrite(q.id)}
                          disabled={running}
                        >
                          Confirm & Write
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderDocument = () => (
    <div className="vw-submode">
      <label className="field">
        <div className="field-head">
          <span>Document</span>
        </div>
        <div className="vw-doc-upload">
          <button className="btn btn-ghost" onClick={() => docInputRef.current?.click()} disabled={running || docUploading}>
            {docUploading ? "Extracting…" : tab.docAttachment ? "Replace document" : "Choose PDF or DOCX"}
          </button>
          <input
            ref={docInputRef}
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            style={{ display: "none" }}
            onChange={(e) => {
              void handleDocPicked(e.target.files);
              e.target.value = "";
            }}
          />
          {tab.docAttachment && (
            <span className={`attach-chip ${tab.docAttachment.expired ? "expired" : ""}`} title={`${tab.docAttachment.chars.toLocaleString()} characters extracted`}>
              {tab.docAttachment.name} · {formatSize(tab.docAttachment.size)}
              {tab.docAttachment.truncated && <span className="aux">truncated</span>}
              {tab.docAttachment.expired && <span className="aux">expired — re-upload</span>}
              <button
                className="attach-x"
                title="Remove document"
                aria-label="Remove document"
                onClick={() => onPatch({ docAttachment: undefined, docProposals: [] })}
              >
                ×
              </button>
            </span>
          )}
        </div>
      </label>
      <label className="field">
        <div className="field-head">
          <span>Focus</span>
          <span className="aux">optional</span>
        </div>
        <textarea
          rows={2}
          placeholder="What should I focus on when placing this document's content?"
          value={tab.writeInput}
          onChange={(e) => onPatch({ writeInput: e.target.value })}
          disabled={running}
          className="vw-input"
        />
      </label>
      <div className="vw-actions">
        {running ? (
          <button className="btn btn-cancel" onClick={onCancel}>Stop</button>
        ) : (
          <button
            className="btn btn-primary"
            onClick={onDocPropose}
            disabled={!tab.docAttachment || tab.docAttachment.expired || docUploading}
          >
            Analyze & Propose
          </button>
        )}
      </div>

      {tab.docProposals.length > 0 && (
        <div className="vw-fillin-questions">
          {tab.docProposals.map((p) => (
            <div key={p.id} className={`vw-fillin-card card ${p.status === "rejected" ? "vw-proposal-rejected" : ""}`}>
              <div className="card-h">
                <span className={`action-badge ${p.action}`}>{p.action}</span>
                <span className="vw-fillin-question">{p.targetPath}</span>
                <span className={`vw-fillin-status ${p.status === "written" ? "ok" : ""}`}>
                  {p.status === "written" ? (
                    <>
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      Written
                    </>
                  ) : p.status === "rejected" ? "Dismissed" : "Pending"}
                </span>
              </div>
              {p.status !== "written" && p.status !== "rejected" && (
                <div className="card-b">
                  <div className="vw-proposal-rationale aux">{p.rationale}</div>
                  <label className="field">
                    <div className="field-head">
                      <span>Target Path</span>
                    </div>
                    <VaultPathPicker
                      vaultDir={globalSettings.vaultDir}
                      value={p.targetPath}
                      onChange={(path) => patchProposal(p.id, { targetPath: path })}
                      allowNewFile={true}
                      placeholder="e.g. Projects/new-project.md"
                    />
                  </label>
                  <label className="field">
                    <div className="field-head">
                      <span>Proposed Content</span>
                      <button
                        className="btn btn-ghost vw-use-preview"
                        onClick={() => setEditingProposals((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
                      >
                        {editingProposals[p.id] ? "Done editing" : "Edit manually"}
                      </button>
                    </div>
                    {editingProposals[p.id] ? (
                      <textarea
                        rows={8}
                        className="vw-input"
                        value={p.content}
                        onChange={(e) => patchProposal(p.id, { content: e.target.value })}
                      />
                    ) : (
                      <div className="vw-preview">{p.content}</div>
                    )}
                  </label>
                  <div className="vw-actions vw-confirm-actions">
                    <button className="btn btn-ghost" onClick={() => onDocDismiss(p.id)} disabled={running}>
                      Dismiss
                    </button>
                    <button className="btn btn-primary vw-confirm-btn" onClick={() => onDocWrite(p.id)} disabled={running || !p.targetPath}>
                      Review & Write
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="vw-container">
      {tab.error && <div className="vw-status-banner bad">{tab.error}</div>}
      {tab.writeConfirmed && !tab.error && <div className="vw-status-banner ok">Successfully written to vault!</div>}
      
      <div className="card inputs">
        <div className="card-h">
          {/* Switching sub-mode clears the stale preview + confirmation banner.
              Fill-in keeps its writePreview untouched — its drafts live per
              question in tab.fillinQuestions, not in the shared writePreview. */}
          <div className="vw-mode-switch mode-switch" role="group">
            <button
              className={tab.writeMode === "summarize" ? "active" : ""}
              onClick={() => onPatch({ writeMode: "summarize", writePreview: "", writeConfirmed: false, error: "" })}
            >
              Summarize
            </button>
            <button
              className={tab.writeMode === "manual" ? "active" : ""}
              onClick={() => onPatch({ writeMode: "manual", writePreview: "", writeConfirmed: false, error: "" })}
            >
              Manual
            </button>
            <button
              className={tab.writeMode === "fillin" ? "active" : ""}
              onClick={() => onPatch({ writeMode: "fillin", writeConfirmed: false, error: "" })}
            >
              Fill-in
            </button>
            <button
              className={tab.writeMode === "document" ? "active" : ""}
              onClick={() => onPatch({ writeMode: "document", writePreview: "", writeConfirmed: false, error: "" })}
            >
              Document
            </button>
          </div>
        </div>
        <div className="card-b">
          <div className="vw-skill-row">
            <SkillPicker
              availableSkills={availableSkills}
              selected={tab.skills}
              onChange={(s) => onPatch({ skills: s })}
              title="Skills to apply when drafting vault content (summarize / format / fill-in)"
              open={skillsOpen}
              onOpenChange={onSkillsOpenChange}
            />
            <span className="vw-skill-hint">Applied when drafting content (not to gap scans or path suggestions).</span>
          </div>
          {tab.writeMode === "summarize" && renderSummarize()}
          {tab.writeMode === "manual" && renderManual()}
          {tab.writeMode === "fillin" && renderFillin()}
          {tab.writeMode === "document" && renderDocument()}
        </div>
      </div>

      {/* The agent's thought process / tool loop for the current write action,
          mirroring the activity view shown in Ask and Job modes. */}
      <ActivityLog activity={tab.activity} />
    </div>
  );
}

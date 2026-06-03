// The "Write to vault" UI, shown when a tab is in write mode. Three sub-modes:
//   summarize — condense pasted text or a fetched URL into a markdown note
//   manual    — write a note by hand, optionally cleaning it up or auto-placing it
//   fillin    — scan the vault for gaps, then draft answers to fill them in
// Drafting streams a preview into the tab; nothing touches disk until the user
// explicitly confirms a save (the parent handles the actual vault write).
import { type Tab, type Settings } from "../lib/store";
import { VaultPathPicker } from "./VaultPathPicker";

interface Props {
  tab: Tab;
  globalSettings: Settings;
  onPatch: (patch: Partial<Tab>) => void;
  onSummarize: () => void;
  onAutoPlace: () => void;
  onFillinScan: () => void;
  onFillinWrite: (questionId: string) => void;
  onConfirmFillinWrite: (questionId: string) => void;
  onWriteCleanup: () => void;
  onConfirmWrite: () => void;
  onCancel: () => void;
}

export function VaultWriter({
  tab,
  globalSettings,
  onPatch,
  onSummarize,
  onAutoPlace,
  onFillinScan,
  onFillinWrite,
  onConfirmFillinWrite,
  onWriteCleanup,
  onConfirmWrite,
  onCancel,
}: Props) {
  const running =
    tab.phase === "draft" || tab.phase === "humanize" || tab.phase === "cleanup" || tab.phase === "followup";

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
                  {q.written ? '✓ Written' : 'Pending'}
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
          </div>
        </div>
        <div className="card-b">
          {tab.writeMode === "summarize" && renderSummarize()}
          {tab.writeMode === "manual" && renderManual()}
          {tab.writeMode === "fillin" && renderFillin()}
        </div>
      </div>
    </div>
  );
}

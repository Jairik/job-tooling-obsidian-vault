// Write to Vault. Four sub-modes (cycled with Ctrl+T; the global Shift+Tab switches
// between Ask/Draft/Write):
//   summarize — condense pasted text / a URL into a markdown note, then save
//   manual    — write a note by hand, optionally format or auto-place it, then save
//   fillin    — scan the vault for gaps, draft answers, and write each one
//   document  — upload an extracted PDF/DOCX and review proposed vault writes
// Nothing touches disk until an explicit write (Ctrl+W / Enter on a path).
import { Box, Text, useApp, useInput, useStdin } from "ink";
import { editInEditor } from "../lib/editor";
import { MultilineInput } from "./MultilineInput";
import { PathPicker } from "./PathPicker";
import { AnswerPane } from "./AnswerPane";
import { ActivityLog } from "./ActivityLog";
import { isRunning, type Session } from "../lib/session";
import type { Actions } from "../lib/actions";
import type { ServerSettings } from "../lib/api";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface Props {
  session: Session;
  settings: ServerSettings;
  patch: (p: Partial<Session>) => void;
  actions: Actions;
  focusId: string;
  active: boolean;
  width: number;
  previewHeight: number;
  showShortcuts?: boolean;
  openEditor: () => void;
}

export function WriteView({
  session,
  settings,
  patch,
  actions,
  focusId,
  active,
  width,
  previewHeight,
  showShortcuts = true,
  openEditor,
}: Props) {
  const running = isRunning(session.phase);
  const mode = session.writeMode;
  const { suspendTerminal } = useApp();
  const { setRawMode } = useStdin();

  // View-level action keys (Ctrl-combos don't collide with text input).
  useInput(
    (input, key) => {
      if (!key.ctrl) return;
      if (mode === "summarize") {
        if (input === "d" && !running) actions.runSummarize(session);
        if (input === "w" && session.writePreview && session.writePath) actions.confirmWrite(session);
      } else if (mode === "manual") {
        if (input === "f" && session.writeInput.trim() && !running) actions.runWriteCleanup(session);
        if (input === "p" && session.writeInput.trim() && !running) actions.runAutoPlace(session);
        if (input === "u" && session.writePreview) patch({ writeInput: session.writePreview, writePreview: "" });
        if (input === "w" && session.writePath && session.writeInput.trim()) actions.confirmWrite(session);
      } else if (mode === "fillin") {
        if (input === "d" && !running) actions.runFillinScan(session);
        if (input === "w" && focusId.startsWith("q:")) actions.confirmFillinWrite(session, focusId.slice(2));
      } else if (mode === "document") {
        if (input === "d" && session.docAttachment && !running) actions.runDocPropose(session);
        if (input === "w" && focusId.startsWith("p:")) actions.confirmDocWrite(session, focusId.slice(2));
        if (input === "x" && focusId.startsWith("p:")) actions.dismissDocProposal(session, focusId.slice(2));
      }
    },
    { isActive: active }
  );

  return (
    <Box flexDirection="column">
      {session.writeConfirmed && !session.error ? (
        <Text color="green">✓ Written to vault.</Text>
      ) : null}

      {mode === "summarize" ? (
        <Box flexDirection="column">
          <Text bold>
            Source content or URL {showShortcuts ? <Text dimColor>(Ctrl+O editor · Ctrl+D summarize)</Text> : null}
          </Text>
          <MultilineInput
            value={session.writeInput}
            onChange={(v) => patch({ writeInput: v, writeConfirmed: false })}
            focus={focusId === "wsource"}
            submitOnEnter={false}
            maxRows={5}
            placeholder="Paste an article/text, or a URL starting with http(s)://"
            onEditor={openEditor}
          />
          {session.writePreview ? (
            <Box flexDirection="column">
              <AnswerPane
                text={session.writePreview}
                width={width}
                height={previewHeight}
                label="Summary preview"
                streaming={running}
                showShortcuts={showShortcuts}
              />
              <Text bold>
                Save path {showShortcuts ? <Text dimColor>(→ complete dir · Enter / Ctrl+W to write)</Text> : null}
              </Text>
              <PathPicker
                vaultDir={settings.vaultDir}
                value={session.writePath}
                onChange={(v) => patch({ writePath: v })}
                onSubmit={() => actions.confirmWrite(session)}
                focus={focusId === "wpath"}
                placeholder="e.g. Topics/summary.md"
                showShortcuts={showShortcuts}
              />
            </Box>
          ) : null}
        </Box>
      ) : null}

      {mode === "manual" ? (
        <Box flexDirection="column">
          <Text bold>
            Target path {showShortcuts ? <Text dimColor>(Enter / Ctrl+W to write)</Text> : null}
          </Text>
          <PathPicker
            vaultDir={settings.vaultDir}
            value={session.writePath}
            onChange={(v) => patch({ writePath: v })}
            onSubmit={() => actions.confirmWrite(session)}
            focus={focusId === "wpath"}
            placeholder="e.g. Projects/new-project.md"
            showShortcuts={showShortcuts}
          />
          <Text bold>
            Content {showShortcuts ? <Text dimColor>(Ctrl+O editor · Ctrl+F format · Ctrl+P auto-place · Ctrl+W write)</Text> : null}
          </Text>
          <MultilineInput
            value={session.writeInput}
            onChange={(v) => patch({ writeInput: v, writeConfirmed: false })}
            focus={focusId === "wcontent"}
            submitOnEnter={false}
            maxRows={8}
            placeholder="Write your vault entry…"
            onEditor={openEditor}
          />
          {session.writePreview ? (
            <Box flexDirection="column">
              <AnswerPane
                text={session.writePreview}
                width={width}
                height={previewHeight}
                label={showShortcuts ? "Formatted preview (Ctrl+U to use as content)" : "Formatted preview"}
                streaming={running}
                showShortcuts={showShortcuts}
              />
            </Box>
          ) : null}
        </Box>
      ) : null}

      {mode === "fillin" ? (
        <Box flexDirection="column">
          <Text bold>
            Focus area {showShortcuts ? <Text dimColor>(optional · Enter or Ctrl+D to scan)</Text> : null}
          </Text>
          <MultilineInput
            value={session.writeInput}
            onChange={(v) => patch({ writeInput: v })}
            onSubmit={() => actions.runFillinScan(session)}
            focus={focusId === "wfocus"}
            maxRows={2}
            placeholder="What area should I look for gaps in?"
            onEditor={openEditor}
          />
          <Text bold>
            Directory scope <Text dimColor>(optional)</Text>
          </Text>
          <PathPicker
            vaultDir={settings.vaultDir}
            value={session.fillinDir}
            onChange={(v) => patch({ fillinDir: v })}
            onSubmit={() => actions.runFillinScan(session)}
            focus={focusId === "wdir"}
            placeholder="Entire vault"
            showShortcuts={showShortcuts}
          />
          {session.fillinQuestions.length > 0 ? (
            <Box flexDirection="column" marginTop={1}>
              {session.fillinQuestions.map((q) => {
                const isFocused = focusId === `q:${q.id}`;
                return (
                  <Box
                    key={q.id}
                    flexDirection="column"
                    borderStyle="round"
                    borderColor={isFocused ? "cyan" : "gray"}
                    paddingX={1}
                  >
                    <Text>
                      <Text color={q.written ? "green" : "yellow"}>{q.written ? "✓ " : "• "}</Text>
                      {q.question}
                      {q.targetPath ? <Text dimColor>{`  → ${q.targetPath}`}</Text> : null}
                    </Text>
                    {!q.written ? (
                      <MultilineInput
                        value={q.answer}
                        onChange={(v) =>
                          patch({
                            fillinQuestions: session.fillinQuestions.map((x) =>
                              x.id === q.id ? { ...x, answer: v } : x
                            ),
                          })
                        }
                        onSubmit={() => actions.runFillinWrite(session, q.id)}
                        focus={isFocused}
                        maxRows={3}
                        placeholder="Type your answer, then Enter to draft…"
                        onEditor={async () => {
                          const next = await editInEditor(q.answer, { setRawMode, suspendTerminal });
                          patch({
                            fillinQuestions: session.fillinQuestions.map((x) =>
                              x.id === q.id ? { ...x, answer: next } : x
                            ),
                          });
                        }}
                      />
                    ) : null}
                    {q.preview && !q.written ? (
                      <Box flexDirection="column">
                        <Text dimColor>{showShortcuts ? "Draft preview (Ctrl+W to write):" : "Draft preview:"}</Text>
                        <Text wrap="truncate-end">{q.preview.split("\n").slice(0, 4).join("  ")}</Text>
                      </Box>
                    ) : null}
                  </Box>
                );
              })}
            </Box>
          ) : null}
        </Box>
      ) : null}

      {mode === "document" ? (
        <Box flexDirection="column">
          <Text bold>
            Document path {showShortcuts ? <Text dimColor>(PDF/DOCX · Enter upload · Ctrl+D analyze)</Text> : null}
          </Text>
          <MultilineInput
            value={session.docUploadPath}
            onChange={(v) => patch({ docUploadPath: v })}
            onSubmit={() => actions.attachDocDocument(session, session.docUploadPath)}
            focus={focusId === "docpath"}
            maxRows={2}
            placeholder="/absolute/path/to/document.pdf"
          />
          {session.docAttachment ? (
            <Box paddingX={1}>
              <Text color={session.docAttachment.expired ? "red" : "green"}>
                {session.docAttachment.name} · {formatSize(session.docAttachment.size)} ·{" "}
                {session.docAttachment.chars.toLocaleString()} chars
                {session.docAttachment.truncated ? " · truncated" : ""}
              </Text>
            </Box>
          ) : null}
          <Text bold>
            Focus <Text dimColor>(optional)</Text>
          </Text>
          <MultilineInput
            value={session.writeInput}
            onChange={(v) => patch({ writeInput: v })}
            onSubmit={() => actions.runDocPropose(session)}
            focus={focusId === "docfocus"}
            maxRows={3}
            placeholder="What should I focus on when placing this document?"
            onEditor={openEditor}
          />

          {session.docProposals.length > 0 ? (
            <Box flexDirection="column" marginTop={1}>
              {session.docProposals.map((p) => {
                const isFocused = focusId === `p:${p.id}`;
                return (
                  <Box
                    key={p.id}
                    flexDirection="column"
                    borderStyle="round"
                    borderColor={isFocused ? "cyan" : p.status === "written" ? "green" : p.status === "rejected" ? "gray" : "yellow"}
                    paddingX={1}
                  >
                    <Text>
                      <Text color={p.status === "written" ? "green" : p.status === "rejected" ? "gray" : "yellow"}>
                        {p.status === "written" ? "✓ " : p.status === "rejected" ? "× " : "• "}
                      </Text>
                      <Text color="cyan">{p.action}</Text> {p.targetPath}
                      <Text dimColor>{`  ${p.status}`}</Text>
                    </Text>
                    {p.rationale ? <Text dimColor>{p.rationale}</Text> : null}
                    {p.status === "pending" ? (
                      <>
                        <Text wrap="truncate-end">{p.content.split("\n").slice(0, 5).join("  ")}</Text>
                        {showShortcuts ? <Text dimColor>Ctrl+W review/write · Ctrl+X dismiss</Text> : null}
                      </>
                    ) : null}
                  </Box>
                );
              })}
            </Box>
          ) : null}
        </Box>
      ) : null}

      <ActivityLog activity={session.activity} />
    </Box>
  );
}

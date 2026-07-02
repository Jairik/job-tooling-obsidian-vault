// Write to Vault. Three sub-modes (switched via the global mode cycle, Ctrl+T):
//   summarize — condense pasted text / a URL into a markdown note, then save
//   manual    — write a note by hand, optionally format or auto-place it, then save
//   fillin    — scan the vault for gaps, draft answers, and write each one
// Nothing touches disk until an explicit write (Ctrl+W / Enter on a path).
import { Box, Text, useInput } from "ink";
import { MultilineInput } from "./MultilineInput";
import { PathPicker } from "./PathPicker";
import { AnswerPane } from "./AnswerPane";
import { ActivityLog } from "./ActivityLog";
import { isRunning, type Session } from "../lib/session";
import type { Actions } from "../lib/actions";
import type { ServerSettings } from "../lib/api";

interface Props {
  session: Session;
  settings: ServerSettings;
  patch: (p: Partial<Session>) => void;
  actions: Actions;
  focusId: string;
  active: boolean;
  width: number;
  previewHeight: number;
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
  openEditor,
}: Props) {
  const running = isRunning(session.phase);
  const mode = session.writeMode;

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
            Source content or URL <Text dimColor>(Ctrl+O editor · Ctrl+D summarize)</Text>
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
              />
              <Text bold>
                Save path <Text dimColor>(→ complete dir · Enter / Ctrl+W to write)</Text>
              </Text>
              <PathPicker
                vaultDir={settings.vaultDir}
                value={session.writePath}
                onChange={(v) => patch({ writePath: v })}
                onSubmit={() => actions.confirmWrite(session)}
                focus={focusId === "wpath"}
                placeholder="e.g. Topics/summary.md"
              />
            </Box>
          ) : null}
        </Box>
      ) : null}

      {mode === "manual" ? (
        <Box flexDirection="column">
          <Text bold>
            Target path <Text dimColor>(Enter / Ctrl+W to write)</Text>
          </Text>
          <PathPicker
            vaultDir={settings.vaultDir}
            value={session.writePath}
            onChange={(v) => patch({ writePath: v })}
            onSubmit={() => actions.confirmWrite(session)}
            focus={focusId === "wpath"}
            placeholder="e.g. Projects/new-project.md"
          />
          <Text bold>
            Content <Text dimColor>(Ctrl+O editor · Ctrl+F format · Ctrl+P auto-place · Ctrl+W write)</Text>
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
                label="Formatted preview (Ctrl+U to use as content)"
                streaming={running}
              />
            </Box>
          ) : null}
        </Box>
      ) : null}

      {mode === "fillin" ? (
        <Box flexDirection="column">
          <Text bold>
            Focus area <Text dimColor>(optional · Enter or Ctrl+D to scan)</Text>
          </Text>
          <MultilineInput
            value={session.writeInput}
            onChange={(v) => patch({ writeInput: v })}
            onSubmit={() => actions.runFillinScan(session)}
            focus={focusId === "wfocus"}
            maxRows={2}
            placeholder="What area should I look for gaps in?"
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
                      />
                    ) : null}
                    {q.preview && !q.written ? (
                      <Box flexDirection="column">
                        <Text dimColor>Draft preview (Ctrl+W to write):</Text>
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

      <ActivityLog activity={session.activity} />
    </Box>
  );
}

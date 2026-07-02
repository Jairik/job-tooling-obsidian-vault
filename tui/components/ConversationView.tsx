// Ask the Vault + Drafting mode. Drafting adds a job-description field and a draft
// (pre-humanize) view toggle. Streams the answer into a scrollable pane and keeps a
// follow-up input once an answer exists.
import { useState } from "react";
import { Box, Text, useApp, useStdin } from "ink";
import { editInEditor } from "../lib/editor";
import { MultilineInput } from "./MultilineInput";
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
  width: number;
  answerHeight: number;
  viewDraft: boolean;
  showShortcuts?: boolean;
  openEditor: (field: "question" | "jobDescription" | "extraContext") => void;
}

export function ConversationView({
  session,
  settings,
  patch,
  actions,
  focusId,
  width,
  answerHeight,
  viewDraft,
  showShortcuts = true,
  openEditor,
}: Props) {
  const [follow, setFollow] = useState("");
  const { suspendTerminal } = useApp();
  const { setRawMode } = useStdin();
  const running = isRunning(session.phase);
  const isJob = session.mode === "job";
  const hasOutput = Boolean(session.answer || session.draft);
  const showFollow = session.phase === "done" && Boolean(session.answer);

  const submitQuestion = () => {
    if (running || !session.question.trim()) return;
    actions.runGenerate(session);
  };
  const submitFollow = () => {
    if (running || !follow.trim()) return;
    actions.runFollowUp(session, follow.trim());
    setFollow("");
  };

  const showingDraft = viewDraft && Boolean(session.draft);
  const paneText = showingDraft ? session.draft : session.answer || session.draft;
  const paneLabel = showingDraft
    ? "Draft (pre-humanize)"
    : running
      ? "Answer"
      : session.phase === "error"
        ? "Answer (error)"
        : "Answer";

  return (
    <Box flexDirection="column">
      {isJob ? (
        <Box flexDirection="column">
          <Text bold>
            Draft context {showShortcuts ? <Text dimColor>(Ctrl+O to edit in $EDITOR)</Text> : null}
          </Text>
          <MultilineInput
            value={session.jobDescription}
            onChange={(v) => patch({ jobDescription: v })}
            focus={focusId === "job"}
            submitOnEnter={false}
            maxRows={5}
            placeholder="Paste context or source material (optional)…"
            onEditor={() => openEditor("jobDescription")}
          />
          <Text bold>
            Additional context {showShortcuts ? <Text dimColor>(optional · Ctrl+O editor)</Text> : null}
          </Text>
          <MultilineInput
            value={session.extraContext}
            onChange={(v) => patch({ extraContext: v })}
            focus={focusId === "extra"}
            submitOnEnter={false}
            maxRows={4}
            placeholder="Extra background, prior notes, or constraints for this draft…"
            onEditor={() => openEditor("extraContext")}
          />
          <Box paddingX={1}>
            <Text dimColor>
              Attachments <Text color={session.attachments.length ? "yellow" : "gray"}>{session.attachments.length}</Text>{" "}
              {showShortcuts ? "(Ctrl+A add path)" : ""}
              {session.attachments.length
                ? ` · ${session.attachments.map((a) => a.name + (a.expired ? " expired" : "")).join(", ")}`
                : ""}
            </Text>
          </Box>
        </Box>
      ) : null}

      <Box flexDirection="column">
        <Text bold>
          {isJob ? "Question" : "Ask the vault"}{" "}
          {showShortcuts ? <Text dimColor>(Enter to send · Alt+Enter newline · Ctrl+O editor)</Text> : null}
        </Text>
        <MultilineInput
          value={session.question}
          onChange={(v) => patch({ question: v })}
          onSubmit={submitQuestion}
          focus={focusId === "question"}
          maxRows={5}
          placeholder={isJob ? "What specific question should I answer?" : "Ask anything grounded in your vault…"}
          onEditor={() => openEditor("question")}
        />
      </Box>

      <Box paddingX={1}>
        <Text dimColor>
          RAG <Text color={session.rag ? "green" : "gray"}>{session.rag ? "on" : "off"}</Text>
          {showShortcuts ? " (Ctrl+R)" : ""} · Skills{" "}
          <Text color={session.skills.length ? "yellow" : "gray"}>{session.skills.length}</Text>
          {showShortcuts ? " (Ctrl+K)" : ""}
          {" · "}
          LaTeX <Text color={session.latex ? "green" : "gray"}>{session.latex ? "on" : "off"}</Text>
          {showShortcuts ? " (Ctrl+L)" : ""}
          {showShortcuts && isJob && session.draft && session.answer ? " · 'd' toggles draft" : ""}
        </Text>
      </Box>

      {session.latex && (session.latexCompileId || session.latexLog || session.latexBusy) ? (
        <Box paddingX={1}>
          <Text color={session.latexCompileId ? "green" : session.latexBusy ? "cyan" : "red"}>
            {session.latexBusy
              ? "Compiling LaTeX…"
              : session.latexCompileId
                ? `PDF ready at /api/latex/${session.latexCompileId}/pdf`
                : `LaTeX: ${session.latexLog.slice(0, 100)}`}
          </Text>
        </Box>
      ) : null}

      {hasOutput ? (
        <AnswerPane
          text={paneText}
          width={width}
          height={answerHeight}
          label={paneLabel}
          focus={focusId === "answer"}
          streaming={running}
          showShortcuts={showShortcuts}
        />
      ) : null}

      <ActivityLog activity={session.activity} />

      {showFollow ? (
        <Box flexDirection="column">
          <Text bold>
            Follow-up {showShortcuts ? <Text dimColor>(Enter to send · e.g. "make it shorter")</Text> : null}
          </Text>
          <MultilineInput
            value={follow}
            onChange={setFollow}
            onSubmit={submitFollow}
            focus={focusId === "followup"}
            maxRows={3}
            placeholder="Request a tweak…"
            onEditor={async () => {
              const next = await editInEditor(follow, { setRawMode, suspendTerminal });
              setFollow(next);
            }}
          />
        </Box>
      ) : null}
    </Box>
  );
}

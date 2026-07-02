// Ask the Vault + Drafting mode. Drafting adds a job-description field and a draft
// (pre-humanize) view toggle. Streams the answer into a scrollable pane and keeps a
// follow-up input once an answer exists.
import { useState } from "react";
import { Box, Text } from "ink";
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
  openEditor: (field: "question" | "jobDescription") => void;
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
  openEditor,
}: Props) {
  const [follow, setFollow] = useState("");
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
            Job description <Text dimColor>(Ctrl+O to edit in $EDITOR)</Text>
          </Text>
          <MultilineInput
            value={session.jobDescription}
            onChange={(v) => patch({ jobDescription: v })}
            focus={focusId === "job"}
            submitOnEnter={false}
            maxRows={5}
            placeholder="Paste the job description (optional)…"
            onEditor={() => openEditor("jobDescription")}
          />
        </Box>
      ) : null}

      <Box flexDirection="column">
        <Text bold>
          {isJob ? "Question" : "Ask the vault"}{" "}
          <Text dimColor>(Enter to send · Alt+Enter newline · Ctrl+O editor)</Text>
        </Text>
        <MultilineInput
          value={session.question}
          onChange={(v) => patch({ question: v })}
          onSubmit={submitQuestion}
          focus={focusId === "question"}
          maxRows={5}
          placeholder={isJob ? "What should I answer for this role?" : "Ask anything grounded in your vault…"}
          onEditor={() => openEditor("question")}
        />
      </Box>

      <Box paddingX={1}>
        <Text dimColor>
          RAG <Text color={session.rag ? "green" : "gray"}>{session.rag ? "on" : "off"}</Text> (Ctrl+R) · Skills{" "}
          <Text color={session.skills.length ? "yellow" : "gray"}>{session.skills.length}</Text> (Ctrl+K)
          {isJob && session.draft && session.answer ? " · 'd' toggles draft" : ""}
        </Text>
      </Box>

      {hasOutput ? (
        <AnswerPane
          text={paneText}
          width={width}
          height={answerHeight}
          label={paneLabel}
          focus={focusId === "answer"}
          streaming={running}
        />
      ) : null}

      <ActivityLog activity={session.activity} />

      {showFollow ? (
        <Box flexDirection="column">
          <Text bold>
            Follow-up <Text dimColor>(Enter to send · e.g. "make it shorter")</Text>
          </Text>
          <MultilineInput
            value={follow}
            onChange={setFollow}
            onSubmit={submitFollow}
            focus={focusId === "followup"}
            maxRows={3}
            placeholder="Request a tweak…"
          />
        </Box>
      ) : null}
    </Box>
  );
}

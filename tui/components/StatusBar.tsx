// Bottom bar: live phase/spinner on the left, contextual key hints on the right,
// and transient notices (copied, written, errors).
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { isRunning, type Phase } from "../lib/session";

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Ready",
  draft: "Answering…",
  humanize: "Humanizing…",
  cleanup: "Cleaning up…",
  followup: "Revising…",
  done: "Ready",
  error: "Error",
};

interface Props {
  phase: Phase;
  hint: string;
  notice?: string;
  error?: string;
}

export function StatusBar({ phase, hint, notice, error }: Props) {
  const running = isRunning(phase);
  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Box>
        {running ? (
          <Text color="cyan">
            <Spinner type="dots" /> {PHASE_LABEL[phase]}
          </Text>
        ) : error ? (
          <Text color="red">✖ {error.slice(0, 60)}</Text>
        ) : notice ? (
          <Text color="green">{notice}</Text>
        ) : (
          <Text color={phase === "error" ? "red" : "green"}>{PHASE_LABEL[phase]}</Text>
        )}
      </Box>
      <Text dimColor>{hint}</Text>
    </Box>
  );
}

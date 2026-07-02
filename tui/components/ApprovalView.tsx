import { Box, Text, useInput } from "ink";
import { AnswerPane } from "./AnswerPane";
import { formatApprovalSummary, type PendingWriteApproval } from "../lib/approval";

interface Props {
  approval: PendingWriteApproval & { busy?: boolean; error?: string };
  width: number;
  height: number;
  showShortcuts?: boolean;
  onApprove: () => void;
  onReject: () => void;
}

export function ApprovalView({ approval, width, height, showShortcuts = true, onApprove, onReject }: Props) {
  useInput((input, key) => {
    if (approval.busy) return;
    if (key.return || input === "y") onApprove();
    if (key.escape || input === "n") onReject();
  });

  const existing = approval.tooLarge ? "(existing file too large to display)" : approval.existingContent;
  const body = [
    formatApprovalSummary(approval),
    approval.error ? `\nError: ${approval.error}\n` : "",
    approval.exists ? "\nExisting content:\n" + (existing || "(empty)") : "",
    "\nNew content:\n" + (approval.newContent || "(empty)"),
  ].join("\n");

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text bold color="yellow">
        Review vault write
      </Text>
      {approval.busy ? <Text color="cyan">Writing…</Text> : null}
      <AnswerPane
        text={body}
        width={width - 4}
        height={Math.max(6, height - 4)}
        label="Approval preview"
        focus
        showShortcuts={showShortcuts}
      />
    </Box>
  );
}

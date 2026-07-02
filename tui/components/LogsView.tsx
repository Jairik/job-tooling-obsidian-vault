import { Box, Text, useInput } from "ink";
import type { LogEntry } from "../lib/api";

interface Props {
  logs: LogEntry[];
  onRefresh: () => void;
  onClear: () => void;
  showShortcuts?: boolean;
  onClose: () => void;
}

export function LogsView({ logs, onRefresh, onClear, showShortcuts = true, onClose }: Props) {
  useInput((input, key) => {
    if (key.escape) onClose();
    if (input === "r") onRefresh();
    if (input === "c") onClear();
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={1}>
      <Text bold>Logs</Text>
      {showShortcuts ? <Text dimColor>r refresh · c clear · Esc close</Text> : null}
      {logs.slice(-18).map((log) => (
        <Text key={log.id} wrap="truncate-end">
          <Text color="cyan">{new Date(log.ts).toLocaleTimeString()}</Text>{" "}
          <Text color="yellow">{log.kind}</Text> {log.engine || ""} {log.model || ""} {log.question || log.detail || ""}
        </Text>
      ))}
      {!logs.length ? <Text dimColor>No logs yet.</Text> : null}
    </Box>
  );
}

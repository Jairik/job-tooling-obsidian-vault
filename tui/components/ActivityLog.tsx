// Compact view of the agent's tool/file activity during a turn (Read, Grep, Skill,
// RAG, …), mirroring the activity list shown in the web app's answer view.
import { Box, Text } from "ink";
import type { Activity } from "../lib/session";

interface Props {
  activity: Activity[];
  max?: number;
}

export function ActivityLog({ activity, max = 4 }: Props) {
  if (!activity.length) return null;
  const shown = activity.slice(-max);
  const hidden = activity.length - shown.length;
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text dimColor>
        Activity{hidden > 0 ? ` (+${hidden} earlier)` : ""}:
      </Text>
      {shown.map((a, i) => (
        <Text key={i} dimColor wrap="truncate-end">
          {"  "}• <Text color="blue">{a.tool}</Text> {a.input}
        </Text>
      ))}
    </Box>
  );
}

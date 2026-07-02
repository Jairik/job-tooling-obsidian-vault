// Top bar: brand, current mode, the engine/model that will actually run, and the
// active flags (RAG, humanize, selected skill count). Mirrors the mode/model badges
// in the web toolbar (src/components/TabView.tsx).
import { Box, Text } from "ink";
import { effectiveEngineModel, type TabMode } from "../../shared/settings";
import type { ServerSettings } from "../lib/api";

const MODE_LABEL: Record<TabMode, string> = {
  ask: "Ask the Vault",
  job: "Drafting",
  write: "Write to Vault",
};

interface Props {
  mode: TabMode;
  settings: ServerSettings;
  skillsCount: number;
  rag: boolean;
}

export function Header({ mode, settings, skillsCount, rag }: Props) {
  const model = effectiveEngineModel(settings) || "(default)";
  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Box>
        <Text color="magenta" bold>
          ⛁ Vault Assistant
        </Text>
        <Text dimColor>{"  ·  "}</Text>
        <Text color="cyan" bold>
          {MODE_LABEL[mode]}
        </Text>
      </Box>
      <Box>
        <Text dimColor>{settings.engine}·</Text>
        <Text>{model}</Text>
        <Text dimColor>{"  "}</Text>
        <Text color={rag ? "green" : "gray"}>RAG {rag ? "on" : "off"}</Text>
        <Text dimColor>{"  "}</Text>
        <Text color={settings.humanize ? "green" : "gray"}>
          Humanize {settings.humanize ? "on" : "off"}
        </Text>
        <Text dimColor>{"  "}</Text>
        <Text color={skillsCount ? "yellow" : "gray"}>
          Skills {skillsCount || 0}
        </Text>
      </Box>
    </Box>
  );
}

import { Box, Text, useInput } from "ink";
import { useMemo, useState } from "react";
import type { CoreSettings, Engine, UrlFetchMethod } from "../../shared/settings";
import type { UsageResult } from "../../shared/usage";
import type { ModelOption } from "../lib/api";
import { TUI_MODE_LABEL, TUI_MODE_ORDER, type TuiMode } from "../lib/modes";
import {
  buildCleanupModelPatch,
  buildCleanupReasoningPatch,
  buildEngineModelPatch,
  buildEnginePatch,
  buildEngineReasoningPatch,
  currentCleanupModelValue,
  currentCleanupReasoningValue,
  currentModelValue,
  currentReasoningValue,
} from "../lib/settings";
import { MultilineInput } from "./MultilineInput";

interface Props {
  settings: CoreSettings;
  models: ModelOption[];
  engines: ModelOption[];
  defaultMode: TuiMode;
  usage: UsageResult | null;
  onPatch: (patch: Partial<CoreSettings>) => void;
  onDefaultModeChange: (mode: TuiMode) => void;
  onRefreshUsage: () => void;
  showShortcuts?: boolean;
  onClose: () => void;
}

type Field =
  | "defaultMode"
  | "tuiShortcutsVisible"
  | "vaultDir"
  | "extraDirs"
  | "userName"
  | "userRole"
  | "personaNotes"
  | "askPersona"
  | "persona"
  | "engine"
  | "model"
  | "reasoning"
  | "cleanupModel"
  | "cleanupReasoning"
  | "rag"
  | "humanize"
  | "maxTurns"
  | "urlFetchMethod"
  | "searxngUrl"
  | "webResearchEnabled";

const FIELDS: { id: Field; label: string; section: "Workspace" | "AI" }[] = [
  { id: "defaultMode", label: "Default TUI mode", section: "Workspace" },
  { id: "tuiShortcutsVisible", label: "Shortcut hints", section: "Workspace" },
  { id: "vaultDir", label: "Vault path", section: "Workspace" },
  { id: "extraDirs", label: "Extra context dirs", section: "Workspace" },
  { id: "userName", label: "Name", section: "Workspace" },
  { id: "userRole", label: "Role", section: "Workspace" },
  { id: "personaNotes", label: "Profile notes", section: "Workspace" },
  { id: "askPersona", label: "Ask prompt", section: "Workspace" },
  { id: "persona", label: "Draft prompt", section: "Workspace" },
  { id: "engine", label: "Engine", section: "AI" },
  { id: "model", label: "Model", section: "AI" },
  { id: "reasoning", label: "Reasoning", section: "AI" },
  { id: "cleanupModel", label: "Cleanup model", section: "AI" },
  { id: "cleanupReasoning", label: "Cleanup reasoning", section: "AI" },
  { id: "rag", label: "RAG default", section: "AI" },
  { id: "humanize", label: "Humanize", section: "AI" },
  { id: "maxTurns", label: "Max turns", section: "AI" },
  { id: "urlFetchMethod", label: "URL fetch", section: "AI" },
  { id: "searxngUrl", label: "SearXNG URL", section: "AI" },
  { id: "webResearchEnabled", label: "Web research", section: "AI" },
];

const URL_METHODS: UrlFetchMethod[] = ["auto", "readability", "playwright"];

function cycle<T>(items: T[], current: T, dir: 1 | -1): T {
  const idx = Math.max(0, items.indexOf(current));
  return items[(idx + dir + items.length) % items.length];
}

function fieldValue(settings: CoreSettings, id: Field, defaultMode: TuiMode): string {
  switch (id) {
    case "defaultMode":
      return TUI_MODE_LABEL[defaultMode];
    case "tuiShortcutsVisible":
      return settings.tuiShortcutsVisible === false ? "off" : "on";
    case "vaultDir":
      return settings.vaultDir;
    case "extraDirs":
      return settings.extraDirs.join("\n");
    case "userName":
      return settings.userName;
    case "userRole":
      return settings.userRole;
    case "personaNotes":
      return settings.personaNotes;
    case "askPersona":
      return settings.askPersona;
    case "persona":
      return settings.persona;
    case "engine":
      return settings.engine;
    case "model":
      return currentModelValue(settings);
    case "reasoning":
      return currentReasoningValue(settings);
    case "cleanupModel":
      return currentCleanupModelValue(settings);
    case "cleanupReasoning":
      return currentCleanupReasoningValue(settings);
    case "rag":
      return settings.rag ? "on" : "off";
    case "humanize":
      return settings.humanize ? "on" : "off";
    case "maxTurns":
      return String(settings.maxTurns);
    case "urlFetchMethod":
      return settings.urlFetchMethod;
    case "searxngUrl":
      return settings.searxngUrl;
    case "webResearchEnabled":
      return settings.webResearchEnabled ? "on" : "off";
  }
}

export function SettingsView({
  settings,
  models,
  engines,
  defaultMode,
  usage,
  onPatch,
  onDefaultModeChange,
  onRefreshUsage,
  showShortcuts = true,
  onClose,
}: Props) {
  const [idx, setIdx] = useState(0);
  const current = FIELDS[idx];
  const engineIds = engines.map((e) => e.id as Engine);

  const usageText = useMemo(() => {
    if (!usage) return "Usage: not loaded";
    if (usage.unsupported) return "Usage: unsupported for this engine/model";
    if (!usage.ok && usage.error) return `Usage: ${usage.error}`;
    const stats = (usage.stats ?? []).map((r) => `${r.label} ${r.value}`);
    const windows = (usage.windows ?? []).map((w) => `${w.label} ${w.utilization}%${w.detail ? ` ${w.detail}` : ""}`);
    const rows = [...stats, ...windows].slice(0, 4);
    return rows.length ? `Usage: ${rows.join(" · ")}` : "Usage: ok";
  }, [usage]);

  const patchText = (field: Field, value: string) => {
    switch (field) {
      case "vaultDir":
        onPatch({ vaultDir: value });
        break;
      case "extraDirs":
        onPatch({ extraDirs: value.split(/\n|,/).map((x) => x.trim()).filter(Boolean) });
        break;
      case "userName":
        onPatch({ userName: value });
        break;
      case "userRole":
        onPatch({ userRole: value });
        break;
      case "personaNotes":
        onPatch({ personaNotes: value });
        break;
      case "askPersona":
        onPatch({ askPersona: value });
        break;
      case "persona":
        onPatch({ persona: value });
        break;
      case "model":
        onPatch(buildEngineModelPatch(settings, value));
        break;
      case "reasoning":
        onPatch(buildEngineReasoningPatch(settings, value));
        break;
      case "cleanupModel":
        onPatch(buildCleanupModelPatch(settings, value));
        break;
      case "cleanupReasoning":
        onPatch(buildCleanupReasoningPatch(settings, value));
        break;
      case "maxTurns": {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) onPatch({ maxTurns: Math.round(parsed) });
        break;
      }
      case "searxngUrl":
        onPatch({ searxngUrl: value });
        break;
    }
  };

  const cycleField = (dir: 1 | -1) => {
    switch (current.id) {
      case "defaultMode":
        onDefaultModeChange(cycle(TUI_MODE_ORDER, defaultMode, dir));
        break;
      case "tuiShortcutsVisible":
        onPatch({ tuiShortcutsVisible: settings.tuiShortcutsVisible === false });
        break;
      case "engine":
        onPatch(buildEnginePatch(settings, cycle(engineIds, settings.engine, dir)));
        break;
      case "rag":
        onPatch({ rag: !settings.rag });
        break;
      case "humanize":
        onPatch({ humanize: !settings.humanize });
        break;
      case "urlFetchMethod":
        onPatch({ urlFetchMethod: cycle(URL_METHODS, settings.urlFetchMethod, dir) });
        break;
      case "webResearchEnabled":
        onPatch({ webResearchEnabled: !settings.webResearchEnabled });
        break;
    }
  };

  useInput((input, key) => {
    const currentEditable =
      !["defaultMode", "tuiShortcutsVisible", "engine", "rag", "humanize", "urlFetchMethod", "webResearchEnabled"].includes(current.id);
    if (key.escape) onClose();
    if (currentEditable && !key.ctrl && !key.meta) {
      if (key.tab) {
        if (key.shift) {
          setIdx((i) => (i - 1 + FIELDS.length) % FIELDS.length);
        } else {
          setIdx((i) => (i + 1) % FIELDS.length);
        }
      }
      return;
    }
    if (key.upArrow || input === "k") setIdx((i) => Math.max(0, i - 1));
    if (key.downArrow || input === "j" || key.tab) {
      if (key.tab) {
        if (key.shift) {
          setIdx((i) => (i - 1 + FIELDS.length) % FIELDS.length);
        } else {
          setIdx((i) => (i + 1) % FIELDS.length);
        }
      } else {
        setIdx((i) => Math.min(FIELDS.length - 1, i + 1));
      }
    }
    if (key.leftArrow) cycleField(-1);
    if (key.rightArrow || input === " ") cycleField(1);
    if (input === "u") onRefreshUsage();
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
      <Text bold>Settings</Text>
      {showShortcuts ? <Text dimColor>j/k field · type to edit · ←/→ cycle/toggle · u usage · Esc close</Text> : null}
      <Text dimColor>{usageText}</Text>
      {FIELDS.map((field, i) => {
        const active = i === idx;
        const value = fieldValue(settings, field.id, defaultMode);
        const editable =
          !["defaultMode", "tuiShortcutsVisible", "engine", "rag", "humanize", "urlFetchMethod", "webResearchEnabled"].includes(field.id);
        return (
          <Box key={field.id} flexDirection="column">
            {(i === 0 || FIELDS[i - 1].section !== field.section) && (
              <Text color="yellow" bold>
                {field.section}
              </Text>
            )}
            <Text color={active ? "cyan" : undefined}>
              {active ? "› " : "  "}
              {field.label}
            </Text>
            {active && editable ? (
              <MultilineInput
                value={value}
                onChange={(v) => patchText(field.id, v)}
                focus
                submitOnEnter={false}
                maxRows={field.id === "askPersona" || field.id === "persona" || field.id === "personaNotes" ? 5 : 2}
              />
            ) : (
              <Text dimColor wrap="truncate-end">
                {"    "}
                {value || "(blank)"}
              </Text>
            )}
          </Box>
        );
      })}
      {models.length ? <Text dimColor>Known models: {models.slice(0, 4).map((m) => m.id).join(", ")}</Text> : null}
    </Box>
  );
}

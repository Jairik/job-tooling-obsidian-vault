import { Box, Text, useInput } from "ink";
import { useMemo, useState } from "react";
import { MultilineInput } from "./MultilineInput";
import type { SkillInfo, SkillStatus } from "../lib/api";

interface Props {
  availableSkills: SkillInfo[];
  selected: string[];
  status: SkillStatus | null;
  onSelectedChange: (skills: string[]) => void;
  onRefresh: () => void;
  onCreateSkill: (payload: { name: string; description: string; body: string; scope: "user" | "vault" }) => Promise<void>;
  showShortcuts?: boolean;
  onClose: () => void;
}

type CreateField = "name" | "description" | "body";

export function SkillsView({
  availableSkills,
  selected,
  status,
  onSelectedChange,
  onRefresh,
  onCreateSkill,
  showShortcuts = true,
  onClose,
}: Props) {
  const [idx, setIdx] = useState(0);
  const [creating, setCreating] = useState(false);
  const [field, setField] = useState<CreateField>("name");
  const [scope, setScope] = useState<"user" | "vault">("user");
  const [draft, setDraft] = useState({ name: "", description: "", body: "" });
  const current = availableSkills[Math.min(idx, Math.max(0, availableSkills.length - 1))];

  const toolStatus = useMemo(() => {
    if (!status) return "";
    return Object.entries(status)
      .map(([k, v]) => `${k}:${v ? "ok" : "missing"}`)
      .join("  ");
  }, [status]);

  useInput((input, key) => {
    if (key.escape) {
      if (creating) setCreating(false);
      else onClose();
      return;
    }
    if (creating) {
      if (key.tab) setField((f) => (f === "name" ? "description" : f === "description" ? "body" : "name"));
      if (input === "w" && key.ctrl) {
        void onCreateSkill({ ...draft, scope }).then(() => {
          setCreating(false);
          setDraft({ name: "", description: "", body: "" });
        });
      }
      if (input === "v" && key.ctrl) setScope((s) => (s === "user" ? "vault" : "user"));
      return;
    }
    if (key.upArrow || input === "k") setIdx((i) => Math.max(0, i - 1));
    if (key.downArrow || input === "j") setIdx((i) => Math.min(Math.max(0, availableSkills.length - 1), i + 1));
    if (input === " ") {
      if (!current) return;
      onSelectedChange(selected.includes(current.name) ? selected.filter((s) => s !== current.name) : [...selected, current.name]);
    }
    if (input === "r") onRefresh();
    if (input === "n") setCreating(true);
  });

  if (creating) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
        <Text bold>Create skill</Text>
        {showShortcuts ? <Text dimColor>Tab field · Ctrl+V scope ({scope}) · Ctrl+W create · Esc cancel</Text> : null}
        <Text>Name</Text>
        <MultilineInput value={draft.name} onChange={(name) => setDraft((d) => ({ ...d, name }))} focus={field === "name"} maxRows={1} />
        <Text>Description</Text>
        <MultilineInput
          value={draft.description}
          onChange={(description) => setDraft((d) => ({ ...d, description }))}
          focus={field === "description"}
          maxRows={2}
        />
        <Text>SKILL.md body</Text>
        <MultilineInput value={draft.body} onChange={(body) => setDraft((d) => ({ ...d, body }))} focus={field === "body"} submitOnEnter={false} maxRows={8} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
      <Text bold>Skills</Text>
      {showShortcuts ? <Text dimColor>j/k select · space toggle · n create · r refresh · Esc close</Text> : null}
      {toolStatus ? <Text dimColor>{toolStatus}</Text> : null}
      {availableSkills.map((skill, i) => (
        <Text key={`${skill.scope}:${skill.name}`} color={i === idx ? "cyan" : undefined} wrap="truncate-end">
          {i === idx ? "› " : "  "}
          <Text color={selected.includes(skill.name) ? "green" : "gray"}>{selected.includes(skill.name) ? "[x]" : "[ ]"}</Text>{" "}
          {skill.name} <Text dimColor>({skill.scope}) {skill.description}</Text>
        </Text>
      ))}
      {!availableSkills.length ? <Text dimColor>No installed skills found.</Text> : null}
    </Box>
  );
}

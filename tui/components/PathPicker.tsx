// A relative vault path input with directory suggestions from /api/vault/tree.
// Type the path directly (cursor stays at the end — paths are short); ↑/↓ highlight
// an existing directory and → completes it so you can append a filename. Enter
// confirms. The server's tree endpoint returns directories only, so suggestions are
// folders to help compose a destination path.
import { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { api, type TreeNode } from "../lib/api";

interface Props {
  vaultDir: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  focus?: boolean;
  placeholder?: string;
  showShortcuts?: boolean;
}

/* Flattens the directory tree into relative paths for suggestion matching. */
function flatten(nodes: TreeNode[], acc: string[] = []): string[] {
  for (const n of nodes) {
    acc.push(n.path);
    if (n.children?.length) flatten(n.children, acc);
  }
  return acc;
}

export function PathPicker({ vaultDir, value, onChange, onSubmit, focus = false, placeholder = "", showShortcuts = true }: Props) {
  const [dirs, setDirs] = useState<string[]>([]);
  const [hl, setHl] = useState(0);

  useEffect(() => {
    let alive = true;
    api
      .vaultTree(vaultDir)
      .then((tree) => alive && setDirs(flatten(tree)))
      .catch(() => alive && setDirs([]));
    return () => {
      alive = false;
    };
  }, [vaultDir]);

  const q = value.toLowerCase();
  const filtered = useMemo(
    () => dirs.filter((d) => d.toLowerCase().includes(q)).slice(0, 6),
    [dirs, q]
  );
  const sel = Math.min(hl, Math.max(0, filtered.length - 1));

  useInput(
    (input, key) => {
      if (key.tab || key.escape) return;
      if (key.return) return onSubmit?.();
      if (key.upArrow) return setHl((h) => Math.max(0, h - 1));
      if (key.downArrow) return setHl((h) => Math.min(filtered.length - 1, h + 1));
      if (key.rightArrow) {
        if (filtered[sel]) onChange(filtered[sel] + "/");
        return;
      }
      if (key.backspace || key.delete) {
        onChange(value.slice(0, -1));
        setHl(0);
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        onChange(value + input);
        setHl(0);
      }
    },
    { isActive: focus }
  );

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor={focus ? "cyan" : "gray"} paddingX={1}>
        <Text>
          {value || (!focus ? <Text dimColor>{placeholder}</Text> : "")}
          {focus ? <Text inverse> </Text> : null}
        </Text>
      </Box>
      {focus && filtered.length > 0 ? (
        <Box flexDirection="column" paddingX={1}>
          {filtered.map((d, i) => (
            <Text key={d} color={i === sel ? "cyan" : undefined} dimColor={i !== sel}>
              {i === sel ? "› " : "  "}
              {d}/
            </Text>
          ))}
          {showShortcuts ? <Text dimColor>{"  ↑/↓ pick · → complete dir · Enter confirm"}</Text> : null}
        </Box>
      ) : null}
    </Box>
  );
}

// Scrollable, markdown-rendered answer viewport. Renders the answer to ANSI sized
// for the pane width (marked-terminal reflows to that width), then shows a window of
// physical lines. Auto-tails while streaming; manual scroll (when focused) detaches
// from the tail until you scroll back to the bottom.
import { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { renderMarkdown } from "../lib/markdown";

interface Props {
  text: string;
  width: number;
  height: number;
  label: string;
  focus?: boolean;
  streaming?: boolean;
  placeholder?: string;
}

export function AnswerPane({
  text,
  width,
  height,
  label,
  focus = false,
  streaming = false,
  placeholder = "No answer yet.",
}: Props) {
  const rendered = useMemo(() => renderMarkdown(text, Math.max(20, width - 2)), [text, width]);
  const lines = rendered ? rendered.split("\n") : [];
  const total = lines.length;
  const viewH = Math.max(1, height);
  const maxOffset = Math.max(0, total - viewH);

  const [offset, setOffset] = useState(0);
  const [follow, setFollow] = useState(true);

  // While following the tail, keep the bottom of the answer in view as it grows.
  useEffect(() => {
    if (follow) setOffset(maxOffset);
  }, [maxOffset, follow]);

  useInput(
    (input, key) => {
      if (key.upArrow || input === "k") {
        setFollow(false);
        setOffset((o) => Math.max(0, o - 1));
      } else if (key.downArrow || input === "j") {
        setOffset((o) => {
          const n = Math.min(maxOffset, o + 1);
          if (n >= maxOffset) setFollow(true);
          return n;
        });
      } else if (key.pageUp) {
        setFollow(false);
        setOffset((o) => Math.max(0, o - viewH));
      } else if (key.pageDown) {
        setOffset((o) => {
          const n = Math.min(maxOffset, o + viewH);
          if (n >= maxOffset) setFollow(true);
          return n;
        });
      } else if (input === "g") {
        setFollow(false);
        setOffset(0);
      } else if (input === "G") {
        setFollow(true);
        setOffset(maxOffset);
      }
    },
    { isActive: focus }
  );

  const clamped = Math.min(offset, maxOffset);
  const window = lines.slice(clamped, clamped + viewH);
  while (window.length < viewH) window.push("");

  const pos =
    total > viewH ? `${clamped + 1}-${Math.min(clamped + viewH, total)}/${total}` : "";

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between" paddingX={1}>
        <Text bold color={focus ? "cyan" : "white"}>
          {label}
          {streaming ? <Text color="cyan"> ▍</Text> : null}
        </Text>
        <Text dimColor>
          {pos}
          {pos && focus ? " · j/k scroll" : ""}
          {clamped < maxOffset ? " ▼" : ""}
          {clamped > 0 ? " ▲" : ""}
        </Text>
      </Box>
      <Box flexDirection="column" height={viewH} paddingX={1}>
        {!text.trim() ? (
          <Text dimColor>{placeholder}</Text>
        ) : (
          window.map((l, i) => (
            <Text key={i} wrap="truncate-end">
              {l.length ? l : " "}
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
}

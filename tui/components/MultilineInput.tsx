// A controlled multi-line text input with a visible cursor, line-based rendering,
// and a row cap (so long draft context doesn't blow up the layout, it scrolls
// around the cursor instead). Handles printable input (incl. pasted chunks),
// backspace, arrow navigation, newline insertion, Enter-to-submit, and an
// "open in $EDITOR" escape via Ctrl+O. ink-text-input is single-line only, so the
// TUI uses this everywhere for a consistent feel.
import { useState } from "react";
import { Box, Text, useInput } from "ink";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  focus?: boolean;
  placeholder?: string;
  // true: Enter submits (Alt+Enter inserts a newline). false: Enter inserts newline.
  submitOnEnter?: boolean;
  onEditor?: () => void;
  maxRows?: number;
}

/* Visible rows a MultilineInput will occupy (content rows capped + 2 border rows). */
export function inputBoxRows(value: string, maxRows = 6): number {
  const lines = value.length ? value.split("\n").length : 1;
  return Math.min(maxRows, Math.max(1, lines)) + 2;
}

/* Returns the caret index after moving up/down one line, preserving the column. */
function moveVertical(value: string, idx: number, dir: -1 | 1): number {
  const lineStart = value.lastIndexOf("\n", idx - 1) + 1;
  const col = idx - lineStart;
  if (dir === -1) {
    if (lineStart === 0) return idx;
    const prevStart = value.lastIndexOf("\n", lineStart - 2) + 1;
    const prevLen = lineStart - 1 - prevStart;
    return prevStart + Math.min(col, prevLen);
  }
  const lineEnd = value.indexOf("\n", idx);
  if (lineEnd === -1) return value.length;
  const nextStart = lineEnd + 1;
  let nextEnd = value.indexOf("\n", nextStart);
  if (nextEnd === -1) nextEnd = value.length;
  return nextStart + Math.min(col, nextEnd - nextStart);
}

/* Renders one logical line, embedding an inverse cursor block at `col` when set. */
function Line({ text, col }: { text: string; col: number | null }) {
  if (col === null) return <Text>{text.length ? text : " "}</Text>;
  const cur = text[col];
  if (cur === undefined)
    return (
      <Text>
        {text}
        <Text inverse> </Text>
      </Text>
    );
  return (
    <Text>
      {text.slice(0, col)}
      <Text inverse>{cur}</Text>
      {text.slice(col + 1)}
    </Text>
  );
}

export function MultilineInput({
  value,
  onChange,
  onSubmit,
  focus = false,
  placeholder = "",
  submitOnEnter = true,
  onEditor,
  maxRows = 6,
}: Props) {
  const [cursor, setCursor] = useState(value.length);
  const c = Math.min(cursor, value.length);

  useInput(
    (input, key) => {
      if (key.tab || key.escape) return; // let the app handle focus/close
      if (key.ctrl && input === "o") return onEditor?.();
      if (key.return) {
        if (submitOnEnter && !key.meta && onSubmit) return onSubmit();
        onChange(value.slice(0, c) + "\n" + value.slice(c));
        return setCursor(c + 1);
      }
      if (key.leftArrow) return setCursor(Math.max(0, c - 1));
      if (key.rightArrow) return setCursor(Math.min(value.length, c + 1));
      if (key.upArrow) return setCursor(moveVertical(value, c, -1));
      if (key.downArrow) return setCursor(moveVertical(value, c, 1));
      if (key.backspace || key.delete) {
        if (c > 0) {
          onChange(value.slice(0, c - 1) + value.slice(c));
          setCursor(c - 1);
        }
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        onChange(value.slice(0, c) + input + value.slice(c));
        setCursor(c + input.length);
      }
    },
    { isActive: focus }
  );

  const lines = value.length ? value.split("\n") : [""];
  // Find the cursor's line + column.
  let rem = c;
  let curLine = 0;
  while (curLine < lines.length && rem > lines[curLine].length) {
    rem -= lines[curLine].length + 1;
    curLine++;
  }
  const curCol = rem;

  // Window the visible lines around the cursor when content exceeds maxRows.
  let start = 0;
  if (lines.length > maxRows) {
    start = Math.min(Math.max(0, curLine - Math.floor(maxRows / 2)), lines.length - maxRows);
  }
  const visible = lines.slice(start, start + maxRows);

  const showPlaceholder = value.length === 0;

  return (
    <Box borderStyle="round" borderColor={focus ? "cyan" : "gray"} paddingX={1} flexDirection="column">
      {showPlaceholder ? (
        focus ? (
          <Text>
            <Text inverse> </Text>
            <Text dimColor>{placeholder}</Text>
          </Text>
        ) : (
          <Text dimColor>{placeholder || " "}</Text>
        )
      ) : (
        visible.map((line, i) => {
          const lineIdx = start + i;
          return <Line key={lineIdx} text={line} col={focus && lineIdx === curLine ? curCol : null} />;
        })
      )}
      {lines.length > maxRows ? <Text dimColor>{`  … ${lines.length} lines`}</Text> : null}
    </Box>
  );
}

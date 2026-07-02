import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { MultilineInput } from "./MultilineInput";

interface Props {
  onSubmit: (path: string) => void;
  showShortcuts?: boolean;
  onClose: () => void;
}

export function AttachView({ onSubmit, showShortcuts = true, onClose }: Props) {
  const [path, setPath] = useState("");
  useInput((_input, key) => {
    if (key.escape) onClose();
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold>Attach document to Draft</Text>
      {showShortcuts ? <Text dimColor>Enter a local PDF/DOCX path. Esc closes.</Text> : null}
      <MultilineInput value={path} onChange={setPath} onSubmit={() => onSubmit(path)} focus maxRows={2} placeholder="/absolute/path/to/file.pdf" />
    </Box>
  );
}

// Escape hatch for editing long text (job descriptions, manual vault content,
// personas) in $EDITOR, like `git commit`. Bun.spawnSync blocks the event loop, so
// Ink's input handler stays quiet while the editor owns the terminal; the caller
// toggles raw mode around it so the editor receives keystrokes cleanly.
import { tmpdir } from "os";
import { join } from "path";
import { rm } from "fs/promises";

interface EditOptions {
  ext?: string;
  setRawMode?: (mode: boolean) => void;
}

/* Opens $EDITOR on the given text and returns the edited contents. */
export async function editInEditor(initial: string, opts: EditOptions = {}): Promise<string> {
  const editor = process.env.VISUAL || process.env.EDITOR || "vi";
  const tmp = join(tmpdir(), `vault-tui-${Date.now()}${opts.ext ?? ".md"}`);
  await Bun.write(tmp, initial);

  const [cmd, ...args] = editor.split(/\s+/).filter(Boolean);
  opts.setRawMode?.(false);
  try {
    Bun.spawnSync([cmd, ...args, tmp], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
  } finally {
    opts.setRawMode?.(true);
  }

  const text = await Bun.file(tmp).text();
  await rm(tmp).catch(() => {});
  return text;
}

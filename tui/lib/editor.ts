// Escape hatch for editing long text (draft context, manual vault content,
// personas) in $EDITOR, like `git commit`. When Ink can suspend the terminal, the
// editor gets a clean stdio handoff and Ink redraws after it exits.
import { tmpdir } from "os";
import { join } from "path";
import { rm } from "fs/promises";

interface EditOptions {
  ext?: string;
  setRawMode?: (mode: boolean) => void;
  suspendTerminal?: (callback: () => void | Promise<void>) => Promise<void>;
}

/* Opens $EDITOR on the given text and returns the edited contents. */
export async function editInEditor(initial: string, opts: EditOptions = {}): Promise<string> {
  const editor = process.env.VISUAL || process.env.EDITOR || "vi";
  const tmp = join(tmpdir(), `vault-tui-${Date.now()}${opts.ext ?? ".md"}`);
  await Bun.write(tmp, initial);

  const [cmd, ...args] = editor.split(/\s+/).filter(Boolean);
  const runEditor = () => {
    Bun.spawnSync([cmd, ...args, tmp], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
  };

  if (opts.suspendTerminal) {
    await opts.suspendTerminal(runEditor);
  } else {
    opts.setRawMode?.(false);
    try {
      runEditor();
    } finally {
      opts.setRawMode?.(true);
    }
  }

  const text = await Bun.file(tmp).text();
  await rm(tmp).catch(() => {});
  return text;
}

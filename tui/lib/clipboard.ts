// Clipboard copy with a graceful fallback. clipboardy uses the platform clipboard
// tool (wl-copy / xclip / xsel / pbcopy). When none is available (e.g. a bare SSH
// session) we fall back to the OSC-52 terminal escape, written to stderr so it does
// not disturb Ink's stdout frame buffer.
import clipboard from "clipboardy";

export interface CopyResult {
  ok: boolean;
  method: "clipboard" | "osc52" | "none";
}

/* Copies text to the system clipboard, falling back to OSC-52 over the terminal. */
export async function copyToClipboard(text: string): Promise<CopyResult> {
  try {
    await clipboard.write(text);
    return { ok: true, method: "clipboard" };
  } catch {
    try {
      const b64 = Buffer.from(text, "utf8").toString("base64");
      process.stderr.write(`]52;c;${b64}`);
      return { ok: true, method: "osc52" };
    } catch {
      return { ok: false, method: "none" };
    }
  }
}

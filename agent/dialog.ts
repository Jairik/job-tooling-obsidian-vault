
export async function showDirectoryPicker(options: { title?: string; defaultPath?: string } = {}): Promise<string | null> {
  const title = options.title || "Select Directory";
  const defaultPath = options.defaultPath || "";

  if (process.platform === "darwin") {
    let prompt = `with prompt "${title.replace(/"/g, '\\"')}"`;
    let defaultLocation = "";
    if (defaultPath) {
      defaultLocation = `default location POSIX file "${defaultPath.replace(/"/g, '\\"')}"`;
    }
    const appleScript = `POSIX path of (choose folder ${prompt} ${defaultLocation})`;
    try {
      const proc = Bun.spawn(["osascript", "-e", appleScript], { stdout: "pipe" });
      const out = await new Response(proc.stdout).text();
      await proc.exited;
      return out.trim() || null;
    } catch (e) {
      console.error("Failed to run appleScript directory picker", e);
      return null;
    }
  } else {
    // Linux/BSD
    const args = ["zenity", "--file-selection", "--directory", `--title=${title}`];
    if (defaultPath) {
      args.push(`--filename=${defaultPath}`);
    }
    try {
      const proc = Bun.spawn(args, { stdout: "pipe" });
      const exitCode = await proc.exited;
      if (exitCode === 0) {
        const out = await new Response(proc.stdout).text();
        return out.trim() || null;
      }
      return null;
    } catch (e) {
      console.error("Failed to run zenity directory picker", e);
      return null;
    }
  }
}

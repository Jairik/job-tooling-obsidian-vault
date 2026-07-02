// LaTeX → PDF pipeline. The model returns a complete .tex document (built from
// the predefined template in ./templates/document.tex); this module compiles it
// with tectonic in an isolated temp directory and registers the resulting PDF
// under a compile id that GET /api/latex/:id/pdf serves back to the browser.
// PDFs are ephemeral by design — the durable artifact is the .tex source kept in
// tab state, from which the UI can always recompile.
import { join } from "path";
import { tmpdir } from "os";
import { mkdtemp, rm } from "fs/promises";
// Embedded at build time so the template survives `bun build --compile` (where
// import.meta.dir points at the virtual bundle root, not a readable directory).
import documentTemplate from "./templates/document.tex" with { type: "text" };

const COMPILE_TIMEOUT_MS = 180_000; // generous: first run downloads TeX packages
const REGISTRY_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const LOG_TAIL_CHARS = 8_000;

interface CompiledDoc {
  pdfPath: string;
  dir: string;
  tex: string;
  createdAt: number;
}

const registry = new Map<string, CompiledDoc>();

/* Reports whether the tectonic binary is on PATH. */
export function tectonicAvailable(): boolean {
  return Bun.which("tectonic") !== null;
}

export function tectonicInstallHint(): string {
  return "Install tectonic to render PDFs: `sudo pacman -S tectonic` (Arch), `brew install tectonic` (macOS), or `cargo install tectonic`.";
}

/* Loads the predefined LaTeX template handed to the model in latex mode. */
export async function loadLatexTemplate(): Promise<string> {
  return documentTemplate.trim();
}

// Models often wrap file contents in markdown fences despite instructions; strip
// one outer ```latex/```tex/``` fence and any prose before \documentclass.
/* Unwraps code fences and leading prose from a model-returned LaTeX document. */
export function stripTexFences(text: string): string {
  let out = text.trim();
  const fence = out.match(/^```(?:latex|tex)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fence) out = fence[1].trim();
  const docStart = out.indexOf("\\documentclass");
  if (docStart > 0) out = out.slice(docStart);
  return out;
}

/* Looks up a previously compiled document by its compile id. */
export function getCompiled(id: string): CompiledDoc | undefined {
  return registry.get(id);
}

/* Deletes registry entries (and their temp dirs) past the retention window. */
async function sweepRegistry(): Promise<void> {
  const now = Date.now();
  for (const [id, doc] of registry) {
    if (now - doc.createdAt > REGISTRY_MAX_AGE_MS) {
      registry.delete(id);
      await rm(doc.dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export type CompileResult =
  | { ok: true; compileId: string; pdfPath: string }
  | { ok: false; log: string };

/* Compiles one .tex document with tectonic and registers the produced PDF. */
export async function compileLatex(tex: string): Promise<CompileResult> {
  sweepRegistry().catch(() => {});
  const dir = await mkdtemp(join(tmpdir(), "va-latex-"));
  const texPath = join(dir, "doc.tex");
  await Bun.write(texPath, tex);

  // --untrusted disables shell-escape and other risky features: the input is
  // model-generated and must not be able to run commands or read outside files.
  const proc = Bun.spawn(
    ["tectonic", "--untrusted", "--chatter", "minimal", "--outdir", dir, texPath],
    { cwd: dir, stdout: "pipe", stderr: "pipe" }
  );
  const timeout = setTimeout(() => proc.kill(), COMPILE_TIMEOUT_MS);
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  clearTimeout(timeout);

  if (exitCode !== 0) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    const log = `${stdout}\n${stderr}`.trim();
    return { ok: false, log: log.slice(-LOG_TAIL_CHARS) || `tectonic exited with code ${exitCode}` };
  }

  const compileId = crypto.randomUUID();
  registry.set(compileId, { pdfPath: join(dir, "doc.pdf"), dir, tex, createdAt: Date.now() });
  return { ok: true, compileId, pdfPath: join(dir, "doc.pdf") };
}

// Inline viewer for a compiled LaTeX answer: the browser's native PDF viewer in
// an iframe, plus download actions for both artifacts. Compiled PDFs are
// ephemeral server-side (temp dir, cleared on restart); the durable artifact is
// the .tex source, so a missing PDF offers a Recompile instead of an error page.
interface Props {
  pdfUrl: string; // "" when no compiled PDF is available
  tex: string;
  tall?: boolean; // larger height inside the expanded modal
  compiling?: boolean;
  onRecompile: () => void;
}

/* Triggers a client-side download of the .tex source. */
function downloadTex(tex: string) {
  const url = URL.createObjectURL(new Blob([tex], { type: "application/x-tex" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "document.tex";
  a.click();
  URL.revokeObjectURL(url);
}

/* Renders the compiled PDF with download and recompile controls. */
export function PdfPreview({ pdfUrl, tex, tall, compiling, onRecompile }: Props) {
  return (
    <div className="pdf-preview">
      {pdfUrl ? (
        <iframe className={`pdf-frame ${tall ? "tall" : ""}`} src={pdfUrl} title="Compiled PDF" />
      ) : (
        <div className="pdf-missing">
          <p>No compiled PDF{tex ? " — recompile from the saved LaTeX source." : "."}</p>
          {tex && (
            <button className="btn btn-primary" onClick={onRecompile} disabled={compiling}>
              {compiling ? "Compiling…" : "Recompile"}
            </button>
          )}
        </div>
      )}
      <div className="pdf-actions">
        {pdfUrl && (
          <>
            <a className="btn btn-ghost" href={pdfUrl} download="document.pdf">
              Download .pdf
            </a>
            <button className="btn btn-ghost" onClick={onRecompile} disabled={compiling}>
              {compiling ? "Compiling…" : "Recompile"}
            </button>
          </>
        )}
        {tex && (
          <button className="btn btn-ghost" onClick={() => downloadTex(tex)}>
            Download .tex
          </button>
        )}
      </div>
    </div>
  );
}

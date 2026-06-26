// Renders agent-produced markdown as formatted HTML. Raw HTML in the source is
// escaped (no rehype-raw) so model output can't inject markup. The container div
// exposes a ref so callers can read `innerText` — the visible text with markdown
// stripped and block/list line breaks preserved — for copy and plain-text editing.
import { forwardRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  children: string;
  className?: string;
}

export const Markdown = forwardRef<HTMLDivElement, Props>(function Markdown(
  { children, className },
  ref,
) {
  return (
    <div ref={ref} className={`answer-md${className ? ` ${className}` : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});

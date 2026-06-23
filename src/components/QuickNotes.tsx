// Quick Notes drawer: a local-only, copy-on-click scratchpad of reusable profile
// links, professional references (real people), and labeled note boxes to paste
// into applications. Persisted to localStorage via the store helpers.
import { useEffect, useState, type ReactElement } from "react";
import {
  loadQuickNotes,
  saveQuickNotes,
  uid,
  type QuickNotes as QN,
} from "../lib/store";

interface Props {
  onClose: () => void;
}

// Monochrome glyphs (inherit currentColor) for the common profile-link kinds.
const ICONS: Record<string, ReactElement> = {
  github: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.2.8-.6v-2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.8 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.5-2.7 5.5-5.3 5.8.4.4.8 1.1.8 2.2v3.3c0 .4.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z" />
    </svg>
  ),
  linkedin: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.47-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.8 0 0 .77 0 1.73v20.54C0 23.22.8 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
    </svg>
  ),
  x: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden>
      <path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.21-6.82-5.97 6.82H1.66l7.73-8.84L1.25 2.25h6.83l4.71 6.23 5.45-6.23zm-1.16 17.52h1.83L7.01 4.12H5.04l12.04 15.65z" />
    </svg>
  ),
  globe: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" />
    </svg>
  ),
  mail: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  ),
  doc: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
  ),
  link: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" />
    </svg>
  ),
  user: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  ),
};

const ICON_ORDER = ["github", "linkedin", "globe", "mail", "x", "doc", "link"];

/* Resolves a small inline icon name to the matching Unicode symbol. */
function Icon({ name }: { name: string }) {
  return ICONS[name] ?? ICONS.link;
}

/* Renders an editable, locally persisted scratchpad for links, contacts, and notes. */
export function QuickNotes({ onClose }: Props) {
  const [qn, setQn] = useState<QN>(() => loadQuickNotes());
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    saveQuickNotes(qn);
  }, [qn]);

  /* Copies one field and tracks which control should display the confirmation state. */
  const copy = async (id: string, text: string) => {
    const value = text.trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(id);
    setTimeout(() => setCopied((c) => (c === id ? null : c)), 1200);
  };

  // ── Links ──────────────────────────────────────────────────────────────
  /* Applies one targeted edit without rebuilding unrelated quick-note entries. */
  const patchLink = (id: string, patch: Partial<QN["links"][number]>) =>
    setQn((q) => ({ ...q, links: q.links.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));

  /* Rotates through the supported icon set for a saved link. */
  const cycleIcon = (id: string) =>
    setQn((q) => ({
      ...q,
      links: q.links.map((l) =>
        l.id === id
          ? { ...l, icon: ICON_ORDER[(ICON_ORDER.indexOf(l.icon) + 1) % ICON_ORDER.length] }
          : l
      ),
    }));

  /* Adds a blank link record that the user can edit in place. */
  const addLink = () =>
    setQn((q) => ({ ...q, links: [...q.links, { id: uid(), icon: "link", label: "New link", value: "" }] }));

  // ── References (real people) ─────────────────────────────────────────────
  /* Updates one reference contact while preserving the rest of the list. */
  const patchRef = (id: string, patch: Partial<QN["references"][number]>) =>
    setQn((q) => ({
      ...q,
      references: q.references.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));

  // ── Boxes ──────────────────────────────────────────────────────────────
  /* Updates one free-form notes box without replacing other boxes. */
  const patchBox = (id: string, patch: Partial<QN["boxes"][number]>) =>
    setQn((q) => ({ ...q, boxes: q.boxes.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));

  /* Adds an empty free-form notes box. */
  const addBox = () =>
    setQn((q) => ({ ...q, boxes: [...q.boxes, { id: uid(), label: "New box", value: "" }] }));

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer quicknotes" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h2>Quick notes</h2>
          <button className="icon-btn" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="drawer-sub">
          Reusable links, references, and snippets — copy any field into an application in one
          click. Saved on this device.
        </p>

        <section className="qn-section">
          <div className="qn-section-head">
            <span className="qn-section-title">Links</span>
            <button className="qn-add" onClick={addLink}>
              + Add link
            </button>
          </div>
          <div className="qn-links">
            {qn.links.map((link) => (
              <div className="qn-link" key={link.id}>
                <button
                  className="qn-icon"
                  title="Change icon"
                  onClick={() => cycleIcon(link.id)}
                >
                  <Icon name={link.icon} />
                </button>
                <input
                  className="qn-label-input"
                  value={link.label}
                  placeholder="Label"
                  onChange={(e) => patchLink(link.id, { label: e.target.value })}
                />
                <button
                  className={`qn-copy ${copied === link.id ? "ok" : ""}`}
                  disabled={!link.value.trim()}
                  onClick={() => copy(link.id, link.value)}
                >
                  {copied === link.id ? "Copied" : "Copy"}
                </button>
                <input
                  className="qn-url"
                  value={link.value}
                  spellCheck={false}
                  placeholder="https://…  ·  name@email.com"
                  onChange={(e) => patchLink(link.id, { value: e.target.value })}
                />
              </div>
            ))}
            {qn.links.length === 0 && (
              <div className="notice small">No links yet — add one to keep your profile URLs handy.</div>
            )}
          </div>
        </section>

        <section className="qn-section">
          <div className="qn-section-head">
            <span className="qn-section-title">References</span>
          </div>
          <div className="qn-refs">
            {qn.references.map((ref, i) => (
              <div className="qn-ref" key={ref.id}>
                <div className="qn-ref-head">
                  <span className="qn-ref-icon" aria-label={`Reference ${i + 1}`}>
                    <Icon name="user" />
                    <span className="qn-ref-num">{i + 1}</span>
                  </span>
                  <input
                    className="qn-label-input"
                    value={ref.name}
                    placeholder="Full name"
                    onChange={(e) => patchRef(ref.id, { name: e.target.value })}
                  />
                </div>
                <div className="qn-ref-field">
                  <input
                    type="text"
                    className="qn-ref-input"
                    value={ref.email}
                    spellCheck={false}
                    placeholder="name@email.com"
                    onChange={(e) => patchRef(ref.id, { email: e.target.value })}
                  />
                  <button
                    className={`qn-copy ${copied === `${ref.id}:email` ? "ok" : ""}`}
                    disabled={!ref.email.trim()}
                    onClick={() => copy(`${ref.id}:email`, ref.email)}
                  >
                    {copied === `${ref.id}:email` ? "Copied" : "Copy"}
                  </button>
                </div>
                <div className="qn-ref-field">
                  <input
                    type="text"
                    className="qn-ref-input"
                    value={ref.phone}
                    spellCheck={false}
                    placeholder="(555) 123-4567"
                    onChange={(e) => patchRef(ref.id, { phone: e.target.value })}
                  />
                  <button
                    className={`qn-copy ${copied === `${ref.id}:phone` ? "ok" : ""}`}
                    disabled={!ref.phone.trim()}
                    onClick={() => copy(`${ref.id}:phone`, ref.phone)}
                  >
                    {copied === `${ref.id}:phone` ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="qn-section">
          <div className="qn-section-head">
            <span className="qn-section-title">Notes</span>
            <button className="qn-add" onClick={addBox}>
              + Add box
            </button>
          </div>
          <div className="qn-boxes">
            {qn.boxes.map((box) => (
              <div className="qn-box" key={box.id}>
                <div className="qn-box-head">
                  <input
                    className="qn-label-input"
                    value={box.label}
                    placeholder="Label"
                    onChange={(e) => patchBox(box.id, { label: e.target.value })}
                  />
                  <button
                    className={`qn-copy ${copied === box.id ? "ok" : ""}`}
                    disabled={!box.value.trim()}
                    onClick={() => copy(box.id, box.value)}
                  >
                    {copied === box.id ? "Copied" : "Copy"}
                  </button>
                </div>
                <textarea
                  rows={4}
                  value={box.value}
                  placeholder="A cover-letter blurb, salary expectations, “why this company”…"
                  onChange={(e) => patchBox(box.id, { value: e.target.value })}
                />
              </div>
            ))}
            {qn.boxes.length === 0 && (
              <div className="notice small">
                No boxes yet — add one to store a labeled snippet you reuse across applications.
              </div>
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}

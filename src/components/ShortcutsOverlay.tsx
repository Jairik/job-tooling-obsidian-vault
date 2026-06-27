// A read-only cheat-sheet of every keyboard shortcut, opened with "?" or from
// Settings → Help. Purely presentational: it renders the SHORTCUTS list from
// lib/shortcuts and closes on backdrop click or Escape, matching the other modals.
import { useEffect } from "react";
import { SHORTCUTS } from "../lib/shortcuts";

interface Props {
  onClose: () => void;
}

/* Centered modal listing the app's keyboard shortcuts as labelled key chips. */
export function ShortcutsOverlay({ onClose }: Props) {
  // Escape closes, like every other dialog in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="shortcuts-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts-head">
          <span className="shortcuts-title">Keyboard shortcuts</span>
          <button className="ans-action-btn" title="Close" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="shortcuts-body">
          {SHORTCUTS.map((section) => (
            <div className="shortcuts-section" key={section.title}>
              <span className="shortcuts-section-lbl">{section.title}</span>
              {section.items.map((s) => (
                <div className="shortcut-row" key={s.label}>
                  <span className="shortcut-label">{s.label}</span>
                  <span className="shortcut-keys">
                    {s.keys.map((k, i) => (
                      <kbd className="kbd" key={i}>
                        {k}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

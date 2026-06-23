// A compact multi-select for choosing which installed skills to apply to a vault
// interaction. Renders as a pill-toggle ("Skills" + count badge) that opens a
// searchable dropdown of checkboxes. Shared by the input footer and Vault Writer.
//
// The dropdown is positioned `fixed`, anchored to the button with a measured rect,
// and rendered through a portal to <body>. Both matter: the cards it lives in use
// `overflow: clip` (which would clip an absolute menu) and carry a `transform`
// from their entrance animation (which would otherwise capture a fixed menu as
// its containing block, offsetting it). The portal escapes both.
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SkillInfo } from "../lib/store";

interface Props {
  availableSkills: SkillInfo[];
  selected: string[];
  onChange: (skills: string[]) => void;
  title?: string;
}

interface MenuPos {
  left: number;
  top?: number;
  bottom?: number;
}

/* Lets callers choose a deduplicated set of installed skills for a tab request. */
export function SkillPicker({ availableSkills, selected, onChange, title }: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<MenuPos>({ left: 0, top: 0 });

  // Anchor the fixed menu to the button, flipping upward when there isn't room.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const estimate = Math.min(340, 80 + availableSkills.length * 56);
    if (spaceBelow < estimate && r.top > spaceBelow) {
      setPos({ left: r.left, bottom: window.innerHeight - r.top + 6 });
    } else {
      setPos({ left: r.left, top: r.bottom + 6 });
    }
  }, [open, availableSkills.length]);

  const toggle = (name: string) => {
    onChange(selected.includes(name) ? selected.filter((s) => s !== name) : [...selected, name]);
  };

  // Count only selections that still correspond to an installed skill.
  const activeCount = selected.filter((s) => availableSkills.some((a) => a.name === s)).length;
  const q = filter.trim().toLowerCase();
  const shown = q
    ? availableSkills.filter(
        (s) => s.name.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q)
      )
    : availableSkills;

  return (
    <div className="skills-dd-wrap">
      <button
        ref={btnRef}
        type="button"
        className={`pill-toggle ${activeCount ? "on" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title={title ?? "Choose which skills to apply to this interaction"}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
        Skills
        <span className={`skill-count-badge ${activeCount ? "" : "hidden"}`}>{activeCount}</span>
      </button>
      {open &&
        createPortal(
          <>
            <div className="skills-dd-backdrop" onClick={() => setOpen(false)} />
            <div
              className="skills-dd"
              role="menu"
              style={{ left: pos.left, top: pos.top, bottom: pos.bottom }}
            >
              <div className="skills-dd-search">
                <input
                  className="skills-dd-input"
                  autoFocus
                  placeholder="Search skills…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>
              <div className="skills-dd-list">
                {availableSkills.length === 0 ? (
                  <div className="skills-dd-empty">No skills found — add one in Settings.</div>
                ) : shown.length === 0 ? (
                  <div className="skills-dd-empty">No skills match.</div>
                ) : (
                  shown.map((s) => (
                    <label key={`${s.scope}:${s.name}`} className="skills-dd-item">
                      <input
                        type="checkbox"
                        checked={selected.includes(s.name)}
                        onChange={() => toggle(s.name)}
                      />
                      <span className="skills-dd-item-body">
                        <span className="skills-dd-name">
                          {s.name}
                          <span className={`skill-scope-badge ${s.scope}`}>{s.scope}</span>
                        </span>
                        {s.description && <span className="skills-dd-desc">{s.description}</span>}
                      </span>
                    </label>
                  ))
                )}
              </div>
              <div className="skills-dd-footer">Skills run after the main draft.</div>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}

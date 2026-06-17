// A compact multi-select for choosing which installed skills to apply to a vault
// interaction. Renders as a chip-styled button ("Skills · n") that opens a
// popover of checkboxes. Shared by the Ask/Job controls row and the Vault Writer.
//
// The popover is positioned `fixed`, anchored to the button with a measured rect,
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

export function SkillPicker({ availableSkills, selected, onChange, title }: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<MenuPos>({ left: 0, top: 0 });

  // Anchor the fixed menu to the button, flipping upward when there isn't room.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const estimate = Math.min(320, 56 + availableSkills.length * 58);
    if (spaceBelow < estimate && r.top > spaceBelow) {
      setPos({ left: r.left, bottom: window.innerHeight - r.top + 8 });
    } else {
      setPos({ left: r.left, top: r.bottom + 8 });
    }
  }, [open, availableSkills.length]);

  const toggle = (name: string) => {
    onChange(selected.includes(name) ? selected.filter((s) => s !== name) : [...selected, name]);
  };

  // Count selections that still map to an installed skill.
  const activeCount = selected.filter((s) => availableSkills.some((a) => a.name === s)).length;

  return (
    <div className="skill-picker">
      <button
        ref={btnRef}
        type="button"
        className={`chip skill-picker-chip ${activeCount ? "has-selection" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title={title ?? "Choose which skills to apply to this interaction"}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span>Skills</span>
        {activeCount > 0 && <span className="chip-note muted">{activeCount}</span>}
      </button>
      {open &&
        createPortal(
          <>
            <div className="skill-picker-backdrop" onClick={() => setOpen(false)} />
            <div
              className="skill-picker-menu"
              role="menu"
              style={{ left: pos.left, top: pos.top, bottom: pos.bottom }}
            >
              {availableSkills.length === 0 ? (
                <div className="skill-picker-empty">No skills found — add one in Settings.</div>
              ) : (
                availableSkills.map((s) => (
                  <label key={`${s.scope}:${s.name}`} className="skill-picker-row">
                    <input
                      type="checkbox"
                      checked={selected.includes(s.name)}
                      onChange={() => toggle(s.name)}
                    />
                    <span className="skill-picker-info">
                      <span className="skill-picker-name">
                        {s.name}
                        <span className={`skill-scope-badge ${s.scope}`}>{s.scope}</span>
                      </span>
                      {s.description && <span className="skill-picker-desc">{s.description}</span>}
                    </span>
                  </label>
                ))
              )}
            </div>
          </>,
          document.body
        )}
    </div>
  );
}

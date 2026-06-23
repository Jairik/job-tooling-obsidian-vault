/* Presentation-controls subsection extracted from SettingsPanel for readability. */
import type { BorderRadius, DesignSettings, FontFamily, ShadowIntensity, SpacingScale } from "../lib/store";
import { DEFAULT_DESIGN } from "../lib/store";
import { FONT_OPTIONS } from "../lib/fonts";
import { FUN_VARIANTS, type FunVariant } from "../../shared/design";

interface Props {
  design: DesignSettings;
  onChange: (patch: Partial<DesignSettings>) => void;
}

/* Groups presentation-only settings so the primary settings panel stays focused. */
export function DesignSettingsSection({ design, onChange }: Props) {
  return (
    <>
      <div className="settings-section">
        <div className="settings-section-title">Background</div>

        <label className="toggle-row">
          <input type="checkbox" checked={design.funEnabled} onChange={(event) => onChange({ funEnabled: event.target.checked })} />
          <span>Animated background (fun mode)</span>
        </label>

        {design.funEnabled && (
          <div className="fun-variant-grid">
            {FUN_VARIANTS.map((variant) => (
              <button
                key={variant.id}
                className={`fun-variant-option ${design.funVariant === variant.id ? "active" : ""}`}
                onClick={() => onChange({ funVariant: variant.id as FunVariant })}
              >
                {variant.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Typography</div>

        <label className="field">
          <span>Font family</span>
          <select value={design.fontFamily} onChange={(event) => onChange({ fontFamily: event.target.value as FontFamily })}>
            {FONT_OPTIONS.map((font) => (
              <option key={font.id} value={font.id}>
                {font.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Font scale ({design.fontScale.toFixed(2)}x)</span>
          <input
            type="range"
            min={0.8}
            max={1.2}
            step={0.05}
            value={design.fontScale}
            onChange={(event) => onChange({ fontScale: Number(event.target.value) })}
          />
        </label>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Colors</div>

        <label className="field">
          <span>Accent hue ({design.accentHue}°)</span>
          <input type="range" min={0} max={360} step={1} value={design.accentHue} onChange={(event) => onChange({ accentHue: Number(event.target.value) })} />
        </label>

        <label className="field">
          <span>Accent intensity ({(design.accentChroma * 100).toFixed(0)}%)</span>
          <input type="range" min={0.05} max={0.2} step={0.01} value={design.accentChroma} onChange={(event) => onChange({ accentChroma: Number(event.target.value) })} />
        </label>

        <div className="color-swatch" style={{ background: "var(--accent)" }} title="Accent color preview" />
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Layout</div>

        <label className="field">
          <span>Border radius</span>
        </label>
        <div className="radius-preview">
          {(["sharp", "rounded", "pill", "circle"] as BorderRadius[]).map((radius) => (
            <button
              key={radius}
              className={`radius-option ${design.borderRadius === radius ? "active" : ""}`}
              data-radius={radius}
              onClick={() => onChange({ borderRadius: radius })}
              title={radius}
            >
              {radius === "sharp" ? "▢" : radius === "rounded" ? "▢" : radius === "pill" ? "⬭" : "○"}
            </button>
          ))}
        </div>

        <label className="field" style={{ marginTop: "var(--space-2)" }}>
          <span>Spacing</span>
        </label>
        <div className="shadow-preview">
          {(["compact", "comfortable", "spacious"] as SpacingScale[]).map((spacing) => (
            <button key={spacing} className={`shadow-option ${design.spacingScale === spacing ? "active" : ""}`} onClick={() => onChange({ spacingScale: spacing })} title={spacing}>
              {spacing === "compact" ? "▪" : spacing === "comfortable" ? "▫" : "□"}
            </button>
          ))}
        </div>

        <label className="field" style={{ marginTop: "var(--space-2)" }}>
          <span>Shadow intensity</span>
        </label>
        <div className="shadow-preview">
          {(["none", "subtle", "medium", "strong"] as ShadowIntensity[]).map((shadow) => (
            <button
              key={shadow}
              className={`shadow-option ${design.shadowIntensity === shadow ? "active" : ""}`}
              data-shadow={shadow}
              onClick={() => onChange({ shadowIntensity: shadow })}
              title={shadow}
            >
              {shadow === "none" ? "○" : shadow === "subtle" ? "◦" : shadow === "medium" ? "●" : "◉"}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-reset">
        <button onClick={() => onChange(DEFAULT_DESIGN)}>Reset Design to Defaults</button>
      </div>
    </>
  );
}

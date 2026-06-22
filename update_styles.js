/* One-off helper that updates the CSS theme-token blocks in place. */
const fs = require('fs');

/* Read the full stylesheet because the replacements target multi-line token sections. */
let css = fs.readFileSync('src/styles.css', 'utf8');

/* Replace the complete dark-theme variable block while leaving component rules intact. */
css = css.replace(
  /:root \{\n[\s\S]*?color-scheme: dark;\n\}/,
  `:root {
  /* Modern Dark Theme (Neutral, High Contrast) */
  --bg:          oklch(18% 0.002 250);
  --surface:     oklch(22% 0.002 250);
  --surface-2:   oklch(26% 0.002 250);
  --elevated:    oklch(24% 0.002 250);
  --fg:          oklch(96% 0.002 250);
  --muted:       oklch(70% 0.005 250);
  --border:      oklch(32% 0.005 250);

  --accent:        oklch(75% 0.12 250);
  --accent-strong: oklch(62% 0.16 250);
  --on-accent:     oklch(98% 0.01 250);

  --success: oklch(75% 0.15 150);
  --warning: oklch(82% 0.14 80);
  --danger:  oklch(70% 0.18 25);

  --font-display: "Inter", -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif;
  --font-body:    "Inter", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, system-ui, sans-serif;
  --font-mono:    "JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;

  --radius-1: 8px;
  --radius-2: 12px;
  --radius-lg: 16px;
  --radius-pill: 9999px;

  --shadow-1: 0 2px 8px -2px rgba(0,0,0,0.25);
  --shadow-card: 0 4px 12px -4px rgba(0,0,0,0.3);

  --ring: 3px;
  --ring-color: color-mix(in oklch, var(--accent) 30%, transparent);

  --space-1: 8px;
  --space-2: 12px;
  --space-3: 16px;
  --space-4: 24px;
  --space-5: 32px;
  --space-6: 48px;

  --titlebar-h: 60px;
  --statusbar-h: 30px;

  --fs-0: 12px;
  --fs-1: 13px;
  --fs-2: 14px;
  --fs-3: 15px;
  --fs-4: 18px;

  color-scheme: dark;
}`
);

/* Replace the corresponding light-theme variable block with matching modern tokens. */
css = css.replace(
  /:root\[data-theme="light"\] \{\n[\s\S]*?color-scheme: light;\n\}/,
  `:root[data-theme="light"] {
  /* Modern Light Theme (Clean, Soft Borders) */
  --bg:          oklch(99% 0.001 250);
  --surface:     oklch(100% 0 0);
  --surface-2:   oklch(97% 0.002 250);
  --elevated:    oklch(100% 0 0);
  --fg:          oklch(20% 0.005 250);
  --muted:       oklch(55% 0.005 250);
  --border:      oklch(90% 0.005 250);

  --accent:        oklch(58% 0.18 250);
  --accent-strong: oklch(50% 0.20 250);
  --on-accent:     oklch(100% 0 0);

  --success: oklch(55% 0.18 145);
  --warning: oklch(65% 0.18 75);
  --danger:  oklch(55% 0.22 25);

  --shadow-1: 0 2px 8px -2px rgba(0,0,0,0.06);
  --shadow-card: 0 4px 12px -4px rgba(0,0,0,0.08);

  color-scheme: light;
}`
);

/* Commit both replacements only after they have been applied in memory. */
fs.writeFileSync('src/styles.css', css);
console.log('Styles updated');

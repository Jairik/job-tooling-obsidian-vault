"""One-off helper that replaces CSS theme tokens and the base body style in place."""

import re

"""Read the stylesheet as one string because the replacements span multiple lines."""
with open('src/styles.css', 'r') as f:
    css = f.read()

"""Replacement token block for the default dark theme."""
dark_theme = """\
:root {
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
}"""

"""Replacement token block for the opt-in light theme."""
light_theme = """\
:root[data-theme="light"] {
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
}"""

"""Replace complete token blocks rather than altering individual variables piecemeal."""
css = re.sub(r':root\s*\{.*?(?=color-scheme:\s*dark;).*?color-scheme:\s*dark;\s*\}', dark_theme, css, flags=re.DOTALL)
css = re.sub(r':root\[data-theme="light"\]\s*\{.*?color-scheme:\s*light;\s*\}', light_theme, css, flags=re.DOTALL)

"""Replace the base body rule while preserving fun-mode-specific styling elsewhere."""
body_style = """\
body {
  font-family: var(--font-body);
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--fg);
  background: var(--bg);
  background-attachment: fixed;
  -webkit-font-smoothing: antialiased;
}"""
css = re.sub(r'body\s*\{.*?\}', body_style, css, flags=re.DOTALL)

"""Write the assembled stylesheet only after all substitutions have completed."""
with open('src/styles.css', 'w') as f:
    f.write(css)

print('Tokens updated')

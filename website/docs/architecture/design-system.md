---
id: design-system
title: Design system and interface styling
---

# Design system and interface styling

The Vault Assistant interface uses a clean, developer-focused aesthetic: dark surfaces, monospaced labels, status badges, and segmented chips.

All styles are defined in `src/styles.css` using CSS custom properties. This design ensures that the layout is driven by global tokens rather than scattered inline styles.

## Styling tokens

Colors are defined using the **OKLCH** format. Authoring colors in OKLCH allows the interface to derive hover states, active states, and border tints dynamically using the CSS `color-mix` function rather than using hardcoded hexadecimal values.

- **Core colors:** `--bg` (page background), `--surface` (card and drawer backgrounds), `--fg` (text), `--muted` (labels and borders), and `--accent` (interactive elements and selections). The default accent color matches Obsidian purple.
- **Status colors:** `--success` (green), `--warning` (yellow), and `--danger` (red) status badges and outlines.
- **Typography:** `--font-display` (interface headings), `--font-body` (prose and model outputs), and `--font-mono` (badges, logs, and metadata).
- **Sizing and rhythm:** `--space-1` through `--space-6` handle margins and padding. `--radius-1` and `--radius-2` define border radii, while `--shadow-card` handles card elevations.

---

## Themes and layouts

Theme and layout density properties are set directly as attributes on the `<html>` element. The CSS styles target these attributes, ensuring that changes propagate instantly without forcing React components to re-render.

- **Theme settings:** Toggled using the sun and moon icon buttons. The application sets `data-theme="dark"` (default) or `data-theme="light"` on the root element.
- **Layout density:** Toggled using the layout size buttons. Setting `data-density="comfortable"` or `data-density="compact"` adjusts the base spacing scale and font size.
- **Persistence:** The application saves these preferences in the browser `localStorage` (`jt.theme` and `jt.density`). A small inline script in `src/index.html` reads these keys before rendering. This prevents the screen from flashing different colors when the page reloads.

---

## Reusable UI components

The interface uses standard class structures. Re-use these patterns when adding new panels:

- **`.card`:** The default container surface. It features a header (`.card-h`) and a body (`.card-b`). It is used for prompt inputs, settings options, and model outputs.
- **`.pill`:** Status and metadata chips (like the model identifier badges in the header). You can combine a pill with a `.dot` element to add a colored status indicator.
- **`.chip`:** Segmented checkboxes or radio selections. Setting the `:has(input:checked)` selector highlights the active option. This pattern is used for RAG, LaTeX, and override selectors.
- **`.btn`:** General buttons. The main action button (`.btn-primary`) uses a gradient background with a light sweep animation on hover.
- **`.statusbar`:** The footer bar. It displays tab count, active engine status, RAG state, and execution phases.

---

## Split view and alternate backgrounds

- **Split view layout:** Clicking the split icon button (`◫`) divides the workspace into two side-by-side panes. The left pane follows the main tab bar, while the right pane selector defaults to another active tab. Each pane runs an independent `TabView` instance. This design lets you draft answers or compare different model outputs side by side.
- **Fun backgrounds:** Clicking the sparkles icon (`✨`) activates an animated canvas or CSS background. It cycles through multiple variants: Aurora, Particles, Waves, Dot Grid, and Mesh. These animations sit behind translucent card surfaces to preserve text readability. The backgrounds respect your system preferences and fall back to static designs if `prefers-reduced-motion` is active.

// Google Fonts loader utility
// Lazily loads fonts from Google Fonts CDN when needed

import type { FontFamily } from "./store";

interface FontConfig {
  id: FontFamily;
  label: string;
  family: string;
  weights: number[];
  isGoogle: boolean;
}

export const FONT_OPTIONS: FontConfig[] = [
  { id: "system", label: "System Default", family: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', system-ui, sans-serif", weights: [400, 500, 600, 700], isGoogle: false },
  { id: "inter", label: "Inter", family: "'Inter', sans-serif", weights: [400, 500, 600, 700], isGoogle: true },
  { id: "roboto", label: "Roboto", family: "'Roboto', sans-serif", weights: [400, 500, 700], isGoogle: true },
  { id: "opensans", label: "Open Sans", family: "'Open Sans', sans-serif", weights: [400, 600, 700], isGoogle: true },
  { id: "lato", label: "Lato", family: "'Lato', sans-serif", weights: [400, 700], isGoogle: true },
  { id: "montserrat", label: "Montserrat", family: "'Montserrat', sans-serif", weights: [400, 500, 600, 700], isGoogle: true },
  { id: "source-sans", label: "Source Sans Pro", family: "'Source Sans 3', sans-serif", weights: [400, 600, 700], isGoogle: true },
  { id: "nunito", label: "Nunito", family: "'Nunito', sans-serif", weights: [400, 600, 700], isGoogle: true },
  { id: "raleway", label: "Raleway", family: "'Raleway', sans-serif", weights: [400, 500, 600, 700], isGoogle: true },
  { id: "poppins", label: "Poppins", family: "'Poppins', sans-serif", weights: [400, 500, 600, 700], isGoogle: true },
  { id: "fira-code", label: "Fira Code", family: "'Fira Code', monospace", weights: [400, 500, 700], isGoogle: true },
  { id: "jetbrains-mono", label: "JetBrains Mono", family: "'JetBrains Mono', monospace", weights: [400, 500, 700], isGoogle: true },
];

const loadedFonts = new Set<FontFamily>();

export function getFontFamily(id: FontFamily): string {
  const config = FONT_OPTIONS.find((f) => f.id === id);
  return config?.family ?? FONT_OPTIONS[0].family;
}

export async function loadFont(id: FontFamily): Promise<void> {
  if (loadedFonts.has(id)) return;

  const config = FONT_OPTIONS.find((f) => f.id === id);
  if (!config || !config.isGoogle) {
    loadedFonts.add(id);
    return;
  }

  const fontName = config.family.replace(/'/g, "").split(",")[0].trim();
  const weights = config.weights.join(";");
  const url = `https://fonts.googleapis.com/css2?family=${fontName.replace(/\s+/g, "+")}:wght@${weights}&display=swap`;

  try {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    document.head.appendChild(link);

    // Resolve on load or error, but also after 2s regardless: a slow or blocked
    // Google Fonts CDN must never hang the font switch — we just fall back to the
    // next family in the CSS stack until (if ever) the stylesheet arrives.
    await new Promise<void>((resolve) => {
      link.onload = () => resolve();
      link.onerror = () => resolve();
      setTimeout(() => resolve(), 2000);
    });

    loadedFonts.add(id);
  } catch {
    loadedFonts.add(id);
  }
}

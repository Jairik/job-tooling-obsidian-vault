// Keyboard-shortcut helpers and the single source of truth for the binding list.
// The handlers live where the action lives (App for globals, TabView for editor
// keys), but the human-readable list is centralised here so the cheat-sheet can
// never drift from what the app actually advertises.

/* True when the event originated in a text field, so bare-key shortcuts (e.g. "?")
   don't fire while the user is typing. */
export function isEditableTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node || !node.tagName) return false;
  const tag = node.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || node.isContentEditable;
}

// Used only to label keys (⌘ vs Ctrl); the handlers always accept both metaKey
// and ctrlKey so the bindings work regardless of platform.
export const IS_MAC =
  typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent || "");

const MOD = IS_MAC ? "⌘" : "Ctrl";

export interface Shortcut {
  keys: string[];
  label: string;
}

export interface ShortcutSection {
  title: string;
  items: Shortcut[];
}

// Mirrors the binding map in the plan. `keys` are display strings (rendered as
// <kbd> chips); the actual matching happens in the handlers.
export const SHORTCUTS: ShortcutSection[] = [
  {
    title: "Composer",
    items: [
      { keys: ["Enter"], label: "Send / generate the question" },
      { keys: ["Shift", "Enter"], label: "New line in the question" },
      { keys: [MOD, "Enter"], label: "Send from any field (or new line in question)" },
      { keys: [MOD, "/"], label: "Open the Skills picker" },
    ],
  },
  {
    title: "App",
    items: [
      { keys: [MOD, ","], label: "Open / close Settings" },
      { keys: [MOD, "\\"], label: "Toggle split view" },
      { keys: [MOD, "."], label: "Cycle mode (Ask → Draft → Write)" },
      { keys: ["Alt", "1…9"], label: "Jump to tab by number" },
      { keys: ["Alt", "T"], label: "New tab" },
      { keys: ["Alt", "W"], label: "Close current tab" },
      { keys: ["Alt", "N"], label: "Toggle Quick Notes" },
    ],
  },
  {
    title: "General",
    items: [
      { keys: ["?"], label: "Show this shortcut sheet" },
      { keys: ["Esc"], label: "Close the open dialog" },
    ],
  },
];

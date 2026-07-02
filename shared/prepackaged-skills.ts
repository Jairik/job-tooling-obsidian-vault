/*
 * The built-in skills that ship with the app, surfaced as global toggles in the
 * Skills settings tab (distinct from the user's discovered SKILL.md files). Each
 * one maps to an existing boolean in CoreSettings, so toggling it persists and
 * drives the runner through the same settings the rest of the app already reads.
 * Keep this module dependency-free so both the Bun server and the React client
 * can import it.
 */
import type { CoreSettings } from "./settings";

export interface PrepackagedSkill {
  id: string;
  name: string;
  description: string;
  // The CoreSettings boolean this skill turns on and off.
  settingKey: Extract<keyof CoreSettings, "humanize" | "webResearchEnabled">;
  // Shown beneath the toggle as a small notice (a warning or a dependency hint).
  note?: string;
}

export const PREPACKAGED_SKILLS: PrepackagedSkill[] = [
  {
    id: "humanize",
    name: "Humanize",
    description: "Rewrites answers to strip AI-writing tells while keeping your voice and every fact.",
    settingKey: "humanize",
    note: "Disabling may degrade response quality but improve speed.",
  },
  {
    id: "web-search-research",
    name: "Web-search research",
    description:
      "Lets the agent search the web through your local SearXNG when current information would improve an answer.",
    settingKey: "webResearchEnabled",
    note: "Requires a local SearXNG instance. Set its URL under Settings -> Retrieval.",
  },
];

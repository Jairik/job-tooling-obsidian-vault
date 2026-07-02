// Shared, user-facing help & walkthrough content. It is rendered in two places
// that both scroll and stack their children with a gap: the Settings → Help page
// (inside .s-body / .s-page) and, on first run, a standalone welcome modal
// (inside .onboard-body). Presentational only, with no state or side effects.
import type { ReactNode } from "react";

interface ModeCard {
  badge: string;
  title: string;
  blurb: string;
  steps: string[];
}

// The three per-tab product modes, switched from the mode bar at the top of a tab.
const MODES: ModeCard[] = [
  {
    badge: "Ask",
    title: "Ask the Vault",
    blurb:
      "The default mode. Ask a question and get an answer grounded in your notes. You'll see which files it reads as it goes.",
    steps: [
      "Type a question in the composer and send it.",
      "Watch the activity strip to see which notes it reads.",
      "Ask a follow-up to keep the same conversation going.",
    ],
  },
  {
    badge: "Draft",
    title: "Drafting mode",
    blurb:
      "Use Drafting mode when you want a first-person answer shaped by extra context. Add background, ask a specific question, and get a draft in your voice.",
    steps: [
      "Paste any context that should shape the draft.",
      "Ask the specific question you want answered.",
      "If Humanize is on, it rewrites the draft to sound natural.",
      "Refine with follow-ups, or use \"+ New question\" to reuse the same context.",
    ],
  },
  {
    badge: "Write",
    title: "Write to Vault",
    blurb:
      "Create new notes and save them back into your vault. Nothing touches disk until you confirm the preview.",
    steps: [
      "Summarize: turn pasted text or a URL into a clean markdown note.",
      "Manual: write a note yourself, then clean it up and auto-place it.",
      "Fill-in: scan the vault for gaps and draft notes to fill them.",
    ],
  },
];

interface Topic {
  icon: ReactNode;
  title: string;
  body: ReactNode;
}

/* Small consistent stroke icon used for the topic cards. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

const TOPICS: Topic[] = [
  {
    icon: <Icon><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="9" y1="4" x2="9" y2="20" /></Icon>,
    title: "Tabs & split view",
    body: (
      <>
        Each tab is an independent conversation with its own mode and settings. Open as
        many as you want, and use the <strong>split view</strong> button in the toolbar
        to work two side by side.
      </>
    ),
  },
  {
    icon: <Icon><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></Icon>,
    title: "AI engine & model",
    body: (
      <>
        Under <strong>Settings -&gt; AI Engine</strong>, choose Claude or an installed CLI
        engine: Gemini, OpenCode, Cursor, Copilot, or Codex. Set the model and reasoning
        effort there too. The status dot shows whether the selected CLI is on your
        <code> PATH</code>.
      </>
    ),
  },
  {
    icon: <Icon><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></Icon>,
    title: "Your voice (persona)",
    body: (
      <>
        <strong>Settings -&gt; Persona</strong> stores the system prompts used for each
        answer mode. Fill in your name, role, and voice notes to regenerate them, or
        edit either prompt by hand so answers sound like you.
      </>
    ),
  },
  {
    icon: <Icon><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></Icon>,
    title: "RAG / retrieval",
    body: (
      <>
        Turn on <strong>Settings -&gt; RAG / Retrieval</strong> to send the model only the
        most relevant vault passages instead of the whole vault. That uses fewer tokens
        and usually keeps answers tighter. Leave it off when you want the assistant to
        browse the vault freely.
      </>
    ),
  },
  {
    icon: <Icon><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></Icon>,
    title: "Skills",
    body: (
      <>
        <strong>Settings -&gt; Skills</strong> toggles built-in capabilities like <em>Humanize</em>
        {" "}(on by default) and <em>Web-search research</em>. It also lists portable
        skills from Claude-compatible folders and embeds selected <code>SKILL.md</code>
        instructions for every engine.
      </>
    ),
  },
  {
    icon: <Icon><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></Icon>,
    title: "Quick Notes",
    body: (
      <>
        The notes button in the toolbar opens a local scratchpad for reusable links,
        references, and snippets you paste often. It stays on your machine.
      </>
    ),
  },
  {
    icon: <Icon><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></Icon>,
    title: "Keyboard shortcuts",
    body: (
      <>
        The app works well from the keyboard: press <kbd className="kbd">Enter</kbd> to
        send a question, <kbd className="kbd">Ctrl</kbd>+<kbd className="kbd">/</kbd> to
        pick skills, and <kbd className="kbd">Ctrl</kbd>+<kbd className="kbd">,</kbd> for
        settings. Press <kbd className="kbd">?</kbd> anytime to see the full list.
      </>
    ),
  },
];

/* Renders the walkthrough sections; `showIntro` adds the one-paragraph overview. */
export function HelpGuide({ showIntro = true }: { showIntro?: boolean }) {
  return (
    <>
      {showIntro && (
        <div className="s-section">
          <p className="help-intro">
            Vault Assistant connects your knowledge vault (an Obsidian folder, or any
            directory of markdown files) to an AI engine. Use it to ask grounded
            questions, draft polished answers, and write new notes back into the vault.
            The app runs locally. Only your prompt and the excerpts it pulls from your
            vault go to the model provider you choose.
          </p>
        </div>
      )}

      <div className="s-section">
        <span className="s-section-lbl">The three modes</span>
        <div className="help-modes">
          {MODES.map((m) => (
            <div className="help-mode" key={m.title}>
              <div className="help-mode-hd">
                <span className="help-mode-badge">{m.badge}</span>
                <span className="help-mode-title">{m.title}</span>
              </div>
              <p className="help-mode-blurb">{m.blurb}</p>
              <ul className="help-steps">
                {m.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="notice small">
          Switch a tab's mode from the mode bar at the top of that tab.
        </p>
      </div>

      <div className="s-section">
        <span className="s-section-lbl">Getting around</span>
        {TOPICS.map((t) => (
          <div className="help-topic" key={t.title}>
            <span className="help-topic-ic">{t.icon}</span>
            <div className="help-topic-bd">
              <div className="help-topic-title">{t.title}</div>
              <div className="help-topic-desc">{t.body}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="s-section">
        <span className="s-section-lbl">First steps</span>
        <ul className="help-steps help-steps-lg">
          <li>Point the assistant at your vault under <strong>Settings -&gt; Vault</strong>.</li>
          <li>Set your name, role, and voice under <strong>Settings -&gt; Persona</strong>.</li>
          <li>Open a tab in <strong>Ask</strong> mode and ask something about your notes.</li>
          <li>Reopen this guide anytime from <strong>Settings -&gt; Help</strong>.</li>
        </ul>
      </div>
    </>
  );
}

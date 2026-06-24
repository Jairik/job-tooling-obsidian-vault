---
name: skill-creator
description: Author a single portable SKILL.md from a plain-language description of what the skill should do. Use whenever the user wants to create or rewrite a skill, capture a workflow as a reusable skill, or turn a description of a task into skill instructions.
---

# Skill Creator (authoring guide)

Use this guide to turn a plain-language description into one complete, well-written
`SKILL.md`. The result is a portable document: its full text is what other agents
read, so it has to stand on its own without any extra setup.

You are producing a single file. There are no test runs, evals, or bundled scripts
in this flow — just the SKILL.md itself. Make it good on the first pass, then look at
it with fresh eyes and tighten it.

## What a SKILL.md is

```
---
name: kebab-case-name
description: When to trigger + what it does (one line, the primary trigger signal)
---

# Human-readable title

Markdown instructions for the model that will use this skill.
```

Only `name` and `description` are required in the frontmatter. The body is plain
Markdown.

## The `name`

- kebab-case: lowercase letters, numbers, and hyphens only (e.g. `tone-check`,
  `meeting-notes`, `commit-message`).
- Short and descriptive of the skill's job, not a sentence.

## The `description` — this is the most important line

The description is the primary mechanism that decides whether the skill gets used.
It must say **both** what the skill does **and** when to trigger it. All "when to
use this" information belongs here, not buried in the body.

Models tend to *under*-trigger skills — they skip them even when they'd help. Counter
that by making the description a little pushy and concrete about its triggers:

- Weak: `Formats meeting notes.`
- Strong: `Turn raw meeting notes into a clean structured summary with decisions and
  action items. Use whenever the user pastes meeting notes, standup notes, or call
  transcripts, or asks to summarize or clean up notes from a meeting — even if they
  don't say the word "skill".`

Keep it to one line (it can be long). Lead with the action, then the triggers.

## The body

Write instructions to the model that will run the skill. Guidelines that produce good
skills:

- **Imperative voice.** "Extract the action items." not "The skill extracts…".
- **Explain the why.** Today's models are smart and have good judgment. When you
  explain *why* a step matters, the model can adapt instead of following a brittle
  script. Heavy-handed `ALWAYS`/`NEVER` in all caps is a yellow flag — reframe as
  reasoning wherever you can.
- **Be general, not overfit.** A skill is used across many situations. Avoid baking
  in one narrow example as if it were the only case.
- **Define the output format** when the skill has a fixed output. Show the exact
  template the model should follow.
- **Use a couple of examples** when they clarify intent. Input → Output pairs work
  well for transformations.
- **Keep it focused.** Cut anything that isn't pulling its weight. A tight skill
  beats a long one. Aim well under ~500 lines; most skills are far shorter.

### Output format pattern

```markdown
## Report structure
Use this exact template:
# [Title]
## Summary
## Key points
## Next steps
```

### Example pattern

```markdown
## Commit message format
Input: Added user authentication with JWT tokens
Output: feat(auth): implement JWT-based authentication
```

## Safety

Skills must not contain malware, exploit code, or instructions to facilitate
unauthorized access, data exfiltration, or other harm. A skill's behavior should not
surprise a user who reads its description. (Harmless creative skills like "roleplay as
a pirate" are fine.)

## When rewriting an existing draft

If you're revising a skill based on feedback, keep the existing `name` unless the
feedback asks to change it. Apply the requested changes, then re-read the whole skill
and make sure it still reads cleanly as one coherent document. Generalize from the
feedback rather than patching in a narrow fix for one example.

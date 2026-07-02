---
id: skills
title: Custom skills
---

# Custom skills

Vault Assistant supports portable skill files to guide model behavior. These files follow the Claude Skill format. The application extracts the instructions and injects them into the prompts for both Claude Code and all supported CLI engines.

## Managing skills

- **Skill discovery:** The application automatically scans two locations on startup:
  1. Your global user directory: `~/.claude/skills/`
  2. Your active vault directory: `<vault>/.claude/skills/`
- **YAML Frontmatter:** Each skill must contain a `SKILL.md` file in its own subdirectory. The file starts with a YAML header containing `name` and `description` fields.
- **Skill Picker:** Inside any tab, you can click the **Skills** button or press `Ctrl` + `/` to toggle which installed skills to apply.
- **Dedicated humanizer pass:** The `humanizer` skill is a prepackaged skill. When the global humanize option is enabled in settings, the application automatically runs a second turn using the humanizer instructions to rewrite the model output.

---

## The skill creator

You can author new skills directly from the interface:
1. Open **Settings** and navigate to the **Skills** page.
2. Click the **Add skill** button.
3. You can write the markdown content manually, or type a description of the skill you want (like "Format output as a professional email").
4. Click the generate button. This sends a POST request to `/api/skills/generate`.
5. The server streams a generated `SKILL.md` draft based on the bundled skill-creator guide.
6. Once the draft finishes streaming, you can edit it, choose whether to save it to your user directory or vault directory, and save it. The server handles this write via `POST /api/skills/create`.

/*
 * Discovers and creates portable SKILL.md skills in user and vault-local folders.
 * The storage convention remains Claude-compatible, but selected instructions are
 * embedded in every engine's prompt so no particular agent runtime is required.
 */
import { homedir } from "os";
import { join, resolve } from "path";
import { readdirSync, readFileSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import skillCreatorGuide from "./skills/skill-creator/SKILL.md" with { type: "text" };

/* Returns false instead of throwing when an optional filesystem path is absent. */
async function exists(path: string): Promise<boolean> {
  return await Bun.file(path).exists();
}

/* Checks both configured skill scopes for a particular skill directory. */
async function hasSkill(name: string, vaultDir: string): Promise<boolean> {
  const candidates = [
    join(homedir(), ".claude", "skills", name, "SKILL.md"),
    join(vaultDir, ".claude", "skills", name, "SKILL.md"),
  ];
  for (const p of candidates) {
    if (await exists(p)) return true;
  }
  return false;
}

export interface SkillStatus {
  humanizer: boolean;
}

// Only the humanizer skill still gets special treatment (it drives the dedicated
// humanize pass + the "Clean up" button). Every other skill is selected through
// the general skills picker, so it doesn't need a hardcoded flag here.
/* Reports availability of the skill with dedicated application behavior. */
export async function detectSkills(vaultDir: string): Promise<SkillStatus> {
  return {
    humanizer: await hasSkill("humanizer", vaultDir),
  };
}

export type SkillScope = "user" | "vault";

interface DiscoveredSkill {
  name: string;
  description: string;
  scope: SkillScope;
  path: string; // absolute path to the skill's SKILL.md
}

/*
 * The complete instruction payload for a skill selected in the UI. Keeping the
 * document with its metadata means a non-Claude CLI receives the same guidance
 * a native Claude Skill invocation would start with.
 */
export interface LoadedSkill {
  name: string;
  description: string;
  instructions: string;
}

const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

/* Resolves the filesystem root for global or vault-local skills. */
function skillsRoot(scope: SkillScope, vaultDir: string): string {
  return scope === "vault"
    ? join(vaultDir, ".claude", "skills")
    : join(homedir(), ".claude", "skills");
}

// Pull `name` and `description` out of a SKILL.md's YAML frontmatter. Handles the
// single-line form (`description: ...`) and the block form (`description: |`),
// collapsing either into a one-line summary. Falls back to the directory name.
/* Extracts optional YAML metadata while accepting plain Markdown skill files. */
function parseFrontmatter(md: string, fallbackName: string): { name: string; description: string } {
  let name = fallbackName;
  let description = "";

  const fm = md.match(/^---\n([\s\S]*?)\n---/);
  const body = fm ? fm[1] : "";
  const lines = body.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nameMatch = line.match(/^name:\s*(.+)$/);
    if (nameMatch) {
      name = nameMatch[1].trim().replace(/^["']|["']$/g, "") || fallbackName;
      continue;
    }
    const descMatch = line.match(/^description:\s*(.*)$/);
    if (descMatch) {
      const inline = descMatch[1].trim();
      if (inline && inline !== "|" && inline !== ">" && inline !== "|-" && inline !== ">-") {
        description = inline.replace(/^["']|["']$/g, "");
      } else {
        // Block scalar: gather following more-indented lines.
        const collected: string[] = [];
        for (let j = i + 1; j < lines.length; j++) {
          if (/^\s+\S/.test(lines[j])) collected.push(lines[j].trim());
          else if (lines[j].trim() === "") collected.push("");
          else break;
        }
        description = collected.join(" ").trim();
      }
    }
  }

  // Collapse to a single line and keep it reasonably short for prompt/UI use.
  description = description.replace(/\s+/g, " ").trim().slice(0, 240);
  return { name, description };
}

/* Reads each direct skill folder in one scope and returns its parsed metadata. */
function scanScope(scope: SkillScope, vaultDir: string): DiscoveredSkill[] {
  const root = skillsRoot(scope, vaultDir);
  const found: DiscoveredSkill[] = [];
  let names: string[];
  try {
    names = readdirSync(root, { withFileTypes: true })
      .filter((ent) => ent.isDirectory())
      .map((ent) => ent.name);
  } catch {
    return found; // directory doesn't exist
  }
  for (const dirName of names) {
    const skillPath = join(root, dirName, "SKILL.md");
    let md: string;
    try {
      md = readFileSync(skillPath, "utf8");
    } catch {
      continue; // no SKILL.md in this dir
    }
    const { name, description } = parseFrontmatter(md, dirName);
    found.push({ name, description, scope, path: skillPath });
  }
  return found;
}

// List every installed skill across user + vault scope. User scope is scanned
// first, so a global skill wins when both scopes contain the same display name.
/* Lists both scopes while exposing at most one selectable skill per name. */
export async function listSkills(vaultDir: string): Promise<DiscoveredSkill[]> {
  const all = [...scanScope("user", vaultDir), ...scanScope("vault", vaultDir)];
  const byName = new Map<string, DiscoveredSkill>();
  for (const s of all) {
    if (!byName.has(s.name)) byName.set(s.name, s);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/*
 * Loads the complete SKILL.md text for user-selected names. Callers receive
 * missing and unreadable names separately so they can explain exactly why a
 * requested skill was not included instead of silently dropping it.
 */
export async function loadSelectedSkills(
  vaultDir: string,
  names: string[] | undefined
): Promise<{ skills: LoadedSkill[]; missing: string[]; unreadable: string[] }> {
  const selected = [...new Set(names ?? [])];
  if (!selected.length) return { skills: [], missing: [], unreadable: [] };

  const byName = new Map((await listSkills(vaultDir)).map((skill) => [skill.name, skill]));
  const skills: LoadedSkill[] = [];
  const missing: string[] = [];
  const unreadable: string[] = [];

  for (const name of selected) {
    const info = byName.get(name);
    if (!info) {
      missing.push(name);
      continue;
    }

    try {
      const instructions = await Bun.file(info.path).text();
      if (!instructions.trim()) {
        unreadable.push(name);
        continue;
      }
      skills.push({ name: info.name, description: info.description, instructions });
    } catch {
      unreadable.push(name);
    }
  }

  return { skills, missing, unreadable };
}

/*
 * Loads the bundled skill-creator guide as a portable instruction bundle. The full
 * document is carried inline so it can be injected into any engine's prompt the same
 * way user-selected skills are.
 */
export async function loadSkillCreatorGuide(): Promise<LoadedSkill> {
  return {
    name: "skill-creator",
    description: "Author a single portable SKILL.md from a plain-language description.",
    instructions: skillCreatorGuide,
  };
}

export interface GeneratedSkill {
  name: string;
  description: string;
  body: string;
}

// Pull a complete generated SKILL.md apart into the three fields the UI edits.
// Unlike parseFrontmatter (which is tuned for the picker and truncates), this keeps
// the full description and body so what the user sees is exactly what gets saved.
/* Splits a generated SKILL.md document into editable name, description, and body. */
export function parseGeneratedSkill(raw: string): GeneratedSkill {
  let text = (raw || "").trim();

  // Models sometimes wrap the whole document in a ```markdown fence — unwrap it.
  const fenced = text.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
  if (fenced) text = fenced[1].trim();

  const fm = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fm) {
    return { name: "", description: "", body: text };
  }

  const header = fm[1];
  const body = text.slice(fm[0].length).trim();
  const lines = header.split("\n");

  let name = "";
  let description = "";

  for (let i = 0; i < lines.length; i++) {
    const nameMatch = lines[i].match(/^name:\s*(.+)$/);
    if (nameMatch) {
      name = nameMatch[1].trim().replace(/^["']|["']$/g, "");
      continue;
    }
    const descMatch = lines[i].match(/^description:\s*(.*)$/);
    if (descMatch) {
      const inline = descMatch[1].trim();
      if (inline && inline !== "|" && inline !== ">" && inline !== "|-" && inline !== ">-") {
        description = inline.replace(/^["']|["']$/g, "");
      } else {
        // Block scalar: gather the following more-indented lines.
        const collected: string[] = [];
        for (let j = i + 1; j < lines.length; j++) {
          if (/^\s+\S/.test(lines[j])) collected.push(lines[j].trim());
          else if (lines[j].trim() === "") collected.push("");
          else break;
        }
        description = collected.join(" ").trim();
      }
    }
  }

  return { name, description: description.replace(/\s+/g, " ").trim(), body };
}

export interface CreateSkillArgs {
  name: string;
  description: string;
  body: string;
  scope: SkillScope;
  vaultDir: string;
}

export interface CreateSkillResult {
  ok: boolean;
  name?: string;
  scope?: SkillScope;
  path?: string;
  error?: string;
}

// Scaffold a new skill at <scope-root>/<name>/SKILL.md with YAML frontmatter and
// the supplied instructions. Validates the name (kebab-case, no traversal),
// enforces the target stays under the scope root, and refuses to overwrite.
/* Validates user input and creates a SKILL.md file in the selected scope. */
export async function createSkill(args: CreateSkillArgs): Promise<CreateSkillResult> {
  const name = (args.name || "").trim().toLowerCase();
  if (!SKILL_NAME_RE.test(name)) {
    return { ok: false, error: "Name must be kebab-case: lowercase letters, numbers, and hyphens (e.g. tone-check)." };
  }
  const description = (args.description || "").replace(/\s+/g, " ").trim();
  if (!description) {
    return { ok: false, error: "A short description is required (it tells the agent when to use the skill)." };
  }
  const scope: SkillScope = args.scope === "vault" ? "vault" : "user";
  const root = skillsRoot(scope, args.vaultDir);
  const dir = join(root, name);
  const file = join(dir, "SKILL.md");

  // Safety: the resolved path must stay within the scope's skills root.
  if (!resolve(file).startsWith(resolve(root))) {
    return { ok: false, error: "Resolved path escapes the skills directory." };
  }
  if (await exists(file)) {
    return { ok: false, error: `A skill named "${name}" already exists in ${scope} scope.` };
  }

  const frontmatter = `---\nname: ${name}\ndescription: ${description}\n---\n\n`;
  const content = frontmatter + (args.body || "").trim() + "\n";
  await mkdir(dir, { recursive: true });
  await writeFile(file, content, "utf8");
  return { ok: true, name, scope, path: file };
}

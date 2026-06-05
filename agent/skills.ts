// Discover and create Claude Code "skills" (SKILL.md folders) in either the user
// scope (~/.claude/skills) or the vault/project scope (<vault>/.claude/skills).
// Skills are surfaced in the UI so the user can pick which to apply per vault
// interaction, and can author new ones from Settings.
import { homedir } from "os";
import { join, resolve } from "path";
import { readdirSync, readFileSync } from "fs";
import { mkdir, writeFile } from "fs/promises";

async function exists(path: string): Promise<boolean> {
  return await Bun.file(path).exists();
}

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
export async function detectSkills(vaultDir: string): Promise<SkillStatus> {
  return {
    humanizer: await hasSkill("humanizer", vaultDir),
  };
}

export type SkillScope = "user" | "vault";

export interface SkillInfo {
  name: string;
  description: string;
  scope: SkillScope;
  path: string; // absolute path to the skill's SKILL.md
}

const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

function skillsRoot(scope: SkillScope, vaultDir: string): string {
  return scope === "vault"
    ? join(vaultDir, ".claude", "skills")
    : join(homedir(), ".claude", "skills");
}

// Pull `name` and `description` out of a SKILL.md's YAML frontmatter. Handles the
// single-line form (`description: ...`) and the block form (`description: |`),
// collapsing either into a one-line summary. Falls back to the directory name.
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

function scanScope(scope: SkillScope, vaultDir: string): SkillInfo[] {
  const root = skillsRoot(scope, vaultDir);
  const found: SkillInfo[] = [];
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
// first; a vault skill sharing a name is dropped so each name appears once.
export async function listSkills(vaultDir: string): Promise<SkillInfo[]> {
  const all = [...scanScope("user", vaultDir), ...scanScope("vault", vaultDir)];
  const byName = new Map<string, SkillInfo>();
  for (const s of all) {
    if (!byName.has(s.name)) byName.set(s.name, s);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
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

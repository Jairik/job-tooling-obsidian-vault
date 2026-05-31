// Detects whether the yc-combinator and humanizer skills are installed, in either
// the user scope (~/.claude/skills) or the vault/project scope (<vault>/.claude/skills).
import { homedir } from "os";
import { join } from "path";

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
  yc: boolean;
  humanizer: boolean;
}

export async function detectSkills(vaultDir: string): Promise<SkillStatus> {
  return {
    yc: await hasSkill("yc-combinator", vaultDir),
    humanizer: await hasSkill("humanizer", vaultDir),
  };
}

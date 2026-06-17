import { describe, test, expect } from "bun:test";
import {
  CLI_ARG_PROMPT_SOFT_LIMIT_BYTES,
  buildCliCommand,
  cliAvailable,
  geminiAvailable,
  gatherVaultContext,
  runCliTurn,
} from "./gemini";
import {
  buildCliAskPrompt,
  buildCliDraftPrompt,
  buildCliHumanizePrompt,
  buildCliCleanupPrompt,
  buildCliFollowupPrompt,
  buildInlineSkillsNote,
  buildSummarizePrompt,
  buildAutoPlacePrompt,
  buildFillinScanPrompt,
  buildFillinAnswerPrompt,
  buildWriteCleanupPrompt,
  defaultSettings,
  effectiveEngineModel,
  effectiveEngineReasoning,
  normalizeSettings,
} from "./config";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

describe("Vault Assistant CLI Engines Audit Suite", () => {
  
  test("autodetects installed CLIs on PATH", () => {
    // Claude is always assumed true since it's managed via SDK
    expect(cliAvailable("claude")).toBe(true);

    const engines = ["gemini", "opencode", "cursor", "copilot", "codex"] as const;
    for (const en of engines) {
      const detected = cliAvailable(en);
      console.log(`Autodetected engine ${en}: ${detected}`);
      expect(typeof detected).toBe("boolean");
    }
    expect(typeof geminiAvailable()).toBe("boolean");
  });

  test("gatherVaultContext reads markdown/text files in context directories", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "jas-test-"));
    const filePath = join(tempDir, "sample.md");
    await writeFile(filePath, "Hello vault content!", "utf8");

    const context = await gatherVaultContext(tempDir);
    expect(context).toContain("===== FILE: sample.md =====");
    expect(context).toContain("Hello vault content!");

    await rm(tempDir, { recursive: true, force: true });
  });

  test("prompt builders construct correct prompt structures", () => {
    const ask = buildCliAskPrompt("my-persona", "file-context", "my question");
    expect(ask).toContain("my-persona");
    expect(ask).toContain("file-context");
    expect(ask).toContain("my question");
    expect(ask).toContain("Do not use any tools");

    const draft = buildCliDraftPrompt("my-persona", "file-context", "jd description", "my question");
    expect(draft).toContain("my-persona");
    expect(draft).toContain("file-context");
    expect(draft).toContain("jd description");
    expect(draft).toContain("my question");
    expect(draft).toContain("Do not use any tools");

    const hum = buildCliHumanizePrompt("draft response");
    expect(hum).toContain("draft response");
    expect(hum).toContain("Rewrite the answer below to remove all signs of AI writing");

    const clean = buildCliCleanupPrompt("messy text");
    expect(clean).toContain("messy text");
    expect(clean).toContain("Fix any spelling, grammar, punctuation");

    const follow = buildCliFollowupPrompt("my-persona", "file-context", "prior answer", "my tweak");
    expect(follow).toContain("my-persona");
    expect(follow).toContain("file-context");
    expect(follow).toContain("prior answer");
    expect(follow).toContain("my tweak");
    expect(follow).toContain("Do not use any tools");

    const summarize = buildSummarizePrompt("text to sum", "vault-ctx");
    expect(summarize).toContain("text to sum");
    expect(summarize).toContain("vault-ctx");
    expect(summarize).toContain("Do not use any tools");

    const place = buildAutoPlacePrompt("my new code", "vault/dir/structure");
    expect(place).toContain("my new code");
    expect(place).toContain("vault/dir/structure");
    expect(place).toContain("Do not use any tools");

    const scan = buildFillinScanPrompt("vault-ctx", "focus area");
    expect(scan).toContain("focus area");
    expect(scan).toContain("vault-ctx");
    expect(scan).toContain("Do not use any tools");

    const ans = buildFillinAnswerPrompt("vault-ctx", "the q", "the ans", "path.md");
    expect(ans).toContain("vault-ctx");
    expect(ans).toContain("the q");
    expect(ans).toContain("the ans");
    expect(ans).toContain("path.md");
    expect(ans).toContain("Do not use any tools");

    const cln = buildWriteCleanupPrompt("dirty md");
    expect(cln).toContain("dirty md");
    expect(cln).toContain("Do not use any tools");
  });

  test("Codex receives selected skill instructions inline while Claude keeps Skill tool notes", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "jas-skill-test-"));
    const skillName = "codex-inline-test-skill";
    const skillDir = join(tempDir, ".claude", "skills", skillName);
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\nname: ${skillName}\ndescription: Tightens answers for Codex tests.\n---\n\nAlways apply MARKER-CODEX-SKILL when this skill is selected.\n`,
      "utf8"
    );

    try {
      const { resolveSkillNotes } = await import("./runner");
      const emit = (events: string[]) => (event: string, data: any) => {
        if (event === "notice") events.push(String(data?.message ?? ""));
      };

      const codexNotices: string[] = [];
      const codexSettings = normalizeSettings({ ...defaultSettings(tempDir), engine: "codex" });
      const codexNotes = await resolveSkillNotes(codexSettings, [skillName], emit(codexNotices));
      expect(codexNotices).toEqual([]);
      expect(codexNotes).toHaveLength(1);
      expect(codexNotes[0].name).toBe(skillName);
      expect(codexNotes[0].content).toContain("MARKER-CODEX-SKILL");

      const codexPrompt = buildCliDraftPrompt("persona", "vault context", "jd", "question", codexNotes);
      expect(codexPrompt).toContain("SKILLS");
      expect(codexPrompt).toContain("Tightens answers for Codex tests.");
      expect(codexPrompt).toContain("MARKER-CODEX-SKILL");

      const inlineNote = buildInlineSkillsNote(codexNotes);
      expect(inlineNote).toContain("Do not try to invoke external skill tools");

      const claudeNotices: string[] = [];
      const claudeSettings = normalizeSettings({ ...defaultSettings(tempDir), engine: "claude" });
      const claudeNotes = await resolveSkillNotes(claudeSettings, [skillName], emit(claudeNotices));
      expect(claudeNotices).toEqual([]);
      expect(claudeNotes).toEqual([{ name: skillName, description: "Tightens answers for Codex tests." }]);

      const geminiNotices: string[] = [];
      const geminiSettings = normalizeSettings({ ...defaultSettings(tempDir), engine: "gemini" });
      const geminiNotes = await resolveSkillNotes(geminiSettings, [skillName], emit(geminiNotices));
      expect(geminiNotes).toEqual([]);
      expect(geminiNotices[0]).toContain("supported on Claude and Codex");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("settings backfill per-engine model and reasoning defaults", () => {
    const settings = normalizeSettings({
      ...defaultSettings(),
      engine: "codex",
      model: "legacy-claude-model",
      effort: "high",
      engineModels: { codex: "gpt-5.2-codex" },
      engineReasoning: { codex: "max" },
    });

    expect(settings.engineModels.claude).toBe("legacy-claude-model");
    expect(settings.engineReasoning.claude).toBe("high");
    expect(effectiveEngineModel(settings, "codex")).toBe("gpt-5.2-codex");
    expect(effectiveEngineReasoning(settings, "codex")).toBe("max");
  });

  test("CLI command builder passes custom model and reasoning settings", () => {
    const settings = normalizeSettings({
      ...defaultSettings(),
      engineModels: {
        gemini: "gemini-2.5-pro",
        opencode: "openai/gpt-5.2",
        cursor: "cursor-custom",
        copilot: "gpt-5.2",
        codex: "gpt-5.2-codex",
      },
      engineReasoning: {
        gemini: "medium",
        opencode: "max",
        cursor: "low",
        copilot: "xhigh",
        codex: "high",
      },
    });

    const gemini = buildCliCommand("gemini", { prompt: "PROMPT", settings });
    expect(gemini.writeToStdin).toBe(true);
    expect(gemini.cmd).toContain("--model");
    expect(gemini.cmd).toContain("gemini-2.5-pro");
    expect(gemini.prompt).toContain("Reasoning effort: medium");

    const opencode = buildCliCommand("opencode", { prompt: "PROMPT", settings });
    expect(opencode.writeToStdin).toBe(true);
    expect(opencode.cmd).toContain("--model");
    expect(opencode.cmd).toContain("openai/gpt-5.2");
    expect(opencode.cmd).toContain("--variant");
    expect(opencode.cmd).toContain("max");
    expect(opencode.cmd.join("\n")).not.toContain("PROMPT");

    const copilot = buildCliCommand("copilot", { prompt: "PROMPT", settings });
    expect(copilot.writeToStdin).toBe(true);
    expect(copilot.cmd).toContain("--model");
    expect(copilot.cmd).toContain("gpt-5.2");
    expect(copilot.cmd).toContain("--reasoning-effort");
    expect(copilot.cmd).toContain("xhigh");
    expect(copilot.cmd.join("\n")).not.toContain("PROMPT");

    const codex = buildCliCommand("codex", { prompt: "PROMPT", settings });
    expect(codex.writeToStdin).toBe(true);
    expect(codex.cmd).toContain("exec");
    expect(codex.cmd).toContain("--model");
    expect(codex.cmd).toContain("gpt-5.2-codex");
    expect(codex.cmd).toContain('model_reasoning_effort="high"');

    const cursor = buildCliCommand("cursor", { prompt: "PROMPT", settings });
    expect(cursor.writeToStdin).toBe(true);
    expect(cursor.cmd).toContain("--model");
    expect(cursor.cmd).toContain("cursor-custom");
    expect(cursor.cmd.join("\n")).not.toContain("PROMPT");
    expect(cursor.prompt).toContain("Reasoning effort: low");
  });

  test("CLI command builder transports current long prompts safely", () => {
    const settings = normalizeSettings(defaultSettings());
    const longPrompt = `Return exactly VA_LONG_PROMPT_OK.\n\n${"vault context line\n".repeat(10_000)}`;
    expect(new TextEncoder().encode(longPrompt).length).toBeGreaterThan(150_000);

    for (const engine of ["gemini", "opencode", "cursor", "copilot", "codex"] as const) {
      const built = buildCliCommand(engine, { prompt: longPrompt, settings });
      expect(built.writeToStdin).toBe(true);
      expect(built.cmd.join("\n")).not.toContain(longPrompt);
      expect(built.prompt).toContain("VA_LONG_PROMPT_OK");
    }
  });

  test("CLI command builder keeps oversized prompts off argv for all supported CLI engines", () => {
    const settings = normalizeSettings(defaultSettings());
    const tooLarge = "x".repeat(CLI_ARG_PROMPT_SOFT_LIMIT_BYTES + 1);
    for (const engine of ["gemini", "opencode", "cursor", "copilot", "codex"] as const) {
      const built = buildCliCommand(engine, { prompt: tooLarge, settings });
      expect(built.writeToStdin).toBe(true);
      expect(built.cmd.join("\n")).not.toContain(tooLarge);
      expect(built.prompt.length).toBe(tooLarge.length);
    }
  });

  test("runCliTurn executes and streams outputs for all autodetected CLI tools", async () => {
    if (process.env.RUN_REAL_CLI_TESTS !== "1") {
      console.log("Skipping real CLI execution audit. Set RUN_REAL_CLI_TESTS=1 to run it.");
      return;
    }

    const enginesToTest = ["gemini", "opencode", "cursor", "copilot", "codex"] as const;

    for (const engine of enginesToTest) {
      if (cliAvailable(engine)) {
        console.log(`Auditing execution turn of ${engine}...`);
        const events: { event: string; data: any }[] = [];
        const emit = (event: string, data: any) => {
          events.push({ event, data });
        };
        const abort = new AbortController();

        // Standardized prompt to verify tool prints response output
        const result = await runCliTurn(engine, {
          prompt: "Write exactly the word 'SUCCESS' and absolutely nothing else.",
          phase: "test",
          emit,
          abort,
        });

        console.log(`${engine} execution result: "${result}"`);
        expect(result.toUpperCase()).toContain("SUCCESS");

        // Verify that events were successfully emitted during run
        const textEvents = events.filter((e) => e.event === "text");
        const activityEvents = events.filter((e) => e.event === "activity");

        expect(activityEvents.length).toBeGreaterThan(0);
        expect(textEvents.length).toBeGreaterThan(0);
        expect(activityEvents[0].data.tool).toBe(engine);
      } else {
        console.log(`${engine} CLI is not installed, skipping execution turn audit.`);
      }
    }
  }, 60000);

  test("agent workflow documentation exists and enforces TDD", async () => {
    const rootPath = join(__dirname, "..");
    
    // Check AGENTS.md
    const agentsMdPath = join(rootPath, "AGENTS.md");
    const agentsMd = await Bun.file(agentsMdPath).text();
    expect(agentsMd.length).toBeGreaterThan(0);
    expect(agentsMd).toContain("docs/WORKFLOW.md");
    expect(agentsMd.toLowerCase()).toContain("test");

    // Check docs/WORKFLOW.md
    const workflowMdPath = join(rootPath, "docs", "WORKFLOW.md");
    const workflowMd = await Bun.file(workflowMdPath).text();
    expect(workflowMd.length).toBeGreaterThan(0);
    expect(workflowMd).toContain("must be accompanied by a test");
  });

  test("default development port is 5177 everywhere", async () => {
    const rootPath = join(__dirname, "..");
    const serverTs = await Bun.file(join(rootPath, "server.ts")).text();
    const runSh = await Bun.file(join(rootPath, "run.sh")).text();
    const readme = await Bun.file(join(rootPath, "README.md")).text();

    expect(serverTs).toContain("process.env.PORT || 5177");
    expect(runSh).toContain('PORT="${PORT:-5177}"');
    expect(readme).toContain("http://localhost:5177");
  });

  test("new-question clones preserve job context and follow the current system prompt", async () => {
    const { newTab, cloneTabForNewQuestion, overrideSettingsBody } = await import("../src/lib/store");
    const { defaultSettings } = await import("./config");

    // The persona the user has *currently specified* in Settings.
    const current: any = { ...defaultSettings(), persona: "CURRENT SYSTEM PROMPT" };

    // A job tab whose Override was toggled on back when an older persona was in
    // effect, freezing that stale persona into the override snapshot.
    const source: any = {
      ...newTab([], false, "job"),
      jobDescription: "A specific job description",
      skills: ["yc-combinator"],
      overrideEnabled: true,
      override: { ...defaultSettings(), persona: "STALE SYSTEM PROMPT" },
    };

    // "+ New question" clones the tab's context into a fresh conversation.
    const clone = cloneTabForNewQuestion(source, []);
    expect(clone.mode).toBe("job");
    expect(clone.jobDescription).toBe("A specific job description");
    expect(clone.skills).toContain("yc-combinator");
    expect(clone.id).not.toBe(source.id);

    // The settings sent for that clone must carry the CURRENT persona, not the
    // stale snapshot — otherwise the new question ignores the specified system prompt.
    const body = overrideSettingsBody(clone, current);
    expect(body?.persona).toBe("CURRENT SYSTEM PROMPT");
    expect(body?.persona).not.toBe("STALE SYSTEM PROMPT");

    // With no override, the tab falls back to the global (current) settings entirely.
    expect(overrideSettingsBody({ ...clone, overrideEnabled: false }, current)).toBeUndefined();
  });

  test("toolbarDropdown design setting defaults to false and is part of DesignSettings", async () => {
    const { DEFAULT_DESIGN, loadDesignSettings } = await import("../src/lib/store");

    // DEFAULT_DESIGN must include toolbarDropdown set to false
    expect(DEFAULT_DESIGN).toHaveProperty("toolbarDropdown");
    expect(DEFAULT_DESIGN.toolbarDropdown).toBe(false);

    // loadDesignSettings should backfill toolbarDropdown when loading older persisted data
    const loaded = loadDesignSettings();
    expect(typeof loaded.toolbarDropdown).toBe("boolean");
  });

});

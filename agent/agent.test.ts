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
  buildAppend,
  buildSkillsNote,
  injectSkillsIntoPrompt,
  buildSummarizePrompt,
  buildAutoPlacePrompt,
  buildFillinScanPrompt,
  buildFillinAnswerPrompt,
  buildWriteCleanupPrompt,
  defaultSettings,
  normalizeServerSettings,
} from "./config";
import { loadSelectedSkills } from "./skills";
import { buildWebResearchSkill, parseWebToolRequest, resolveWebPage, webResearchEnabled } from "./web";
import { fetchUsageForTarget, parseCodexProfileStats, parseCodexUsagePayload, parseOpenCodeStats } from "./usage";
import { effectiveEngineModel, effectiveEngineReasoning } from "../shared/settings";
import { defaultEngineModels, defaultEngineReasoning } from "../shared/settings";
import { isClaudeUsageModel, usageSupportForTarget } from "../shared/usage";
import { normalizeSettings as normalizeClientSettings } from "../src/lib/store";
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

  test("embeds each selected SKILL.md for Claude and every CLI engine", async () => {
    const vaultDir = await mkdtemp(join(tmpdir(), "jas-skills-test-"));
    const skillDir = join(vaultDir, ".claude", "skills", "portable-review");
    const skillPath = join(skillDir, "SKILL.md");
    const instructions = "# Portable review\nAlways check the supplied answer for unsupported claims.";

    // The temporary vault exercises the same vault-local discovery path the UI
    // uses, without relying on a developer's real ~/.claude skill collection.
    await mkdir(skillDir, { recursive: true });
    await writeFile(skillPath, instructions, "utf8");
    const resolved = await loadSelectedSkills(vaultDir, ["portable-review", "missing-skill", "portable-review"]);

    expect(resolved.missing).toEqual(["missing-skill"]);
    expect(resolved.unreadable).toEqual([]);
    expect(resolved.skills).toHaveLength(1); // Duplicate UI selections cannot duplicate prompt instructions.
    expect(resolved.skills[0]).toMatchObject({ name: "portable-review", instructions });

    // Claude receives the bundle in its system-prompt append.
    const claudeAppend = buildAppend({
      persona: "TEST PERSONA",
      mode: "ask",
      skills: resolved.skills,
      phase: "draft",
    });
    expect(claudeAppend).toContain(instructions);

    // Every CLI command uses the same stdin prompt, so every external agent gets
    // the complete skill text without needing a native Skill tool installation.
    const cliPrompt = injectSkillsIntoPrompt("Return a review.", resolved.skills);
    expect(buildSkillsNote(resolved.skills)).toContain("BEGIN USER-SELECTED SKILL: portable-review");
    expect(cliPrompt).toContain(instructions);
    for (const engine of ["gemini", "opencode", "cursor", "copilot", "codex"] as const) {
      const built = buildCliCommand(engine, { prompt: "Return a review.", skills: resolved.skills });
      expect(built.writeToStdin).toBe(true);
      expect(built.prompt).toContain(instructions);
    }

    await rm(vaultDir, { recursive: true, force: true });
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

  test("settings backfill per-engine model and reasoning defaults", () => {
    const settings = normalizeServerSettings({
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
    // Old browser settings used "basic" before the local resolver existed.
    // Normalization upgrades them to the safe Readability-first auto mode.
    expect(normalizeServerSettings({ urlFetchMethod: "basic" as any }).urlFetchMethod).toBe("auto");
  });

  test("uses a portable, bounded web research protocol for every agent", async () => {
    const settings = defaultSettings();

    // Research remains disabled until the owner explicitly opts into their local
    // SearXNG instance; no hosted search provider is silently contacted.
    expect(webResearchEnabled(settings)).toBe(false);
    settings.webResearchEnabled = true;
    settings.searxngUrl = "http://127.0.0.1:8080";
    expect(webResearchEnabled(settings)).toBe(true);

    const skill = buildWebResearchSkill();
    expect(skill).toContain("<vault-web-tool>");
    expect(skill).toContain('"web_search"');
    expect(skill).toContain('"web_read"');

    // Only a standalone, schema-valid request can trigger a network operation.
    expect(parseWebToolRequest('<vault-web-tool>{"tool":"web_search","query":"SearXNG JSON API"}</vault-web-tool>')).toEqual({
      tool: "web_search",
      query: "SearXNG JSON API",
    });
    expect(parseWebToolRequest('Here is a request: <vault-web-tool>{"tool":"web_search","query":"x"}</vault-web-tool>')).toBeUndefined();
    expect(parseWebToolRequest('<vault-web-tool>{"tool":"shell","command":"curl example.com"}</vault-web-tool>')).toBeUndefined();

    // The resolver rejects loopback before making a request, guarding the server
    // from an agent or URL-import workflow being used as an SSRF proxy.
    await expect(resolveWebPage("http://127.0.0.1/private", "readability")).rejects.toThrow("Private, local, or reserved");
  });

  test("server and client settings share engine defaults", () => {
    const server = defaultSettings();
    const client = normalizeClientSettings({});

    expect(server.engineModels).toEqual(defaultEngineModels());
    expect(client.engineModels).toEqual(defaultEngineModels());
    expect(server.engineReasoning).toEqual(defaultEngineReasoning());
    expect(client.engineReasoning).toEqual(defaultEngineReasoning());
  });

  test("usage checker targets any compatible selected model", async () => {
    expect(isClaudeUsageModel("claude-sonnet-4-6")).toBe(true);
    expect(isClaudeUsageModel("auto")).toBe(true);
    expect(isClaudeUsageModel("gpt-5.2-codex")).toBe(false);

    expect(usageSupportForTarget({ engine: "claude", model: "claude-custom-model" })).toMatchObject({
      supported: true,
      provider: "claude-code",
    });

    expect(usageSupportForTarget({ engine: "codex", model: "gpt-5.2-codex" })).toMatchObject({
      supported: true,
      provider: "codex",
    });

    expect(usageSupportForTarget({ engine: "opencode", model: "openai/gpt-5.2" })).toMatchObject({
      supported: true,
      provider: "opencode",
    });

    const unsupported = await fetchUsageForTarget({ engine: "gemini", model: "gemini-2.5-pro" });
    expect(unsupported).toMatchObject({
      ok: false,
      unsupported: true,
      target: { engine: "gemini", model: "gemini-2.5-pro" },
    });
  });

  test("normalizes Codex usage payloads into generic usage windows and stats", () => {
    const parsed = parseCodexUsagePayload({
      plan_type: "pro",
      rate_limit: {
        primary_window: { used_percent: 42, limit_window_seconds: 300, reset_at: 1893456000 },
        secondary_window: { used_percent: 84, limit_window_seconds: 3600, reset_at: 1893459600 },
      },
      additional_rate_limits: [
        {
          limit_name: "codex_other",
          metered_feature: "codex_other",
          rate_limit: {
            primary_window: { used_percent: 70, limit_window_seconds: 900, reset_at: 1893463200 },
          },
        },
      ],
      credits: { has_credits: true, unlimited: false, balance: "9.99" },
      rate_limit_reset_credits: { available_count: 3 },
      spend_control: {
        individual_limit: { limit: "25000", used: "8000", remaining_percent: 68 },
      },
    });

    expect(parsed.windows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "Codex primary",
        utilization: 42,
        resetsAt: "2030-01-01T00:00:00.000Z",
        detail: "5m window",
      }),
      expect.objectContaining({
        label: "Codex Other primary",
        utilization: 70,
        detail: "15m window",
      }),
    ]));
    expect(parsed.stats).toEqual(expect.arrayContaining([
      { label: "Plan", value: "Pro" },
      { label: "Credits", value: "$9.99" },
      { label: "Reset credits", value: "3" },
      { label: "Usage limit", value: "8000 / 25000 · 68% remaining" },
    ]));

    expect(parseCodexProfileStats({
      stats: {
        lifetime_tokens: 1234567,
        current_streak_days: 5,
        daily_usage_buckets: [{ start_date: "2030-01-01", tokens: 1200 }],
      },
    })).toEqual(expect.arrayContaining([
      { label: "Lifetime tokens", value: "1,234,567" },
      { label: "Current streak", value: "5d" },
      { label: "Tokens on 2030-01-01", value: "1,200" },
    ]));
  });

  test("parses OpenCode stats output into display rows", () => {
    const stats = parseOpenCodeStats(`
Total cost: $1.23
Total tokens: 12,345
Input tokens: 10,000
Output tokens: 2,345
│ openai/gpt-5 │ $1.00 │ 10,000 tokens │
`);

    expect(stats).toEqual(expect.arrayContaining([
      { label: "Total Cost", value: "$1.23" },
      { label: "Total Tokens", value: "12,345" },
      { label: "Input Tokens", value: "10,000" },
      { label: "Output Tokens", value: "2,345" },
      { label: "Openai/Gpt 5", value: "$1.00 · 10,000 tokens" },
    ]));
  });

  test("CLI command builder passes custom model and reasoning settings", () => {
    const settings = normalizeServerSettings({
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
    const settings = normalizeServerSettings(defaultSettings());
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
    const settings = normalizeServerSettings(defaultSettings());
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

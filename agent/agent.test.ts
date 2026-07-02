import { describe, test, expect } from "bun:test";
import {
  CLI_ARG_PROMPT_SOFT_LIMIT_BYTES,
  buildCliCommand,
  cliAvailable,
  geminiAvailable,
  gatherVaultContext,
  runCliTurn,
} from "./cli-engines";
import { ENGINE_CLI_NAMES, engineAvailabilityStatus, scanEngines } from "./engine-scan";
import {
  buildCliAskPrompt,
  buildDraftPrompt,
  buildCliDraftPrompt,
  buildCliHumanizePrompt,
  buildCliCleanupPrompt,
  buildCliFollowupPrompt,
  buildAppend,
  buildHumanizeTurnPrompt,
  buildSkillsNote,
  injectSkillsIntoPrompt,
  buildSummarizePrompt,
  buildAutoPlacePrompt,
  buildFillinScanPrompt,
  buildFillinAnswerPrompt,
  buildWriteCleanupPrompt,
  buildWriterAppend,
  defaultSettings,
  normalizeServerSettings,
} from "./config";
import { MAX_SKILL_INSTRUCTIONS_CHARS, loadSelectedSkills, loadSkillCreatorGuide, listSkills } from "./skills";
import { buildWebResearchSkill, parseWebToolRequest, resolveWebPage, webResearchEnabled } from "./web";
import { fetchUsageForTarget, parseCodexProfileStats, parseCodexUsagePayload, parseOpenCodeStats } from "./usage";
import {
  cleanupEngineSettings,
  defaultCleanupModels,
  defaultCleanupReasoning,
  defaultEngineModels,
  defaultEngineReasoning,
  effectiveCleanupModel,
  effectiveCleanupReasoning,
  effectiveEngineModel,
  effectiveEngineReasoning,
} from "../shared/settings";
import { buildAskPersona, buildDefaultSystemPrompt, buildJobPersona } from "../shared/persona";
import { isClaudeUsageModel, usageSupportForTarget } from "../shared/usage";
import { DEFAULT_PORT, loadDotEnv, parseDotEnv, resolveAppPort } from "../shared/ports";
import { normalizeSettings as normalizeClientSettings } from "../src/lib/store";
import { OTHER_OPTION, modelOptionsForEngine, optionValue, reasoningOptionsForEngine } from "../src/lib/engine-options";
import { formatTuiHelp, parseLauncherArgs, parseTuiArgs } from "../tui/lib/cli";
import { toBackendMode, getTabBarInfo } from "../tui/lib/modes";
import { newSession, type Session } from "../tui/lib/session";
import { createActions } from "../tui/lib/actions";
import {
  buildAutoPlacePayload,
  buildCleanupPayload,
  buildDocProposePayload,
  buildFillinScanPayload,
  buildFillinWritePayload,
  buildGeneratePayload,
  buildMessagePayload,
  buildSummarizePayload,
  buildVaultPreviewPayload,
  buildVaultWritePayload,
  buildWriteCleanupPayload,
} from "../tui/lib/payloads";
import { approvalWritePayload, createPendingApproval, parseDocProposals } from "../tui/lib/approval";
import {
  buildCleanupModelPatch,
  buildCleanupReasoningPatch,
  buildEngineModelPatch,
  buildEngineReasoningPatch,
  mergeTuiSettings,
} from "../tui/lib/settings";
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

  test("scans supported agent paths and exposes model/reasoning choices", () => {
    const scan = scanEngines(12345);
    const minimum = ["claude", "gemini", "opencode", "cursor", "codex"] as const;

    expect(scan.scannedAt).toBe(12345);
    expect(ENGINE_CLI_NAMES.gemini).toBe("agy");

    for (const engine of minimum) {
      const entry = scan.engines[engine];
      expect(entry.id).toBe(engine);
      expect(typeof entry.available).toBe("boolean");
      expect(entry.modelCustom).toBe(true);
      expect(entry.reasoningCustom).toBe(true);
      expect(entry.models.length).toBeGreaterThan(0);
      expect(entry.reasoning.length).toBeGreaterThan(0);
    }

    expect(scan.engines.claude.available).toBe(true);
    expect(scan.engines.codex.models.map((m) => m.id)).toContain("gpt-5-codex");
    expect(scan.engines.codex.reasoning.map((r) => r.id)).toContain("minimal");
    expect(scan.engines.opencode.models.map((m) => m.id)).toContain("openai/gpt-5");
    expect(scan.engines.cursor.models.map((m) => m.id)).toContain("auto");
    expect(engineAvailabilityStatus(scan).codex).toBe(scan.engines.codex.available);
  });

  test("engine option helpers keep scanned dropdowns and Other custom values", async () => {
    const scan = scanEngines(12345);
    const codexModels = modelOptionsForEngine(scan, "codex", []);
    const codexReasoning = reasoningOptionsForEngine(scan, "codex");

    expect(codexModels.map((m) => m.id)).toContain("gpt-5-codex");
    expect(codexReasoning.map((r) => r.id)).toContain("minimal");
    expect(optionValue("gpt-5-codex", codexModels, false)).toBe("gpt-5-codex");
    expect(optionValue("provider/custom-model", codexModels, false)).toBe(OTHER_OPTION);
    expect(optionValue("gpt-5-codex", codexModels, true)).toBe(OTHER_OPTION);

    const fallback = modelOptionsForEngine(null, "opencode", []);
    expect(fallback).toContainEqual({ id: "", label: "CLI default" });
    expect(fallback).toContainEqual({ id: "auto", label: "Auto" });

    const rootPath = join(__dirname, "..");
    const settingsPanel = await Bun.file(join(rootPath, "src", "components", "SettingsPanel.tsx")).text();
    expect(settingsPanel).toContain("Rescan paths");
    expect(settingsPanel).toContain("Other...");
    expect(settingsPanel).toContain("Cleanup reasoning effort");
    expect(settingsPanel).not.toContain('settings.engine === "claude" &&');
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
    await writeFile(join(skillDir, "README.md"), "Supporting details that are not embedded.", "utf8");

    const listed = await listSkills(vaultDir);
    const listedSkill = listed.find((skill) => skill.name === "portable-review");
    expect(listedSkill).toMatchObject({
      chars: instructions.length,
      estimatedTokens: Math.ceil(instructions.length / 4),
      hasSupportingFiles: true,
      tooLarge: false,
    });

    const resolved = await loadSelectedSkills(vaultDir, ["portable-review", "missing-skill", "portable-review"]);

    expect(resolved.missing).toEqual(["missing-skill"]);
    expect(resolved.unreadable).toEqual([]);
    expect(resolved.oversized).toEqual([]);
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

    const largeSkillDir = join(vaultDir, ".claude", "skills", "too-large");
    await mkdir(largeSkillDir, { recursive: true });
    await writeFile(join(largeSkillDir, "SKILL.md"), "x".repeat(MAX_SKILL_INSTRUCTIONS_CHARS + 1), "utf8");
    expect((await listSkills(vaultDir)).find((skill) => skill.name === "too-large")).toMatchObject({ tooLarge: true });
    const oversized = await loadSelectedSkills(vaultDir, ["too-large"]);
    expect(oversized.skills).toEqual([]);
    expect(oversized.oversized).toEqual(["too-large"]);

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
    expect(buildHumanizeTurnPrompt(false)).toContain("Rewrite your previous answer using these rules");
    expect(buildHumanizeTurnPrompt(false)).not.toContain("Apply the humanizer skill");
    const fallbackAppend = buildAppend({ persona: "P", mode: "ask", phase: "humanize", useHumanizerSkill: false });
    expect(fallbackAppend).toContain("Rewrite your previous answer to remove signs of AI writing");
    expect(fallbackAppend).not.toContain("Use the humanizer skill");

    const clean = buildCliCleanupPrompt("messy text");
    expect(clean).toContain("messy text");
    expect(clean).toContain("Fix any spelling, grammar, punctuation");

    const follow = buildCliFollowupPrompt("my-persona", "file-context", "prior answer", "my tweak");
    expect(follow).toContain("my-persona");
    expect(follow).toContain("file-context");
    expect(follow).toContain("prior answer");
    expect(follow).toContain("my tweak");
    expect(follow).toContain("Do not use any tools");

    const summarize = buildSummarizePrompt("text to sum", "personal-ctx");
    expect(summarize).toContain("text to sum");
    expect(summarize).toContain("personal-ctx");
    expect(summarize).toContain("Do not use any tools");

    const place = buildAutoPlacePrompt("my new code", "notes/dir/structure");
    expect(place).toContain("my new code");
    expect(place).toContain("notes/dir/structure");
    expect(place).toContain("Do not use any tools");

    const scan = buildFillinScanPrompt("personal-ctx", "focus area");
    expect(scan).toContain("focus area");
    expect(scan).toContain("personal-ctx");
    expect(scan).toContain("Do not use any tools");

    const ans = buildFillinAnswerPrompt("personal-ctx", "the q", "the ans", "path.md");
    expect(ans).toContain("personal-ctx");
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
      cleanupModel: "legacy-cleanup-model",
      effort: "high",
      engineModels: { codex: "gpt-5.2-codex" },
      engineReasoning: { codex: "max" },
      cleanupModels: { codex: "gpt-5.2-mini" },
      cleanupReasoning: { codex: "minimal" },
    });

    expect(settings.engineModels.claude).toBe("legacy-claude-model");
    expect(settings.engineReasoning.claude).toBe("high");
    expect(settings.cleanupModels.claude).toBe("legacy-cleanup-model");
    expect(settings.cleanupReasoning.claude).toBe("low");
    expect(effectiveEngineModel(settings, "codex")).toBe("gpt-5.2-codex");
    expect(effectiveEngineReasoning(settings, "codex")).toBe("max");
    expect(effectiveCleanupModel(settings, "codex")).toBe("gpt-5.2-mini");
    expect(effectiveCleanupReasoning(settings, "codex")).toBe("minimal");
    expect(normalizeServerSettings({}).tuiShortcutsVisible).toBe(true);
    expect(normalizeServerSettings({ tuiShortcutsVisible: false } as any).tuiShortcutsVisible).toBe(false);
    // Old browser settings used "basic" before the local resolver existed.
    // Normalization upgrades them to the safe Readability-first auto mode.
    expect(normalizeServerSettings({ urlFetchMethod: "basic" as any }).urlFetchMethod).toBe("auto");
  });

  test("askPersona is a stored, per-mode system prompt independent of the draft prompt", () => {
    // Migration: a config written before askPersona existed has no such key, so it
    // is seeded from the profile — preserving the exact Ask prompt that used to be
    // recomputed on every request. The Draft prompt stays untouched.
    const migrated = normalizeServerSettings({
      userName: "Jane Doe",
      userRole: "a data scientist",
      personaNotes: "I write tersely.",
      persona: "JOB ONLY PROMPT",
      // no askPersona key
    } as any);
    expect(migrated.askPersona).toBe(
      buildAskPersona({ userName: "Jane Doe", userRole: "a data scientist", personaNotes: "I write tersely." })
    );
    expect(migrated.askPersona).toContain("Jane Doe");
    expect(migrated.askPersona.length).toBeGreaterThan(0);
    // The two prompts are independent: the Draft prompt never leaks into Ask mode.
    expect(migrated.persona).toBe("JOB ONLY PROMPT");
    expect(migrated.askPersona).not.toBe(migrated.persona);

    // An explicitly saved Ask prompt is preserved verbatim (not regenerated).
    expect(normalizeServerSettings({ askPersona: "MY CUSTOM ASK PROMPT" } as any).askPersona).toBe(
      "MY CUSTOM ASK PROMPT"
    );
  });

  test("default system prompt rules apply across all user-facing modes", () => {
    const profile = {
      userName: "Jane Doe",
      userRole: "a systems engineer",
      personaNotes: "Keep the tone direct.",
    };
    const defaultPrompt = buildDefaultSystemPrompt(profile);
    const jobPrompt = buildJobPersona(profile);
    const askPrompt = buildAskPersona(profile);
    const settings = { ...defaultSettings(), ...profile };
    const writerAppend = buildWriterAppend(settings, "Summarize content for personal notes.");
    const cliHumanize = buildCliHumanizePrompt("Rova helped me learn systems design.", askPrompt);
    const cliCleanup = buildCliCleanupPrompt("Parallel Query Processing System was useful.", defaultPrompt);

    for (const prompt of [defaultPrompt, jobPrompt, askPrompt, writerAppend, cliHumanize, cliCleanup]) {
      expect(prompt).toContain("include a brief explanatory clause or one-sentence description");
      expect(prompt).toContain("Do not leave bare names unexplained");
      expect(prompt).not.toMatch(/\bvault\b/i);
      expect(prompt).toContain("personally explaining work, experience, and interests");
      expect(prompt).not.toMatch(/\bapplicant\b/i);
    }

    expect(jobPrompt).toContain("DRAFT MODE");
    expect(jobPrompt).toContain("thoughtful user");
    expect(askPrompt).toContain("ASK MODE");
    expect(writerAppend).toContain("WRITER MODE");
    expect(cliHumanize).toContain("ASK MODE");
    expect(cliCleanup).toContain("CORE RESPONSE RULES");
  });

  test("draft-mode settings and help copy stay neutral and humanized", async () => {
    const rootPath = join(__dirname, "..");
    const settingsPanel = await Bun.file(join(rootPath, "src", "components", "SettingsPanel.tsx")).text();
    const helpGuide = await Bun.file(join(rootPath, "src", "components", "HelpGuide.tsx")).text();
    const onboarding = await Bun.file(join(rootPath, "src", "components", "Onboarding.tsx")).text();
    const tabView = await Bun.file(join(rootPath, "src", "components", "TabView.tsx")).text();
    const skillPicker = await Bun.file(join(rootPath, "src", "components", "SkillPicker.tsx")).text();
    const conversationView = await Bun.file(join(rootPath, "tui", "components", "ConversationView.tsx")).text();
    const quickNotes = await Bun.file(join(rootPath, "src", "components", "QuickNotes.tsx")).text();
    const prepackaged = await Bun.file(join(rootPath, "shared", "prepackaged-skills.ts")).text();

    expect(settingsPanel).toContain("System Prompt Draft Mode");
    expect(onboarding).toContain("System Prompt Draft Mode");
    expect(settingsPanel).not.toContain("System prompt — Job mode");
    expect(buildDraftPrompt("extra context", "the question")).toContain("Draft context:");

    expect(buildJobPersona()).not.toMatch(/\b(applicant|job-application|JOB-APPLICATION)\b/i);
    expect(helpGuide).toContain("<strong>Settings -&gt; Persona</strong>");
    expect(helpGuide).not.toMatch(/\b(job|application|applicant|cover-letter)\b/i);
    expect(settingsPanel).toContain("Built-in capabilities");
    expect(settingsPanel).toContain("Portable skills");
    expect(settingsPanel).not.toContain("Pre-packaged skills");
    expect(settingsPanel).not.toContain("User skills");
    expect(skillPicker).toContain("Selected SKILL.md instructions are embedded for every engine.");

    const userFacingCopy = [
      settingsPanel,
      helpGuide,
      skillPicker,
      onboarding,
      tabView,
      conversationView,
      quickNotes,
      prepackaged,
    ].join("\n");
    expect(userFacingCopy).not.toMatch(/System prompt — Job mode|Job description|job description|application question|cover-letter|applications|applicant|JOB-APPLICATION|job-application/);
    expect(userFacingCopy).not.toMatch(/[—–“”]/);
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
    expect(server.cleanupModels).toEqual(defaultCleanupModels());
    expect(client.cleanupModels).toEqual(defaultCleanupModels());
    expect(server.cleanupReasoning).toEqual(defaultCleanupReasoning());
    expect(client.cleanupReasoning).toEqual(defaultCleanupReasoning());
    expect(server.tuiShortcutsVisible).toBe(true);
    expect(client.tuiShortcutsVisible).toBe(true);
    expect(normalizeClientSettings({ tuiShortcutsVisible: false } as any).tuiShortcutsVisible).toBe(false);
  });

  test("port env parsing supports a single app port", async () => {
    expect(parseDotEnv("PORT='8123'\n# ignored\nexport VAULT_DIR=/tmp/vault")).toEqual({
      PORT: "8123",
      VAULT_DIR: "/tmp/vault",
    });

    const tempDir = await mkdtemp(join(tmpdir(), "ports-env-test-"));
    const envFile = join(tempDir, ".env");
    const env: Record<string, string | undefined> = { PORT: "9000" };
    await writeFile(envFile, "PORT=6123\nVAULT_DIR=/tmp/vault\n", "utf8");
    loadDotEnv(envFile, env as NodeJS.ProcessEnv);
    expect(env).toMatchObject({ PORT: "9000", VAULT_DIR: "/tmp/vault" });
    await rm(tempDir, { recursive: true, force: true });

    expect(resolveAppPort({})).toBe(DEFAULT_PORT);
    expect(resolveAppPort({ PORT: "8123" })).toBe(8123);
    expect(resolveAppPort({ PORT: "0" })).toBe(DEFAULT_PORT);
    expect(resolveAppPort({ PORT: "bad" })).toBe(DEFAULT_PORT);
  });

  test("TUI draft mode displays as draft but sends backend job mode", () => {
    const session = newSession(toBackendMode("draft"));
    session.question = "Write the answer.";

    expect(session.mode).toBe("job");
    expect(buildGeneratePayload(session).mode).toBe("job");
    expect(toBackendMode("ask")).toBe("ask");
    expect(toBackendMode("write")).toBe("write");

    // Test getTabBarInfo helper for tab bar rendering
    const askTabBar = getTabBarInfo("ask");
    expect(askTabBar.modes.find((m) => m.key === "ask")?.isActive).toBe(true);
    expect(askTabBar.modes.find((m) => m.key === "job")?.isActive).toBe(false);
    expect(askTabBar.modes.find((m) => m.key === "write")?.isActive).toBe(false);
    expect(askTabBar.submodes).toHaveLength(0);

    const draftTabBar = getTabBarInfo("job");
    expect(draftTabBar.modes.find((m) => m.key === "ask")?.isActive).toBe(false);
    expect(draftTabBar.modes.find((m) => m.key === "job")?.isActive).toBe(true);
    expect(draftTabBar.modes.find((m) => m.key === "write")?.isActive).toBe(false);
    expect(draftTabBar.submodes).toHaveLength(0);

    const writeTabBar = getTabBarInfo("write", "manual");
    expect(writeTabBar.modes.find((m) => m.key === "ask")?.isActive).toBe(false);
    expect(writeTabBar.modes.find((m) => m.key === "job")?.isActive).toBe(false);
    expect(writeTabBar.modes.find((m) => m.key === "write")?.isActive).toBe(true);
    expect(writeTabBar.submodes.find((sm) => sm.key === "manual")?.isActive).toBe(true);
    expect(writeTabBar.submodes.find((sm) => sm.key === "summarize")?.isActive).toBe(false);
  });

  test("TUI payload builders match backend endpoint shapes", () => {
    const session = newSession("job");
    Object.assign(session, {
      jobDescription: "JD",
      question: "Question",
      extraContext: "Extra",
      skills: ["fallow"],
      rag: true,
      latex: true,
      attachments: [
        { id: "att-live", name: "live.pdf", size: 100, chars: 10, truncated: false },
        { id: "att-expired", name: "old.pdf", size: 100, chars: 10, truncated: false, expired: true },
      ],
      writeInput: "Writer input",
      fillinDir: "Projects",
      docAttachment: { id: "doc-1", name: "doc.pdf", size: 100, chars: 10, truncated: false },
    });

    expect(buildGeneratePayload(session)).toEqual({
      jobDescription: "JD",
      question: "Question",
      skills: ["fallow"],
      rag: true,
      mode: "job",
      extraContext: "Extra",
      attachmentIds: ["att-live"],
      latex: true,
    });
    expect(buildMessagePayload(session, "Follow")).toEqual({
      text: "Follow",
      skills: ["fallow"],
      rag: true,
      mode: "job",
      latex: true,
    });
    expect(buildCleanupPayload(session, "Draft")).toEqual({ text: "Draft", skills: ["fallow"], latex: true });
    expect(buildSummarizePayload(session, "Article text", false)).toEqual({ input: "Article text", isUrl: false, skills: ["fallow"] });
    expect(buildAutoPlacePayload("Note")).toEqual({ content: "Note" });
    expect(buildFillinScanPayload(session)).toEqual({ prompt: "Writer input", dir: "Projects" });
    expect(buildFillinWritePayload({ question: "Q", answer: "A", targetPath: "P.md" }, session)).toEqual({
      question: "Q",
      answer: "A",
      targetPath: "P.md",
      skills: ["fallow"],
    });
    expect(buildWriteCleanupPayload(session)).toEqual({ text: "Writer input", skills: ["fallow"] });
    expect(buildDocProposePayload(session)).toEqual({ attachmentId: "doc-1", focus: "Writer input" });
  });

  test("TUI CLI flag parsing supports launcher and terminal flags", () => {
    expect(parseLauncherArgs(["--tui", "--port", "6001", "--mode", "draft"])).toEqual({
      tui: true,
      rest: ["--port", "6001", "--mode", "draft"],
    });
    expect(parseLauncherArgs(["--port", "6001"])).toEqual({ tui: false, rest: ["--port", "6001"] });

    expect(
      parseTuiArgs(["--port", "6001", "--server-url", "http://127.0.0.1:9999/", "--mode", "draft"], {
        PORT: "5174",
      })
    ).toEqual({
      help: false,
      port: 6001,
      serverUrl: "http://127.0.0.1:9999",
      initialMode: "draft",
      fullScreen: false,
    });
    expect(parseTuiArgs([], { PORT: "6200" }).port).toBe(6200);
    expect(parseTuiArgs(["--full-screen"], {}).fullScreen).toBe(true);
    expect(parseTuiArgs(["--fullscreen"], {}).fullScreen).toBe(true);
    expect(parseTuiArgs(["--help"], {}).help).toBe(true);
    expect(formatTuiHelp()).toContain("--full-screen");
  });

  test("TUI full-screen mode is opt-in and uses Ink alternate screen rendering", async () => {
    const rootPath = join(__dirname, "..");
    const main = await Bun.file(join(rootPath, "tui", "main.tsx")).text();
    const cli = await Bun.file(join(rootPath, "tui", "lib", "cli.ts")).text();
    const editor = await Bun.file(join(rootPath, "tui", "lib", "editor.ts")).text();

    expect(cli).toContain("let fullScreen = false");
    expect(cli).toContain('arg === "--full-screen"');
    expect(main).toContain("alternateScreen: parsed.fullScreen");
    expect(main).toContain("const { exit, suspendTerminal } = useApp()");
    expect(editor).toContain("await opts.suspendTerminal(runEditor)");
  });

  test("TUI settings patches preserve per-engine model and reasoning maps", () => {
    const base = normalizeServerSettings({
      ...defaultSettings(),
      engine: "codex",
      model: "claude-legacy",
      effort: "high",
      engineModels: { claude: "claude-legacy", codex: "gpt-5-codex", opencode: "openai/gpt-5" },
      engineReasoning: { claude: "high", codex: "medium", opencode: "max" },
      cleanupModels: { claude: "claude-haiku-4-5", codex: "gpt-5-codex-mini", opencode: "openai/gpt-5-mini" },
      cleanupReasoning: { claude: "low", codex: "minimal", opencode: "low" },
    });

    const modelPatch = buildEngineModelPatch(base, "gpt-5.2-codex");
    const afterModel = mergeTuiSettings(base, modelPatch);
    expect(modelPatch).toEqual({
      engineModels: { ...base.engineModels, codex: "gpt-5.2-codex" },
    });
    expect(afterModel.engineModels.claude).toBe("claude-legacy");
    expect(afterModel.engineModels.opencode).toBe("openai/gpt-5");
    expect(afterModel.engineModels.codex).toBe("gpt-5.2-codex");

    const reasoningPatch = buildEngineReasoningPatch(afterModel, "high");
    const afterReasoning = mergeTuiSettings(afterModel, reasoningPatch);
    expect(afterReasoning.engineReasoning.claude).toBe("high");
    expect(afterReasoning.engineReasoning.opencode).toBe("max");
    expect(afterReasoning.engineReasoning.codex).toBe("high");

    const cleanupModelPatch = buildCleanupModelPatch(afterReasoning, "gpt-5.2-codex-mini");
    const afterCleanupModel = mergeTuiSettings(afterReasoning, cleanupModelPatch);
    expect(afterCleanupModel.cleanupModels.claude).toBe("claude-haiku-4-5");
    expect(afterCleanupModel.cleanupModels.opencode).toBe("openai/gpt-5-mini");
    expect(afterCleanupModel.cleanupModels.codex).toBe("gpt-5.2-codex-mini");

    const cleanupReasoningPatch = buildCleanupReasoningPatch(afterCleanupModel, "low");
    const afterCleanupReasoning = mergeTuiSettings(afterCleanupModel, cleanupReasoningPatch);
    expect(afterCleanupReasoning.cleanupReasoning.claude).toBe("low");
    expect(afterCleanupReasoning.cleanupReasoning.opencode).toBe("low");
    expect(afterCleanupReasoning.cleanupReasoning.codex).toBe("low");

    const hiddenHints = mergeTuiSettings(afterCleanupReasoning, { tuiShortcutsVisible: false });
    expect(hiddenHints.tuiShortcutsVisible).toBe(false);
    expect(hiddenHints.engineModels.codex).toBe("gpt-5.2-codex");
  });

  test("TUI vault writes require preview token flow before write payload", () => {
    expect(buildVaultPreviewPayload("Notes/new.md")).toEqual({ path: "Notes/new.md" });
    expect(buildVaultWritePayload("Notes/new.md", "content", "token-1")).toEqual({
      path: "Notes/new.md",
      content: "content",
      token: "token-1",
    });

    const pending = createPendingApproval(
      {
        ok: true,
        path: "Notes/existing.md",
        exists: true,
        existingContent: "Old content\n",
        token: "preview-token",
      },
      "New content",
      "append"
    );

    expect(pending.newContent).toBe("Old content\n\nNew content");
    expect(approvalWritePayload(pending)).toEqual({
      path: "Notes/existing.md",
      content: "Old content\n\nNew content",
      token: "preview-token",
    });

    expect(() =>
      createPendingApproval(
        {
          ok: true,
          path: "Notes/huge.md",
          exists: true,
          existingContent: "",
          tooLarge: true,
          token: "preview-token",
        },
        "New content",
        "append"
      )
    ).toThrow("Cannot safely append");
  });

  test("TUI document writes only request approval for pending proposals", () => {
    const settings = normalizeServerSettings(defaultSettings());
    let session = newSession("write");
    const writes: unknown[] = [];
    session.docProposals = [
      {
        id: "pending",
        targetPath: "Notes/pending.md",
        action: "create",
        content: "Pending",
        rationale: "",
        status: "pending",
      },
      {
        id: "rejected",
        targetPath: "Notes/rejected.md",
        action: "append",
        content: "Rejected",
        rationale: "",
        status: "rejected",
      },
      {
        id: "written",
        targetPath: "Notes/written.md",
        action: "append",
        content: "Written",
        rationale: "",
        status: "written",
      },
    ];

    const actions = createActions({
      settings,
      controllers: new Map(),
      update: (fn) => {
        session = { ...session, ...fn(session) };
      },
      requestWrite: (request) => {
        writes.push(request);
      },
    });

    actions.confirmDocWrite(session, "rejected");
    actions.confirmDocWrite(session, "written");
    expect(writes).toHaveLength(0);

    actions.confirmDocWrite(session, "pending");
    expect(writes).toHaveLength(1);
  });

  test("TUI generation start clears stale LaTeX output", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(new ReadableStream({ start: (controller) => controller.close() }));
    try {
      const settings = normalizeServerSettings(defaultSettings());
      let session = newSession("ask");
      Object.assign(session, {
        question: "Compile a PDF",
        latex: true,
        latexCompileId: "old-pdf",
        latexLog: "old log",
        latexBusy: true,
        texSource: "old source",
      });

      const actions = createActions({
        settings,
        controllers: new Map(),
        update: (fn) => {
          session = { ...session, ...fn(session) };
        },
        requestWrite: () => {},
      });

      actions.runGenerate(session);
      expect(session.latexCompileId).toBe("");
      expect(session.latexLog).toBe("");
      expect(session.latexBusy).toBe(false);
      expect(session.texSource).toBe("");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("TUI stream handlers ignore events after the session id changes", async () => {
    const originalFetch = globalThis.fetch;
    const encoder = new TextEncoder();
    let releaseStream: (() => void) | undefined;
    globalThis.fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            releaseStream = () => {
              controller.enqueue(encoder.encode('event: text\ndata: {"phase":"answer","delta":"late"}\n\n'));
              controller.enqueue(encoder.encode('event: done\ndata: {"text":"late answer"}\n\n'));
              controller.close();
            };
          },
        })
      );

    try {
      const settings = normalizeServerSettings(defaultSettings());
      let session = newSession("ask");
      session.question = "Question";

      const actions = createActions({
        settings,
        controllers: new Map(),
        update: (fn) => {
          session = { ...session, ...fn(session) };
        },
        requestWrite: () => {},
      });

      actions.runGenerate(session);
      await Promise.resolve();
      session = { ...session, id: "new-session" } as Session;
      releaseStream?.();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(session.answer).toBe("");
      expect(session.id).toBe("new-session");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("TUI document proposal parsing handles fenced and prose-wrapped model output", () => {
    const proposals = parseDocProposals(`
The proposals are:

\`\`\`json
[
  {"targetPath":"Projects/lunara.md","action":"append","content":"## Update\\nWorked on Lunara.","rationale":"The project note already exists."},
  {"targetPath":"Reading/new.md","action":"create","content":"# New note","rationale":"A new topic appears."}
]
\`\`\`
`);

    expect(proposals).toHaveLength(2);
    expect(proposals[0]).toMatchObject({
      targetPath: "Projects/lunara.md",
      action: "append",
      content: "## Update\nWorked on Lunara.",
      rationale: "The project note already exists.",
      status: "pending",
    });
    expect(proposals[0].id).toMatch(/^tui-/);
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

    const cleanupSettings = cleanupEngineSettings({
      ...settings,
      engine: "codex",
      cleanupModels: { ...settings.cleanupModels, codex: "gpt-5.2-codex-mini" },
      cleanupReasoning: { ...settings.cleanupReasoning, codex: "minimal" },
    });
    const cleanupCodex = buildCliCommand("codex", { prompt: "CLEANUP", settings: cleanupSettings });
    expect(cleanupCodex.cmd).toContain("gpt-5.2-codex-mini");
    expect(cleanupCodex.cmd).toContain('model_reasoning_effort="minimal"');

    const cursor = buildCliCommand("cursor", { prompt: "PROMPT", settings });
    expect(cursor.writeToStdin).toBe(true);
    expect(cursor.cmd).toContain("--model");
    expect(cursor.cmd).toContain("cursor-custom");
    expect(cursor.cmd.join("\n")).not.toContain("PROMPT");
    expect(cursor.prompt).toContain("Reasoning effort: low");
  });

  test("CLI command builder handles session resumption resume flags", async () => {
    const { defaultSettings, normalizeServerSettings } = await import("./config");
    const settings = normalizeServerSettings({
      engineModels: { gemini: "gemini-model", opencode: "opencode-model", codex: "codex-model" }
    });

    // 1. agy (Gemini) session resume
    const geminiResumed = buildCliCommand("gemini", { prompt: "PROMPT", settings, resume: "sess-123" });
    expect(geminiResumed.cmd).toContain("--conversation");
    expect(geminiResumed.cmd).toContain("sess-123");

    // 2. OpenCode session resume
    const opencodeResumed = buildCliCommand("opencode", { prompt: "PROMPT", settings, resume: "sess-456" });
    expect(opencodeResumed.cmd).toContain("--session");
    expect(opencodeResumed.cmd).toContain("sess-456");

    // 3. Codex session resume
    const codexResumed = buildCliCommand("codex", { prompt: "PROMPT", settings, resume: "sess-789" });
    expect(codexResumed.cmd).toContain("resume");
    expect(codexResumed.cmd).toContain("sess-789");
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
    expect(agentsMd).toContain("is not loaded by Vault Assistant at runtime");
    expect(agentsMd).toContain("The app uses one port for both frontend and backend traffic");
    expect(agentsMd).toContain("`PORT` in `.env`");
    expect(agentsMd).not.toContain("BACKEND_PORT");
    expect(agentsMd).not.toContain("FRONTEND_PORT");

    // Check docs/WORKFLOW.md
    const workflowMdPath = join(rootPath, "docs", "WORKFLOW.md");
    const workflowMd = await Bun.file(workflowMdPath).text();
    expect(workflowMd.length).toBeGreaterThan(0);
    expect(workflowMd).toContain("must be accompanied by a test");
  });

  test("bundled skill creator guide loads without a source-tree file lookup", async () => {
    const guide = await loadSkillCreatorGuide();

    expect(guide.name).toBe("skill-creator");
    expect(guide.description).toContain("portable SKILL.md");
    expect(guide.instructions).toContain("# Skill Creator");
    expect(guide.instructions).toContain("description: Author a single portable SKILL.md");
  });

  test("Tauri staging bundles the server and copies only explicit runtime externals", async () => {
    const rootPath = join(__dirname, "..");
    const stageScript = await Bun.file(join(rootPath, "src-tauri", "scripts", "stage-app.sh")).text();
    const tauriShell = await Bun.file(join(rootPath, "src-tauri", "src", "lib.rs")).text();

    expect(stageScript).toContain('bun build "$ROOT/server.ts"');
    expect(stageScript).toContain("--target=bun");
    expect(stageScript).toContain("--production");
    expect(stageScript).toContain("--external playwright");
    expect(stageScript).toContain("--external css-tree");
    expect(stageScript).toContain("for pkg in css-tree mdn-data source-map-js");
    expect(stageScript).toContain("for pkg in playwright playwright-core");
    expect(stageScript).toContain("select_claude_sdk_package");
    expect(stageScript).not.toContain("bun install --production");
    expect(stageScript).not.toContain("for item in server.ts agent shared src");

    expect(tauriShell).toContain('"server.ts"');
    expect(tauriShell).toContain('"server.js"');
    expect(tauriShell).toContain("cfg!(debug_assertions)");
    expect(tauriShell).toContain(".env(\"PORT\"");
  });

  test("Dockerfile supports web and TUI container runs", async () => {
    const rootPath = join(__dirname, "..");
    const dockerfile = await Bun.file(join(rootPath, "Dockerfile")).text();
    const dockerignore = await Bun.file(join(rootPath, ".dockerignore")).text();

    expect(dockerfile).toContain("FROM oven/bun:");
    expect(dockerfile).toContain("ENV PORT=5173");
    expect(dockerfile).toContain("EXPOSE 5173");
    expect(dockerfile).toContain('CMD ["bun", "run", "start"]');
    expect(dockerfile).toContain("bun run tui");

    for (const ignored of ["node_modules", "config.json", ".sessions.json", ".attachments", "logs", ".env"]) {
      expect(dockerignore).toContain(ignored);
    }
  });

  test("default visual identity uses Obsidian purple and the image logo", async () => {
    const rootPath = join(__dirname, "..");
    const {
      DEFAULT_DESIGN,
      OBSIDIAN_PURPLE_ACCENT_CHROMA,
      OBSIDIAN_PURPLE_ACCENT_HUE,
      normalizeDesignSettings,
    } = await import("../src/lib/store");
    const styles = await Bun.file(join(rootPath, "src", "styles.css")).text();
    const app = await Bun.file(join(rootPath, "src", "App.tsx")).text();
    const index = await Bun.file(join(rootPath, "src", "index.html")).text();
    const server = await Bun.file(join(rootPath, "server.ts")).text();

    expect(DEFAULT_DESIGN.accentHue).toBe(OBSIDIAN_PURPLE_ACCENT_HUE);
    expect(DEFAULT_DESIGN.accentChroma).toBe(OBSIDIAN_PURPLE_ACCENT_CHROMA);
    expect(normalizeDesignSettings({ accentHue: 250, accentChroma: 0.13 })).toMatchObject({
      accentHue: OBSIDIAN_PURPLE_ACCENT_HUE,
      accentChroma: OBSIDIAN_PURPLE_ACCENT_CHROMA,
    });
    expect(normalizeDesignSettings({ accentHue: 140, accentChroma: 0.08 })).toMatchObject({
      accentHue: 140,
      accentChroma: 0.08,
    });

    expect(styles).toContain("var(--accent-chroma, 0.24) var(--accent-hue, 293)");
    expect(app).toContain('import logoUrl from "./assets/vault-assistant-logo-v2.png"');
    expect(app).toContain('className="logo-mark" src={logoUrl}');
    expect(app).toContain('<span>vault</span>');
    expect(app).toContain('<span>assistant</span>');
    expect(app).not.toContain('className="logo-mark">VA</span>');
    expect(styles).toContain("flex-direction: column");
    expect(index).toContain('rel="icon" type="image/png" href="./assets/vault-assistant-logo-v2.png"');
    expect(server).toContain('"/assets/vault-assistant-logo-v2.png"');
    expect(server).toContain('"/vault-assistant-logo-v2.png"');
    expect(await Bun.file(join(rootPath, "src", "assets", "vault-assistant-logo-v2.png")).exists()).toBe(true);
  });

  test("new-question clones preserve draft context and follow the current system prompt", async () => {
    const { newTab, cloneTabForNewQuestion, overrideSettingsBody } = await import("../src/lib/store");
    const { defaultSettings } = await import("./config");

    // The personas the user has *currently specified* in Settings.
    const current: any = { ...defaultSettings(), persona: "CURRENT SYSTEM PROMPT", askPersona: "CURRENT ASK PROMPT" };

    // A Draft tab whose Override was toggled on back when an older persona was in
    // effect, freezing that stale persona into the override snapshot.
    const source: any = {
      ...newTab([], false, "job"),
      jobDescription: "A specific draft context",
      skills: ["yc-combinator"],
      overrideEnabled: true,
      override: { ...defaultSettings(), persona: "STALE SYSTEM PROMPT", askPersona: "STALE ASK PROMPT" },
    };

    // "+ New question" clones the tab's context into a fresh conversation.
    const clone = cloneTabForNewQuestion(source, []);
    expect(clone.mode).toBe("job");
    expect(clone.jobDescription).toBe("A specific draft context");
    expect(clone.skills).toContain("yc-combinator");
    expect(clone.id).not.toBe(source.id);

    // The settings sent for that clone must carry the CURRENT personas, not the
    // stale snapshot — otherwise the new question ignores the specified system prompt.
    // Both modes' prompts (Draft prompt + Ask askPersona) are pinned to global.
    const body = overrideSettingsBody(clone, current);
    expect(body?.persona).toBe("CURRENT SYSTEM PROMPT");
    expect(body?.persona).not.toBe("STALE SYSTEM PROMPT");
    expect(body?.askPersona).toBe("CURRENT ASK PROMPT");
    expect(body?.askPersona).not.toBe("STALE ASK PROMPT");

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

  test("TUI identifies text inputs and the shortcut-hints toggle correctly", async () => {
    const { isTextInput, isShortcutHintsToggle } = await import("../tui/main");

    // Valid text input focus IDs
    expect(isTextInput("job")).toBe(true);
    expect(isTextInput("extra")).toBe(true);
    expect(isTextInput("question")).toBe(true);
    expect(isTextInput("wsource")).toBe(true);
    expect(isTextInput("wcontent")).toBe(true);
    expect(isTextInput("followup")).toBe(true);
    expect(isTextInput("wfocus")).toBe(true);
    expect(isTextInput("docfocus")).toBe(true);
    expect(isTextInput("docpath")).toBe(true);
    expect(isTextInput("q:123")).toBe(true);
    expect(isTextInput("q:some-uuid")).toBe(true);

    // Non-text-input focus IDs (should be false)
    expect(isTextInput("answer")).toBe(false);
    expect(isTextInput("wpath")).toBe(false);
    expect(isTextInput("wdir")).toBe(false);
    expect(isTextInput("p:proposal-123")).toBe(false);
    expect(isTextInput("random-id")).toBe(false);

    expect(isShortcutHintsToggle("h", { ctrl: true })).toBe(true);
    expect(isShortcutHintsToggle("\x08", { ctrl: true })).toBe(true);
    expect(isShortcutHintsToggle("h", { ctrl: true, backspace: true })).toBe(false);
    expect(isShortcutHintsToggle("\x08", { ctrl: true, backspace: true })).toBe(false);
    expect(isShortcutHintsToggle("h", { ctrl: false })).toBe(false);
  });

  test("TUI shortcut hints are gated by a persisted visibility setting", async () => {
    const rootPath = join(__dirname, "..");
    const main = await Bun.file(join(rootPath, "tui", "main.tsx")).text();
    const settingsView = await Bun.file(join(rootPath, "tui", "components", "SettingsView.tsx")).text();
    const components = await Promise.all(
      ["ConversationView", "WriteView", "AnswerPane", "PathPicker", "ApprovalView", "SkillsView", "LogsView", "AttachView"].map(
        async (name) => [name, await Bun.file(join(rootPath, "tui", "components", `${name}.tsx`)).text()] as const
      )
    );

    expect(main).toContain("isShortcutHintsToggle(input, key)");
    expect(main).toContain("changeSettings({ tuiShortcutsVisible: next })");
    expect(settingsView).toContain('{ id: "tuiShortcutsVisible", label: "Shortcut hints"');
    expect(settingsView).toContain("onPatch({ tuiShortcutsVisible: settings.tuiShortcutsVisible === false })");
    for (const [name, source] of components) {
      expect(`${name}:${source}`).toContain("showShortcuts");
    }
  });

  test("showDirectoryPicker triggers OS picker correctly", async () => {
    const { showDirectoryPicker } = await import("./dialog");
    const { mock } = await import("bun:test");
    const originalSpawn = Bun.spawn;
    try {
      const mockSpawn = mock(() => {
        return {
          exited: Promise.resolve(0),
          stdout: new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("/mocked/path\n"));
              controller.close();
            }
          })
        } as any;
      });
      Bun.spawn = mockSpawn;

      const path = await showDirectoryPicker({ title: "Test Picker", defaultPath: "/default" });
      expect(path).toBe("/mocked/path");

      expect(mockSpawn.mock.calls.length).toBe(1);
      const callArgs = (mockSpawn.mock.calls as any)[0][0] as string[];
      if (process.platform === "win32") {
        expect(callArgs[0]).toBe("powershell.exe");
      } else if (process.platform === "darwin") {
        expect(callArgs[0]).toBe("osascript");
      } else {
        expect(callArgs[0]).toBe("zenity");
      }
    } finally {
      Bun.spawn = originalSpawn;
    }
  });

  test("newTab option 1 context-aware auto-naming", async () => {
    const { newTab } = await import("../src/lib/store");

    // 1. Fallback to random codename
    const fallbackTab = newTab();
    expect(fallbackTab.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);

    // 2. Vault-aware naming
    const vaultTab = newTab([], false, "ask", "/path/to/my-obsidian-vault");
    expect(vaultTab.name).toBe("Vault: my-obsidian-vault");

    // 3. File context-aware naming
    const activeTabWithFile: any = {
      writePath: "/path/to/my-obsidian-vault/docs/GUIDE.md"
    };
    const fileTab = newTab([], false, "ask", "/path/to/my-obsidian-vault", activeTabWithFile);
    expect(fileTab.name).toBe("Context: GUIDE.md");

    // 4. Folder context-aware naming
    const activeTabWithDir: any = {
      writePath: "/path/to/my-obsidian-vault/src/components"
    };
    const dirTab = newTab([], false, "ask", "/path/to/my-obsidian-vault", activeTabWithDir);
    expect(dirTab.name).toBe("Folder: components/");

    // 5. Attachment context-aware naming
    const activeTabWithAttachment: any = {
      attachments: [{ id: "123", name: "attachment_file.pdf", size: 100, chars: 100, truncated: false }]
    };
    const attachmentTab = newTab([], false, "ask", "/path/to/my-obsidian-vault", activeTabWithAttachment);
    expect(attachmentTab.name).toBe("File: attachment_file.pdf");
  });

});

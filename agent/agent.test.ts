import { describe, test, expect } from "bun:test";
import { cliAvailable, geminiAvailable, gatherVaultContext, runCliTurn } from "./gemini";
import {
  buildCliAskPrompt,
  buildCliDraftPrompt,
  buildCliHumanizePrompt,
  buildCliCleanupPrompt,
  buildCliFollowupPrompt,
  buildSummarizePrompt,
  buildAutoPlacePrompt,
  buildFillinScanPrompt,
  buildFillinAnswerPrompt,
  buildWriteCleanupPrompt,
} from "./config";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

describe("Vault Assistant CLI Engines Audit Suite", () => {
  
  test("autodetects installed CLIs on PATH", () => {
    // Claude is always assumed true since it's managed via SDK
    expect(cliAvailable("claude")).toBe(true);

    const engines = ["gemini", "opencode", "cursor", "copilot"] as const;
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

  test("runCliTurn executes and streams outputs for all autodetected CLI tools", async () => {
    const enginesToTest = ["gemini", "opencode", "cursor", "copilot"] as const;

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
      yc: true,
      overrideEnabled: true,
      override: { ...defaultSettings(), persona: "STALE SYSTEM PROMPT" },
    };

    // "+ New question" clones the tab's context into a fresh conversation.
    const clone = cloneTabForNewQuestion(source, []);
    expect(clone.mode).toBe("job");
    expect(clone.jobDescription).toBe("A specific job description");
    expect(clone.yc).toBe(true);
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

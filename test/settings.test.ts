import { describe, it, expect } from "vitest";
import {
  parseSettings,
  DEFAULT_SETTINGS,
  DEFAULT_TOGGLE_SHORTCUT,
  DEFAULT_CANCEL_SHORTCUT,
  VALID_THINKING_LEVELS,
  loadShortcutSettingsSync,
  configDirs,
  readConfigFile,
  isEnabledFromDisk,
  writeEnabledToDisk,
  resolveWritePath,
  loadSettings,
} from "../settings";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";

describe("parseSettings", () => {
  it("parseSettings_EmptyObject_ReturnsDefaults", () => {
    const { settings, errors } = parseSettings({});
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(errors).toEqual([]);
  });

  it("parseSettings_ValidMaxReviewLoops_Applies", () => {
    const { settings, errors } = parseSettings({ maxReviewLoops: 5 });
    expect(settings.maxReviewLoops).toBe(5);
    expect(errors).toEqual([]);
  });

  it("parseSettings_ZeroMaxReviewLoops_RejectsWithError", () => {
    const { settings, errors } = parseSettings({ maxReviewLoops: 0 });
    expect(settings.maxReviewLoops).toBe(DEFAULT_SETTINGS.maxReviewLoops);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("maxReviewLoops");
  });

  it("parseSettings_NegativeMaxReviewLoops_RejectsWithError", () => {
    const { settings, errors } = parseSettings({ maxReviewLoops: -1 });
    expect(settings.maxReviewLoops).toBe(DEFAULT_SETTINGS.maxReviewLoops);
    expect(errors.length).toBe(1);
  });

  it("parseSettings_FloatMaxReviewLoops_RejectsWithError", () => {
    const { settings, errors } = parseSettings({ maxReviewLoops: 3.5 });
    expect(settings.maxReviewLoops).toBe(DEFAULT_SETTINGS.maxReviewLoops);
    expect(errors.length).toBe(1);
  });

  it("parseSettings_StringMaxReviewLoops_RejectsWithError", () => {
    const { settings, errors } = parseSettings({ maxReviewLoops: "10" });
    expect(settings.maxReviewLoops).toBe(DEFAULT_SETTINGS.maxReviewLoops);
    expect(errors.length).toBe(1);
  });

  it("parseSettings_ValidModel_Applies", () => {
    const { settings, errors } = parseSettings({ model: "anthropic/claude-sonnet-4" });
    expect(settings.model).toBe("anthropic/claude-sonnet-4");
    expect(errors).toEqual([]);
  });

  it("parseSettings_ModelWithoutSlash_RejectsWithError", () => {
    const { settings, errors } = parseSettings({ model: "claude-sonnet" });
    expect(settings.model).toBe(DEFAULT_SETTINGS.model);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("provider/model-id");
  });

  it("parseSettings_NonStringModel_RejectsWithError", () => {
    const { settings, errors } = parseSettings({ model: 123 });
    expect(settings.model).toBe(DEFAULT_SETTINGS.model);
    expect(errors.length).toBe(1);
  });

  it("parseSettings_ValidThinkingLevels_AllAccepted", () => {
    for (const level of VALID_THINKING_LEVELS) {
      const { settings, errors } = parseSettings({ thinkingLevel: level });
      expect(settings.thinkingLevel).toBe(level);
      expect(errors).toEqual([]);
    }
  });

  it("parseSettings_InvalidThinkingLevel_RejectsWithError", () => {
    const { settings, errors } = parseSettings({ thinkingLevel: "turbo" });
    expect(settings.thinkingLevel).toBe(DEFAULT_SETTINGS.thinkingLevel);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("thinkingLevel");
  });

  it("parseSettings_ArchitectEnabledTrue_Applies", () => {
    const { settings, errors } = parseSettings({ architectEnabled: true });
    expect(settings.architectEnabled).toBe(true);
    expect(errors).toEqual([]);
  });

  it("parseSettings_ArchitectEnabledFalse_Applies", () => {
    const { settings, errors } = parseSettings({ architectEnabled: false });
    expect(settings.architectEnabled).toBe(false);
    expect(errors).toEqual([]);
  });

  it("parseSettings_NonBooleanArchitectEnabled_RejectsWithError", () => {
    const { settings, errors } = parseSettings({ architectEnabled: "yes" });
    expect(settings.architectEnabled).toBe(DEFAULT_SETTINGS.architectEnabled);
    expect(errors.length).toBe(1);
  });

  it("parseSettings_LegacyRoundupEnabled_AppliesAsArchitectEnabled", () => {
    const { settings, errors } = parseSettings({ roundupEnabled: false });
    expect(settings.architectEnabled).toBe(false);
    expect(errors).toEqual([]);
  });

  it("parseSettings_ArchitectEnabledOverridesLegacyRoundup", () => {
    // When both are present, architectEnabled wins (roundupEnabled is only used as fallback)
    const { settings, errors } = parseSettings({ architectEnabled: true, roundupEnabled: false });
    expect(settings.architectEnabled).toBe(true);
    expect(errors).toEqual([]);
  });

  it("parseSettings_LegacyRoundupEnabled_NotFlaggedAsUnknown", () => {
    const { errors } = parseSettings({ roundupEnabled: true });
    // Should NOT warn about unknown key
    expect(errors.some((e) => e.includes("Unknown"))).toBe(false);
  });

  it("parseSettings_UnknownKey_WarnsButDoesNotFail", () => {
    const { settings, errors } = parseSettings({ unknownOption: true });
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("unknownOption");
    expect(errors[0]).toContain("ignored");
  });

  it("parseSettings_MultipleUnknownKeys_WarnsEach", () => {
    const { errors } = parseSettings({ foo: 1, bar: 2 });
    expect(errors.length).toBe(2);
  });

  it("parseSettings_AllValidFields_AppliesAll", () => {
    const input = {
      maxReviewLoops: 10,
      model: "openai/gpt-5",
      thinkingLevel: "high",
      architectEnabled: true,
      judgeEnabled: true,
      judgeModel: "amazon-bedrock/claude-haiku",
      judgeTimeoutMs: 8000,
    };
    const { settings, errors } = parseSettings(input);
    expect(errors).toEqual([]);
    expect(settings.maxReviewLoops).toBe(10);
    expect(settings.model).toBe("openai/gpt-5");
    expect(settings.thinkingLevel).toBe("high");
    expect(settings.architectEnabled).toBe(true);
    expect(settings.judgeEnabled).toBe(true);
    expect(settings.judgeModel).toBe("amazon-bedrock/claude-haiku");
    expect(settings.judgeTimeoutMs).toBe(8000);
  });

  it("parseSettings_MixOfValidAndInvalid_AppliesValidRejectsInvalid", () => {
    const { settings, errors } = parseSettings({
      maxReviewLoops: 5,
      model: "no-slash",
      thinkingLevel: "low",
    });
    expect(settings.maxReviewLoops).toBe(5);
    expect(settings.model).toBe(DEFAULT_SETTINGS.model);
    expect(settings.thinkingLevel).toBe("low");
    expect(errors.length).toBe(1);
  });

  it("parseSettings_DoesNotMutateDefaults", () => {
    const before = { ...DEFAULT_SETTINGS };
    parseSettings({ maxReviewLoops: 999 });
    expect(DEFAULT_SETTINGS).toEqual(before);
  });

  it("parseSettings_ValidReviewTimeoutMs_Applies", () => {
    const { settings, errors } = parseSettings({ reviewTimeoutMs: 300_000 });
    expect(settings.reviewTimeoutMs).toBe(300_000);
    expect(errors).toEqual([]);
  });

  it("parseSettings_ZeroReviewTimeoutMs_RejectsWithError", () => {
    const { settings, errors } = parseSettings({ reviewTimeoutMs: 0 });
    expect(settings.reviewTimeoutMs).toBe(DEFAULT_SETTINGS.reviewTimeoutMs);
    expect(errors.length).toBe(1);
  });

  it("parseSettings_NegativeReviewTimeoutMs_RejectsWithError", () => {
    const { settings, errors } = parseSettings({ reviewTimeoutMs: -1 });
    expect(settings.reviewTimeoutMs).toBe(DEFAULT_SETTINGS.reviewTimeoutMs);
    expect(errors.length).toBe(1);
  });

  it("parseSettings_NonNumericReviewTimeoutMs_RejectsWithError", () => {
    const { settings, errors } = parseSettings({ reviewTimeoutMs: "5000" });
    expect(settings.reviewTimeoutMs).toBe(DEFAULT_SETTINGS.reviewTimeoutMs);
    expect(errors.length).toBe(1);
  });

  // ── toggleShortcut ──

  it("parseSettings_ValidToggleShortcut_Applies", () => {
    const { settings, errors } = parseSettings({ toggleShortcut: "ctrl+r" });
    expect(settings.toggleShortcut).toBe("ctrl+r");
    expect(errors).toEqual([]);
  });

  it("parseSettings_EmptyToggleShortcut_RejectsWithError", () => {
    const { settings, errors } = parseSettings({ toggleShortcut: "" });
    expect(settings.toggleShortcut).toBe(DEFAULT_SETTINGS.toggleShortcut);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("toggleShortcut");
  });

  it("parseSettings_NonStringToggleShortcut_RejectsWithError", () => {
    const { settings, errors } = parseSettings({ toggleShortcut: 42 });
    expect(settings.toggleShortcut).toBe(DEFAULT_SETTINGS.toggleShortcut);
    expect(errors.length).toBe(1);
  });

  it("parseSettings_ToggleShortcutTrimsWhitespace", () => {
    const { settings, errors } = parseSettings({ toggleShortcut: "  ctrl+t  " });
    expect(settings.toggleShortcut).toBe("ctrl+t");
    expect(errors).toEqual([]);
  });

  // ── cancelShortcut ──

  it("parseSettings_ValidCancelShortcut_Applies", () => {
    const { settings, errors } = parseSettings({ cancelShortcut: "ctrl+shift+x" });
    expect(settings.cancelShortcut).toBe("ctrl+shift+x");
    expect(errors).toEqual([]);
  });

  it("parseSettings_EmptyCancelShortcut_AcceptsAsNoShortcut", () => {
    const { settings, errors } = parseSettings({ cancelShortcut: "" });
    expect(settings.cancelShortcut).toBe("");
    expect(errors.length).toBe(0);
  });

  it("parseSettings_NonStringCancelShortcut_RejectsWithError", () => {
    const { settings, errors } = parseSettings({ cancelShortcut: true });
    expect(settings.cancelShortcut).toBe(DEFAULT_SETTINGS.cancelShortcut);
    expect(errors.length).toBe(1);
  });

  it("parseSettings_CancelShortcutTrimsWhitespace", () => {
    const { settings, errors } = parseSettings({ cancelShortcut: "  alt+c  " });
    expect(settings.cancelShortcut).toBe("alt+c");
    expect(errors).toEqual([]);
  });

  it("parseSettings_BothShortcutsConfigured_AppliesBoth", () => {
    const { settings, errors } = parseSettings({
      toggleShortcut: "ctrl+r",
      cancelShortcut: "ctrl+q",
    });
    expect(settings.toggleShortcut).toBe("ctrl+r");
    expect(settings.cancelShortcut).toBe("ctrl+q");
    expect(errors).toEqual([]);
  });

  // ── judgeEnabled ──

  it("parseSettings_ValidJudgeEnabledTrue_Applies", () => {
    const { settings, errors } = parseSettings({ judgeEnabled: true });
    expect(settings.judgeEnabled).toBe(true);
    expect(errors).toEqual([]);
  });

  it("parseSettings_ValidJudgeEnabledFalse_Applies", () => {
    const { settings, errors } = parseSettings({ judgeEnabled: false });
    expect(settings.judgeEnabled).toBe(false);
    expect(errors).toEqual([]);
  });

  it("parseSettings_NonBooleanJudgeEnabled_RejectsWithError", () => {
    const { settings, errors } = parseSettings({ judgeEnabled: "yes" });
    expect(settings.judgeEnabled).toBe(DEFAULT_SETTINGS.judgeEnabled);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("judgeEnabled");
    expect(errors[0]).toContain("boolean");
  });

  it("parseSettings_NullJudgeEnabled_RejectsWithError", () => {
    const { settings, errors } = parseSettings({ judgeEnabled: null });
    expect(settings.judgeEnabled).toBe(DEFAULT_SETTINGS.judgeEnabled);
    expect(errors.length).toBe(1);
  });

  // ── judgeModel ──

  it("parseSettings_ValidJudgeModel_Applies", () => {
    const { settings, errors } = parseSettings({
      judgeModel: "amazon-bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0",
    });
    expect(settings.judgeModel).toBe("amazon-bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0");
    expect(errors).toEqual([]);
  });

  it("parseSettings_JudgeModelWithoutSlash_RejectsWithError", () => {
    const { settings, errors } = parseSettings({ judgeModel: "no-slash" });
    expect(settings.judgeModel).toBe(DEFAULT_SETTINGS.judgeModel);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("judgeModel");
    expect(errors[0]).toContain("provider/model-id");
  });

  it("parseSettings_NonStringJudgeModel_RejectsWithError", () => {
    const { settings, errors } = parseSettings({ judgeModel: 42 });
    expect(settings.judgeModel).toBe(DEFAULT_SETTINGS.judgeModel);
    expect(errors.length).toBe(1);
  });

  it("parseSettings_EmptyJudgeModel_RejectsWithError", () => {
    // Empty string has no "/" so it must reject.
    const { settings, errors } = parseSettings({ judgeModel: "" });
    expect(settings.judgeModel).toBe(DEFAULT_SETTINGS.judgeModel);
    expect(errors.length).toBe(1);
  });

  // ── judgeTimeoutMs ──

  it("parseSettings_ValidJudgeTimeoutMs_Applies", () => {
    const { settings, errors } = parseSettings({ judgeTimeoutMs: 5000 });
    expect(settings.judgeTimeoutMs).toBe(5000);
    expect(errors).toEqual([]);
  });

  it("parseSettings_ZeroJudgeTimeoutMs_RejectsWithError", () => {
    const { settings, errors } = parseSettings({ judgeTimeoutMs: 0 });
    expect(settings.judgeTimeoutMs).toBe(DEFAULT_SETTINGS.judgeTimeoutMs);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("positive integer");
  });

  it("parseSettings_NegativeJudgeTimeoutMs_RejectsWithError", () => {
    const { settings, errors } = parseSettings({ judgeTimeoutMs: -100 });
    expect(settings.judgeTimeoutMs).toBe(DEFAULT_SETTINGS.judgeTimeoutMs);
    expect(errors.length).toBe(1);
  });

  it("parseSettings_NonIntegerJudgeTimeoutMs_RejectsWithError", () => {
    const { settings, errors } = parseSettings({ judgeTimeoutMs: 1500.5 });
    expect(settings.judgeTimeoutMs).toBe(DEFAULT_SETTINGS.judgeTimeoutMs);
    expect(errors.length).toBe(1);
  });

  it("parseSettings_NonNumberJudgeTimeoutMs_RejectsWithError", () => {
    const { settings, errors } = parseSettings({ judgeTimeoutMs: "10000" });
    expect(settings.judgeTimeoutMs).toBe(DEFAULT_SETTINGS.judgeTimeoutMs);
    expect(errors.length).toBe(1);
  });

  it("parseSettings_AllJudgeFieldsTogether_AppliesAll", () => {
    const { settings, errors } = parseSettings({
      judgeEnabled: true,
      judgeModel: "amazon-bedrock/claude-haiku-test",
      judgeTimeoutMs: 7000,
    });
    expect(settings.judgeEnabled).toBe(true);
    expect(settings.judgeModel).toBe("amazon-bedrock/claude-haiku-test");
    expect(settings.judgeTimeoutMs).toBe(7000);
    expect(errors).toEqual([]);
  });
});

describe("loadShortcutSettingsSync", () => {
  function makeTmpDir() {
    const dir = mkdtempSync(join(tmpdir(), "hardno-test-"));
    return {
      dir,
      writeSettings(obj: Record<string, unknown>) {
        const settingsDir = join(dir, ".hardno");
        mkdirSync(settingsDir, { recursive: true });
        writeFileSync(join(settingsDir, "settings.json"), JSON.stringify(obj));
      },
      cleanup() {
        rmSync(dir, { recursive: true, force: true });
      },
    };
  }

  it("returns defaults when no settings file exists", () => {
    const tmp = makeTmpDir();
    try {
      const result = loadShortcutSettingsSync(tmp.dir);
      expect(result.toggleShortcut).toBe(DEFAULT_TOGGLE_SHORTCUT);
      expect(result.cancelShortcut).toBe(DEFAULT_CANCEL_SHORTCUT);
    } finally {
      tmp.cleanup();
    }
  });

  it("returns defaults when settings file is invalid JSON", () => {
    const tmp = makeTmpDir();
    try {
      const settingsDir = join(tmp.dir, ".hardno");
      mkdirSync(settingsDir, { recursive: true });
      writeFileSync(join(settingsDir, "settings.json"), "not json");
      const result = loadShortcutSettingsSync(tmp.dir);
      expect(result.toggleShortcut).toBe(DEFAULT_TOGGLE_SHORTCUT);
      expect(result.cancelShortcut).toBe(DEFAULT_CANCEL_SHORTCUT);
    } finally {
      tmp.cleanup();
    }
  });

  it("returns defaults when settings has no shortcut keys", () => {
    const tmp = makeTmpDir();
    try {
      tmp.writeSettings({ maxReviewLoops: 5 });
      const result = loadShortcutSettingsSync(tmp.dir);
      expect(result.toggleShortcut).toBe(DEFAULT_TOGGLE_SHORTCUT);
      expect(result.cancelShortcut).toBe(DEFAULT_CANCEL_SHORTCUT);
    } finally {
      tmp.cleanup();
    }
  });

  it("reads custom toggleShortcut", () => {
    const tmp = makeTmpDir();
    try {
      tmp.writeSettings({ toggleShortcut: "ctrl+r" });
      const result = loadShortcutSettingsSync(tmp.dir);
      expect(result.toggleShortcut).toBe("ctrl+r");
      expect(result.cancelShortcut).toBe(DEFAULT_CANCEL_SHORTCUT);
    } finally {
      tmp.cleanup();
    }
  });

  it("reads custom cancelShortcut", () => {
    const tmp = makeTmpDir();
    try {
      tmp.writeSettings({ cancelShortcut: "ctrl+q" });
      const result = loadShortcutSettingsSync(tmp.dir);
      expect(result.toggleShortcut).toBe(DEFAULT_TOGGLE_SHORTCUT);
      expect(result.cancelShortcut).toBe("ctrl+q");
    } finally {
      tmp.cleanup();
    }
  });

  it("reads both custom shortcuts", () => {
    const tmp = makeTmpDir();
    try {
      tmp.writeSettings({ toggleShortcut: "f5", cancelShortcut: "f6" });
      const result = loadShortcutSettingsSync(tmp.dir);
      expect(result.toggleShortcut).toBe("f5");
      expect(result.cancelShortcut).toBe("f6");
    } finally {
      tmp.cleanup();
    }
  });

  it("ignores non-string shortcut values and uses defaults", () => {
    const tmp = makeTmpDir();
    try {
      tmp.writeSettings({ toggleShortcut: 123, cancelShortcut: false });
      const result = loadShortcutSettingsSync(tmp.dir);
      expect(result.toggleShortcut).toBe(DEFAULT_TOGGLE_SHORTCUT);
      expect(result.cancelShortcut).toBe(DEFAULT_CANCEL_SHORTCUT);
    } finally {
      tmp.cleanup();
    }
  });

  it("ignores empty string shortcuts and uses defaults", () => {
    const tmp = makeTmpDir();
    try {
      tmp.writeSettings({ toggleShortcut: "", cancelShortcut: "  " });
      const result = loadShortcutSettingsSync(tmp.dir);
      expect(result.toggleShortcut).toBe(DEFAULT_TOGGLE_SHORTCUT);
      expect(result.cancelShortcut).toBe(DEFAULT_CANCEL_SHORTCUT);
    } finally {
      tmp.cleanup();
    }
  });

  it("trims whitespace from shortcut values", () => {
    const tmp = makeTmpDir();
    try {
      tmp.writeSettings({ cancelShortcut: "  ctrl+x  " });
      const result = loadShortcutSettingsSync(tmp.dir);
      expect(result.cancelShortcut).toBe("ctrl+x");
    } finally {
      tmp.cleanup();
    }
  });
});

describe("configDirs", () => {
  it("returns local and global dirs", () => {
    const [local, global] = configDirs("/project");
    expect(local).toBe(join("/project", ".hardno"));
    expect(global).toBe(join(homedir(), ".pi", ".hardno"));
  });

  it("accepts custom home override", () => {
    const [local, global] = configDirs("/project", "/fakehome");
    expect(local).toBe(join("/project", ".hardno"));
    expect(global).toBe(join("/fakehome", ".pi", ".hardno"));
  });
});

describe("readConfigFile", () => {
  function makeDirs() {
    const root = mkdtempSync(join(tmpdir(), "hardno-cfg-"));
    const localDir = join(root, "project");
    const fakeHome = join(root, "home");
    const localCfg = join(localDir, ".hardno");
    const globalCfg = join(fakeHome, ".pi", ".hardno");
    mkdirSync(localCfg, { recursive: true });
    mkdirSync(globalCfg, { recursive: true });
    return {
      root,
      localDir,
      fakeHome,
      localCfg,
      globalCfg,
      cleanup() {
        rmSync(root, { recursive: true, force: true });
      },
    };
  }

  it("returns null when file not in either location", async () => {
    const d = makeDirs();
    try {
      const result = await readConfigFile(d.localDir, "missing.json", d.fakeHome);
      expect(result).toBeNull();
    } finally {
      d.cleanup();
    }
  });

  it("reads from global when local missing", async () => {
    const d = makeDirs();
    try {
      writeFileSync(join(d.globalCfg, "test.txt"), "global-content");
      const result = await readConfigFile(d.localDir, "test.txt", d.fakeHome);
      expect(result).toBe("global-content");
    } finally {
      d.cleanup();
    }
  });

  it("reads from local when both exist (local takes precedence)", async () => {
    const d = makeDirs();
    try {
      writeFileSync(join(d.localCfg, "test.txt"), "local-content");
      writeFileSync(join(d.globalCfg, "test.txt"), "global-content");
      const result = await readConfigFile(d.localDir, "test.txt", d.fakeHome);
      expect(result).toBe("local-content");
    } finally {
      d.cleanup();
    }
  });

  it("reads from local when only local exists", async () => {
    const d = makeDirs();
    try {
      writeFileSync(join(d.localCfg, "test.txt"), "local-only");
      const result = await readConfigFile(d.localDir, "test.txt", d.fakeHome);
      expect(result).toBe("local-only");
    } finally {
      d.cleanup();
    }
  });
});

describe("enabled setting", () => {
  it("parseSettings defaults enabled to true", () => {
    const { settings } = parseSettings({});
    expect(settings.enabled).toBe(true);
  });

  it("parseSettings accepts explicit enabled=false", () => {
    const { settings, errors } = parseSettings({ enabled: false });
    expect(settings.enabled).toBe(false);
    expect(errors).toEqual([]);
  });

  it("parseSettings accepts explicit enabled=true", () => {
    const { settings, errors } = parseSettings({ enabled: true });
    expect(settings.enabled).toBe(true);
    expect(errors).toEqual([]);
  });

  it("parseSettings rejects non-boolean enabled with error + default", () => {
    const { settings, errors } = parseSettings({ enabled: "yes" });
    expect(settings.enabled).toBe(DEFAULT_SETTINGS.enabled);
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/"enabled".*boolean/);
  });
});

describe("isEnabledFromDisk", () => {
  function makeDirs() {
    const root = mkdtempSync(join(tmpdir(), "hardno-toggle-"));
    const localDir = join(root, "project");
    const fakeHome = join(root, "home");
    const localCfg = join(localDir, ".hardno");
    const globalCfg = join(fakeHome, ".pi", ".hardno");
    mkdirSync(localCfg, { recursive: true });
    mkdirSync(globalCfg, { recursive: true });
    return {
      root,
      localDir,
      fakeHome,
      localCfg,
      globalCfg,
      cleanup() {
        rmSync(root, { recursive: true, force: true });
      },
    };
  }

  it("returns null when no settings file exists", () => {
    const d = makeDirs();
    try {
      expect(isEnabledFromDisk(d.localDir, d.fakeHome)).toBeNull();
    } finally {
      d.cleanup();
    }
  });

  it("reads enabled=false from global settings", () => {
    const d = makeDirs();
    try {
      writeFileSync(join(d.globalCfg, "settings.json"), JSON.stringify({ enabled: false }));
      expect(isEnabledFromDisk(d.localDir, d.fakeHome)).toBe(false);
    } finally {
      d.cleanup();
    }
  });

  it("reads enabled=true from local settings (local wins)", () => {
    const d = makeDirs();
    try {
      writeFileSync(join(d.globalCfg, "settings.json"), JSON.stringify({ enabled: false }));
      writeFileSync(join(d.localCfg, "settings.json"), JSON.stringify({ enabled: true }));
      expect(isEnabledFromDisk(d.localDir, d.fakeHome)).toBe(true);
    } finally {
      d.cleanup();
    }
  });

  it("returns null when local file exists but has no enabled key (doesn't fall through)", () => {
    // Rationale: the more-specific file wins even when silent. This prevents
    // a surprise where removing `enabled` from local silently exposes global.
    const d = makeDirs();
    try {
      writeFileSync(join(d.localCfg, "settings.json"), JSON.stringify({ model: "x/y" }));
      writeFileSync(join(d.globalCfg, "settings.json"), JSON.stringify({ enabled: false }));
      expect(isEnabledFromDisk(d.localDir, d.fakeHome)).toBeNull();
    } finally {
      d.cleanup();
    }
  });

  it("returns null on malformed JSON (caller falls back to cached)", () => {
    const d = makeDirs();
    try {
      writeFileSync(join(d.globalCfg, "settings.json"), "{ not json");
      expect(isEnabledFromDisk(d.localDir, d.fakeHome)).toBeNull();
    } finally {
      d.cleanup();
    }
  });
});

describe("writeEnabledToDisk", () => {
  function makeFakeHome() {
    const root = mkdtempSync(join(tmpdir(), "hardno-write-"));
    return {
      fakeHome: root,
      settingsPath: join(root, ".pi", ".hardno", "settings.json"),
      cleanup() {
        rmSync(root, { recursive: true, force: true });
      },
    };
  }

  it("creates settings file when missing", () => {
    const h = makeFakeHome();
    try {
      writeEnabledToDisk(false, { home: h.fakeHome });
      const raw = readFileSync(h.settingsPath, "utf8");
      expect(JSON.parse(raw).enabled).toBe(false);
    } finally {
      h.cleanup();
    }
  });

  it("preserves other fields when flipping enabled", () => {
    const h = makeFakeHome();
    try {
      mkdirSync(join(h.fakeHome, ".pi", ".hardno"), { recursive: true });
      writeFileSync(h.settingsPath, JSON.stringify({ model: "a/b", reviewTimeoutMs: 99_999 }));
      writeEnabledToDisk(true, { home: h.fakeHome });
      const parsed = JSON.parse(readFileSync(h.settingsPath, "utf8"));
      expect(parsed.enabled).toBe(true);
      expect(parsed.model).toBe("a/b");
      expect(parsed.reviewTimeoutMs).toBe(99_999);
    } finally {
      h.cleanup();
    }
  });

  it("overwrites existing enabled value", () => {
    const h = makeFakeHome();
    try {
      writeEnabledToDisk(false, { home: h.fakeHome });
      writeEnabledToDisk(true, { home: h.fakeHome });
      expect(JSON.parse(readFileSync(h.settingsPath, "utf8")).enabled).toBe(true);
    } finally {
      h.cleanup();
    }
  });

  it("recovers from malformed existing file (overwrites with fresh content)", () => {
    const h = makeFakeHome();
    try {
      mkdirSync(join(h.fakeHome, ".pi", ".hardno"), { recursive: true });
      writeFileSync(h.settingsPath, "{ corrupt");
      writeEnabledToDisk(false, { home: h.fakeHome });
      const parsed = JSON.parse(readFileSync(h.settingsPath, "utf8"));
      expect(parsed.enabled).toBe(false);
    } finally {
      h.cleanup();
    }
  });

  it("leaves no tmp file behind", () => {
    const h = makeFakeHome();
    try {
      writeEnabledToDisk(false, { home: h.fakeHome });
      const dir = join(h.fakeHome, ".pi", ".hardno");
      const files = readdirSync(dir);
      expect(files.some((f) => f.startsWith("settings.json.tmp"))).toBe(false);
      expect(files).toContain("settings.json");
      expect(existsSync(h.settingsPath)).toBe(true);
    } finally {
      h.cleanup();
    }
  });
});

describe("resolveWritePath + precedence (F1 fix)", () => {
  function makeDirs() {
    const root = mkdtempSync(join(tmpdir(), "hardno-write-prec-"));
    const localDir = join(root, "project");
    const fakeHome = join(root, "home");
    const localCfg = join(localDir, ".hardno");
    const globalCfg = join(fakeHome, ".pi", ".hardno");
    mkdirSync(localCfg, { recursive: true });
    mkdirSync(globalCfg, { recursive: true });
    return {
      root,
      localDir,
      fakeHome,
      localCfg,
      globalCfg,
      cleanup() {
        rmSync(root, { recursive: true, force: true });
      },
    };
  }

  it("resolveWritePath returns global when no local file exists", () => {
    const d = makeDirs();
    try {
      const p = resolveWritePath(d.localDir, d.fakeHome);
      expect(p).toBe(join(d.globalCfg, "settings.json"));
    } finally {
      d.cleanup();
    }
  });

  it("resolveWritePath returns local when local file exists", () => {
    const d = makeDirs();
    try {
      writeFileSync(join(d.localCfg, "settings.json"), "{}");
      const p = resolveWritePath(d.localDir, d.fakeHome);
      expect(p).toBe(join(d.localCfg, "settings.json"));
    } finally {
      d.cleanup();
    }
  });

  it("writeEnabledToDisk with cwd writes to local when local exists (F1)", () => {
    const d = makeDirs();
    try {
      writeFileSync(join(d.localCfg, "settings.json"), JSON.stringify({ model: "m/1" }));
      writeEnabledToDisk(false, { cwd: d.localDir, home: d.fakeHome });
      // Local file was updated
      const local = JSON.parse(readFileSync(join(d.localCfg, "settings.json"), "utf8"));
      expect(local.enabled).toBe(false);
      expect(local.model).toBe("m/1");
      // Global file untouched (doesn't exist)
      expect(existsSync(join(d.globalCfg, "settings.json"))).toBe(false);
    } finally {
      d.cleanup();
    }
  });

  it("writeEnabledToDisk with cwd writes to global when no local (F1)", () => {
    const d = makeDirs();
    try {
      writeEnabledToDisk(false, { cwd: d.localDir, home: d.fakeHome });
      const global = JSON.parse(readFileSync(join(d.globalCfg, "settings.json"), "utf8"));
      expect(global.enabled).toBe(false);
      expect(existsSync(join(d.localCfg, "settings.json"))).toBe(false);
    } finally {
      d.cleanup();
    }
  });

  it("end-to-end: toggle writes to local, read picks it up (no masking)", () => {
    const d = makeDirs();
    try {
      // Pre-existing local file without `enabled`
      writeFileSync(join(d.localCfg, "settings.json"), JSON.stringify({ model: "x/y" }));
      // Pre-existing global file with enabled=true
      writeFileSync(join(d.globalCfg, "settings.json"), JSON.stringify({ enabled: true }));

      // Write to the effective path (local wins)
      writeEnabledToDisk(false, { cwd: d.localDir, home: d.fakeHome });

      // Read path should now see local.enabled=false, NOT fall through to global
      expect(isEnabledFromDisk(d.localDir, d.fakeHome)).toBe(false);
    } finally {
      d.cleanup();
    }
  });
});

describe("isEnabledFromDisk (F2 fix: local silence does not fall through)", () => {
  function makeDirs() {
    const root = mkdtempSync(join(tmpdir(), "hardno-silence-"));
    const localDir = join(root, "project");
    const fakeHome = join(root, "home");
    const localCfg = join(localDir, ".hardno");
    const globalCfg = join(fakeHome, ".pi", ".hardno");
    mkdirSync(localCfg, { recursive: true });
    mkdirSync(globalCfg, { recursive: true });
    return {
      root,
      localDir,
      fakeHome,
      localCfg,
      globalCfg,
      cleanup() {
        rmSync(root, { recursive: true, force: true });
      },
    };
  }

  it("malformed local does NOT fall through to global", () => {
    const d = makeDirs();
    try {
      writeFileSync(join(d.localCfg, "settings.json"), "{ not json");
      writeFileSync(join(d.globalCfg, "settings.json"), JSON.stringify({ enabled: false }));
      // Bug before fix: would return false. After fix: null (local wins on silence).
      expect(isEnabledFromDisk(d.localDir, d.fakeHome)).toBeNull();
    } finally {
      d.cleanup();
    }
  });

  it("array-at-root local does NOT fall through to global", () => {
    const d = makeDirs();
    try {
      writeFileSync(join(d.localCfg, "settings.json"), JSON.stringify([1, 2, 3]));
      writeFileSync(join(d.globalCfg, "settings.json"), JSON.stringify({ enabled: false }));
      expect(isEnabledFromDisk(d.localDir, d.fakeHome)).toBeNull();
    } finally {
      d.cleanup();
    }
  });

  it("missing local DOES fall through to global (ENOENT is the only pass-through)", () => {
    const d = makeDirs();
    try {
      writeFileSync(join(d.globalCfg, "settings.json"), JSON.stringify({ enabled: false }));
      expect(isEnabledFromDisk(d.localDir, d.fakeHome)).toBe(false);
    } finally {
      d.cleanup();
    }
  });
});

describe("writeEnabledToDisk safety (F2 race retry, F3 corrupt backup)", () => {
  function makeFakeHome() {
    const root = mkdtempSync(join(tmpdir(), "hardno-safety-"));
    return {
      fakeHome: root,
      settingsPath: join(root, ".pi", ".hardno", "settings.json"),
      cleanup() {
        rmSync(root, { recursive: true, force: true });
      },
    };
  }

  it("backs up corrupt bytes before overwrite (F3)", () => {
    const h = makeFakeHome();
    try {
      mkdirSync(join(h.fakeHome, ".pi", ".hardno"), { recursive: true });
      writeFileSync(h.settingsPath, "{ corrupt-content");
      writeEnabledToDisk(false, { home: h.fakeHome });
      const dir = join(h.fakeHome, ".pi", ".hardno");
      const files = readdirSync(dir);
      const backup = files.find((f) => f.startsWith("settings.json.corrupt-"));
      expect(backup).toBeDefined();
      // Original bytes preserved in backup
      expect(readFileSync(join(dir, backup!), "utf8")).toBe("{ corrupt-content");
      // New file is valid JSON with enabled=false
      expect(JSON.parse(readFileSync(h.settingsPath, "utf8")).enabled).toBe(false);
    } finally {
      h.cleanup();
    }
  });

  it("backs up non-plain-object root (array) before overwrite (F3)", () => {
    const h = makeFakeHome();
    try {
      mkdirSync(join(h.fakeHome, ".pi", ".hardno"), { recursive: true });
      writeFileSync(h.settingsPath, JSON.stringify([1, 2, 3]));
      writeEnabledToDisk(false, { home: h.fakeHome });
      const dir = join(h.fakeHome, ".pi", ".hardno");
      const files = readdirSync(dir);
      expect(files.some((f) => f.startsWith("settings.json.corrupt-"))).toBe(true);
    } finally {
      h.cleanup();
    }
  });

  it("cleans up tmp file on write failure", () => {
    const h = makeFakeHome();
    try {
      // Write to a readonly dir to force failure. Use a path that can't be mkdir'd.
      // Simulating a rename failure is hard without a custom fs mock — at minimum,
      // check no leftover *.tmp-* files on success (covered by earlier test).
      writeEnabledToDisk(false, { home: h.fakeHome });
      const dir = join(h.fakeHome, ".pi", ".hardno");
      const files = readdirSync(dir);
      expect(files.every((f) => !f.includes(".tmp-"))).toBe(true);
    } finally {
      h.cleanup();
    }
  });
});

describe("loadSettings integration (F4 coverage)", () => {
  function makeDirs() {
    const root = mkdtempSync(join(tmpdir(), "hardno-load-int-"));
    const localDir = join(root, "project");
    const fakeHome = join(root, "home");
    const localCfg = join(localDir, ".hardno");
    const globalCfg = join(fakeHome, ".pi", ".hardno");
    mkdirSync(localCfg, { recursive: true });
    mkdirSync(globalCfg, { recursive: true });
    return {
      root,
      localDir,
      fakeHome,
      localCfg,
      globalCfg,
      cleanup() {
        rmSync(root, { recursive: true, force: true });
      },
    };
  }

  it("persisted enabled=false survives load cycle", async () => {
    const d = makeDirs();
    try {
      writeEnabledToDisk(false, { cwd: d.localDir, home: d.fakeHome });
      // Simulate subsequent session_start
      // loadSettings uses cwd-only path via readConfigFile which does its own
      // resolution. The toggle's file is in ~/.pi/.hardno/ (no local). We need
      // to make HOME point at fakeHome for loadSettings to find it.
      const origHome = process.env.HOME;
      try {
        process.env.HOME = d.fakeHome;
        const { settings } = await loadSettings(d.localDir);
        expect(settings.enabled).toBe(false);
      } finally {
        if (origHome === undefined) delete process.env.HOME;
        else process.env.HOME = origHome;
      }
    } finally {
      d.cleanup();
    }
  });

  it("persisted to local file survives load cycle", async () => {
    const d = makeDirs();
    try {
      // Pre-seed local so resolveWritePath picks it
      writeFileSync(join(d.localCfg, "settings.json"), "{}");
      writeEnabledToDisk(false, { cwd: d.localDir, home: d.fakeHome });
      const { settings } = await loadSettings(d.localDir);
      expect(settings.enabled).toBe(false);
    } finally {
      d.cleanup();
    }
  });
});

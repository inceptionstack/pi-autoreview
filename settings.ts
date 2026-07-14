/**
 * settings.ts — Configuration loading and validation
 *
 * Loads config from .hardno/ in two locations (local takes precedence):
 *   1. cwd/.hardno/   (project-local)
 *   2. ~/.pi/.hardno/ (global)
 *
 * Files: settings.json, review-rules.md
 */

import { readFile } from "node:fs/promises";
import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  existsSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

/**
 * Resolve the .hardno config directory paths.
 * Returns [local, global] where local = cwd/.hardno, global = ~/.pi/.hardno.
 * Local takes precedence over global.
 */
export function configDirs(cwd: string, home?: string): [string, string] {
  return [join(cwd, ".hardno"), join(home ?? homedir(), ".pi", ".hardno")];
}

/**
 * Read a config file, trying local (cwd/.hardno/) first, then global (~/.pi/.hardno/).
 * Returns the file content or null if not found in either location.
 */
export async function readConfigFile(
  cwd: string,
  filename: string,
  home?: string,
): Promise<string | null> {
  for (const dir of configDirs(cwd, home)) {
    try {
      return await readFile(join(dir, filename), "utf8");
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Synchronous version of readConfigFile for init-time use.
 */
function readConfigFileSync(cwd: string, filename: string): string | null {
  for (const dir of configDirs(cwd)) {
    try {
      return readFileSync(join(dir, filename), "utf8");
    } catch {
      /* try next */
    }
  }
  return null;
}

// ── Types ────────────────────────────────────────────

export interface AutoReviewSettings {
  /** Master on/off switch for auto-review. Persisted across sessions.
   * Re-read from disk at each agent_end so external tools (e.g. roundhouse's
   * /toggle-review) can flip it without restarting the session. */
  enabled: boolean;
  maxReviewLoops: number;
  model: string; // "provider/model-id" e.g. "amazon-bedrock/us.meta.llama4-maverick-17b-instruct-v1:0"
  thinkingLevel: string; // "off" | "minimal" | "low" | "medium" | "high" | "xhigh"
  architectEnabled: boolean;
  reviewTimeoutMs: number; // Max wall-clock for a single review (default 120s)
  toggleShortcut: string; // Key id for toggling review on/off (default "alt+r")
  cancelShortcut: string; // Key id for cancelling in-progress review (default: none — use /cancel-review)
  /** Duplicate-review suppressor ("judge") — see judge.ts. Off by default so
   *  users opt in. When enabled and all bash commands in a turn classify as
   *  read-only, the auto-review is skipped entirely. */
  judgeEnabled: boolean;
  /** Model used by the judge. Chosen from `eval/RESULTS.md`. */
  judgeModel: string;
  /** Max wall-clock per judge classification call (default 10s). */
  judgeTimeoutMs: number;
}

/** Shortcut-only settings loaded synchronously at init (before session_start). */
export interface ShortcutSettings {
  toggleShortcut: string;
  cancelShortcut: string;
}

export const DEFAULT_TOGGLE_SHORTCUT = "alt+r";
export const DEFAULT_CANCEL_SHORTCUT = ""; // no default shortcut — use /cancel-review command

export const DEFAULT_SETTINGS: AutoReviewSettings = {
  enabled: true,
  maxReviewLoops: 100,
  model: "amazon-bedrock/us.meta.llama4-maverick-17b-instruct-v1:0",
  thinkingLevel: "off",
  architectEnabled: true, // triggers when >1 file reviewed
  reviewTimeoutMs: 120_000,
  toggleShortcut: DEFAULT_TOGGLE_SHORTCUT,
  cancelShortcut: DEFAULT_CANCEL_SHORTCUT,
  judgeEnabled: false,
  judgeModel: "amazon-bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0",
  judgeTimeoutMs: 10_000,
};

export const VALID_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"];

// ── Parsing ──────────────────────────────────────────

/**
 * Parse and validate a raw settings object against the schema.
 * Pure function — no I/O. Returns validated settings + any errors.
 */
export function parseSettings(parsed: Record<string, unknown>): {
  settings: AutoReviewSettings;
  errors: string[];
} {
  const errors: string[] = [];
  const settings = { ...DEFAULT_SETTINGS };

  if ("enabled" in parsed) {
    if (typeof parsed.enabled === "boolean") {
      settings.enabled = parsed.enabled;
    } else {
      errors.push(
        `[hard-no] "enabled" must be a boolean (got ${JSON.stringify(parsed.enabled)}). Using default: ${DEFAULT_SETTINGS.enabled}.`,
      );
    }
  }

  if ("maxReviewLoops" in parsed) {
    if (
      typeof parsed.maxReviewLoops === "number" &&
      Number.isInteger(parsed.maxReviewLoops) &&
      parsed.maxReviewLoops > 0
    ) {
      settings.maxReviewLoops = parsed.maxReviewLoops;
    } else {
      errors.push(
        `[hard-no] "maxReviewLoops" must be a positive integer (got ${JSON.stringify(parsed.maxReviewLoops)}). Using default: ${DEFAULT_SETTINGS.maxReviewLoops}.`,
      );
    }
  }

  if ("model" in parsed) {
    if (typeof parsed.model === "string" && parsed.model.includes("/")) {
      settings.model = parsed.model;
    } else {
      errors.push(
        `[hard-no] "model" must be "provider/model-id" (got ${JSON.stringify(parsed.model)}). Using default: ${DEFAULT_SETTINGS.model}.`,
      );
    }
  }

  if ("thinkingLevel" in parsed) {
    if (
      typeof parsed.thinkingLevel === "string" &&
      VALID_THINKING_LEVELS.includes(parsed.thinkingLevel)
    ) {
      settings.thinkingLevel = parsed.thinkingLevel;
    } else {
      errors.push(
        `[hard-no] "thinkingLevel" must be one of ${VALID_THINKING_LEVELS.join(", ")} (got ${JSON.stringify(parsed.thinkingLevel)}). Using default: ${DEFAULT_SETTINGS.thinkingLevel}.`,
      );
    }
  }

  if ("architectEnabled" in parsed) {
    if (typeof parsed.architectEnabled === "boolean") {
      settings.architectEnabled = parsed.architectEnabled;
    } else {
      errors.push(
        `[hard-no] "architectEnabled" must be a boolean (got ${JSON.stringify(parsed.architectEnabled)}). Using default: ${DEFAULT_SETTINGS.architectEnabled}.`,
      );
    }
  }

  // Backwards compat: accept old "roundupEnabled" if "architectEnabled" not set
  if (!("architectEnabled" in parsed) && "roundupEnabled" in parsed) {
    if (typeof parsed.roundupEnabled === "boolean") {
      settings.architectEnabled = parsed.roundupEnabled;
    } else {
      errors.push(
        `[hard-no] "roundupEnabled" must be a boolean (got ${JSON.stringify(parsed.roundupEnabled)}). Using default: ${DEFAULT_SETTINGS.architectEnabled}.`,
      );
    }
  }

  if ("reviewTimeoutMs" in parsed) {
    if (
      typeof parsed.reviewTimeoutMs === "number" &&
      Number.isInteger(parsed.reviewTimeoutMs) &&
      parsed.reviewTimeoutMs > 0
    ) {
      settings.reviewTimeoutMs = parsed.reviewTimeoutMs;
    } else {
      errors.push(
        `[hard-no] "reviewTimeoutMs" must be a positive integer (got ${JSON.stringify(parsed.reviewTimeoutMs)}). Using default: ${DEFAULT_SETTINGS.reviewTimeoutMs}.`,
      );
    }
  }

  if ("toggleShortcut" in parsed) {
    if (typeof parsed.toggleShortcut === "string" && parsed.toggleShortcut.trim()) {
      settings.toggleShortcut = parsed.toggleShortcut.trim();
    } else {
      errors.push(
        `[hard-no] "toggleShortcut" must be a non-empty string key id (got ${JSON.stringify(parsed.toggleShortcut)}). Using default: ${DEFAULT_SETTINGS.toggleShortcut}.`,
      );
    }
  }

  if ("cancelShortcut" in parsed) {
    if (typeof parsed.cancelShortcut === "string") {
      // Empty string is valid — means "no shortcut" (use /cancel-review command instead)
      settings.cancelShortcut = parsed.cancelShortcut.trim();
    } else {
      errors.push(
        `[hard-no] "cancelShortcut" must be a string key id (got ${JSON.stringify(parsed.cancelShortcut)}). Using default: ${DEFAULT_SETTINGS.cancelShortcut}.`,
      );
    }
  }

  if ("judgeEnabled" in parsed) {
    if (typeof parsed.judgeEnabled === "boolean") {
      settings.judgeEnabled = parsed.judgeEnabled;
    } else {
      errors.push(
        `[hard-no] "judgeEnabled" must be a boolean (got ${JSON.stringify(parsed.judgeEnabled)}). Using default: ${DEFAULT_SETTINGS.judgeEnabled}.`,
      );
    }
  }

  if ("judgeModel" in parsed) {
    if (typeof parsed.judgeModel === "string" && parsed.judgeModel.includes("/")) {
      settings.judgeModel = parsed.judgeModel;
    } else {
      errors.push(
        `[hard-no] "judgeModel" must be "provider/model-id" (got ${JSON.stringify(parsed.judgeModel)}). Using default: ${DEFAULT_SETTINGS.judgeModel}.`,
      );
    }
  }

  if ("judgeTimeoutMs" in parsed) {
    if (
      typeof parsed.judgeTimeoutMs === "number" &&
      Number.isInteger(parsed.judgeTimeoutMs) &&
      parsed.judgeTimeoutMs > 0
    ) {
      settings.judgeTimeoutMs = parsed.judgeTimeoutMs;
    } else {
      errors.push(
        `[hard-no] "judgeTimeoutMs" must be a positive integer (got ${JSON.stringify(parsed.judgeTimeoutMs)}). Using default: ${DEFAULT_SETTINGS.judgeTimeoutMs}.`,
      );
    }
  }

  const knownKeys = new Set(Object.keys(DEFAULT_SETTINGS));
  // Accept legacy "roundupEnabled" without warning
  knownKeys.add("roundupEnabled");
  for (const key of Object.keys(parsed)) {
    if (!knownKeys.has(key)) {
      errors.push(
        `[hard-no] Unknown setting "${key}" (ignored). Known: ${[...knownKeys].join(", ")}.`,
      );
    }
  }

  return { settings, errors };
}

// ── File loaders ─────────────────────────────────────

/**
 * Load and validate .hardno/settings.json.
 * Tries cwd/.hardno/ first, then ~/.pi/.hardno/.
 */
export async function loadSettings(
  cwd: string,
): Promise<{ settings: AutoReviewSettings; errors: string[] }> {
  const errors: string[] = [];

  const raw = await readConfigFile(cwd, "settings.json");
  if (raw === null) return { settings: { ...DEFAULT_SETTINGS }, errors };

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (e: any) {
    errors.push(`[hard-no] .hardno/settings.json is not valid JSON: ${e.message}. Using defaults.`);
    return { settings: { ...DEFAULT_SETTINGS }, errors };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    errors.push(`[hard-no] .hardno/settings.json must be a JSON object. Using defaults.`);
    return { settings: { ...DEFAULT_SETTINGS }, errors };
  }

  const result = parseSettings(parsed);
  return { settings: result.settings, errors: [...errors, ...result.errors] };
}

/**
 * Synchronously load shortcut settings from .hardno/settings.json.
 * Tries cwd/.hardno/ first, then ~/.pi/.hardno/.
 * Used at extension init time (before session_start) for shortcut registration.
 * Falls back to defaults on any error — never throws.
 */
export function loadShortcutSettingsSync(cwd: string): ShortcutSettings {
  const defaults: ShortcutSettings = {
    toggleShortcut: DEFAULT_TOGGLE_SHORTCUT,
    cancelShortcut: DEFAULT_CANCEL_SHORTCUT,
  };
  try {
    const raw = readConfigFileSync(cwd, "settings.json");
    if (raw === null) return defaults;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return defaults;
    if (typeof parsed.toggleShortcut === "string" && parsed.toggleShortcut.trim()) {
      defaults.toggleShortcut = parsed.toggleShortcut.trim();
    }
    if (typeof parsed.cancelShortcut === "string" && parsed.cancelShortcut.trim()) {
      defaults.cancelShortcut = parsed.cancelShortcut.trim();
    }
  } catch {
    /* bad JSON — use defaults */
  }
  return defaults;
}

/**
 * Load .hardno/review-rules.md custom review rules.
 * Tries cwd/.hardno/ first, then ~/.pi/.hardno/.
 */
export async function loadReviewRules(cwd: string): Promise<string | null> {
  const content = await readConfigFile(cwd, "review-rules.md");
  return content?.trim() || null;
}

/**
 * Load .hardno/auto-review.md — overrides the "what to review / what not to report"
 * section of the review prompt. Returns null if not found (uses built-in defaults).
 * Tries cwd/.hardno/ first, then ~/.pi/.hardno/.
 */
export async function loadAutoReviewRules(cwd: string): Promise<string | null> {
  const content = await readConfigFile(cwd, "auto-review.md");
  return content?.trim() || null;
}

// ── Runtime on/off toggle ──────────────────────────────

/**
 * Fast synchronous read of just the `enabled` field from settings.json.
 * Called on each agent_end to pick up toggles made by external tools (e.g.
 * `roundhouse` `/toggle-review`) without restarting the session.
 *
 * Local (.hardno/settings.json in cwd) takes precedence over global
 * (~/.pi/.hardno/settings.json).
 *
 * Semantics: local "wins on silence" too — if the local file exists but is
 * missing/malformed/unreadable (anything except ENOENT), we do NOT fall
 * through to global. This prevents a surprise where corrupting local silently
 * exposes a different global value.
 */
export function isEnabledFromDisk(cwd: string, home?: string): boolean | null {
  for (const dir of configDirs(cwd, home)) {
    const path = join(dir, "settings.json");
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (err: any) {
      // Only fall through on ENOENT. Permission errors, IO errors, etc. should
      // halt resolution — if the more-specific file exists but we can't read
      // it, we shouldn't silently fall through to the less-specific file.
      if (err?.code === "ENOENT") continue;
      return null;
    }
    // File exists: parse once; any failure/shape-mismatch = return null WITHOUT
    // falling through (local wins on silence / corruption).
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        if (typeof parsed.enabled === "boolean") return parsed.enabled;
      }
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Resolve which settings.json path to *write* to for persisting the `enabled`
 * flag. Matches the read-resolution path used by loadSettings / isEnabledFromDisk:
 *   - If local (cwd/.hardno/settings.json) exists, write there (local wins).
 *   - Otherwise, write to global (~/.pi/.hardno/settings.json).
 *
 * This prevents the "toggle appears to revert" bug where writing global
 * gets masked by a local file that the read path loads first.
 */
export function resolveWritePath(cwd: string, home?: string): string {
  const [localDir, globalDir] = configDirs(cwd, home);
  const localPath = join(localDir, "settings.json");
  if (existsSync(localPath)) return localPath;
  return join(globalDir, "settings.json");
}

/**
 * Persist `enabled: boolean` to the settings file selected by resolveWritePath.
 * Atomic tmp+rename; preserves other fields. Creates the file/dir if missing.
 *
 * Race handling: does a read-modify-write with a small retry window. If the
 * file mtime changes between our read and our intended rename, we re-read,
 * re-apply `enabled`, and retry (up to 3 attempts). Eliminates the common
 * case where an external writer (e.g. roundhouse) flips a different field
 * concurrently.
 *
 * Before overwriting a non-plain-object or malformed file (rare; usually
 * means another tool wrote garbage), we back up the original bytes to
 * <settings>.corrupt-<ts>.bak so user data isn't silently discarded.
 */
export function writeEnabledToDisk(
  enabled: boolean,
  opts: { cwd?: string; home?: string; targetPath?: string } = {},
): void {
  const home = opts.home ?? homedir();
  // Explicit targetPath wins (useful for tests); otherwise resolve via cwd.
  const target =
    opts.targetPath ??
    (opts.cwd ? resolveWritePath(opts.cwd, home) : join(home, ".pi", ".hardno", "settings.json"));
  const dir = dirname(target);

  const MAX_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Read existing (preserve other fields)
    let existing: Record<string, unknown> = {};
    let wasMalformed = false;
    let rawBytes: string | null = null;
    let readMtime: number | null = null;
    try {
      rawBytes = readFileSync(target, "utf8");
      readMtime = statSync(target).mtimeMs;
      const parsed = JSON.parse(rawBytes);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      } else {
        wasMalformed = true; // valid JSON but wrong shape (array / scalar)
      }
    } catch (err: any) {
      if (err?.code !== "ENOENT") wasMalformed = true;
      // else: file missing, start fresh
    }

    // Safety: if the existing file had bytes we can't safely merge into,
    // back them up before overwrite so user data isn't silently lost.
    if (wasMalformed && rawBytes !== null) {
      try {
        const backup = `${target}.corrupt-${Date.now()}.bak`;
        writeFileSync(backup, rawBytes, { encoding: "utf8" });
      } catch {
        /* best-effort only */
      }
    }

    existing.enabled = enabled;

    // Atomic write: tmp + rename in the same directory.
    mkdirSync(dir, { recursive: true });
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${attempt}`;
    try {
      writeFileSync(tmp, JSON.stringify(existing, null, 2) + "\n", { encoding: "utf8" });

      // Race check: if the file's mtime changed after our read, someone else
      // wrote between our read and our rename. Discard our tmp and retry so
      // we don't clobber their edits to other fields.
      if (readMtime !== null && attempt < MAX_ATTEMPTS) {
        try {
          const currentMtime = statSync(target).mtimeMs;
          if (currentMtime !== readMtime) {
            try {
              unlinkSync(tmp);
            } catch {
              /* ignore */
            }
            continue;
          }
        } catch {
          /* stat failed — fall through to rename */
        }
      }

      renameSync(tmp, target);
      return;
    } catch (err) {
      // Clean up orphan tmp on any failure so we don't leave garbage behind.
      try {
        unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      throw err;
    }
  }
}

/**
 * logger.ts — File logger for pi-autoreview
 *
 * Writes timestamped log lines to ~/.pi/.autoreview/review.log
 * Uses sync writes to guarantee output even in complex async flows.
 * Rotates when file exceeds 1MB.
 */

import { appendFileSync, mkdirSync, statSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const LOG_DIR = join(homedir(), ".pi", ".autoreview");
const LOG_FILE = join(LOG_DIR, "review.log");
const LOG_OLD = join(LOG_DIR, "review.log.old");
const MAX_LOG_SIZE = 1_000_000; // 1MB

let initialized = false;

function ensureDir() {
  if (initialized) return;
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    initialized = true;
  } catch {
    // best effort
  }
}

function maybeRotate() {
  try {
    const s = statSync(LOG_FILE);
    if (s.size > MAX_LOG_SIZE) {
      try { renameSync(LOG_FILE, LOG_OLD); } catch { /* ok */ }
    }
  } catch {
    // file doesn't exist yet
  }
}

function ts(): string {
  return new Date().toISOString();
}

export function log(...args: any[]) {
  ensureDir();
  const line = `[${ts()}] ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}\n`;
  try {
    appendFileSync(LOG_FILE, line);
  } catch {
    // best effort
  }
}

/** Log and also rotate if needed (call once per review cycle) */
export function logRotate(...args: any[]) {
  maybeRotate();
  log(...args);
}

export { LOG_FILE, LOG_DIR };

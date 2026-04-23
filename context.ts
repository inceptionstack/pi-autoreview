/**
 * context.ts — Build rich review context
 *
 * Gathers: file tree, changed files list, full file contents, git diff.
 * Falls back gracefully when git is unavailable.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateDiff } from "./helpers";
import { filterIgnored } from "./ignore";
import { type TrackedToolCall, buildChangeSummary } from "./changes";

export interface ReviewContext {
  diff: string;
  changedFiles: string[];
  fileContents: Map<string, string>;
  fileTree: string;
}

const MAX_FILE_SIZE = 10_000;
const MAX_TOTAL_CONTENT_SIZE = 60_000;

/**
 * Build full review context from the current working directory.
 * Returns diff, changed file list, their full contents, and project file tree.
 */
export async function buildReviewContext(
  pi: ExtensionAPI,
  onStatus?: (msg: string) => void,
  ignorePatterns?: string[],
): Promise<ReviewContext | null> {
  onStatus?.("getting diff…");

  const fullDiffResult = await pi.exec("git", ["diff", "HEAD"], { timeout: 15000 });
  let diff = fullDiffResult.code === 0 ? fullDiffResult.stdout.trim() : "";

  if (!diff) return null;

  // Get list of changed files
  onStatus?.("listing changed files…");
  const changedResult = await pi.exec("git", ["diff", "HEAD", "--name-only"], { timeout: 5000 });
  let changedFiles =
    changedResult.code === 0 ? changedResult.stdout.trim().split("\n").filter(Boolean) : [];

  // Apply ignore patterns
  if (ignorePatterns && ignorePatterns.length > 0) {
    const before = changedFiles.length;
    changedFiles = filterIgnored(changedFiles, ignorePatterns);
    if (changedFiles.length < before) {
      onStatus?.(`filtered ${before - changedFiles.length} ignored files`);
    }
  }

  if (changedFiles.length === 0) return null;

  // Re-get diff for only non-ignored files if we filtered any out
  if (ignorePatterns && ignorePatterns.length > 0) {
    const filteredDiffResult = await pi.exec("git", ["diff", "HEAD", "--", ...changedFiles], {
      timeout: 15000,
    });
    if (filteredDiffResult.code === 0 && filteredDiffResult.stdout.trim()) {
      diff = filteredDiffResult.stdout.trim();
    }
  }

  // Read full contents of each changed file, respecting total size cap
  const fileContents = new Map<string, string>();
  let totalContentSize = 0;

  for (const file of changedFiles) {
    if (totalContentSize >= MAX_TOTAL_CONTENT_SIZE) {
      fileContents.set(file, "(skipped — total content size limit reached)");
      continue;
    }

    onStatus?.(`reading ${file}…`);
    try {
      // Read working tree version directly
      const readResult = await pi.exec("head", ["-c", String(MAX_FILE_SIZE + 100), file], {
        timeout: 5000,
      });

      if (readResult.code !== 0 || !readResult.stdout) {
        fileContents.set(file, "(could not read — file may be deleted)");
        continue;
      }

      let content = readResult.stdout;
      totalContentSize += content.length; // count pre-truncation size

      if (content.length > MAX_FILE_SIZE) {
        content =
          content.slice(0, MAX_FILE_SIZE) + `\n\n... (truncated, ${content.length} total chars)`;
      }

      fileContents.set(file, content);
    } catch {
      fileContents.set(file, "(could not read — file may be deleted)");
    }
  }

  // Get project file tree (shallow)
  onStatus?.("scanning file tree…");
  const treeResult = await pi.exec(
    "find",
    [
      ".",
      "-maxdepth",
      "3",
      "-not",
      "-path",
      "*/node_modules/*",
      "-not",
      "-path",
      "*/.git/*",
      "-not",
      "-path",
      "*/dist/*",
    ],
    { timeout: 5000 },
  );
  const fileTree = treeResult.code === 0 ? treeResult.stdout.trim() : "(file tree unavailable)";

  return { diff, changedFiles, fileContents, fileTree };
}

/**
 * Format the review context into a prompt section.
 */
export function formatReviewContext(ctx: ReviewContext): string {
  const parts: string[] = [];

  // Changed files summary
  parts.push(`## Changed files (${ctx.changedFiles.length})\n`);
  for (const f of ctx.changedFiles) {
    parts.push(`- ${f}`);
  }

  // Full file contents
  parts.push(`\n## Full file contents\n`);
  for (const [file, content] of ctx.fileContents) {
    parts.push(`### ${file}\n\`\`\`\n${content}\n\`\`\`\n`);
  }

  // Git diff
  parts.push(`## Git diff\n\`\`\`diff\n${truncateDiff(ctx.diff, 30000)}\n\`\`\`\n`);

  // File tree
  parts.push(`## Project file tree (depth 3)\n\`\`\`\n${ctx.fileTree.slice(0, 5000)}\n\`\`\`\n`);

  return parts.join("\n");
}

/**
 * Get the best available review content.
 * Tries: git diff HEAD → git diff HEAD~1 → tool call summaries.
 * Returns the context string for the reviewer prompt, or null if nothing to review.
 */
export async function getBestReviewContent(
  pi: ExtensionAPI,
  agentToolCalls: TrackedToolCall[],
  onStatus?: (msg: string) => void,
  ignorePatterns?: string[],
): Promise<{ content: string; label: string } | null> {
  // 1. Try uncommitted changes (git diff HEAD)
  const reviewContext = await buildReviewContext(pi, onStatus, ignorePatterns);
  if (reviewContext) {
    return { content: formatReviewContext(reviewContext), label: "" };
  }

  // 2. Try last commit (git diff HEAD~1 HEAD)
  onStatus?.("checking last commit…");
  try {
    const lastCommitDiff = await pi.exec("git", ["diff", "HEAD~1", "HEAD"], { timeout: 15000 });
    if (lastCommitDiff.code === 0 && lastCommitDiff.stdout.trim()) {
      const truncated = truncateDiff(lastCommitDiff.stdout.trim(), 30000);
      const commitLog = (
        await pi.exec("git", ["log", "--oneline", "-1"], { timeout: 5000 })
      ).stdout.trim();
      return {
        content: `## Last commit\n${commitLog}\n\n## Diff\n\`\`\`diff\n${truncated}\n\`\`\``,
        label: "last commit",
      };
    }
  } catch {
    // git not available — fall through
  }

  // 3. Fall back to tool call summaries (no git)
  if (agentToolCalls.length > 0) {
    const summary = buildChangeSummary(agentToolCalls);
    if (summary.trim()) {
      return { content: summary, label: "tracked changes" };
    }
  }

  return null;
}

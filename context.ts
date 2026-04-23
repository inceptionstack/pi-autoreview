/**
 * context.ts — Build rich review context
 *
 * Gathers: file tree, changed files list, full file contents, git diff
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateDiff } from "./helpers";

export interface ReviewContext {
  diff: string;
  changedFiles: string[];
  fileContents: Map<string, string>;
  fileTree: string;
}

/**
 * Build full review context from the current working directory.
 * Returns diff, changed file list, their full contents, and project file tree.
 */
export async function buildReviewContext(
  pi: ExtensionAPI,
  onStatus?: (msg: string) => void,
): Promise<ReviewContext | null> {
  onStatus?.("getting diff…");

  const diffResult = await pi.exec("git", ["diff", "HEAD"], { timeout: 15000 });
  const diff = diffResult.code === 0 ? diffResult.stdout.trim() : "";

  if (!diff) return null;

  // Get list of changed files
  onStatus?.("listing changed files…");
  const changedResult = await pi.exec("git", ["diff", "HEAD", "--name-only"], { timeout: 5000 });
  const changedFiles =
    changedResult.code === 0 ? changedResult.stdout.trim().split("\n").filter(Boolean) : [];

  // Read full contents of each changed file
  const fileContents = new Map<string, string>();
  for (const file of changedFiles) {
    onStatus?.(`reading ${file}…`);
    try {
      const readResult = await pi.exec("cat", [file], { timeout: 5000 });
      if (readResult.code === 0) {
        // Limit individual file size to 10k to avoid blowing up context
        const content = readResult.stdout;
        if (content.length > 10000) {
          fileContents.set(
            file,
            content.slice(0, 10000) + `\n\n... (truncated, ${content.length} total chars)`,
          );
        } else {
          fileContents.set(file, content);
        }
      }
    } catch {
      // File might be deleted
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

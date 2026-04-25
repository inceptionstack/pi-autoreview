/**
 * helpers.ts — Extracted pure functions for testability
 */

import { randomBytes } from "node:crypto";

/**
 * Generate a short unique ID for a review cycle.
 * Format: `r-` + 8 lowercase hex chars (32 bits, ~4B possible values).
 * Enough uniqueness for debugging/correlation within a session; not cryptographic.
 */
export function createReviewId(): string {
  return `r-${randomBytes(4).toString("hex")}`;
}

/**
 * Clamp requested commit count to available commits.
 * Returns the effective count and whether it was clamped.
 */
export function clampCommitCount(
  requested: number,
  totalCommits: number,
): { effectiveCount: number; wasClamped: boolean } {
  if (totalCommits <= 0) {
    return { effectiveCount: 0, wasClamped: true };
  }
  const effectiveCount = Math.min(requested, totalCommits);
  return {
    effectiveCount,
    wasClamped: effectiveCount < requested,
  };
}

/**
 * Determine whether to diff against empty tree (all commits)
 * or HEAD~N (partial history).
 */
export function shouldDiffAllCommits(effectiveCount: number, totalCommits: number): boolean {
  return effectiveCount >= totalCommits;
}

/**
 * Truncate a diff string to maxLen, appending a note if truncated.
 */
export function truncateDiff(diff: string, maxLen: number): string {
  if (diff.length <= maxLen) return diff;
  const omitted = diff.length - maxLen;
  return diff.slice(0, maxLen) + `\n\n... (diff truncated, ${omitted} chars omitted)`;
}

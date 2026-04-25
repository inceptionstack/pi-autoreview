import { describe, it, expect, vi } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { formatReviewIdFooter, sendReviewResult } from "../message-sender";
import type { ReviewResult } from "../reviewer";

describe("formatReviewIdFooter", () => {
  it("formatReviewIdFooter_WithId_ReturnsItalicCodeLine", () => {
    expect(formatReviewIdFooter("r-abcdef01")).toBe("\n\n_review-id: `r-abcdef01`_");
  });

  it("formatReviewIdFooter_NoId_ReturnsEmptyString", () => {
    expect(formatReviewIdFooter(undefined)).toBe("");
    expect(formatReviewIdFooter("")).toBe("");
  });
});

function makeResult(
  isLgtm: boolean,
  text = isLgtm ? "LGTM" : "- **High:** missing null check",
): ReviewResult {
  return {
    text,
    rawText: text,
    isLgtm,
    durationMs: 1234,
    toolCalls: [],
    model: "test/model",
    thinkingLevel: "off",
  };
}

function capturePi() {
  const calls: Array<{ message: any; options: any }> = [];
  const pi = {
    sendMessage: vi.fn((message: any, options: any) => {
      calls.push({ message, options });
    }),
  } as unknown as ExtensionAPI;
  return { pi, calls };
}

describe("sendReviewResult — reviewId footer", () => {
  it("sendReviewResult_LgtmWithReviewId_AppendsFooterUnderFiles", () => {
    const { pi, calls } = capturePi();
    sendReviewResult(pi, makeResult(true), "", {
      reviewedFiles: ["src/foo.ts", "src/bar.ts"],
      reviewId: "r-abcdef01",
    });
    expect(calls).toHaveLength(1);
    const content = calls[0].message.content as string;
    // File list and footer both present, in that order
    expect(content).toContain("**Reviewed files:**");
    expect(content).toContain("src/foo.ts");
    expect(content).toContain("_review-id: `r-abcdef01`_");
    const filesIdx = content.indexOf("**Reviewed files:**");
    const idIdx = content.indexOf("_review-id:");
    expect(idIdx).toBeGreaterThan(filesIdx);
  });

  it("sendReviewResult_IssuesWithReviewId_AppendsFooter", () => {
    const { pi, calls } = capturePi();
    sendReviewResult(pi, makeResult(false), "", {
      reviewedFiles: ["src/foo.ts"],
      reviewId: "r-deadbeef",
    });
    expect(calls).toHaveLength(1);
    const content = calls[0].message.content as string;
    expect(content).toContain("_review-id: `r-deadbeef`_");
  });

  it("sendReviewResult_NoReviewedFilesButReviewId_StillIncludesFooter", () => {
    // Issues case with no files — LGTM+zero-files path is intentionally silent, so use issues.
    const { pi, calls } = capturePi();
    sendReviewResult(pi, makeResult(false), "", {
      reviewedFiles: [],
      reviewId: "r-12345678",
    });
    expect(calls).toHaveLength(1);
    const content = calls[0].message.content as string;
    expect(content).not.toContain("**Reviewed files:**");
    expect(content).toContain("_review-id: `r-12345678`_");
  });

  it("sendReviewResult_NoReviewId_OmitsFooterEntirely", () => {
    const { pi, calls } = capturePi();
    sendReviewResult(pi, makeResult(true), "", {
      reviewedFiles: ["src/foo.ts"],
    });
    expect(calls).toHaveLength(1);
    const content = calls[0].message.content as string;
    expect(content).not.toContain("_review-id:");
  });

  it("sendReviewResult_LgtmZeroReviewedFiles_DoesNotSendMessage", () => {
    // Regression: LGTM with empty reviewedFiles is silently skipped; footer should not force a send.
    const { pi, calls } = capturePi();
    sendReviewResult(pi, makeResult(true), "", {
      reviewedFiles: [],
      reviewId: "r-abcdef01",
    });
    expect(calls).toHaveLength(0);
  });
});

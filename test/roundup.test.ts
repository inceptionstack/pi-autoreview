import { describe, it, expect } from "vitest";
import { buildRoundupPrompt, checkRoundupHeuristics } from "../roundup";

describe("buildRoundupPrompt", () => {
  it("buildRoundupPrompt_NoCustomRules_ReturnsDefault", () => {
    const result = buildRoundupPrompt(null);
    expect(result).toContain("senior architect");
    expect(result).toContain("zoom out");
  });

  it("buildRoundupPrompt_WithCustomRules_AppendsRules", () => {
    const result = buildRoundupPrompt("Always check for memory leaks");
    expect(result).toContain("senior architect");
    expect(result).toContain("## Additional project-specific roundup rules");
    expect(result).toContain("Always check for memory leaks");
  });

  it("buildRoundupPrompt_ContainsArchitectureSection", () => {
    const result = buildRoundupPrompt(null);
    expect(result).toContain("Architecture coherence");
  });

  it("buildRoundupPrompt_ContainsCrossFileSection", () => {
    const result = buildRoundupPrompt(null);
    expect(result).toContain("Cross-file consistency");
  });

  it("buildRoundupPrompt_ContainsLGTMFormat", () => {
    const result = buildRoundupPrompt(null);
    expect(result).toContain("LGTM");
  });
});

describe("checkRoundupHeuristics", () => {
  it("skip when peakLoopCount is 0", () => {
    expect(checkRoundupHeuristics({
      changedFiles: ["a.ts", "b.ts", "c.ts", "d.ts"],
      peakLoopCount: 0,
      changeSummaries: ["summary"],
    })).toBe("skip");
  });

  it("skip when fewer than 3 files changed", () => {
    expect(checkRoundupHeuristics({
      changedFiles: ["a.ts", "b.ts"],
      peakLoopCount: 2,
      changeSummaries: ["summary"],
    })).toBe("skip");
  });

  it("skip when only 1 file changed", () => {
    expect(checkRoundupHeuristics({
      changedFiles: ["src/index.ts"],
      peakLoopCount: 3,
      changeSummaries: ["summary"],
    })).toBe("skip");
  });

  it("skip when only test files changed", () => {
    expect(checkRoundupHeuristics({
      changedFiles: ["test/foo.test.ts", "test/bar.spec.ts", "__tests__/baz.ts"],
      peakLoopCount: 2,
      changeSummaries: ["summary"],
    })).toBe("skip");
  });

  it("skip when only __mocks__ and fixtures changed", () => {
    expect(checkRoundupHeuristics({
      changedFiles: ["__mocks__/db.ts", "test/fixtures/data.json", "spec/mocks/api.ts"],
      peakLoopCount: 2,
      changeSummaries: ["summary"],
    })).toBe("skip");
  });

  it("maybe when 3+ non-test files with fix loops", () => {
    expect(checkRoundupHeuristics({
      changedFiles: ["src/a.ts", "src/b.ts", "src/c.ts"],
      peakLoopCount: 1,
      changeSummaries: ["summary"],
    })).toBe("maybe");
  });

  it("maybe when mix of test and non-test files", () => {
    expect(checkRoundupHeuristics({
      changedFiles: ["src/a.ts", "src/b.ts", "src/c.ts", "test/a.test.ts"],
      peakLoopCount: 1,
      changeSummaries: ["summary"],
    })).toBe("maybe");
  });

  it("maybe with many files and high loop count", () => {
    expect(checkRoundupHeuristics({
      changedFiles: Array.from({ length: 10 }, (_, i) => `src/mod${i}.ts`),
      peakLoopCount: 5,
      changeSummaries: ["a", "b", "c"],
    })).toBe("maybe");
  });

  it("skip when 0 files changed", () => {
    expect(checkRoundupHeuristics({
      changedFiles: [],
      peakLoopCount: 2,
      changeSummaries: ["summary"],
    })).toBe("skip");
  });
});

import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { findGitRoot, resolveGitRoots, resolveAllGitRoots } from "../git-roots";

/**
 * Minimal mock of the parts of ExtensionAPI that git-roots uses.
 * Records every exec call and returns canned results.
 */
function makeMockPi(execHandler: (cmd: string, args: string[]) => { code: number; stdout: string; stderr?: string }) {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const pi: any = {
    async exec(cmd: string, args: string[]) {
      calls.push({ cmd, args });
      const r = execHandler(cmd, args);
      return { code: r.code, stdout: r.stdout, stderr: r.stderr ?? "" };
    },
  };
  return { pi, calls };
}

describe("findGitRoot", () => {
  it("findGitRoot_GitSucceeds_ReturnsToplevel", async () => {
    const { pi } = makeMockPi(() => ({ code: 0, stdout: "/home/user/repo\n" }));
    const result = await findGitRoot(pi, "/home/user/repo/src");
    expect(result).toBe("/home/user/repo");
  });

  it("findGitRoot_GitFails_ReturnsNull", async () => {
    const { pi } = makeMockPi(() => ({ code: 128, stdout: "", stderr: "not a git repo" }));
    const result = await findGitRoot(pi, "/tmp");
    expect(result).toBeNull();
  });

  it("findGitRoot_EmptyStdout_ReturnsNull", async () => {
    const { pi } = makeMockPi(() => ({ code: 0, stdout: "   \n" }));
    const result = await findGitRoot(pi, "/tmp");
    expect(result).toBeNull();
  });

  it("findGitRoot_CallsGitWithCFlag", async () => {
    const { pi, calls } = makeMockPi(() => ({ code: 0, stdout: "/repo" }));
    await findGitRoot(pi, "/some/dir");
    expect(calls[0].cmd).toBe("git");
    expect(calls[0].args).toEqual(["-C", "/some/dir", "rev-parse", "--show-toplevel"]);
  });
});

describe("resolveGitRoots", () => {
  it("resolveGitRoots_BashFileOp_Skipped", async () => {
    const { pi, calls } = makeMockPi(() => ({ code: 0, stdout: "/repo" }));
    const files = new Set(["(bash file op)"]);
    const result = await resolveGitRoots(pi, "/cwd", files);
    // Should only call once for cwd fallback, not for "(bash file op)"
    expect(calls.length).toBe(1);
    expect(calls[0].args).toContain("/cwd");
    expect(result.size).toBe(1);
  });

  it("resolveGitRoots_TildeExpansion", async () => {
    const { pi, calls } = makeMockPi(() => ({ code: 0, stdout: "/home/user/repo" }));
    const files = new Set(["~/project/foo.ts"]);
    await resolveGitRoots(pi, "/cwd", files);
    // The -C arg should have ~ expanded to homedir
    const expandedPath = `${homedir()}/project`;
    const hasExpanded = calls.some((c) => c.args.includes(expandedPath));
    expect(hasExpanded).toBe(true);
  });

  it("resolveGitRoots_AbsolutePath_UsedAsIs", async () => {
    const { pi, calls } = makeMockPi(() => ({ code: 0, stdout: "/repo" }));
    const files = new Set(["/abs/path/foo.ts"]);
    await resolveGitRoots(pi, "/cwd", files);
    expect(calls[0].args).toContain("/abs/path");
  });

  it("resolveGitRoots_RelativePath_ResolvedAgainstCwd", async () => {
    const { pi, calls } = makeMockPi(() => ({ code: 0, stdout: "/repo" }));
    const files = new Set(["src/foo.ts"]);
    await resolveGitRoots(pi, "/my/cwd", files);
    expect(calls[0].args).toContain("/my/cwd/src");
  });

  it("resolveGitRoots_FilesInSameRepo_GroupedUnderOneRoot", async () => {
    const { pi } = makeMockPi(() => ({ code: 0, stdout: "/repo" }));
    const files = new Set(["/repo/a.ts", "/repo/b.ts"]);
    const result = await resolveGitRoots(pi, "/cwd", files);
    expect(result.size).toBe(1);
    expect(result.get("/repo")).toEqual(["/repo/a.ts", "/repo/b.ts"]);
  });

  it("resolveGitRoots_NonGitFile_GroupedUnderNoGit", async () => {
    const { pi } = makeMockPi(() => ({ code: 128, stdout: "" }));
    const files = new Set(["/tmp/a.ts"]);
    const result = await resolveGitRoots(pi, "/cwd", files);
    expect(result.get("(no-git)")).toEqual(["/tmp/a.ts"]);
  });

  it("resolveGitRoots_CachesSameDir", async () => {
    let callCount = 0;
    const { pi } = makeMockPi(() => {
      callCount++;
      return { code: 0, stdout: "/repo" };
    });
    const files = new Set(["/repo/src/a.ts", "/repo/src/b.ts"]);
    await resolveGitRoots(pi, "/cwd", files);
    // Same dir, so findGitRoot should only run once
    expect(callCount).toBe(1);
  });

  it("resolveGitRoots_NoFiles_TriesCwdFallback", async () => {
    const { pi, calls } = makeMockPi(() => ({ code: 0, stdout: "/cwd-repo" }));
    const result = await resolveGitRoots(pi, "/cwd", new Set());
    expect(calls.length).toBe(1);
    expect(result.has("/cwd-repo")).toBe(true);
  });
});

describe("resolveAllGitRoots", () => {
  it("resolveAllGitRoots_MergesDetectedAndFileRoots", async () => {
    const { pi } = makeMockPi(() => ({ code: 0, stdout: "/repo-a" }));
    const detected = new Set(["/pre-detected"]);
    const result = await resolveAllGitRoots(pi, "/cwd", new Set(["/repo-a/foo.ts"]), [], detected);
    expect(result.has("/pre-detected")).toBe(true);
    expect(result.has("/repo-a")).toBe(true);
  });

  it("resolveAllGitRoots_CombinesModifiedAndToolCallPaths", async () => {
    const { pi } = makeMockPi((_cmd, args) => {
      // Different paths resolve to different repos
      if (args.includes("/a/src")) return { code: 0, stdout: "/a" };
      if (args.includes("/b/src")) return { code: 0, stdout: "/b" };
      return { code: 128, stdout: "" };
    });
    const result = await resolveAllGitRoots(
      pi, "/cwd",
      new Set(["/a/src/x.ts"]),
      ["/b/src/y.ts"],
      new Set(),
    );
    expect(result.has("/a")).toBe(true);
    expect(result.has("/b")).toBe(true);
  });

  it("resolveAllGitRoots_NoGitGroup_NotIncluded", async () => {
    const { pi } = makeMockPi(() => ({ code: 128, stdout: "" }));
    const result = await resolveAllGitRoots(
      pi, "/cwd",
      new Set(["/tmp/x.ts"]),
      [],
      new Set(),
    );
    expect(result.has("(no-git)")).toBe(false);
  });

  it("resolveAllGitRoots_EmptyInput_ReturnsOnlyCwdRoot", async () => {
    const { pi } = makeMockPi(() => ({ code: 0, stdout: "/cwd-repo" }));
    const result = await resolveAllGitRoots(pi, "/cwd", new Set(), [], new Set());
    expect(result.has("/cwd-repo")).toBe(true);
  });

  it("resolveAllGitRoots_Deduplicates", async () => {
    const { pi } = makeMockPi(() => ({ code: 0, stdout: "/repo" }));
    const result = await resolveAllGitRoots(
      pi, "/cwd",
      new Set(["/repo/a.ts"]),
      ["/repo/b.ts"],
      new Set(["/repo"]),
    );
    // All roads lead to /repo, should only appear once
    expect([...result]).toEqual(["/repo"]);
  });
});

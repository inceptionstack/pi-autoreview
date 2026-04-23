/**
 * changes.ts — Change detection and summary building
 */

export const FILE_MODIFYING_TOOLS = ["write", "edit"];

const MAX_NON_GIT_FILE_SIZE = 100_000;

/** Common binary file extensions to skip */
const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".zip",
  ".gz",
  ".tar",
  ".bz2",
  ".7z",
  ".rar",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".mp3",
  ".mp4",
  ".avi",
  ".mov",
  ".wav",
  ".pyc",
  ".class",
  ".o",
  ".obj",
  ".wasm",
  ".sqlite",
  ".db",
]);

/**
 * Check if a file path looks like a binary file.
 */
export function isBinaryPath(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

export interface TrackedToolCall {
  name: string;
  input: any;
  result?: string;
}

/**
 * Check if any tool calls include file modifications.
 * Any bash command is conservatively treated as file-modifying.
 */
export function hasFileChanges(toolCalls: TrackedToolCall[]): boolean {
  return toolCalls.some((tc) => FILE_MODIFYING_TOOLS.includes(tc.name) || tc.name === "bash");
}

/**
 * Check if a single tool call modifies files.
 * Any bash command is conservatively treated as file-modifying.
 * The reviewer checks git diff and skips if nothing actually changed.
 */
export function isFileModifyingTool(toolName: string): boolean {
  return FILE_MODIFYING_TOOLS.includes(toolName) || toolName === "bash";
}

/**
 * Extract potential file paths from a bash command string.
 * Best-effort: catches common patterns like redirections, common tools.
 */
export function extractPathsFromBashCommand(command: string): string[] {
  const paths: string[] = [];

  // Match quoted or unquoted file paths (absolute or relative)
  // Patterns: > file, >> file, tool file, cp/mv src dst
  const pathPattern = /(?:['"]([^'"]+\.\w+)['"]|\b(\/[\w./-]+\.\w+)\b|\b(\w[\w./-]*\.\w{1,10})\b)/g;
  let match;
  while ((match = pathPattern.exec(command)) !== null) {
    const p = match[1] || match[2] || match[3];
    if (p && !p.startsWith("-") && !isBinaryPath(p)) {
      paths.push(p);
    }
  }

  return [...new Set(paths)];
}

/**
 * Collect all potential file paths from tracked tool calls.
 * Includes explicit paths from write/edit and extracted paths from bash.
 */
export function collectModifiedPaths(toolCalls: TrackedToolCall[]): string[] {
  const paths = new Set<string>();

  for (const tc of toolCalls) {
    if ((tc.name === "write" || tc.name === "edit") && tc.input?.path) {
      paths.add(tc.input.path);
    }
    if (tc.name === "bash" && tc.input?.command) {
      for (const p of extractPathsFromBashCommand(tc.input.command)) {
        paths.add(p);
      }
    }
  }

  return [...paths];
}

export { MAX_NON_GIT_FILE_SIZE };

/**
 * Build a human-readable summary of file changes from tool calls.
 */
export function buildChangeSummary(toolCalls: TrackedToolCall[]): string {
  return toolCalls
    .filter((tc) => FILE_MODIFYING_TOOLS.includes(tc.name) || tc.name === "bash")
    .map((tc) => {
      if (tc.name === "write") {
        return `WROTE file: ${tc.input?.path}\n${(tc.input?.content ?? "").slice(0, 3000)}`;
      }
      if (tc.name === "edit") {
        const edits = tc.input?.edits ?? [];
        const editSummary = edits
          .map(
            (e: any, i: number) =>
              `  Edit ${i + 1}:\n    OLD: ${(e.oldText ?? "").slice(0, 500)}\n    NEW: ${(e.newText ?? "").slice(0, 500)}`,
          )
          .join("\n");
        return `EDITED file: ${tc.input?.path}\n${editSummary}`;
      }
      if (tc.name === "bash") {
        return `BASH: ${tc.input?.command}\n→ ${(tc.result ?? "").slice(0, 1000)}`;
      }
      return `${tc.name}: ${JSON.stringify(tc.input).slice(0, 500)}`;
    })
    .join("\n\n---\n\n");
}

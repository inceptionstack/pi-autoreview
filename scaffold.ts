/**
 * scaffold.ts — Template content for /scaffold-review-files
 *
 * Contains the actual default prompts used by the extension so users
 * can see and customise exactly what the reviewer sees.
 */

import { DEFAULT_REVIEW_PROMPT } from "./prompt";

// ── review-rules.md ──────────────────────────────────
// Shows the full default review prompt so users know what's built-in,
// then a section for project-specific additions.

export const SCAFFOLD_REVIEW_RULES = `# Review rules

## Default review prompt (built-in)

The following is the full default prompt sent to the reviewer model.
You do **not** need to repeat it — it is always included automatically.
This is here so you can see exactly what the reviewer is told, and
override or extend it below.

<details>
<summary>Click to expand default prompt</summary>

${DEFAULT_REVIEW_PROMPT}

</details>

---

## Project-specific rules (customise below)

Everything below this line is **appended** to the default prompt above.
Add your project's architecture rules, conventions, and constraints here.

### Architecture

- All API routes must go through the middleware chain
- Database access only via the repository layer, never direct queries
- No business logic in controllers — delegate to services

### Code standards

- All public functions must have JSDoc comments
- No \`console.log\` in production code — use the logger
- All API endpoints must validate input with zod schemas

### Security

- No secrets in code — use environment variables
- All user input must be sanitized before database queries
- Authentication required on all non-public routes
`;

// ── roundup.md ───────────────────────────────────────

export const SCAFFOLD_ROUNDUP_RULES = `# Roundup review rules

The roundup review runs after mini-review loops reach LGTM.
It's a "zoom out" architecture review gated by heuristics + LLM judge.

The default roundup prompt covers:
- Architecture coherence & module coupling
- Cross-file consistency (naming, patterns, types)
- Integration completeness
- Accumulated tech debt (TODO/FIXME, dead code)
- Documentation accuracy

Add project-specific roundup rules below. These are **appended** to the
built-in roundup prompt.

---

## Project-specific roundup rules

### Architecture

- Verify the module dependency graph has no unexpected cycles
- Check that layering is respected (e.g. UI → Service → Repository → Database)
- Flag any god-objects or god-modules that accumulated too many responsibilities

### Cross-cutting concerns

- Error handling strategy consistent across all modules
- Logging follows the same patterns everywhere
- Configuration accessed the same way in all files

### Technical debt

- Flag any TODO/FIXME/HACK comments that were added
- Identify code that was clearly written in haste during fix loops
- Check for dead code or unused imports that accumulated

### Documentation

- README still accurate after all changes
- Architecture docs reflect current state
- Changed public APIs have updated JSDoc/comments
`;

// ── ignore ───────────────────────────────────────────

export const SCAFFOLD_IGNORE = `# Files to skip during review (gitignore syntax)
# Blank lines and lines starting with # are ignored.
# Patterns follow .gitignore rules: *, **, ?, !, trailing /

# Dependencies & lock files
package-lock.json
yarn.lock
pnpm-lock.yaml
bun.lockb

# Build output
dist/**
build/**
out/**
*.min.js
*.min.css

# Generated files
*.generated.ts
*.d.ts

# Snapshots
*.snap

# Large data / assets
*.csv
*.parquet
`;

// ── settings.json ────────────────────────────────────

export const SCAFFOLD_SETTINGS = JSON.stringify(
  {
    maxReviewLoops: 100,
    model: "amazon-bedrock/us.anthropic.claude-opus-4-6-v1",
    thinkingLevel: "off",
    roundupEnabled: true,
    reviewTimeoutMs: 120000,
    toggleShortcut: "alt+r",
    cancelShortcut: "",
  },
  null,
  2,
);

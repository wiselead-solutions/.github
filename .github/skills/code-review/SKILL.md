---
name: code-review
description: Review staged, unstaged, or branch diffs for bugs, security issues, and logic errors before committing or opening a PR. Use for "review my changes", "review this diff", "code review", "review this PR", "check my changes before I commit".
---

# Code Review Skill

Give context-aware, high-signal reviews of an existing change set (staged, unstaged, or branch diff) in this repository. This skill does not review the whole codebase from scratch: it requires a diff to compare against.

## Steps

1. **Confirm there is a diff to review.** Run `git status` / `git diff --stat` (and `git diff <base>...HEAD --stat` for branch diffs). If there is no diff, say so and ask what to compare against instead of guessing.
2. **Delegate to the `code-review` task agent** (`agent_type: "code-review"`), passing it full context: which diff to inspect (staged/unstaged/branch + base ref), the repo root, and this repo's own conventions (AGENTS.md, linters, test commands) so it judges against real project standards rather than generic style.
3. **Do not review the diff yourself in parallel**: the agent owns this scope. Wait for its findings.

## Reporting findings

Present results as a table, ranked by severity then confidence:

| # | Severity | File | Lines | Issue | Confidence |
|---|----------|------|-------|-------|------------|
| 1 | 🔴 CRITICAL | path/to/file.ts | 42-45 | Description of the bug | 9/10 |

Severity legend: 🔴 CRITICAL, 🟠 HIGH, 🟡 MEDIUM, ⚪ LOW.

Only report high-confidence bugs, security vulnerabilities, and logic errors, skip style/formatting nitpicks unless explicitly asked.

If any issues were found, offer (via `ask_user` if available, otherwise a numbered list):
- **Fix highest severity issues**: list top issues by severity then confidence, ask which to fix, then implement.
- **Fix all issues**: implement minimal, surgical fixes for every reported issue.
- **Commit a summary of findings**: write a CODE-REVIEW.md documenting findings and commit it.

If no issues were found, say so plainly, do not invent findings to fill the table.

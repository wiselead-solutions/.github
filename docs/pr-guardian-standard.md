# PR and Guardian standard

Owner request: 3 November 2026. Rejist is the behavioral reference. This standard applies to
every active Wiselead Solutions repository, including the scaffold used for new products.
Archived repositories are excluded.

## Author a PR

Branch from the current `main` and target `main`. Keep the PR draft until it is ready to
merge. Use exactly these five headings: Executive Summary, Technical Summary, Testing,
Risk & Rollout, and Reviewer Guidance. Assign an owner and link the issue with `Closes`,
`Fixes`, `Resolves`, or `Part of`, followed by `#123` or `org/repo#123`. `Part-of` remains
accepted for existing automation; `Part of` is the preferred spelling.

Complete the six documentation-impact rows under Technical Summary using the repository's
own `.github/documentation-baseline.json`. A ready area names a canonical document and
explains its impact; pending implementation areas remain blocked. A documentation-only
adoption can land first. Do not mark an area ready solely to get an implementation merged.

CI and documentation evidence must describe the actual change. An authenticated Dependabot
author on a `dependabot/` branch is exempt from human metadata requirements, but still needs
a non-draft PR, passing CI, and the documentation policy applicable to that repository.
A branch name alone does not grant that exemption.

## Automatic merge

The Guardian is the merge holder. Agents finish their implementation and verification,
then leave merging to it. Never push directly to `main`, bypass a ruleset, dismiss a human's
review to hurry a merge, or arm native GitHub auto-merge as a substitute for a fresh audit.

The workflow runs trusted policy from the default branch through `pull_request_target`.
Checkout disables persisted credentials. PR content is read as API data, never executed.
Pinned actions and a checked PowerShell runtime precede the audit.

Each repository has one non-cancelling audit concurrency group. PR metadata changes,
completion of every workflow that can report a PR check, manual dispatch, and the nominal
15-minute schedule trigger a fresh sweep. Review-only changes are picked up by the next
completion or scheduled sweep. Schedules are a fallback, not a time guarantee.

The shared audit:

1. Reads up to 1,000 open PRs and fails rather than silently auditing a truncated inventory.
2. Disables legacy native auto-merge before processing an armed PR. Explicit holds prevent
   merging, including `guardian:skip`, `hold`, `blocked:owner`, and `paused-hold`.
3. Checks draft state, assignee, five sections, issue link, and any declared repository adapter.
4. Reads structured CI for the audited head. Failed, cancelled, pending, unreadable, and
   unexpected empty CI block. Checks are grouped by workflow and check name. A queued rerun
   without a start time cannot disappear behind an older success. Only this Guardian's own
   run identities are excluded. A readable trusted workflow inventory explicitly permits
   empty CI in repositories with no other PR workflow.
5. Runs the trusted documentation pre-audit before publishing a passing verdict or dismissing
   an obsolete Guardian review. The merge-time audit repeats it against the same head and
   compares the body digest, base, assignees and requested-reviewer count with the audit.
6. Dismisses only `github-actions[bot]` changes-requested reviews marked as PR Guardian.
   Human reviews and other automation reviews remain intact. Unchanged verdicts are not reposted.
7. Re-reads metadata and holds, then requests an immediate merge bound to the audited head.
   Feature PRs squash; release, hotfix and backmerge PRs prefer a merge commit into the default
   branch. Repository settings and effective rulesets can require a supported fallback.
   Long-lived branches are retained.
8. Merges at most one PR per sweep, allowing the next sweep to read a fresh base. Every PR is
   still audited. Failed review or label writes prevent that PR's merge; failures accumulate
   and fail the final workflow step after any required post-merge dispatch.

GitHub rulesets remain authoritative. The Guardian neither changes them nor bypasses required
checks, deployment gates, conversation resolution, or owner approval for production.

## Repository adapters

The five job-level `GUARDIAN_*` values declare the only supported metadata and freshness
adapters. The audit body is identical across repositories; deployment steps remain local.

- Website retains its reviewer-request requirement when another collaborator exists.
- Ops Portal retains its metadata exemption for existing `develop` and `backmerge/` automation.
- Shakad retains metadata/CI auditing and stale-block cleanup while a release hold remains,
  and its fifteen-commit stale-base limit. Held PRs explicitly report that documentation is
  checked after the hold is removed. A hold always withholds the merge.
- Rejist and Identity dispatch their existing DV workflow after a `GITHUB_TOKEN` merge.
  Workflow-touching App-token merges trigger the push route, so the duplicate dispatch is skipped.
- Clippy retains its post-merge CI dispatch and documentation-only suppression.
- Other repositories retain their existing scheduled or push-based deployment contracts.

The release-bot token is used only for workflow-touching merges and branch-update recovery.
Normal reads, reviews, and labels use the repository token. No stored credential is introduced.

## Maintain the standard

The canonical workflow is
[`product-scaffold/templates/workflows/pr-guardian.yml.template`](https://github.com/wiselead-solutions/product-scaffold/blob/main/templates/workflows/pr-guardian.yml.template).
The canonical audit lies between `guardian-standard:audit:start` and `guardian-standard:audit:end`.
Its generated digest is pinned by the shared tests appended to
`.github/scripts/documentation-baseline.test.cjs`. Keep every repository and the scaffold in
sync when changing this policy. Preserve the declared adapters and deployment routing.

The documentation validator is embedded in the trusted workflow and must remain byte-identical
to `.github/scripts/documentation-baseline.cjs`. Preserve authenticated automation exemptions;
do not copy another product's documentation manifest or claim its evidence.

Run `node .github/scripts/documentation-baseline.test.cjs` and validate the workflow with
`actionlint`. The shared fixtures execute the real audit with API doubles: they do not contact
GitHub. They cover metadata, CI states, reruns, head and hold races, reviewer adapters, failed
verdicts, stale bases, branch history, and one merge per sweep. Existing product-specific
workflow tests remain required. Run applicable product tests when product code also changes.

Keep `workflow_run.workflows` equal to the actual names of workflows triggered by
`pull_request` or `pull_request_target`, excluding this Guardian itself. Review or maintenance
automation must not create a pending check on the PR solely to wake the Guardian.
Existing display-name aliases may remain while runs from a workflow rename finish;
paired observers such as Rejist's runner-fault retry retain the same completion-name set.

Legacy `.github/pr-guardian.yml` files are historical declarations, not executable configuration.
The workflow, its declared adapters, tests, and this document define the active process.

## Rollout and rollback

Each repository changes through its own PR from a clean worktree. First verify the shared
fixtures, documentation tests, YAML, and repository-specific regression suites. Publish drafts
for CI and automated review, address findings, then mark merge-ready for the existing Guardian.
The rollout does not remove any existing owner hold or promote a production release.

Rollback by reverting the standardization commit through a PR. Restore the corresponding
embedded validator, script, tests, and deployment adapter together. Disarm any native auto-merge
left by an older workflow before returning a held PR to service.

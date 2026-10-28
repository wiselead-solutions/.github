# .github — Agent Instructions

The organisation-wide defaults repository for `wiselead-solutions`: the default PR template
(`.github/pull_request_template.md`), the org profile (`profile/README.md`), the staff hub
`README.md`, and a copy of the org ways of working (`docs/WAYS-OF-WORKING.md`). It ships no code
and deploys nothing. Its only workflow is `pr-guardian.yml`; there is
no PR CI.

## Code Review Rules

PRs are reviewed automatically by Claude (the ai-org review loop; Copilot review was retired 2026-10-04 and ChatGPT Codex review 2026-10-27). Keep P0/P1 for defects that would hurt, and say nothing rather than
guess.

**Consequential here — flag at P0/P1:**

- **The default PR template.** Renaming, removing or adding one of the five headings
  (`Executive Summary`, `Technical Summary`, `Testing`, `Risk & Rollout`, `Reviewer Guidance`).
  Repos without their own template inherit this one, and every PR guardian matches those
  headings by text (owner rule, 2026-09-14).
- **Disclosure.** Credentials, internal hostnames, customer names or unreleased plans in
  `profile/README.md` (the org profile page) or the staff hub `README.md`; any mention of an
  Enterprise tier (it does not exist).
- **The guardian.** A weakened `pr-guardian.yml` merge gate (sections, issue link, assignee,
  draft), a widened `permissions:` block, or a merge path that skips its checks.
- **Ways of working.** A `docs/WAYS-OF-WORKING.md` change that contradicts the org rules it
  records (trunk on `main`, PRs draft until merge-ready, PD human-gated) without saying it is
  an owner decision.

**Safe paths — P2 at most:** `docs/ux-psychology-principles.md`, wording and link fixes,
comment-only changes.

**Don't duplicate CI.** There is no PR CI here; the guardian checks the PR body, assignee and
draft state. Don't comment on formatting, Markdown style or naming.

## Documentation baseline enforcement

Before implementation, read [the documentation baseline](docs/documentation-baseline.md)
and `.github/documentation-baseline.json`. Complete every pending area through the linked
adoption issue; reuse canonical documents, record honest coverage and justified exclusions.
Implementation PRs need all six documentation-impact rows under Technical Summary.
Keep the five standard PR headings. The guardian blocks missing/pending/unreadable evidence;
documentation-only completion can proceed. Do not certify unrelated README content as a spec.
Run `node .github/scripts/documentation-baseline.test.cjs` when changing this gate and keep
the trusted validator embedded in the guardian byte-for-byte aligned with its script copy.

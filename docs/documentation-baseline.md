# Documentation baseline

Implementation changes require a maintained specification before the PR guardian may merge them.
The owner's 2026-10-08 instruction to enforce the six-document advisory is tracked in
https://github.com/wiselead-solutions/.github/issues/27.

## Canonical index

`.github/documentation-baseline.json` maps exactly six areas: `prd`, `trd`, `app_flow`,
`design_brief`, `backend_schema`, and `implementation_plan`. Reuse existing documents and
retain their established paths. A single canonical document can cover several areas if its
coverage statement explains the relevant sections. Existing files are not proof of completeness.

Each area has one of three statuses:

- `pending`: links the repository's adoption issue. It blocks implementation PRs.
- `ready`: references 1–12 repository-relative Markdown paths, names the responsible `owner`
  role, and describes the verified `coverage` in a concrete sentence. The guardian reads
  those files at the PR's exact head commit and rejects missing or empty content.
- `not_applicable`: provides a specific `reason` explaining why this repository does not
  need that area. Infrastructure, libraries and content repos normally map to operator
  flows and configuration/content models rather than blanket exemptions.

Example of an area after its specification has been reviewed:

```json
{
  "status": "ready",
  "documents": ["PRD.md"],
  "owner": "planner",
  "coverage": "PRD sections 2–5 define the supported users, feature behaviour and measurable acceptance criteria."
}
```

`prd` covers users, goals, scope, feature behaviour and acceptance criteria. `trd` covers
verified architecture, tooling, interfaces, security, performance and deployment constraints.
`app_flow` covers normal, error and permission-boundary journeys. `design_brief` covers
canonical tokens/components and accessibility, or operator/document presentation conventions.
`backend_schema` covers entities/contracts, relationships, access, retention and migration.
`implementation_plan` covers dependencies, work packages, milestones, verification and recovery.

The adoption issue remains open until the inventory and all six areas are reviewed. The gate
checks the contract and readable evidence; reviewers still assess accuracy and sufficiency.
Do not claim readiness by pointing every area at an unrelated README or copying templates.

## PR declaration

Keep the organisation's five existing PR headings. Under Technical Summary, add one table
row per area with `updated`, `unchanged`, or `not_applicable` and a concrete evidence/reason
sentence. For ready areas, name a canonical document path in backticks. `updated` must
reference a document actually changed in the PR; `unchanged` explains why the existing
specification still covers the change. A documented area cannot be waived in the PR body.
Comments, fenced examples, duplicate rows and placeholder evidence do not satisfy the gate.

Documentation-only completion remains possible while areas are pending. That exception
covers root README/specification/reference Markdown, Markdown under `docs/`, and the exact
documentation-enforcement assets. It does not cover arbitrary Markdown, generated agent
policy, source, tests, deployment workflows, binaries, or a rename from an implementation path.
The narrow enforcement-asset exception lets the gate and its policy be maintained without
requiring a product feature specification for the gate itself. Existing review/CI gates still apply.

## Enforcement and verification

The existing guardian embeds a trusted copy of the validator, prepares it in `RUNNER_TEMP`,
and runs it immediately before each merge. It never checks out or executes PR code for this
gate: GitHub contents responses are parsed as JSON/Markdown data only. API errors, truncated
file inventories, pending areas and metadata/head movement fail closed. Merges are bound to
the audited head; the gate does not arm a later unchecked `--auto` merge. Existing merge
methods, CI checks, approvals and explicit guardian hold/skip policies remain in force.

Run `node .github/scripts/documentation-baseline.test.cjs` for positive/negative controls.
The embedded source must equal `.github/scripts/documentation-baseline.cjs`; update both
in the same PR. Changes to the validator, exemptions or manifest readiness require review.

This enforces the guardian's automated merge path. Manual/admin bypasses are still subject
to repository rulesets and the owner's existing permissions; it does not change rulesets.

Repository adoption issue: https://github.com/wiselead-solutions/.github/issues/27

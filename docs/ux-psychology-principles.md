# UX Psychology Principles — and What They Mean for Developer Experience

This note captures the behavioural-psychology principles behind why some
products (and some workflows) feel effortless while others feel like a
chore. It exists as shared organisational knowledge — the same ideas that
shape sticky consumer apps also explain why a PR template gets filled in
correctly on the first try, or why a contributor abandons an issue half-way
through.

This repo (`wiselead-solutions/.github`) has no end users in the consumer
sense. Its "users" are **Wiselead engineers** interacting with issue
templates, PR templates, CONTRIBUTING docs, and org-level workflows. So
alongside each principle below, we reframe it as a **developer experience
(DX)** lens for the templates and docs that live in this repo.

## The core principles

| Principle | Consumer-app framing | DX framing (this repo) |
|---|---|---|
| **Hook Model** (Trigger → Action → Variable Reward → Investment) | A notification pulls a user back in, a quick action gives a reward, repeated use builds investment (data, streaks, followers) | A failing status check (trigger) → a fix (action) → a green check + auto-merge eligibility (reward) → a well-filled-out PR history (investment) that makes future reviews faster |
| **Fogg's B=MAP** (Behaviour = Motivation × Ability × Prompt) | Make the desired action *easy* (Ability) so even low motivation still results in the behaviour | A contributor may be low-motivation ("just fixing one typo") — a short, obvious template (high Ability) still gets them to file it correctly; a 40-field form does not |
| **Friction / cognitive load reduction** | Fewer taps, fewer fields, sensible defaults | Short issue/PR templates with pre-filled checkboxes beat long free-text essays; templates should ask only what triage genuinely needs |
| **Variable rewards** | Unpredictable positive feedback (likes, new content) keeps users engaged | Not directly applicable to internal tooling — flagged as a principle to *avoid* misusing (see ethical note below) |
| **Investment** | Users who put effort in (profile, preferences) are more likely to return | A contributor who fills in a clear template, gets a fast first review response, and sees their PR merged cleanly is more likely to contribute again |
| **Progress indicators / goal-gradient effect** | People push harder as they perceive themselves closer to a goal | PR templates with a checklist ("Test plan", "Screenshots", "Linked issue") show a contributor exactly how close they are to "done"; CI status checks are a real-time progress indicator |
| **Loss aversion** | People work harder to avoid losing something than to gain the equivalent | A stale branch protection warning ("this PR is now out of date and needs a rebase") triggers action faster than a neutral status note |
| **Social proof** | Seeing others' behaviour normalizes an action | A CODEOWNERS file (once added) would let visible approvals, and CI badges in the org profile README (`profile/README.md`) signal "this is how we work here" |
| **Personalization / investment** | Tailored experience increases perceived value | Using CODEOWNERS (once added) to auto-assign the right reviewer/team reduces the "who do I even ask" friction |
| **Immediate feedback loops** | Instant confirmation of an action taken | Fast CI feedback, template validation, and bot comments confirming "your PR meets the checklist" close the loop quickly |
| **Peak-End rule** | People judge an experience mostly by its most intense point and its ending | The merge experience (clean squash-merge message, thank-you note, closed-issue auto-link) is the "end" of a contribution — worth polishing even though it feels like a formality |
| **Choice overload / Hick's Law** | More options = slower decisions | A single well-scoped issue template beats five overlapping ones; a PR template with 3–4 sections beats one with 15 |
| **Accessibility as trust** | Inclusive design signals the product cares about all its users | Clear, jargon-free template language and Markdown that renders well (headings, checklists) build trust just as visual accessibility does for consumer UI |

## Ethical guardrail

The Hook Model is easy to misuse — variable rewards and engagement loops
can shade into dark patterns (manufactured urgency, guilt-tripping,
hidden costs). **None of that belongs in internal tooling.** Templates and
workflows in this repo should optimize for *contributor time saved and
correctness*, never for engagement metrics, forced compliance, or making
it harder to do the right thing (e.g., skipping tests, bypassing review).
If a template nudges a behaviour, the nudge must be transparent and in the
contributor's actual interest (e.g., "please fill in the test plan so
review is faster" — not disguised gates).

## Applying this to `wiselead-solutions/.github`

Concrete opportunities, based on the templates and docs that currently
exist (or are still marked "coming soon") in this repo:

- **Ability over Motivation (Fogg)** — `CONTRIBUTING.md` and
  `CODE_OF_CONDUCT.md` are still listed as "coming soon" in `README.md`.
  Shipping them lowers the Ability bar for first-time contributors who
  don't yet know the org's expectations.
- **Reduce choice overload** — when `ISSUE_TEMPLATE/` and
  `PULL_REQUEST_TEMPLATE/` are added, keep each template to the smallest
  set of fields that triage actually needs, rather than one exhaustive
  form covering every repo's edge cases.
- **Goal-gradient / progress indicators** — PR templates should include an
  explicit checklist (e.g., tests updated, docs updated, linked issue) so
  a contributor can see exactly how close they are to a mergeable PR.
- **Immediate feedback** — pair templates with lightweight automation
  (e.g., a bot comment or required-check) that confirms the checklist was
  actually completed, rather than relying on reviewers to notice omissions.

See tracking issue #2 for the concrete follow-up checklist.

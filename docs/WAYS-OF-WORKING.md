# WiseLead Solutions — Repository Ways of Working

**Status:** Adopted · **Applies to:** all repositories in `wiselead-solutions` · **Owner:** Dara Oladapo

This document defines how code moves from a developer's branch to production. Every flow is automated. The only manual step is one approval click before production.

---

## 1. Environments

| Env | Purpose | Fed by | Deploys |
|---|---|---|---|
| **dv** | Latest integrated code | `develop` | On every merge to `develop` |
| **QA** | Regression testing | `main` | Twice daily, after the scheduled `develop` → `main` merge |
| **RC** | Release candidate validation | `release/*` | Wednesday 12:00 (UK), on release cut |
| **pd** | Production | `release/*` (same artifact as RC) | Thursday evening, after approval |

Automatic validation gates (smoke, regression or validation suites) run after **every** deployment to **every** environment.

---

## 2. Branches

| Branch | Lifetime | Created from | Merges into |
|---|---|---|---|
| `main` | Permanent | — | — |
| `develop` | Permanent | `main` | `main` (automated PR) |
| `feature/<short-name>` | ≤ 1 day | `develop` | `develop` |
| `release/<yyyy.ww>` | Until next release ships | Last green commit on `main` | Never merged; abandoned after next release |
| `hotfix/<short-name>` | Hours | Current production `release/*` | `release/*`, then auto back-merge to `main` and `develop` |

Rules:
- New work each day branches from the latest `develop`.
- Work that won't finish in a day is either rebased onto `develop` every morning or merged behind a feature flag.
- `develop` → `main` uses a **merge commit**, never squash.
- Nobody pushes directly to `main`, `develop` or `release/*`.

---

## 3. The weekly release train

| When (UK) | What happens | Driven by |
|---|---|---|
| Every merge to `develop` | Build → deploy dv → smoke tests | Push trigger |
| 12:00 and 17:30 daily | Bot opens `develop` → `main` PR with auto-merge; on merge: build → deploy QA → full regression | Scheduled workflow |
| Wednesday 12:00 | Bot cuts `release/yyyy.ww` from the **last `main` commit that passed QA regression** → build → deploy RC → validation | Scheduled workflow |
| After RC passes | Approval request posted with release summary | Pipeline |
| Thursday evening window | Approved RC artifact promoted to pd → validation → tag `vyyyy.ww.0` → release notes | Environment approval + time window |

Scheduled triggers run in UTC. Cron times shift by one hour at BST/GMT changeovers and must be adjusted twice a year.

---

## 4. Automation guarantees

- **Build once, promote the artifact.** pd always receives the exact artifact validated in RC. Nothing is rebuilt between RC and pd.
- **Never cut from HEAD.** The Wednesday cut uses the last commit with a passing QA regression run. A red commit is never eligible.
- **QA deploys don't overlap regression.** The 17:30 merge is skipped if the 12:00 regression run is still in progress or failed.
- **Broken `develop` blocks itself.** If required checks fail, the `develop` → `main` PR stays open and QA keeps the previous build.
- **Bots use a GitHub App token**, not `GITHUB_TOKEN`, so bot-created PRs and branches trigger downstream workflows.
- **Failures notify.** Every gate result is posted to the team channel.
- **Automatic rollback.** A failed pd validation triggers slot swap-back or redeploy of the previous artifact.
- **Cleanup is automatic.** Merged feature and hotfix branches are deleted. Release branches older than the last two are pruned.
- **Azure auth uses OIDC federation only.** No service principal secrets in any pipeline.

---

## 5. Code review

Code review is automated. A PR merges automatically when all required checks pass.

| Check | Tooling | Blocking |
|---|---|---|
| Build, analyzers, warnings as errors | .NET SDK, Roslyn analyzers, `.editorconfig` | Yes |
| Unit and integration tests + coverage on new code | Test runner + coverage threshold | Yes |
| Quality gate | SonarCloud | Yes |
| Security | CodeQL, secret scanning, Dependabot | Yes (high/critical) |
| IaC scanning | PSRule for Azure / Checkov | Yes (high/critical) |
| AI review | Copilot code review / Claude Code Action | High-severity findings only |

**Human review is still required** (via `CODEOWNERS`) for changes to:
- `.github/` (workflows, rulesets, CODEOWNERS itself)
- Infrastructure code targeting RC or pd
- Authentication, authorisation and cryptography code
- Database migrations

This prevents any change from disabling the gates that approve it.

---

## 6. Production approval

The single manual step in the whole flow.

- When RC validation passes, the pipeline posts a summary: version, release notes, RC results, quality and security status, included PRs (sensitive paths flagged), and any RC fixes since the cut.
- Approval can be given any time after RC passes. Deployment waits for the Thursday evening window automatically.
- At least two eligible approvers; one approval required.
- Reminder sent if unapproved by 15:00 Thursday. Unapproved RCs expire Friday and do not carry over.
- Approve or reject from the GitHub mobile app or the notification link.
- Rejection notifies the team, leaves RC untouched for investigation and pd unchanged.

---

## 7. Fixes during a release

**RC fixes:** fix on `release/yyyy.ww` via PR. A bot automatically opens back-merge PRs to `main` and `develop`.

**Hotfixes:** branch `hotfix/*` from the current production release branch. Its pipeline fast-tracks RC → pd (still behind approval), then automatically opens back-merge PRs to `main` and `develop`.

Fixes always flow **down from the release branch and back up by bot**. Never apply the same fix independently in two places.

---

## 8. Per-repo setup checklist

- [ ] `develop` branch exists and is protected
- [ ] Rulesets on `main`, `develop`, `release/*`: required checks, no direct pushes, auto-merge enabled
- [ ] `CODEOWNERS` covering the paths in section 5
- [ ] Environments `dv`, `QA`, `RC`, `pd` created, with secrets scoped per environment
- [ ] `pd` environment: required reviewers, deployment restricted to `release/*` and `hotfix/*`
- [ ] Workflows: PR validation, `develop` → dv, scheduled `develop` → `main`, `main` → QA, scheduled release cut, `release/*` → RC → pd, back-merge bot, cleanup
- [ ] GitHub App installed for bot operations
- [ ] Artifact retention policy set (Actions storage and minutes are capped)
- [ ] This document linked from the repo `README.md`

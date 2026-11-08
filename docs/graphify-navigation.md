# Graphify navigation — .github

Owner-requested rollout, 5 November 2026. Part of wiselead-solutions/wiselead-solutions#230.

Optional local developer navigation. Application behavior, dependencies, CI and deployment gates are unchanged.

## Scope

Scan `.github/scripts` only. This is governance code/config, not shipped application code. No production data, documents, media or secrets are sent to a model. Generated migrations, build outputs, vendored assets and sensitive config are outside the intended corpus.

## Use

Requires Python and uv. Run from the repository root.

```powershell
$env:GRAPHIFY_BACKEND = 'none'
python scripts/graphify-navigation.py
python scripts/graphify-navigation.py check
```

The runner pins Graphify 0.9.102, disables model backend detection, limits AST workers to four and skips HTML/model community labels. It writes ignored `graphify-out/graph.json`, `GRAPH_REPORT.md` and local check evidence. No Git hooks, MCP configuration, watcher or database is installed. The bundled Codex skill's broader extraction defaults are bounded by AGENTS.

## Verification and limits

Verification results are recorded below after the local checks. Source-backed CLI checks demonstrate selected navigation behavior, not overall retrieval accuracy. Confidence tags are extraction metadata. Static graphs can miss DI, reflection, getters, generated code and runtime routing. Always verify consequential claims in source; normal search remains available. No token-saving percentage or productivity gain is claimed.

Refresh after changing source or commits. No semantic document/media extraction is authorized by this rollout. Upstream local query logging remains enabled; CLI queries use the local graph. Package installation may download dependencies.

## Recovery

Return to the primary checkout to stop using this opt-in worktree setup. Revert this PR to remove the committed onboarding; no application service or deployment needs stopping. Keep generated graph data out of commits.

## Local rollout evidence

Graph built from `282f4d4f327083e90f0d18a93b9783fb00f80fbc`: 51 nodes and 83 relationships; model extraction tokens: 0. Three CLI checks passed: source line/location verified against a real file, a bounded query, and missing-symbol exit 4.

Verified example: `pending()` at `.github/scripts/documentation-baseline.test.cjs:L31`. Raw stdout and current-commit receipts stay local under `graphify-out/pilot-evidence/`. This checks a source location, not runtime behavior.

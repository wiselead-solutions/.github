'use strict';

// This source is embedded in the trusted guardian workflow. PR files are data only.
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const process = require('node:process');
const { Buffer } = require('node:buffer');
const { isAbsolute } = require('node:path');
const AREAS = ['prd', 'trd', 'app_flow', 'design_brief', 'backend_schema', 'implementation_plan'];
const MANIFEST = '.github/documentation-baseline.json';
const POLICY_FILES = new Set([
  MANIFEST, '.github/workflows/pr-guardian.yml', '.github/pull_request_template.md',
  '.github/scripts/documentation-baseline.cjs', '.github/scripts/documentation-baseline.test.cjs',
  'docs/documentation-baseline.md', 'AGENTS.md',
  'templates/workflows/pr-guardian.yml.template', 'templates/AGENTS.md.template',
  'templates/pull_request_template.md', 'templates/documentation-baseline.json.template',
  'templates/documentation-baseline.md.template', 'templates/documentation-baseline.cjs.template',
  'templates/documentation-baseline.test.cjs.template',
]);
const prose = value => typeof value === 'string' && value.trim().length >= 20 &&
  !/\b(TODO|TBD|FIXME|placeholder|replace me)\b/i.test(value) &&
  !(value.includes('<') && value.indexOf('>', value.indexOf('<') + 1) > value.indexOf('<') + 1);
const docPath = value => typeof value === 'string' &&
  /^(?:[A-Za-z0-9_. -]+\/)*[A-Za-z0-9_. -]+\.md$/.test(value) &&
  !value.split('/').some(part => part === '.' || part === '..');
const canonical = value => JSON.stringify(value, (key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]])) : item);
const digest = body => crypto.createHash('sha256').update(body || '').digest('hex');

const REGRESSION_FILES = new Map([
  ['wiselead-solutions/ai-org', 'tools/test_validate.py'],
  ['wiselead-solutions/rejist', '.github/tools/test_deploy_routing.py'],
]);

function documentationOnly(files, repository) {
  // Only documentation paths, not all Markdown: runtime/agents/*.md can be executable policy.
  const safe = path => POLICY_FILES.has(path) || path === REGRESSION_FILES.get(repository) ||
    /^(?:README|readme|PRD|TRD|DECISIONS|SETUP|TESTING|BOOTSTRAP|HANDOVER|MEMORY|PROJECT-DETAILS)\.md$/.test(path) ||
    /^docs\/(?!.*(?:^|\/)\.\.(?:\/|$)).+\.md$/.test(path);
  // Maintaining the enforcement assets is documentation work; deleting or renaming one away
  // removes the gate itself, so that never rides the bootstrap exemption.
  const dropsPolicy = file => (file.status === 'removed' && POLICY_FILES.has(file.filename)) ||
    (Boolean(file.previous_filename) && file.previous_filename !== file.filename && POLICY_FILES.has(file.previous_filename));
  return files.length > 0 && files.every(file => safe(file.filename) && !dropsPolicy(file) &&
    (!file.previous_filename || safe(file.previous_filename)));
}

function withoutDelimited(text, opening, closing) {
  const pieces = [];
  let offset = 0;
  for (;;) {
    const start = text.indexOf(opening, offset);
    if (start < 0) { pieces.push(text.slice(offset)); break; }
    pieces.push(text.slice(offset, start));
    const end = text.indexOf(closing, start + opening.length);
    if (end < 0) break;
    offset = end + closing.length;
  }
  return pieces.join('');
}

function impactRows(body, reasons) {
  const rows = new Map();
  const visible = withoutDelimited(withoutDelimited(body || '', '<!--', '-->'), '```', '```');
  for (const line of visible.split('\n')) {
    const cells = line.trim().split('|').map(cell => cell.trim());
    if (cells.length !== 5 || cells[0] || cells[4] || !AREAS.includes(cells[1]) ||
        !['updated', 'unchanged', 'not_applicable'].includes(cells[2])) continue;
    if (rows.has(cells[1])) reasons.push(`Duplicate documentation impact row: ${cells[1]}.`);
    rows.set(cells[1], { impact: cells[2], evidence: cells[3] });
  }
  return rows;
}

function validateReady(area, entry, readDocument, reasons) {
  if (!Array.isArray(entry.documents) || entry.documents.length === 0 ||
      entry.documents.length > 12 || entry.documents.some(path => !docPath(path))) {
    reasons.push(`${area}: ready must reference 1–12 repository-relative Markdown documents.`);
    return false;
  }
  if (!prose(entry.coverage) || !/^[A-Za-z0-9_-]+$/.test(entry.owner || '')) {
    reasons.push(`${area}: ready requires a named responsible role and concrete coverage description.`);
  }
  for (const path of entry.documents) {
    try {
      const text = readDocument(path);
      if (typeof text !== 'string' || withoutDelimited(text, '<!--', '-->').trim().length < 80) {
        reasons.push(`${area}: ${path} is empty or too short to be a specification.`);
      }
    } catch { reasons.push(`${area}: cannot read ${path} at the PR head.`); }
  }
  return true;
}

function validateImpact(area, entry, row, changed, reasons) {
  if (!row || !prose(row.evidence)) {
    reasons.push(`${area}: add one documentation-impact table row with concrete evidence/reason.`); return;
  }
  if (entry.status === 'not_applicable') {
    if (row.impact !== 'not_applicable') reasons.push(`${area}: impact must agree with the manifest's not_applicable status.`);
    return;
  }
  if (row.impact === 'not_applicable') reasons.push(`${area}: documented areas cannot be waived in the PR body.`);
  const referenced = entry.documents.filter(path => row.evidence.includes('`' + path + '`'));
  if (referenced.length === 0) reasons.push(`${area}: evidence must name a canonical document path in backticks.`);
  if (row.impact === 'updated' && !referenced.some(path => changed.has(path))) {
    reasons.push(`${area}: updated must reference a canonical document actually changed in this PR.`);
  }
  if (row.impact === 'unchanged' && entry.documents.some(path => changed.has(path))) {
    reasons.push(`${area}: a canonical document changed; declare updated.`);
  }
}

function validateArea(area, entry, context) {
  const { docsOnly, readDocument, rows, changed, reasons, baseManifest } = context;
  if (!entry || !['ready', 'pending', 'not_applicable'].includes(entry.status)) {
    reasons.push(`${area}: invalid status; use ready, pending or not_applicable.`); return;
  }
  const baseEntry = baseManifest && baseManifest.version === 1 && baseManifest.areas ? baseManifest.areas[area] : null;
  if (!docsOnly && entry.status !== 'pending' && (!baseEntry || baseEntry.status === 'pending')) {
    reasons.push(`${area}: base branch manifest is pending or unreadable; land the adoption as a documentation-only PR before implementation.`);
    return;
  }
  if (!docsOnly && entry.status !== 'pending' && canonical(entry) !== canonical(baseEntry)) {
    reasons.push(`${area}: an implementation PR cannot change this area's manifest entry; land manifest changes as a documentation-only PR.`);
    return;
  }
  if (entry.status === 'pending') {
    if (!/^https:\/\/github\.com\/wiselead-solutions\/[A-Za-z0-9_.-]+\/issues\/[1-9]\d*$/.test(entry.issue || '')) {
      reasons.push(`${area}: pending must link its adoption issue.`);
    }
    if (!docsOnly) reasons.push(`${area}: baseline is pending; complete its adoption issue before implementation.`);
    return;
  }
  if (entry.status === 'not_applicable') {
    if (!prose(entry.reason)) reasons.push(`${area}: non-applicability requires a concrete explanation (20+ characters, no placeholders).`);
  } else if (!validateReady(area, entry, readDocument, reasons)) return;
  if (!docsOnly) validateImpact(area, entry, rows.get(area), changed, reasons);
}

function validate({ manifest, baseManifest = manifest, files, body, readDocument, repository }) {
  const reasons = [];
  const docsOnly = documentationOnly(files, repository);
  if (!manifest || manifest.version !== 1 || !manifest.areas ||
      Object.keys(manifest.areas).sort().join(',') !== [...AREAS].sort().join(',')) {
    return { ok: false, reasons: ['Missing or invalid .github/documentation-baseline.json (version 1 and exactly six areas required).'] };
  }
  const changed = new Set(files.filter(f => f.status !== 'removed').map(f => f.filename));
  const rows = impactRows(body, reasons);
  const context = { docsOnly, readDocument, rows, changed, reasons, baseManifest };
  for (const area of AREAS) validateArea(area, manifest.areas[area], context);
  return { ok: reasons.length === 0, reasons, documentationOnly: docsOnly };
}

function auditState(pr) {
  return {
    head: pr.head?.sha, base: pr.base?.sha, body: digest(pr.body), state: pr.state, draft: Boolean(pr.draft),
    changed_files: pr.changed_files,
    base_ref: pr.base?.ref,
    assignees: JSON.stringify((pr.assignees || []).map(user => user.login).sort()),
    reviewers: JSON.stringify([...(pr.requested_reviewers || []).map(user => user.login), ...(pr.requested_teams || []).map(team => 'team:' + team.slug)].sort()),
    // A JSON list, not a joined string: a label name may itself contain the separator.
    labels: JSON.stringify((pr.labels || []).map(label => String(label.name || '').toLowerCase())
      .filter(name => name !== 'guardian:blocked').sort((a, b) => a.localeCompare(b))),
  };
}

function changedFields(before, after) {
  const was = auditState(before), now = auditState(after);
  return Object.keys(was).filter(key => was[key] !== now[key])
    .map(key => `${key} ${JSON.stringify(was[key])} -> ${JSON.stringify(now[key])}`);
}

// Changes the comparison ignores, logged so a CI-only difference can be traced to its field.
function ignoredDifferences(before, after) {
  const notes = [];
  const raw = pr => JSON.stringify(pr.labels || []);
  if (raw(before) !== raw(after)) {
    const keys = pr => [...new Set((pr.labels || []).flatMap(Object.keys))].sort((a, b) => a.localeCompare(b)).join(',');
    const names = pr => (pr.labels || []).map(label => label.name).join(',');
    notes.push(`label JSON differs: names [${names(before)}] -> [${names(after)}], keys [${keys(before)}] -> [${keys(after)}]`);
  }
  return notes;
}

function audit(repository, number, expectedHead, api, log = () => {}) {
  if (!/^wiselead-solutions\/[A-Za-z0-9_.-]+$/.test(repository) || !/^[1-9]\d*$/.test(number)) throw Error('Invalid repository or PR number.');
  // A PR whose labels change mid-audit is audited again from scratch once; the verdict always
  // comes from a pass whose PR state was identical before and after it, or the audit throws.
  // Any other change (head, base, body, state, draft, files) throws at once: the workflow checked
  // the body's sections and issue link before this audit, so only a fresh sweep re-runs them.
  for (let attempt = 1; ; attempt++) {
    const { result, before, after } = auditOnce(repository, number, expectedHead, api);
    for (const note of ignoredDifferences(before, after)) log(`PR #${number} attempt ${attempt}: ignored ${note}`);
    const changed = changedFields(before, after);
    if (changed.length === 0) return result;
    log(`PR #${number} attempt ${attempt}: changed during audit: ${changed.join('; ')}`);
    if (attempt >= 2 || changed.some(field => !field.startsWith('labels '))) throw Error(`PR changed during documentation audit (${changed.join('; ')}); re-evaluate before merging.`);
  }
}

function auditOnce(repository, number, expectedHead, api) {
  const prefix = `repos/${repository}`;
  const before = api(`${prefix}/pulls/${number}`);
  if (before.state !== 'open' || before.draft || !/^[0-9a-f]{40}$/.test(before.head?.sha || '')) throw Error('PR is closed, draft, or its head is unreadable.');
  if ((before.labels || []).some(label => ['guardian:skip', 'hold', 'blocked:owner', 'paused-hold'].includes(label.name?.toLowerCase()))) throw Error('PR acquired guardian:skip or another explicit hold; do not merge.');
  if (process.env.DOCUMENTATION_EXPECTED_METADATA) {
    const expectedMetadata = JSON.parse(process.env.DOCUMENTATION_EXPECTED_METADATA);
    if (Array.isArray(expectedMetadata.assignees)) expectedMetadata.assignees.sort();
    const observedMetadata = { body: digest(before.body), base: before.base?.ref,
      assignees: (before.assignees || []).map(user => user.login).sort(),
      reviewers: (before.requested_reviewers || []).length + (before.requested_teams || []).length };
    if (canonical(expectedMetadata) !== canonical(observedMetadata)) throw Error('PR metadata changed since the workflow audited its gates.');
  }
  if (expectedHead && expectedHead !== before.head.sha) throw Error('PR head changed since CI was audited.');
  const files = [];
  for (let page = 1; page <= 30; page++) {
    const batch = api(`${prefix}/pulls/${number}/files?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw Error('Cannot read changed files.');
    files.push(...batch);
    if (batch.length < 100) break;
  }
  if (files.length !== before.changed_files || files.length === 0) throw Error('Changed-file inventory is empty or truncated.');
  const cache = new Map();
  const readAt = (path, ref) => {
    const key = ref + ':' + path;
    if (cache.has(key)) return cache.get(key);
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const file = api(`${prefix}/contents/${encoded}?ref=${ref}`);
    if (file.type !== 'file' || file.encoding !== 'base64' || typeof file.content !== 'string') throw Error('Not a readable text file.');
    const text = Buffer.from(file.content, 'base64').toString('utf8');
    cache.set(key, text); return text;
  };
  const readDocument = path => readAt(path, before.head.sha);
  const manifest = JSON.parse(readDocument(MANIFEST));
  // A missing or unreadable base manifest leaves baseManifest null, which fails closed.
  let baseManifest = null;
  if (/^[0-9a-f]{40}$/.test(before.base?.sha || '')) {
    try { baseManifest = JSON.parse(readAt(MANIFEST, before.base.sha)); } catch { baseManifest = null; }
  }
  const result = validate({ manifest, baseManifest, files, body: before.body, readDocument, repository, automation: typeof isAutomationPr === 'function' && isAutomationPr(before, repository) });
  const after = api(`${prefix}/pulls/${number}`);
  return { result: { ...result, head: before.head.sha }, before, after };
}

module.exports = { AREAS, validate, audit, documentationOnly };
if (require.main === module) {
  let repository, number, ghPath, audited = false;
  const executable = name => {
    const value = process.env[name];
    if (!value || !isAbsolute(value)) throw Error(`Trusted workflow must supply absolute ${name}.`);
    return value;
  };
  try {
    const [mode, repo, ...args] = process.argv.slice(2);
    repository = repo;
    ghPath = executable('DOCUMENTATION_GH_PATH');
    const api = endpoint => JSON.parse(execFileSync(ghPath, ['api', endpoint], {
      encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }));
    if (!['--merge', '--execute', '--verify'].includes(mode)) throw Error('Expected --merge, --execute or --verify.');
    number = args[0];
    const matchIndex = args.indexOf('--match-head-commit');
    let expected = args[1];
    if (mode === '--merge') expected = matchIndex >= 0 ? args[matchIndex + 1] : '';
    // The guardian keeps these lines out of the block reasons and echoes them to its log.
    const log = line => process.stderr.write(`Documentation audit diagnostic: ${line}\n`);
    const result = audit(repo, number, expected, api, log);
    if (!result.ok) throw Error(result.reasons.join('\n'));
    audited = true;
    if (mode === '--verify') {
      process.stdout.write(JSON.stringify(result));
    } else if (mode === '--merge') {
      // The guardian must make the merge decision now, not arm a future unchecked merge.
      const mergeArgs = args.filter(arg => arg !== '--auto');
      if (matchIndex < 0) mergeArgs.push('--match-head-commit', result.head);
      if (!mergeArgs.includes('--repo')) mergeArgs.push('--repo', repo);
      // ai-org#264: the guardian sets GUARDIAN_MERGE_TOKEN (the release-bot App token) only
      // for a PR that changes .github/workflows/*; only this merge call uses it.
      const mergeToken = process.env.GUARDIAN_MERGE_TOKEN;
      process.stdout.write(execFileSync(ghPath, ['pr', 'merge', ...mergeArgs], {
        encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: mergeToken ? { ...process.env, GH_TOKEN: mergeToken } : process.env,
      }));
    } else {
      const [command, ...commandArgs] = args.slice(2);
      // Used only for Shakad's existing trusted merge-method fallback script.
      if (command !== 'bash' || commandArgs[0] !== '.github/scripts/guardian-merge.sh') throw Error('Unrecognised guardian merge helper.');
      process.stdout.write(execFileSync(executable('DOCUMENTATION_BASH_PATH'), commandArgs, {
        encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      }));
    }
  } catch (error) {
    // Best-effort disarm and label; their failures must never turn the gate green. Only a
    // failed audit is labelled here: a refused merge command after a passing audit (conflict,
    // workflow permission, policy) is the guardian workflow's to classify and record.
    if (ghPath && /^wiselead-solutions\/[A-Za-z0-9_.-]+$/.test(repository || '') && /^[1-9]\d*$/.test(number || '')) {
      for (const args of [
        ['pr', 'merge', number, '--repo', repository, '--disable-auto'],
        ...(audited ? [] : [['api', '--method', 'POST', `repos/${repository}/issues/${number}/labels`, '-f', 'labels[]=guardian:blocked']]),
      ]) {
        try { execFileSync(ghPath, args, {timeout:30000,stdio:['ignore','ignore','ignore']}); } catch {}
      }
    }
    // A failing helper reports on stdout as well as stderr; keep both for the caller's matching.
    const detail = [error.stdout, error.stderr].filter(Boolean).map(String).join('\n').trim() || error.message;
    process.stderr.write((audited ? 'Guardian merge refused:\n' : 'Documentation baseline audit rejected:\n') + detail.slice(0, 4000) + '\n');
    process.exitCode = 1;
  }
}

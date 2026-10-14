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
  return files.length > 0 && files.every(file => safe(file.filename) &&
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
  const { docsOnly, readDocument, rows, changed, reasons } = context;
  if (!entry || !['ready', 'pending', 'not_applicable'].includes(entry.status)) {
    reasons.push(`${area}: invalid status; use ready, pending or not_applicable.`); return;
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

function validate({ manifest, files, body, readDocument, repository }) {
  const reasons = [];
  const docsOnly = documentationOnly(files, repository);
  if (!manifest || manifest.version !== 1 || !manifest.areas ||
      Object.keys(manifest.areas).sort().join(',') !== [...AREAS].sort().join(',')) {
    return { ok: false, reasons: ['Missing or invalid .github/documentation-baseline.json (version 1 and exactly six areas required).'] };
  }
  const changed = new Set(files.filter(f => f.status !== 'removed').map(f => f.filename));
  const rows = impactRows(body, reasons);
  const context = { docsOnly, readDocument, rows, changed, reasons };
  for (const area of AREAS) validateArea(area, manifest.areas[area], context);
  return { ok: reasons.length === 0, reasons, documentationOnly: docsOnly };
}

function audit(repository, number, expectedHead, api) {
  if (!/^wiselead-solutions\/[A-Za-z0-9_.-]+$/.test(repository) || !/^[1-9]\d*$/.test(number)) throw Error('Invalid repository or PR number.');
  const prefix = `repos/${repository}`;
  const before = api(`${prefix}/pulls/${number}`);
  if (before.state !== 'open' || before.draft || !/^[0-9a-f]{40}$/.test(before.head?.sha || '')) throw Error('PR is closed, draft, or its head is unreadable.');
  if ((before.labels || []).some(label => label.name?.toLowerCase() === 'guardian:skip')) throw Error('PR acquired guardian:skip; do not merge.');
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
  const readDocument = path => {
    if (cache.has(path)) return cache.get(path);
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const file = api(`${prefix}/contents/${encoded}?ref=${before.head.sha}`);
    if (file.type !== 'file' || file.encoding !== 'base64' || typeof file.content !== 'string') throw Error('Not a readable text file.');
    const text = Buffer.from(file.content, 'base64').toString('utf8');
    cache.set(path, text); return text;
  };
  const manifest = JSON.parse(readDocument(MANIFEST));
  const result = validate({ manifest, files, body: before.body, readDocument, repository });
  const after = api(`${prefix}/pulls/${number}`);
  if (after.head?.sha !== before.head.sha || after.base?.sha !== before.base?.sha ||
      digest(after.body) !== digest(before.body) || after.state !== 'open' || after.draft ||
      after.changed_files !== before.changed_files ||
      JSON.stringify(after.labels || []) !== JSON.stringify(before.labels || [])) {
    throw Error('PR changed during documentation audit; re-evaluate before merging.');
  }
  return { ...result, head: before.head.sha };
}

module.exports = { AREAS, validate, audit, documentationOnly };
if (require.main === module) {
  let repository, number, ghPath;
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
    const result = audit(repo, number, expected, api);
    if (!result.ok) throw Error(result.reasons.join('\n'));
    if (mode === '--verify') {
      process.stdout.write(JSON.stringify(result));
    } else if (mode === '--merge') {
      // The guardian must make the merge decision now, not arm a future unchecked merge.
      const mergeArgs = args.filter(arg => arg !== '--auto');
      if (matchIndex < 0) mergeArgs.push('--match-head-commit', result.head);
      if (!mergeArgs.includes('--repo')) mergeArgs.push('--repo', repo);
      process.stdout.write(execFileSync(ghPath, ['pr', 'merge', ...mergeArgs], {
        encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
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
    // Best-effort disarm and label; their failures must never turn the gate green.
    if (ghPath && /^wiselead-solutions\/[A-Za-z0-9_.-]+$/.test(repository || '') && /^[1-9]\d*$/.test(number || '')) {
      for (const args of [
        ['pr', 'merge', number, '--repo', repository, '--disable-auto'],
        ['api', '--method', 'POST', `repos/${repository}/issues/${number}/labels`, '-f', 'labels[]=guardian:blocked'],
      ]) {
        try { execFileSync(ghPath, args, {timeout:30000,stdio:['ignore','ignore','ignore']}); } catch {}
      }
    }
    const detail = error.stderr ? error.stderr.toString() : error.message;
    process.stderr.write('Documentation baseline / merge blocked:\n' + detail.slice(0, 4000) + '\n');
    process.exitCode = 1;
  }
}

// The CLI fixtures are JavaScript executables. Windows cannot execute a shebang;
// this test-only preload launches precisely that fixture through Node instead.
{
const process = require('node:process');
if (process.platform === 'win32') {
  const fixtureFs = require('node:fs'), fixturePath = require('node:path');
  const fixtureDir = fixtureFs.mkdtempSync(fixturePath.join(require('node:os').tmpdir(), 'guardian-cli-fixture-'));
  const preload = fixturePath.join(fixtureDir, 'preload.cjs');
  fixtureFs.writeFileSync(preload, `const cp = require('node:child_process');
const execute = cp.execFileSync;
cp.execFileSync = (file, args, options) => file === process.env.DOCUMENTATION_GH_PATH
  ? execute(process.execPath, [file, ...args], options) : execute(file, args, options);
`);
  const priorOptions = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = ((priorOptions || '') + ' --require ' + JSON.stringify(preload)).trim();
  process.on('exit', () => {
    if (priorOptions === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = priorOptions;
    fixtureFs.rmSync(fixtureDir, {recursive:true, force:true});
  });
}
}

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const process = require('node:process');
const { Buffer } = require('node:buffer');
const { AREAS, validate, audit, documentationOnly } = require('./documentation-baseline.cjs');
const text = '# Canonical specification\n\n' + 'Verified requirements and acceptance criteria. '.repeat(5);
const issue = 'https://github.com/wiselead-solutions/project-assets/issues/29';
const pending = () => ({version: 1, areas: Object.fromEntries(AREAS.map(area => [area, {status: 'pending', issue}]))});
const ready = () => ({version: 1, areas: Object.fromEntries(AREAS.map(area => [area, {
  status: 'ready', documents: [`docs/${area}.md`], owner: 'reviewer',
  coverage: 'Verified requirements and acceptance criteria for this area.',
}]))});
const body = impact => AREAS.map(area => `| ${area} | ${impact} | \`docs/${area}.md\` — Verified acceptance criteria remain unchanged. |`).join('\n');
const run = (manifest = ready(), files = [{filename:'src/app.cs',status:'modified'}], content = body('unchanged'), reader = () => text) =>
  validate({manifest, files, body:content, readDocument:reader});
test('positive control: complete baseline and concrete unchanged evidence pass implementation', () => assert.equal(run().ok, true));
test('pending baseline blocks implementation with all six gaps', () => assert.equal(run(pending()).reasons.length, 6));
test('documentation-only baseline completion remains possible', () => assert.equal(run(pending(), [{filename:'docs/spec.md'}], '').ok, true));
test('absent, wrong-version and missing-area manifests fail closed even for docs', () => {
  for(const m of [null, {...ready(),version:2}, {version:1,areas:{}}]) assert.equal(run(m,[{filename:'docs/spec.md'}]).ok,false);
});
test('all six impact rows required, including automation PRs', () => assert.equal(run(ready(),undefined,'').ok,false));
test('dependabot PR without an impact table is skipped; a human PR without it is still blocked (shakad#1981)', () => {
  const { isAutomationPr } = require('./documentation-baseline.cjs');
  const repo = 'wiselead-solutions/example';
  const bot = {user:{login:'dependabot[bot]'},head:{ref:'dependabot/nuget/pkg-1.2.3',repo:{full_name:repo}}};
  assert.equal(isAutomationPr(bot, repo), true);
  assert.equal(isAutomationPr({...bot,user:{login:'app/dependabot'}}, repo), true);
  assert.equal(isAutomationPr({...bot,user:{login:'DaraOladapo'}}, repo), false);
  assert.equal(isAutomationPr({...bot,head:{ref:'feature/x',repo:{full_name:repo}}}, repo), false);
  assert.equal(isAutomationPr({...bot,head:{ref:bot.head.ref,repo:{full_name:'fork/example'}}}, repo), false);
  const files = [{filename:'src/app.cs',status:'modified'}];
  const dependabotBody = 'Bumps pkg from 1.2.2 to 1.2.3.';
  assert.equal(validate({manifest:ready(), files, body:dependabotBody, readDocument:()=>text, repository:repo, automation:true}).ok, true);
  assert.equal(validate({manifest:ready(), files, body:dependabotBody, readDocument:()=>text, repository:repo, automation:false}).ok, false);
  // The manifest must still be valid: automation does not waive a broken baseline.
  assert.equal(validate({manifest:null, files, body:'', readDocument:()=>text, repository:repo, automation:true}).ok, false);
});
test('comments, fenced examples, placeholders and duplicate rows cannot certify impact', () => {
  for(const b of [`<!-- ${body('unchanged')} -->`, '```\n'+body('unchanged')+'\n```', body('unchanged').replaceAll('Verified acceptance criteria remain unchanged.','TODO'),body('unchanged')+'\n'+body('unchanged')]) assert.equal(run(ready(),undefined,b).ok,false);
});
test('updated evidence must refer to a changed canonical document', () => {
  assert.equal(run(ready(),undefined,body('updated')).ok,false);
  const files=[{filename:'src/app.cs'},...AREAS.map(a=>({filename:`docs/${a}.md`}))];
  assert.equal(run(ready(),files,body('updated')).ok,true);
  assert.equal(run(ready(),files,body('unchanged')).ok,false);
});
test('missing, empty or comment-only canonical documents block', () => {
  for(const reader of [()=>{throw Error('404');},()=>'',()=> '<!--' + text + '-->']) assert.equal(run(ready(),undefined,undefined,reader).ok,false);
});
test('external links, traversal and executable documents are rejected', () => {
  for(const path of ['../spec.md','docs/../spec.md','https://github.com/example/spec.md','docs/spec.js','/spec.md']) {
    const m=ready();m.areas.prd.documents=[path];assert.equal(run(m).ok,false);
  }
});
test('non-applicability needs a concrete reason and matching impact', () => {
  const m=ready();m.areas.backend_schema={status:'not_applicable',reason:'This repository stores documentation only and has no runtime data model.'};
  assert.equal(run(m).ok,false);
  const b=body('unchanged').replace(/\| backend_schema[^\n]+/,'| backend_schema | not_applicable | This repository contains no runtime data or configuration model. |');
  assert.equal(run(m,undefined,b).ok,true);
  m.areas.backend_schema.reason='N/A';assert.equal(run(m,undefined,b).ok,false);
});
test('runtime Markdown and unsafe rename sources are implementation', () => {
  for(const filename of ['runtime/agents/planner.md','roles/planner.toml','docs/script.js','.github/workflows/deploy.yml']) assert.equal(documentationOnly([{filename}]),false);
  assert.equal(documentationOnly([{filename:'docs/app.md',previous_filename:'src/app.cs'}]),false);
  assert.equal(documentationOnly([]),false);
});
test('only the precise enforcement assets bypass pending bootstrap; neighbouring scripts do not', () => {
  assert.equal(run(pending(),[{filename:'.github/scripts/documentation-baseline.cjs'},{filename:'.github/workflows/pr-guardian.yml'}],'').ok,true);
  assert.equal(run(pending(),[{filename:'.github/scripts/other.cjs'}],'').ok,false);
});
test('bootstrap regression exemptions are scoped to their owning repository and exact file', () => {
  for (const [repository, filename] of [
    ['wiselead-solutions/ai-org', 'tools/test_validate.py'],
    ['wiselead-solutions/rejist', '.github/tools/test_deploy_routing.py'],
  ]) {
    assert.equal(documentationOnly([{filename}], repository), true);
    assert.equal(documentationOnly([{filename}], 'wiselead-solutions/other'), false);
    assert.equal(documentationOnly([{filename: filename + '.extra'}], repository), false);
  }
});
function fixture(overrides={}) {
  const head='a'.repeat(40);
  const pr={state:'open',draft:false,head:{sha:head},base:{sha:'b'.repeat(40)},body:body('unchanged'),labels:[],changed_files:1};
  let reads=0;
  const api=endpoint=> {
    if(endpoint.endsWith('/pulls/1')) {reads++;return {...pr,...(reads>1 ? overrides.after : overrides.before)};}
    if(endpoint.includes('/files?')) return overrides.files || [{filename:'src/app.cs',status:'modified'}];
    if(endpoint.includes('/contents/')) {
      if(!endpoint.endsWith('?ref='+head) && !(endpoint.includes('documentation-baseline.json') && endpoint.endsWith('?ref='+'b'.repeat(40)))) throw Error('Read not pinned to audited head or base manifest');
      return {type:'file',encoding:'base64',content:Buffer.from(endpoint.includes('documentation-baseline.json')?JSON.stringify(ready()):text).toString('base64')};
    }
    throw Error('Unexpected API endpoint');
  };
  return {api,head};
}
test('API positive control: head-pinned files and stable metadata pass',()=>{
  const f=fixture();assert.equal(audit('wiselead-solutions/example','1',f.head,f.api).ok,true);
});
test('head movement, body edit, draft flip, labels and base movement fail closed',()=>{
  const mutations=[{head:{sha:'c'.repeat(40)}},{body:'edited'}, {draft:true},{labels:[{name:'guardian:skip'}]},{base:{sha:'c'.repeat(40)}}];
  for(const after of mutations){const f=fixture({after});assert.throws(()=>audit('wiselead-solutions/example','1',f.head,f.api));}
  const f=fixture();assert.throws(()=>audit('wiselead-solutions/example','1','c'.repeat(40),f.api));
});
test('truncated file inventories, unreadable API, draft and skip states cannot pass',()=>{
  for(const before of [{changed_files:2},{draft:true},{labels:[{name:'guardian:skip'}]}]) {
    const f=fixture({before});assert.throws(()=>audit('wiselead-solutions/example','1',f.head,f.api));
  }
  assert.throws(()=>audit('wiselead-solutions/example','1','',()=>{throw Error('API unavailable');}));
});

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const scriptDirectory = path.dirname(module.filename);
const {spawnSync} = require('node:child_process');
function cli(manifest, extraArgs=[]) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'documentation-gate-'));
  const gh=path.join(dir,'gh');
  const log=path.join(dir,'calls.jsonl');
  const cfg={manifest,body:body('unchanged'),head:'a'.repeat(40),outcome:extraArgs.find(arg=>arg.startsWith('fixture:'))};
  fs.writeFileSync(path.join(dir,'fixture.json'),JSON.stringify(cfg));
  fs.writeFileSync(gh, `#!/usr/bin/env node
const fs=require('node:fs');
const path=require('node:path');
const cfg=JSON.parse(fs.readFileSync(path.join(__dirname,'fixture.json'),'utf8'));
const args=process.argv.slice(2);
fs.appendFileSync(path.join(__dirname,'calls.jsonl'),JSON.stringify(args)+'\\n');
if(args[0]==='api' && args[1].endsWith('/pulls/1')) console.log(JSON.stringify({state:'open',merged:fs.existsSync(path.join(__dirname,'server-merged')),draft:false,head:{sha:cfg.head},base:{sha:'b'.repeat(40)},body:cfg.body,labels:[],changed_files:1}));
else if(args[0]==='api' && args[1].includes('/files?')) console.log(JSON.stringify([{filename:'src/app.cs',status:'modified'}]));
else if(args[0]==='api' && args[1].includes('/contents/')) console.log(JSON.stringify({type:'file',encoding:'base64',content:Buffer.from(args[1].includes('documentation-baseline.json')?JSON.stringify(cfg.manifest):'Verified canonical specification. '.repeat(10)).toString('base64')}));
else if(args[0]==='api' && args[1].endsWith('/merge')) {
  if(cfg.outcome==='fixture:refused') console.log(JSON.stringify({merged:false,message:'Queue policy requires a queue'}));
  else if(cfg.outcome==='fixture:lost-response') { fs.writeFileSync(path.join(__dirname,'server-merged'),'yes'); process.exit(1); }
  else console.log(JSON.stringify({merged:true,sha:cfg.head}));
}
else console.log('done');
`,{mode:0o755});
  const result=spawnSync(process.execPath,[path.join(scriptDirectory,'documentation-baseline.cjs'),'--merge','wiselead-solutions/example','1','--squash',...extraArgs],{
    encoding:'utf8',env:{...process.env,DOCUMENTATION_GH_PATH:gh,PATH:dir+path.delimiter+process.env.PATH},
  });
  const calls=fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse);
  fs.rmSync(dir,{recursive:true,force:true});
  return {result,calls};
}
test('CLI only executes a commit-bound merge after the positive audit',()=>{
  const {result,calls}=cli(ready(),['--auto']);assert.equal(result.status,0,result.stderr);
  const merges=calls.filter(args=>args[0]==='api'&&args[1].endsWith('/merge'));assert.equal(merges.length,1);
  assert.ok(merges[0].includes('PUT'));assert.ok(merges[0].includes('sha='+'a'.repeat(40)));
  assert.ok(merges[0].includes('merge_method=squash'));
  assert.ok(!merges[0].includes('--auto'));
});
test('CLI pending baseline never merges; disarms existing auto-merge and records a blocked label',()=>{
  const {result,calls}=cli(pending());assert.equal(result.status,1);assert.match(result.stderr,/baseline is pending/);
  const merges=calls.filter(args=>args[0]==='pr'&&args[1]==='merge');assert.equal(merges.length,1);
  assert.ok(merges[0].includes('--disable-auto'));assert.ok(calls.some(args=>args.includes('labels[]=guardian:blocked')));
});
test('CLI stale audited head cannot reach a merge',()=>{
  const {result,calls}=cli(ready(),['--match-head-commit','c'.repeat(40)]);assert.equal(result.status,1);
  assert.match(result.stderr,/head changed/);assert.ok(!calls.some(args=>args[0]==='api'&&args[1].endsWith('/merge')));
});

test('CLI immediate merge refuses queue-only responses without scheduling auto-merge',()=>{
  const {result,calls}=cli(ready(),['fixture:refused']);
  assert.equal(result.status,1); assert.match(result.stderr,/Queue policy/);
  assert.ok(!calls.some(args=>args[0]==='pr'&&args[1]==='merge'&&!args.includes('--disable-auto')));
});
test('CLI confirms a committed merge after a lost API response',()=>{
  const {result,calls}=cli(ready(),['fixture:lost-response']);
  assert.equal(result.status,0,result.stderr); assert.equal(JSON.parse(result.stdout).merged,true);
  assert.equal(calls.filter(args=>args[0]==='api'&&args[1].endsWith('/merge')).length,1);
});

// guardian-standard:tests:start
// Executes the actual shared audit body with in-process API doubles: never contacts GitHub.
{
  const fsG = require('node:fs');
  const osG = require('node:os');
  const pathG = require('node:path');
  const cpG = require('node:child_process');
  const cryptoG = require('node:crypto');
  const workflowG = fsG.readFileSync(pathG.join(__dirname, '../workflows/pr-guardian.yml'), 'utf8');
  const matchG = workflowG.match(/          # guardian-standard:audit:start\r?\n([\s\S]*?)          # guardian-standard:audit:end/);
  const auditG = matchG ? matchG[1].split(/\r?\n/).map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n') : '';
  test('guardian shared audit has the reviewed canonical digest', () => {
    assert.ok(matchG, 'shared audit extraction markers must remain');
    // Digest re-pinned for shakad#1981 (wiselead-solutions#243): the doc-baseline verify step is skipped for metadata-exempt PRs,
    // and the embedded validator skips the impact rows for Dependabot PRs (same change as wiselead-solutions#242).
    // Digest re-pinned for Guardian policy v2 step 1 (ai-org#170, as edusign#187): no request-changes, stale bot reviews dismissed on every audit.
    // Digest re-pinned for the review-thread gate (the merge was refused with HTTP 405 while a thread was open); no pre-merge ready claim.
    assert.equal(cryptoG.createHash('sha256').update(auditG).digest('hex'), 'bf038e5cc93a1858e2d86e319b3e335602f97c926ce12c2813448e2dd92c5a7f');
  });
  const bodyG = ['Executive Summary','Technical Summary','Testing','Risk & Rollout','Reviewer Guidance'].map(s => `## ${s}\nVerified change and evidence.`).join('\n\n')+'\nPart of #123';
  const prG = overrides => ({number:1,title:'Standard fixture',body:bodyG,isDraft:false,state:'OPEN',assignees:[{login:'owner'}],reviewRequests:[],labels:[],headRefName:'feature/standard',baseRefName:'main',headRefOid:'a'.repeat(40),author:{login:'owner'},autoMergeRequest:null,...overrides});
  const checkG = (conclusion='SUCCESS', extra={}) => ({name:'Build',workflowName:'Product - PR CI',startedAt:'2026-11-01T00:00:00Z',status:'COMPLETED',conclusion,detailsUrl:'https://github.com/wiselead-solutions/example/actions/runs/202/job/1',...extra});
  const harnessG = String.raw`
$ErrorActionPreference = 'Stop'
$fixture = Get-Content -Raw -LiteralPath $env:GUARDIAN_FIXTURE | ConvertFrom-Json
$script:refReads = @{}
function Record-Call($kind, $arguments) { @{kind=$kind;args=@($arguments);token=$env:GH_TOKEN} | ConvertTo-Json -Compress -Depth 20 | Add-Content -LiteralPath $env:GUARDIAN_CALLS }
function gh {
  Record-Call 'gh' $args
  $global:LASTEXITCODE=0
  if ($args[0] -eq 'pr') {
    $wanted = $args[2]
    $pr = @($fixture.prs | Where-Object { $_.number -eq $wanted })[0]
    switch ($args[1]) {
      'list' { if ($fixture.listFail) {$global:LASTEXITCODE=1;return}; ConvertTo-Json -InputObject @($fixture.prs) -Depth 30 -Compress;return }
      'view' {
        $fields = $args[[Array]::IndexOf($args,'--json')+1]
        if ($fields -eq 'statusCheckRollup,headRefOid') {
          if ($fixture.ciFail) {$global:LASTEXITCODE=1;return}
          @{statusCheckRollup=@($fixture.checks);headRefOid=$(if($fixture.ciHead){$fixture.ciHead}else{$pr.headRefOid})} | ConvertTo-Json -Depth 30 -Compress;return
        }
        if ($fields -eq 'mergeable') { @{mergeable=$(if($fixture.conflict){'CONFLICTING'}else{'MERGEABLE'})} | ConvertTo-Json -Compress;return }
        if ($fields -eq 'files') { @{files=@(@{path=$(if($fixture.workflowFile){'.github/workflows/pr-ci.yml'}else{'src/app.cs'})})} | ConvertTo-Json -Depth 5 -Compress;return }
        if ($fixture.final) { $fixture.final | ConvertTo-Json -Depth 30 -Compress } else { $pr | ConvertTo-Json -Depth 30 -Compress };return
      }
      'review' { if($fixture.writeFail){$global:LASTEXITCODE=1};return }
      'merge' {
        if ($args -contains '--disable-auto') {if($fixture.disarmFail){$global:LASTEXITCODE=1};return}
        if ($fixture.mergeFail -or $fixture.pushAfterRefCheck) {$global:LASTEXITCODE=1;Write-Output $(if($fixture.mergeMessage){$fixture.mergeMessage}else{'base branch policy prohibits the merge'})};return
      }
      'comment' { if($fixture.writeFail){$global:LASTEXITCODE=1};return }
      'update-branch' {return}
    }
  }
  if ($args[0] -eq 'api' -and $args[1] -eq 'graphql') {
    if ($fixture.threadsFail) {$global:LASTEXITCODE=1;return}
    if ($fixture.threadsMalformed) {Write-Output '{"data":null}';return}
    $all=@($fixture.threads | Where-Object {$_})
    $after=0
    $cursorArg=@($args | Where-Object {$_ -like 'cursor=*'})[0]
    if ($cursorArg) {$after=[int]($cursorArg -replace '^cursor=page','')}
    $size=if($fixture.threadPageSize){[int]$fixture.threadPageSize}else{100}
    $slice=@($all | Select-Object -Skip $after -First $size)
    $more=($after+$size) -lt $all.Count
    $nodes=@($slice | ForEach-Object {@{isResolved=[bool]$_.resolved;isOutdated=[bool]$_.outdated;path=$_.path;line=$_.line;originalLine=$_.originalLine;comments=@{nodes=@(@{author=@{login=$_.author}})}}})
    @{data=@{repository=@{pullRequest=@{reviewThreads=@{pageInfo=@{hasNextPage=$more;endCursor=$(if($more){"page$($after+$size)"}else{$null})};nodes=$nodes}}}}} | ConvertTo-Json -Depth 20 -Compress
    return
  }
  if ($args[0] -eq 'api') {
    $endpoint = @($args | Where-Object {$_ -like 'repos/*'})[0]
    if ($endpoint -match '/pulls/(?<number>[0-9]+)$') {
      $headPr = @($fixture.prs | Where-Object { $_.number -eq [int]$Matches.number })[0]
      if ($fixture.headMetadataFail) {$global:LASTEXITCODE=1;return}
      $payload=@{head=@{sha=$headPr.headRefOid;ref=$headPr.headRefName;repo=@{full_name=$(if($fixture.headRepo){$fixture.headRepo}else{'wiselead-solutions/example'})}}} | ConvertTo-Json -Compress -Depth 8
      if ($fixture.headMetadataArray) {Write-Output "[$payload]"} else {Write-Output $payload};return
    }
    if ($endpoint -match '/git/ref/heads/(?<branch>.+)$') {
      $branch=[Uri]::UnescapeDataString($Matches.branch)
      $refPr=@($fixture.prs | Where-Object { $_.headRefName -ceq $branch })[0]
      if ($fixture.refReadFail -or $fixture.refReadFailFor -eq $refPr.number) {$global:LASTEXITCODE=1;return}
      if ($fixture.refMalformed) {Write-Output 'not-json';return}
      $actual=$refPr.headRefOid
      $key="$($refPr.number)"
      if (-not $script:refReads.ContainsKey($key)) {$script:refReads[$key]=0}
      $script:refReads[$key]++
      if ($fixture.refHeads) {
        $value=$fixture.refHeads.PSObject.Properties[$key]
        if ($value) {$actual=$value.Value}
      }
      if ($fixture.finalRefHeads -and $script:refReads[$key] -gt 1) {
        $value=$fixture.finalRefHeads.PSObject.Properties[$key]
        if ($value) {$actual=$value.Value}
      }
      $payload=@{ref=$(if($fixture.actualRefName){$fixture.actualRefName}else{"refs/heads/$branch"});object=@{type=$(if($fixture.refType){$fixture.refType}else{'commit'});sha=$actual}} | ConvertTo-Json -Compress -Depth 8
      if ($fixture.refArray) {Write-Output "[$payload]"} else {Write-Output $payload};return
    }
    if ($endpoint -like '*/actions/workflows/pr-guardian.yml/runs*') { Write-Output '["101"]';return }
    if ($endpoint -eq 'repos/wiselead-solutions/example') { Write-Output $(if($fixture.repoAllowed){$fixture.repoAllowed}else{'squash,rebase,merge'});return }
    if ($endpoint -like '*/rules/branches/*') { Write-Output $(if($fixture.allowed){$fixture.allowed}else{'squash,rebase,merge'});return }
    if ($endpoint -like '*/collaborators*') { Write-Output $(if($fixture.collaborators){$fixture.collaborators}else{2});return }
    if ($endpoint -like '*/compare/*') { Write-Output $(if($fixture.behind){$fixture.behind}else{0});return }
    if ($endpoint -like '*/reviews?*') {
      if($fixture.reviewReadFail){$global:LASTEXITCODE=1;return}
      if(($args -join ' ') -like '*@base64*') {if($fixture.priorVerdict){[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($fixture.priorVerdict))};return}
      if ($fixture.staleReview) {Write-Output '500'}
      if ($fixture.unrelatedBotReview -and ($args -join ' ') -notlike '*contains("PR Guardian")*') {Write-Output '501'};return
    }
    if ($fixture.writeFail -and ($args -contains '--method')) {$global:LASTEXITCODE=1};return
  }
  throw "Unhandled fixture call: $args"
}
function node {
  Record-Call 'documentation' $args
  $global:LASTEXITCODE=0
  if($fixture.docFail -or ($fixture.docMergeFail -and $args -contains '--merge')){$global:LASTEXITCODE=1;Write-Output 'Documentation baseline audit rejected: pending documentation';return}
  if($args -contains '--merge') { gh pr merge $args[3] --match-head-commit $args[-1]; if($LASTEXITCODE -ne 0){Write-Output 'Guardian merge refused'} }
  else {Write-Output '{"ok":true}'}
}
`;
  function runG(config, env={}, script=auditG) {
    const dir=fsG.mkdtempSync(pathG.join(osG.tmpdir(),'guardian-standard-'));
    try {
      const fixture=pathG.join(dir,'fixture.json'), calls=pathG.join(dir,'calls.jsonl'), output=pathG.join(dir,'output');
      fsG.writeFileSync(fixture,JSON.stringify({prs:[prG()],checks:[checkG()],...config}));
      fsG.writeFileSync(calls,'');fsG.writeFileSync(output,'');
      fsG.mkdirSync(pathG.join(dir,'.github/workflows'),{recursive:true});
      fsG.writeFileSync(pathG.join(dir,'.github/workflows',config.onlyGuardian?'pr-guardian.yml':'fixture.yml'),config.workflowSource||(config.ciFree?'on: workflow_dispatch\n':'on:\n  pull_request:\n'));
      const scripts=pathG.join(dir,'audit.ps1');fsG.writeFileSync(scripts,harnessG+'\n'+script);
      // pwsh can die before it runs a line (a signal or hang gives status null; review-pop 2026-11-13T21:47 hit a .NET FileLoadException abort on a macOS runner).
      // That is a runner fault, not a policy result: retry up to twice with a long limit. A real policy failure still has a numeric status.
      const spawnAudit=()=>cpG.spawnSync('pwsh',['-NoLogo','-NoProfile','-NonInteractive','-File',scripts],{encoding:'utf8',timeout:120000,cwd:dir,env:{...process.env,GH_TOKEN:'fixture-only-token',GUARDIAN_MERGE_TOKEN:'',GUARDIAN_WORKFLOW_TOKEN:'',GUARDIAN_REQUIRE_REVIEWER:'false',GUARDIAN_RELEASE_METADATA_EXEMPT:'false',GUARDIAN_AUDIT_HELD:'false',GUARDIAN_STALE_BASE_THRESHOLD:'0',GUARDIAN_DEFAULT_BRANCH:'main',DOCUMENTATION_VALIDATOR_PATH:'fixture-only',GITHUB_REPOSITORY:'wiselead-solutions/example',GITHUB_RUN_ID:'101',GITHUB_OUTPUT:output,GUARDIAN_FIXTURE:fixture,GUARDIAN_CALLS:calls,...env}});
      let result=spawnAudit();
      for(let retry=0;result.status===null&&retry<2;retry++){fsG.writeFileSync(calls,'');fsG.writeFileSync(output,'');result=spawnAudit();}
      const logged=fsG.readFileSync(calls,'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
      return {result,logged,output:fsG.readFileSync(output,'utf8'),merged:logged.filter(c=>c.kind==='gh'&&c.args[0]==='pr'&&c.args[1]==='merge'&&!c.args.includes('--disable-auto')),reviews:logged.filter(c=>c.kind==='gh'&&c.args[0]==='pr'&&c.args[1]==='review')};
    } finally {fsG.rmSync(dir,{recursive:true,force:true});}
  }
  const casesG = [
    ['clean',{},true],
    ['draft',{prs:[prG({isDraft:true})]},false],
    ['assignee',{prs:[prG({assignees:[]})]},false],
    ...['Executive Summary','Technical Summary','Testing','Risk & Rollout','Reviewer Guidance'].map(s=>['missing '+s,{prs:[prG({body:bodyG.replace(s,'Removed heading')})]},false]),
    ['issue link',{prs:[prG({body:bodyG.replace('Part of #123','No issue')})]},false],
    ['escaped heading',{prs:[prG({body:bodyG.replace('Risk & Rollout','Risk &amp;amp; Rollout')})]},true],
    ['forged dependabot branch',{prs:[prG({headRefName:'dependabot/forged',body:'',assignees:[]})]},false],
    ['authenticated Dependabot',{prs:[prG({headRefName:'dependabot/update',author:{login:'app/dependabot'},body:'',assignees:[]})]},true],
    ['failed CI',{checks:[checkG('FAILURE')]},false],
    ['cancelled CI',{checks:[checkG('CANCELLED')]},false],
    ['pending CI',{checks:[checkG('',{status:'IN_PROGRESS'})]},false],
    ['unreadable CI',{ciFail:true},false],
    ['empty CI',{checks:[]},false],
    ['inline event list PR second',{checks:[],workflowSource:'on: [push, pull_request]\n'},false],
    ['quoted event key',{checks:[],workflowSource:'"on":\n  pull_request:\n'},false],
    ['unrecognised workflow structure',{checks:[],workflowSource:'unknown: event-source\n'},false],
    ['CI-free repository',{checks:[],ciFree:true},true],
    ['repository with only its Guardian',{checks:[],onlyGuardian:true},true],
    ['unreadable CI-free response',{ciFree:true,ciFail:true},false],
    ['wrong CI head',{ciHead:'b'.repeat(40)},false],
    ['cached PR head differs from branch',{refHeads:{1:'b'.repeat(40)}},false],
    ['unreadable head metadata',{headMetadataFail:true},false],
    ['array head metadata',{headMetadataArray:true},false],
    ['unreadable actual branch',{refReadFail:true},false],
    ['malformed actual branch',{refMalformed:true},false],
    ['array actual branch',{refArray:true},false],
    ['non-commit actual branch',{refType:'tag'},false],
    ['wrong actual branch name',{actualRefName:'refs/heads/other'},false],
    ['malformed actual head SHA',{refHeads:{1:'not-a-sha'}},false],
    ['head ref changes immediately before attempt',{finalRefHeads:{1:'b'.repeat(40)}},false],
    ['fork head repository',{headRepo:'fork-owner/example'},true],
    ['unsafe head repository',{headRepo:'../outside/extra'},false],
    ['parent head repository component',{headRepo:'../example'},false],
    ['dot head repository component',{headRepo:'owner/.'},false],
    ['different workflows',{checks:[checkG('FAILURE'),checkG('SUCCESS',{workflowName:'Other CI',startedAt:'2026-11-02T00:00:00Z'})]},false],
    ['superseded run',{checks:[checkG('CANCELLED'),checkG('SUCCESS',{startedAt:'2026-11-02T00:00:00Z'})]},true],
    ['queued rerun without start time',{checks:[checkG(),checkG('',{status:'QUEUED',startedAt:null})]},false],
    ['ignore only guardian run',{checks:[checkG('',{status:'IN_PROGRESS',detailsUrl:'https://github.com/wiselead-solutions/example/actions/runs/101/job/1'}),checkG()]},true],
    ['documentation pre-audit',{docFail:true},false],
    ['unresolved review thread',{threads:[{path:'src/app.cs',line:7,author:'reviewer-bot'}]},false],
    ['unresolved thread without a line',{threads:[{path:'src/app.cs',originalLine:3,author:'reviewer-bot'}]},false],
    ['resolved review thread',{threads:[{path:'src/app.cs',line:7,author:'reviewer-bot',resolved:true}]},true],
    ['outdated unresolved thread',{threads:[{path:'src/app.cs',line:7,author:'reviewer-bot',outdated:true}]},true],
    ['unresolved thread on a later page',{threads:[{resolved:true,path:'a',line:1,author:'x'},{resolved:true,path:'b',line:1,author:'x'},{path:'c.cs',line:9,author:'late-reviewer'}],threadPageSize:2},false],
    ['unreadable review threads',{threadsFail:true},false],
    ['malformed review threads',{threadsMalformed:true},false],
    ['conflict',{conflict:true},false],
    ['skip label',{prs:[prG({labels:[{name:'guardian:skip'}]})]},false],
    ['owner hold',{prs:[prG({labels:[{name:'blocked:owner'}]})]},false],
    ['hold arrives before merge',{final:prG({labels:[{name:'hold'}]})},false],
    ['head moves before merge',{final:prG({headRefOid:'b'.repeat(40)})},false],
    ['body changes before merge',{final:prG({body:'Removed required metadata'})},false],
    ['assignee removed before merge',{final:prG({assignees:[]})},false],
    ['failed verdict write',{writeFail:true},false],
    ['failed review read',{reviewReadFail:true},false],
    ['failed disarm',{prs:[prG({autoMergeRequest:{enabledAt:'2026-11-01'}})],disarmFail:true},false],
    ['stale base',{behind:16},false,{GUARDIAN_STALE_BASE_THRESHOLD:'15'}],
    ['reviewer required',{collaborators:2},false,{GUARDIAN_REQUIRE_REVIEWER:'true'}],
    ['single collaborator',{collaborators:1},true,{GUARDIAN_REQUIRE_REVIEWER:'true'}],
    ['audit held without merging',{prs:[prG({labels:[{name:'guardian:skip'}]})]},false,{GUARDIAN_AUDIT_HELD:'true'}],
  ];
  test('guardian actual audit executes its shared gates and repository adapters', () => {
    for(const [name,cfg,shouldMerge,env] of casesG) {
      const run=runG(cfg,env);
      assert.equal(run.result.status,0,name+': '+run.result.stderr+'\n'+run.result.stdout);
      assert.equal(run.merged.length>0,shouldMerge,name+': '+run.result.stdout+'\n'+JSON.stringify(run.reviews));
      if(cfg.docFail) assert.ok(!run.reviews.some(c=>c.args.includes('--comment')&&!/Blocked/.test(c.args.join(' '))),'documentation refusal never publishes a pass verdict');
      if(cfg.writeFail||cfg.reviewReadFail) assert.match(run.output,/gh_failures=[1-9]/,name+' must fail the final workflow step');
    }
    const batch=runG({prs:[prG(),prG({number:2})]});
    assert.equal(batch.merged.length,1,'at most one merge per sweep');
    const refusedBatch=runG({prs:[prG(),prG({number:2})],mergeFail:true});
    assert.equal(refusedBatch.merged.length,1,'an ambiguous first attempt must prevent a second merge attempt');
    const staleHeadBatch=runG({prs:[prG(),prG({number:2,headRefName:'feature/second'})],refHeads:{1:'b'.repeat(40)}});
    assert.equal(staleHeadBatch.merged.length,1,'a stale head must not consume the one merge attempt');
    assert.equal(String(staleHeadBatch.merged[0].args[2]),'2','the independently current PR gets the attempt');
    assert.ok(!staleHeadBatch.reviews.some(c=>String(c.args[2])==='1'&&c.args.includes('--comment')&&!/Blocked/.test(c.args.join(' '))),'stale cached PR cannot receive a passing verdict');
    const unreadableHeadBatch=runG({prs:[prG(),prG({number:2,headRefName:'feature/second'})],refReadFailFor:1});
    assert.equal(String(unreadableHeadBatch.merged[0]?.args[2]),'2','an unreadable branch must not block an independent current PR');
    const finalHeadBatch=runG({prs:[prG(),prG({number:2,headRefName:'feature/second'})],finalRefHeads:{1:'b'.repeat(40)}});
    assert.equal(String(finalHeadBatch.merged[0]?.args[2]),'2','a ref mismatch at the final check spends no merge attempt');
    const forkHead=runG({headRepo:'fork-owner/example'});
    assert.ok(forkHead.logged.some(c=>c.args.includes('repos/fork-owner/example/git/ref/heads/feature%2Fstandard')),'read the actual fork repository and encode its branch path');
    const refPush=runG({prs:[prG(),prG({number:2,headRefName:'feature/second'})],pushAfterRefCheck:true});
    assert.equal(refPush.merged.length,1,'a post-ref-check push still consumes only one refused SHA-bound attempt');
    const shaIndex=refPush.merged[0].args.indexOf('--match-head-commit');
    assert.equal(refPush.merged[0].args[shaIndex+1],'a'.repeat(40),'never replace the audited SHA with a newer branch SHA');
    assert.match(refPush.output,/merged=false/,'a refused attempt cannot be reported as merged');
    assert.doesNotMatch(auditG,/--delete-branch/,'branch cleanup must not obscure the merge outcome');
    const bodyOf=run=>run.logged.filter(c=>c.kind==='gh'&&c.args[0]==='pr'&&c.args[1]==='review').map(c=>String(c.args[c.args.indexOf('--body')+1]));
    const blockedLabel=run=>run.logged.some(c=>c.kind==='gh'&&c.args[0]==='api'&&c.args.includes('labels[]=guardian:blocked'));
    const labelCleared=run=>run.logged.some(c=>c.kind==='gh'&&c.args[0]==='api'&&c.args.includes('DELETE')&&c.args.some(a=>String(a).endsWith('/labels/guardian%3Ablocked')));
    const threaded=runG({threads:[{path:'src/app.cs',line:7,author:'reviewer-bot'},{resolved:true,path:'done.cs',line:1,author:'other'},{path:'old.cs',line:2,author:'stale',outdated:true}]});
    assert.equal(threaded.merged.length,0,'an unresolved thread prevents the merge attempt');
    const threadVerdict=bodyOf(threaded).join('\n');
    assert.match(threadVerdict,/Blocked/); assert.match(threadVerdict,/src\/app\.cs:7 by @reviewer-bot/);
    assert.doesNotMatch(threadVerdict,/done\.cs|old\.cs/,'resolved and outdated threads are not listed');
    assert.ok(blockedLabel(threaded),'guardian:blocked stays on while a thread is open');
    assert.ok(!labelCleared(threaded),'guardian:blocked is not cleared while a thread is open');
    const paged=runG({threads:[{path:'a',line:1,author:'x'},{path:'b',line:1,author:'x'},{path:'c.cs',line:9,author:'late-reviewer'}],threadPageSize:2});
    assert.match(bodyOf(paged).join('\n'),/c\.cs:9 by @late-reviewer/,'every page of review threads is audited');
    const ruleset=runG({mergeFail:true,mergeMessage:'All comments must be resolved. (HTTP 405)'});
    const refusalVerdicts=bodyOf(ruleset);
    assert.ok(!refusalVerdicts.some(b=>/ready, and merging/.test(b)),'a merge that was refused is never announced as ready and merging');
    assert.ok(refusalVerdicts.some(b=>/Blocked/.test(b)&&/All comments must be resolved\. \(HTTP 405\)/.test(b)),'the refusal text is posted in a Blocked verdict');
    assert.ok(ruleset.logged.some(c=>c.kind==='gh'&&c.args[0]==='pr'&&c.args[1]==='review'&&c.args.includes('--comment')&&/Blocked/.test(c.args.join(' '))),'the refusal verdict is a Blocked COMMENT review (policy v2: never request changes)');
    assert.ok(blockedLabel(ruleset),'a refused merge applies guardian:blocked');
    assert.ok(!labelCleared(ruleset),'a refused merge never clears guardian:blocked');
    assert.match(ruleset.output,/merged=false/);
    const success=runG({});
    assert.ok(!bodyOf(success).some(b=>/ready, and merging/.test(b)),'no pre-merge ready-and-merging claim');
    const mergeAt=success.logged.findIndex(c=>c.kind==='documentation'&&c.args.includes('--merge'));
    const clearAt=success.logged.findIndex(c=>c.kind==='gh'&&c.args[0]==='api'&&c.args.some(a=>String(a).endsWith('/labels/guardian%3Ablocked')));
    const noticeAt=success.logged.findIndex(c=>c.kind==='gh'&&c.args[0]==='pr'&&c.args[1]==='comment'&&c.args.some(a=>/merged/.test(String(a))));
    assert.ok(mergeAt>=0&&clearAt>mergeAt&&noticeAt>mergeAt,'the label is cleared and "merged" is announced only after the merge call succeeds');
    assert.doesNotMatch(auditG,/ready, and merging/,'the audit never contains the pre-merge ready claim');
    const failedList=runG({listFail:true});assert.notEqual(failedList.result.status,0,'unreadable inventory cannot mean zero PRs');
    const unrelated=runG({staleReview:true,unrelatedBotReview:true});
    assert.ok(unrelated.logged.some(c=>c.args.some(a=>String(a).includes('/reviews/500/dismissals'))),'dismiss own stale review');
    assert.ok(!unrelated.logged.some(c=>c.args.some(a=>String(a).includes('/reviews/501/dismissals'))),'preserve unrelated bot review');
    const appRecovery=runG({workflowFile:true,mergeFail:true},{GUARDIAN_WORKFLOW_TOKEN:'fixture-app-token'});
    assert.ok(appRecovery.logged.some(c=>c.kind==='gh'&&c.args[0]==='pr'&&c.args[1]==='update-branch'),'App merge refusal still reaches branch-update recovery');
    const docRecovery=runG({workflowFile:true,docMergeFail:true},{GUARDIAN_WORKFLOW_TOKEN:'fixture-app-token'});
    assert.ok(!docRecovery.logged.some(c=>c.kind==='gh'&&c.args[0]==='pr'&&c.args[1]==='update-branch'),'documentation rejection is not a stale-base recovery');
    for(const [head,allowed,method] of [['feature/x',null,'--squash'],['release/2026.45',null,'--merge'],['hotfix/x',null,'--merge'],['backmerge/x',null,'--merge'],['release/2026.45','rebase','--rebase']]) {
      const run=runG({prs:[prG({headRefName:head})],allowed});
      assert.ok(run.logged.some(c=>c.kind==='documentation'&&c.args.includes('--merge')&&c.args.includes(method)),head+' selects '+method);
    }
    const squashOnly=runG({prs:[prG({headRefName:'release/2026.45'})],repoAllowed:'squash'});
    assert.ok(squashOnly.logged.some(c=>c.kind==='documentation'&&c.args.includes('--merge')&&c.args.includes('--squash')),'repository squash-only policy composes with branch rules');
    const mutation=runG({checks:[checkG('FAILURE')]},{},auditG.replace("if (@($CI_OTHER | Where-Object { $_.bucket -eq 'fail' -or $_.bucket -eq 'cancel' }).Count -gt 0)", 'if ($false)'));
    assert.equal(mutation.merged.length,1,'the failing-CI fixture must detect a removed CI gate');
  });
  test('guardian wrapper runs trusted policy with serialized audits and no future auto-merge', () => {
    assert.match(workflowG,/\n  pull_request_target:/);
    assert.doesNotMatch(workflowG,/\n  pull_request(?:_review)?:/);
    assert.match(workflowG,/ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
    assert.match(workflowG,/persist-credentials: false/);
    assert.match(workflowG,/group: pr-guardian-\$\{\{ github\.repository \}\}\$\{\{ github\.event_name == 'pull_request_target' && format\('-pr-\{0\}', github\.event\.pull_request\.number\) \|\| '' \}\}/);
    assert.match(workflowG,/cancel-in-progress: false/);
    assert.doesNotMatch(auditG,/--auto(?:\s|$)/);
    assert.match(auditG,/--match-head-commit/);
    assert.match(auditG,/--limit 1000/);
    assert.match(workflowG,/Fail if a verdict could not be recorded/);
  });
  test('guardian trusted validator binds merge metadata and all explicit hold labels', () => {
    const {audit: apiAudit,AREAS: areas}=require('./documentation-baseline.cjs');
    const before={state:'open',draft:false,head:{sha:'a'.repeat(40)},base:{sha:'b'.repeat(40),ref:'main'},body:bodyG,labels:[],changed_files:1,assignees:[{login:'owner'}],requested_reviewers:[],requested_teams:[]};
    const manifest={version:1,areas:Object.fromEntries(areas.map(a=>[a,{status:'pending',issue:'https://github.com/wiselead-solutions/example/issues/1'}]))};
    const apiFor = (initial=before,after=initial) => {
      let reads=0;
      return endpoint => {
        if(endpoint.endsWith('/pulls/1')) return ++reads===1?initial:after;
        if(endpoint.includes('/files?')) return [{filename:'docs/standard.md',status:'modified'}];
        if(endpoint.includes('/contents/')) return {type:'file',encoding:'base64',content:Buffer.from(JSON.stringify(manifest)).toString('base64')};
        throw Error('Unexpected endpoint '+endpoint);
      };
    };
    const prior=process.env.DOCUMENTATION_EXPECTED_METADATA;
    try {
      process.env.DOCUMENTATION_EXPECTED_METADATA=JSON.stringify({body:cryptoG.createHash('sha256').update(bodyG).digest('hex'),base:'main',assignees:['owner'],reviewers:0});
      assert.equal(apiAudit('wiselead-solutions/example','1','a'.repeat(40),apiFor()).ok,true);
      for(const label of ['guardian:skip','hold','blocked:owner','paused-hold']) assert.throws(()=>apiAudit('wiselead-solutions/example','1','a'.repeat(40),apiFor({...before,labels:[{name:label}]})),/hold|skip/i);
      for(const change of [{body:'Removed metadata'},{assignees:[]},{base:{...before.base,ref:'other'}},{requested_reviewers:[{login:'new-reviewer'}]}]) {
        assert.throws(()=>apiAudit('wiselead-solutions/example','1','a'.repeat(40),apiFor({...before,...change})),/metadata changed/);
        assert.throws(()=>apiAudit('wiselead-solutions/example','1','a'.repeat(40),apiFor(before,{...before,...change})),/changed during/);
      }
    } finally {if(prior===undefined) delete process.env.DOCUMENTATION_EXPECTED_METADATA;else process.env.DOCUMENTATION_EXPECTED_METADATA=prior;}
  });
  test('guardian standard prevents self-clearing baseline holds and deleting policy assets', () => {
    const {validate: validatePolicy,AREAS: areas,documentationOnly: docsOnly}=require('./documentation-baseline.cjs');
    const readyManifest={version:1,areas:Object.fromEntries(areas.map(a=>[a,{status:'ready',documents:[`docs/${a}.md`],owner:'tech-lead',coverage:'Defines verified requirements and testable acceptance criteria for this area.'}]))};
    const pendingManifest={version:1,areas:Object.fromEntries(areas.map(a=>[a,{status:'pending',issue:'https://github.com/wiselead-solutions/example/issues/1'}]))};
    const content='## Technical Summary\n\n| Area | Impact | Evidence / reason |\n| --- | --- | --- |\n'+areas.map(a=>`| ${a} | unchanged | \`docs/${a}.md\` — Verified acceptance criteria remain unchanged by this adjustment. |`).join('\n')+'\n\n## Testing\nVerified.';
    const input={manifest:readyManifest,baseManifest:readyManifest,files:[{filename:'src/app.cs',status:'modified'}],body:content,readDocument:()=> '# Canonical specification\n\n'+'Verified requirements and acceptance criteria. '.repeat(8)};
    assert.equal(validatePolicy(input).ok,true,'positive implementation control');
    const adoption=validatePolicy({...input,baseManifest:pendingManifest});
    assert.equal(adoption.ok,false,'implementation cannot clear its own pending baseline');
    assert.ok(adoption.reasons.some(r=>r.includes('base branch manifest')));
    const rewritten=JSON.parse(JSON.stringify(readyManifest));rewritten.areas.prd.coverage+=' Additional claims.';
    assert.equal(validatePolicy({...input,manifest:rewritten}).ok,false,'implementation cannot rewrite resolved evidence');
    assert.equal(docsOnly([{filename:'.github/workflows/pr-guardian.yml',status:'removed'}]),false,'deleting enforcement is not documentation-only');
  });
}
// guardian-standard:tests:end

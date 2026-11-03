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
  const cfg={manifest,body:body('unchanged'),head:'a'.repeat(40)};
  fs.writeFileSync(path.join(dir,'fixture.json'),JSON.stringify(cfg));
  fs.writeFileSync(gh, `#!/usr/bin/env node
const fs=require('node:fs');
const path=require('node:path');
const cfg=JSON.parse(fs.readFileSync(path.join(__dirname,'fixture.json'),'utf8'));
const args=process.argv.slice(2);
fs.appendFileSync(path.join(__dirname,'calls.jsonl'),JSON.stringify(args)+'\\n');
if(args[0]==='api' && args[1].endsWith('/pulls/1')) console.log(JSON.stringify({state:'open',draft:false,head:{sha:cfg.head},base:{sha:'b'.repeat(40)},body:cfg.body,labels:[],changed_files:1}));
else if(args[0]==='api' && args[1].includes('/files?')) console.log(JSON.stringify([{filename:'src/app.cs',status:'modified'}]));
else if(args[0]==='api' && args[1].includes('/contents/')) console.log(JSON.stringify({type:'file',encoding:'base64',content:Buffer.from(args[1].includes('documentation-baseline.json')?JSON.stringify(cfg.manifest):'Verified canonical specification. '.repeat(10)).toString('base64')}));
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
  const merges=calls.filter(args=>args[0]==='pr'&&args[1]==='merge');assert.equal(merges.length,1);
  assert.ok(merges[0].includes('--match-head-commit'));assert.ok(merges[0].includes('a'.repeat(40)));
  assert.ok(!merges[0].includes('--auto'));
});
test('CLI pending baseline never merges; disarms existing auto-merge and records a blocked label',()=>{
  const {result,calls}=cli(pending());assert.equal(result.status,1);assert.match(result.stderr,/baseline is pending/);
  const merges=calls.filter(args=>args[0]==='pr'&&args[1]==='merge');assert.equal(merges.length,1);
  assert.ok(merges[0].includes('--disable-auto'));assert.ok(calls.some(args=>args.includes('labels[]=guardian:blocked')));
});
test('CLI stale audited head cannot reach a merge',()=>{
  const {result,calls}=cli(ready(),['--match-head-commit','c'.repeat(40)]);assert.equal(result.status,1);
  assert.match(result.stderr,/head changed/);assert.ok(!calls.some(args=>args[0]==='pr'&&args[1]==='merge'&&!args.includes('--disable-auto')));
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
    assert.equal(cryptoG.createHash('sha256').update(auditG).digest('hex'), '1e491d6a20c6d31edfa394c185fe5d9ab117520ac6c6502d0a8a425694fa7b72');
  });
  const bodyG = ['Executive Summary','Technical Summary','Testing','Risk & Rollout','Reviewer Guidance'].map(s => `## ${s}\nVerified change and evidence.`).join('\n\n')+'\nPart of #123';
  const prG = overrides => ({number:1,title:'Standard fixture',body:bodyG,isDraft:false,state:'OPEN',assignees:[{login:'owner'}],reviewRequests:[],labels:[],headRefName:'feature/standard',baseRefName:'main',headRefOid:'a'.repeat(40),author:{login:'owner'},autoMergeRequest:null,...overrides});
  const checkG = (conclusion='SUCCESS', extra={}) => ({name:'Build',workflowName:'Product - PR CI',startedAt:'2026-11-01T00:00:00Z',status:'COMPLETED',conclusion,detailsUrl:'https://github.com/wiselead-solutions/example/actions/runs/202/job/1',...extra});
  const harnessG = String.raw`
$ErrorActionPreference = 'Stop'
$fixture = Get-Content -Raw -LiteralPath $env:GUARDIAN_FIXTURE | ConvertFrom-Json
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
        if ($fixture.mergeFail) {$global:LASTEXITCODE=1;Write-Output 'base branch policy prohibits the merge'};return
      }
      'update-branch' {return}
    }
  }
  if ($args[0] -eq 'api') {
    $endpoint = @($args | Where-Object {$_ -like 'repos/*'})[0]
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
  if($args -contains '--merge') { gh pr merge $args[3] --match-head-commit $args[-1]; if($LASTEXITCODE -ne 0){Write-Output 'Guardian merge refused: base branch policy prohibits the merge'} }
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
      fsG.writeFileSync(pathG.join(dir,'.github/workflows',config.onlyGuardian?'pr-guardian.yml':'fixture.yml'),config.ciFree?'on: workflow_dispatch\n':'on:\n  pull_request:\n');
      const scripts=pathG.join(dir,'audit.ps1');fsG.writeFileSync(scripts,harnessG+'\n'+script);
      const result=cpG.spawnSync('pwsh',['-NoLogo','-NoProfile','-NonInteractive','-File',scripts],{encoding:'utf8',timeout:30000,cwd:dir,env:{...process.env,GH_TOKEN:'fixture-only-token',GUARDIAN_MERGE_TOKEN:'',GUARDIAN_WORKFLOW_TOKEN:'',GUARDIAN_REQUIRE_REVIEWER:'false',GUARDIAN_RELEASE_METADATA_EXEMPT:'false',GUARDIAN_AUDIT_HELD:'false',GUARDIAN_STALE_BASE_THRESHOLD:'0',GUARDIAN_DEFAULT_BRANCH:'main',DOCUMENTATION_VALIDATOR_PATH:'fixture-only',GITHUB_REPOSITORY:'wiselead-solutions/example',GITHUB_RUN_ID:'101',GITHUB_OUTPUT:output,GUARDIAN_FIXTURE:fixture,GUARDIAN_CALLS:calls,...env}});
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
    ['CI-free repository',{checks:[],ciFree:true},true],
    ['repository with only its Guardian',{checks:[],onlyGuardian:true},true],
    ['unreadable CI-free response',{ciFree:true,ciFail:true},false],
    ['wrong CI head',{ciHead:'b'.repeat(40)},false],
    ['different workflows',{checks:[checkG('FAILURE'),checkG('SUCCESS',{workflowName:'Other CI',startedAt:'2026-11-02T00:00:00Z'})]},false],
    ['superseded run',{checks:[checkG('CANCELLED'),checkG('SUCCESS',{startedAt:'2026-11-02T00:00:00Z'})]},true],
    ['queued rerun without start time',{checks:[checkG(),checkG('',{status:'QUEUED',startedAt:null})]},false],
    ['ignore only guardian run',{checks:[checkG('',{status:'IN_PROGRESS',detailsUrl:'https://github.com/wiselead-solutions/example/actions/runs/101/job/1'}),checkG()]},true],
    ['documentation pre-audit',{docFail:true},false],
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
      if(cfg.docFail) assert.ok(!run.reviews.some(c=>c.args.includes('--comment')),'documentation refusal never publishes a pass verdict');
      if(cfg.writeFail||cfg.reviewReadFail) assert.match(run.output,/gh_failures=[1-9]/,name+' must fail the final workflow step');
    }
    const batch=runG({prs:[prG(),prG({number:2})]});
    assert.equal(batch.merged.length,1,'at most one merge per sweep');
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
    assert.match(workflowG,/group: pr-guardian-\$\{\{ github\.repository \}\}/);
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
}
// guardian-standard:tests:end

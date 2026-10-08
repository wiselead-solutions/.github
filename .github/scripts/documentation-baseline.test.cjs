'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
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
function fixture(overrides={}) {
  const head='a'.repeat(40);
  const pr={state:'open',draft:false,head:{sha:head},base:{sha:'b'.repeat(40)},body:body('unchanged'),labels:[],changed_files:1};
  let reads=0;
  const api=endpoint=> {
    if(endpoint.endsWith('/pulls/1')) {reads++;return {...pr,...(reads>1 ? overrides.after : overrides.before)};}
    if(endpoint.includes('/files?')) return overrides.files || [{filename:'src/app.cs',status:'modified'}];
    if(endpoint.includes('/contents/')) {
      if(!endpoint.endsWith('?ref='+head)) throw Error('Read not pinned to audited head');
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
  const result=spawnSync(process.execPath,[path.join(__dirname,'documentation-baseline.cjs'),'--merge','wiselead-solutions/example','1','--squash',...extraArgs],{
    encoding:'utf8',env:{...process.env,PATH:dir+path.delimiter+process.env.PATH},
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

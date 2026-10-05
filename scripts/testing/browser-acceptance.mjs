#!/usr/bin/env node
/** Portable handoff utilities only: loopback fixtures, file hashes and strict reports. Never launches a browser. */
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {validatePassEvidence} from './browser-acceptance-evidence.mjs';
import {runEvidenceRegressions} from './browser-acceptance-selfcheck.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const docs = path.join(root, 'docs/browser-acceptance');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const fixtureFiles = new Map([
  ['/fixtures/unified.html', 'tests/fixtures/unified-translation-fixture.html'],
  ['/fixtures/all-nodes.html', 'tests/fixtures/all-nodes-translation-fixture.html'],
  ['/fixtures/dynamic-shadow.html', 'tests/fixtures/translation-pages/dynamic-shadow-replacement.html'],
]);
const fixtureSource = 'Reading should feel calm and effortless. Colors and lines should follow the page you are reading.';
const fixtureTranslation = '【本地夹具】阅读应该轻松、自然。颜色和线条应当贴合你正在阅读的网页。';
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>FluentRead local acceptance</title>
<style>body{font:18px/1.7 system-ui;max-width:900px;margin:32px auto;padding:0 20px}img{display:block;max-width:100%;border:1px solid #aaa;margin:20px 0}textarea{width:100%;height:150px}</style>
<h1 translate="no">FluentRead local acceptance fixtures</h1><p translate="no">Synthetic content only. This page does not run models or simulate YouTube.</p>
<nav translate="no"><a href="/fixtures/unified.html">Existing unified fixture</a> · <a href="/fixtures/all-nodes.html">Existing all-nodes fixture</a> · <a href="/fixtures/dynamic-shadow.html">Existing dynamic Shadow DOM fixture</a></nav>
<h2 translate="no">Routing and privacy</h2><p>${fixtureSource}</p><p>Private translation marker alpha. The same synthetic sentence may be used in both windows.</p>
<h2 translate="no">Single image</h2><img id="single-image" alt="Synthetic single-image OCR input">
<h2 translate="no">Manga image</h2><img id="manga-image" alt="Synthetic comic OCR input">
<h2 translate="no">TTS text with ending markers</h2><textarea id="tts-text" aria-label="Synthetic TTS text" readonly></textarea>
<script>
const draw=(id,manga)=>{const c=document.createElement('canvas');c.width=900;c.height=manga?620:280;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.fillStyle='#111';x.font='32px sans-serif';if(manga){x.strokeStyle='#111';x.lineWidth=3;x.beginPath();x.ellipse(450,190,420,145,0,0,Math.PI*2);x.stroke();x.fillText('Welcome to FluentRead',180,165);x.fillText('Read every page',270,220);x.fillText('Scroll to continue',240,480);}else{x.fillText('Welcome to FluentRead',70,105);x.fillText('Read every page',70,175);}document.getElementById(id).src=c.toDataURL('image/png');};draw('single-image',false);draw('manga-image',true);
document.getElementById('tts-text').value=('今天是2026年10月4日。第12345位读者记录了56.78元，请完整朗读这些日期和数字。我们正在检查句子顺序和长文本结尾。').repeat(16)+'中文结尾哨兵：最后一句已经完整读完。 English ending marker: the final sentence is complete.';
</script></html>`;

async function startFixtureServer() {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    try {
      const address = server.address();
      if (request.headers.host !== `127.0.0.1:${address.port}`) {
        response.writeHead(403); response.end('Loopback host required'); return;
      }
      const url = new URL(request.url, `http://127.0.0.1:${address.port}`);
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      const endpoint = /^\/(?:slow\/|fail\/)?v1\/chat\/completions$/u.test(url.pathname);
      if (endpoint) {
        response.setHeader('Access-Control-Allow-Origin', '*');
        response.setHeader('Access-Control-Allow-Headers', 'authorization,content-type');
        response.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
        if (request.method === 'OPTIONS') {response.writeHead(204); response.end(); return;}
        if (request.method !== 'POST') {response.writeHead(405); response.end(); return;}
        if (request.headers.authorization && request.headers.authorization !== 'Bearer fixture-not-secret') {
          response.writeHead(400); response.end('Only the documented synthetic credential is accepted'); return;
        }
        let size = 0;
        const chunks = [];
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 65536) {response.writeHead(413); response.end('Fixture request too large'); return;}
          chunks.push(chunk);
        }
        let body;
        try {body = JSON.parse(Buffer.concat(chunks).toString());}
        catch {response.writeHead(400); response.end('Invalid JSON'); return;}
        if (!['fixture-normal', 'fixture-private'].includes(body?.model) || !Array.isArray(body.messages) || body.stream) {
          response.writeHead(400); response.end('Use fixture-normal/private, messages and non-streaming mode'); return;
        }
        const mode = url.pathname.startsWith('/fail/') ? 'injected-503' : url.pathname.startsWith('/slow/') ? 'delayed-2200ms' : 'fixed';
        requests.push({sequence: requests.length + 1, model: body.model, mode});
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        if (mode === 'injected-503') {response.writeHead(503); response.end(JSON.stringify({error:{message:'Explicit local fixture failure'}})); return;}
        if (mode === 'delayed-2200ms') await new Promise(resolve => setTimeout(resolve, 2200));
        response.end(JSON.stringify({id:'fluentread-local-fixture',object:'chat.completion',created:1,model:body.model,
          choices:[{index:0,message:{role:'assistant',content:fixtureTranslation},finish_reason:'stop'}],
          usage:{prompt_tokens:7,completion_tokens:11,total_tokens:18}})); return;
      }
      if (request.method !== 'GET') {response.writeHead(405); response.end(); return;}
      if (url.pathname === '/metrics') {
        response.setHeader('Content-Type','application/json; charset=utf-8');
        response.end(JSON.stringify({synthetic:true,requests})); return;
      }
      if (url.pathname === '/') {response.setHeader('Content-Type','text/html; charset=utf-8'); response.end(html); return;}
      const file = fixtureFiles.get(url.pathname);
      if (file) {response.setHeader('Content-Type','text/html; charset=utf-8'); response.end(await fs.readFile(path.join(root,file))); return;}
      response.writeHead(404); response.end('Not an allowlisted fixture');
    } catch {
      if (!response.headersSent) response.writeHead(500);
      response.end('Local fixture error');
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  await new Promise((resolve,reject) => {server.once('error',reject); server.listen(0,'127.0.0.1',resolve);});
  return {server, url:`http://127.0.0.1:${server.address().port}`};
}

async function fingerprint(directory, kind = 'files') {
  const entries = [];
  async function walk(relative) {
    for (const item of (await fs.readdir(path.join(directory,relative),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))) {
      const file = path.join(relative,item.name);
      if (item.isSymbolicLink()) throw new Error('Fingerprint refuses symbolic links');
      if (item.isDirectory()) await walk(file);
      else if (item.isFile()) {
        const bytes = await fs.readFile(path.join(directory,file));
        entries.push({path:file.split(path.sep).join('/'),size:bytes.length,sha256:sha256(bytes)});
      }
    }
  }
  await walk('');
  return {kind,algorithm:'sha256',files:entries,manifestSha256:sha256(JSON.stringify(entries)),...(kind==='extension-build'?{extensionManifestText:await fs.readFile(path.join(directory,'manifest.json'),'utf8')}:{})};
}

// This deliberately implements only the keywords used by the checked-in schema.
// Unknown schema keywords fail closed so extending the schema cannot silently weaken validation.
function validateShape(value, schema, location = '$') {
  const supported = new Set(['$schema','title','description','type','anyOf','const','enum','properties','required','additionalProperties','items','minItems','minLength','minimum','pattern']);
  for (const key of Object.keys(schema)) assert(supported.has(key),`Unsupported schema keyword ${key}`);
  if (schema.anyOf) {
    assert(schema.anyOf.some(branch=>{try {validateShape(value,branch,location);return true;} catch {return false;}}),`${location}: no matching type`); return;
  }
  if ('const' in schema) assert.deepEqual(value,schema.const,`${location}: wrong constant`);
  if (schema.enum) assert(schema.enum.includes(value),`${location}: invalid enum`);
  if (schema.type) {
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    assert(actual === schema.type || (schema.type === 'integer' && Number.isInteger(value)),`${location}: expected ${schema.type}`);
  }
  if (typeof value === 'number') {assert(Number.isFinite(value),`${location}: non-finite`);if ('minimum' in schema) assert(value>=schema.minimum,`${location}: too small`);}
  if (typeof value === 'string') {
    if (schema.minLength) assert(value.length>=schema.minLength,`${location}: empty string`);
    if (schema.pattern) assert(new RegExp(schema.pattern,'u').test(value),`${location}: invalid format`);
  }
  if (Array.isArray(value)) {if (schema.minItems) assert(value.length>=schema.minItems,`${location}: missing entries`);if(schema.items)value.forEach((item,i)=>validateShape(item,schema.items,`${location}[${i}]`));}
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required || []) assert(Object.hasOwn(value,key),`${location}: missing ${key}`);
    for (const [key,item] of Object.entries(value)) {
      if (schema.properties?.[key]) validateShape(item,schema.properties[key],`${location}.${key}`);
      else if (schema.additionalProperties === false) assert.fail(`${location}: unexpected ${key}`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') validateShape(item,schema.additionalProperties,`${location}.${key}`);
    }
  }
}

async function validateReport(report, evidenceRoot) {
  validateShape(report,await readJson(path.join(docs,'result.schema.json')));
  const template = await readJson(path.join(docs,'result.template.json'));
  assert.deepEqual(report.cases.map(c=>c.id).sort(),template.cases.map(c=>c.id).sort(),'Case IDs must appear exactly once');
  const overall = report.cases.some(c=>c.status==='fail') ? 'fail' : report.cases.every(c=>c.status==='pass') ? 'pass' : 'blocked';
  assert.equal(report.overall,overall,'Overall status must include all cases');
  const artifacts = new Map();
  const base = await fs.realpath(evidenceRoot);
  for (const artifact of report.artifacts) {
    assert(!artifacts.has(artifact.path),'Duplicate artifact path');
    assert(!artifact.path.includes('\\') && !path.isAbsolute(artifact.path) && !artifact.path.split('/').includes('..'),'Artifact path must stay relative');
    const actual = await fs.realpath(path.join(base,artifact.path));
    assert(actual.startsWith(base+path.sep),'Artifact symlink escaped evidence directory');
    assert.equal(sha256(await fs.readFile(actual)),artifact.sha256,`Artifact digest mismatch: ${artifact.path}`);
    artifacts.set(artifact.path,{...artifact,bytes:await fs.readFile(actual)});
  }
  for (const item of report.cases) {
    assert.equal(item.kind,template.cases.find(c=>c.id===item.id).kind,`${item.id}: evidence class changed`);
    assert(item.reason.trim(),`${item.id}: explain the result`);
    for (const evidence of item.evidence) assert(artifacts.has(evidence),`${item.id}: unregistered evidence`);
    if (item.status !== 'blocked') {
      assert(item.evidence.length>0 && item.observations.length>0,`${item.id}: observed results need evidence`);
      assert(report.startedAt && report.finishedAt,'Executed results need timestamps');
      assert(report.environment.profileKind==='dedicated-temporary','Executed results require owned temporary profile');
      for (const key of ['browser','browserVersion','browserosVersion','launchMode','focusPolicy','windowPlacement','profileMarker','extensionId']) assert(report.environment[key],`Missing ${key}`);
      assert(report.provenance.publishedSourceCommit && report.provenance.checkoutCommit && report.provenance.observedSourceTree===report.expectedSourceTree,'Executed results require exact source provenance');
      assert.equal(report.provenance.checkoutCommit,report.provenance.publishedSourceCommit,'Checkout must match the published source commit');
      assert(report.provenance.worktreeCleanBeforeLocaleGeneration===true && report.provenance.lockfileSha256,'Executed results require a clean source worktree and lockfile hash');
      assert(report.environment.browserExecutableSha256,'Executed results require browser binary identity');
      assert(report.provenance.buildManifest && artifacts.has(report.provenance.buildManifest),'Executed results require build manifest evidence');
    }
  }
  await validatePassEvidence(report,artifacts,root);

  for(const evidence of report.hardware.evidence) assert(artifacts.has(evidence),'Hardware evidence not registered');
  for(const evidence of report.environment.capabilityEvidence) assert(artifacts.has(evidence),'Capability evidence not registered');
  for(const value of [report.startedAt,report.finishedAt]) if(value) assert(Number.isFinite(Date.parse(value)),'Invalid timestamp');
  if(report.startedAt && report.finishedAt) assert(Date.parse(report.finishedAt)>=Date.parse(report.startedAt),'Reversed timestamps');
  return {valid:true,overall,cases:report.cases.length};
}

async function selfCheck() {
  const template = await readJson(path.join(docs,'result.template.json'));
  await validateReport(template,docs);
  const invalid = structuredClone(template);invalid.cases[0].status='pass';
  await assert.rejects(()=>validateReport(invalid,docs));
  const duplicate = structuredClone(template);duplicate.cases[1]=duplicate.cases[0];
  await assert.rejects(()=>validateReport(duplicate,docs));
  const extra = structuredClone(template);extra.unrecognized='no';
  await assert.rejects(()=>validateReport(extra,docs));
  const wrongStatus = structuredClone(template);wrongStatus.cases[0].status='skipped';
  await assert.rejects(()=>validateReport(wrongStatus,docs));
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(),'fluentread-acceptance-selfcheck-'));
  try {
    const bytes = Buffer.from('Synthetic evidence only.');
    await fs.writeFile(path.join(scratch,'evidence.txt'),bytes);
    const evidence = structuredClone(template);
    evidence.artifacts=[{path:'evidence.txt',sha256:sha256(bytes),mediaType:'text/plain',role:'source'}];
    await validateReport(evidence,scratch);
    evidence.artifacts[0].sha256='0'.repeat(64);
    await assert.rejects(()=>validateReport(evidence,scratch));
    evidence.artifacts[0].path='../outside.txt';
    await assert.rejects(()=>validateReport(evidence,scratch));
    const failed = structuredClone(template);failed.overall='fail';failed.cases[0].status='fail';
    failed.startedAt=failed.finishedAt='2026-10-05T00:00:00.000Z';failed.cases[0].reason='Synthetic failure validation';
    failed.cases[0].observations=['Fixture observation'];failed.cases[0].evidence=['evidence.txt'];
    failed.artifacts=[{path:'evidence.txt',sha256:sha256(bytes),mediaType:'text/plain',role:'source'}];
    failed.environment={...failed.environment,profileKind:'dedicated-temporary',browserExecutableSha256:sha256(bytes)};
    for(const key of ['browser','browserVersion','browserosVersion','launchMode','focusPolicy','windowPlacement','profileMarker','extensionId']) failed.environment[key]='synthetic-validator-fixture';
    Object.assign(failed.provenance,{publishedSourceCommit:'1'.repeat(40),checkoutCommit:'1'.repeat(40),observedSourceTree:template.expectedSourceTree,worktreeCleanBeforeLocaleGeneration:true,lockfileSha256:sha256(bytes),buildManifest:'evidence.txt'});
    await validateReport(failed,scratch);
    failed.cases[0].status='pass';failed.overall='blocked';failed.provenance.checkoutCommit=null;
    await assert.rejects(()=>validateReport(failed,scratch));
  } finally {await fs.rm(scratch,{recursive:true,force:true});}
  const {server,url} = await startFixtureServer();
  try {
    for (const route of ['/',...fixtureFiles.keys()]) {
      const response = await fetch(url+route);assert.equal(response.status,200);assert((await response.text()).includes('<'));
    }
    assert.equal((await fetch(url+'/.git/config')).status,404);
    assert.equal((await fetch(url+'/%2e%2e/AGENTS.md')).status,404);
    const payload = {model:'fixture-normal',messages:[{role:'user',content:fixtureSource}]};
    const options = {method:'POST',headers:{'content-type':'application/json',authorization:'Bearer fixture-not-secret'},body:JSON.stringify(payload)};
    const reply = await fetch(url+'/v1/chat/completions',options);assert.equal(reply.status,200);assert.equal((await reply.json()).choices[0].message.content,fixtureTranslation);
    assert.equal((await fetch(url+'/fail/v1/chat/completions',options)).status,503);
    const slowStarted=Date.now();
    assert.equal((await fetch(url+'/slow/v1/chat/completions',options)).status,200);
    assert(Date.now()-slowStarted>=2100,'Delayed fixture responded too early');
    assert.equal((await fetch(url+'/v1/chat/completions',{...options,body:'{'})).status,400);
    assert.equal((await fetch(url+'/v1/chat/completions',{...options,headers:{authorization:'Bearer nonfixture'}})).status,400);
    assert.equal((await fetch(url+'/v1/chat/completions',{...options,body:JSON.stringify({...payload,stream:true})})).status,400);
    const metrics = await (await fetch(url+'/metrics')).json();assert.equal(metrics.requests.length,3);assert(!JSON.stringify(metrics).includes(fixtureSource));assert(!JSON.stringify(metrics).includes('Bearer'));
  } finally {await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
  const hashes = await fingerprint(docs);assert(hashes.files.length>=4);assert.match(hashes.manifestSha256,/^[a-f0-9]{64}$/u);
  await runEvidenceRegressions(validateReport,root);
  console.log(JSON.stringify({ok:true,checks:['strict template','unsupported status/keys/duplicate rejection','artifact digest and path checks','evidenced failure','unproven pass rejection','existing fixture routes','path allowlist','fixed provider','explicit failure','invalid request rejection','no request-body logging','file fingerprints'],browserRun:false,modelRun:false}));
}

const [command,argument,manifestKind] = process.argv.slice(2);
try {
  if (command==='serve') {
    const {server,url} = await startFixtureServer();console.log(JSON.stringify({url,scope:'loopback-only',synthetic:true}));
    for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{server.close();server.closeAllConnections();});
  } else if (command==='fingerprint' && argument) console.log(JSON.stringify(await fingerprint(path.resolve(argument),manifestKind),null,2));
  else if (command==='validate' && argument) console.log(JSON.stringify(await validateReport(await readJson(argument),path.dirname(path.resolve(argument)))));
  else if (command==='self-check') await selfCheck();
  else throw new Error('Usage: browser-acceptance.mjs serve | fingerprint DIRECTORY [extension-build|generated-locales] | validate RESULT.json | self-check');
} catch(error) {console.error(error.message);process.exitCode=1;}

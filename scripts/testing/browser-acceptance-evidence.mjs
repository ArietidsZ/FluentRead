/** Strict evidence contracts for the fixed-source local browser handoff. No browser or model execution. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const key = profile => `${profile.id}@${profile.variant}`;
const artifactKey = file => `${file.repo}/${file.revision}/${file.path}`;
const gpuBackends = new Set(['hardware-webgpu','hardware-webgpu-with-host-ops']);
const mtIds = ['fluentread/opus-zh-en-fp16','fluentread/opus-ja-en-fp32','IndexTeam/Index-Translate-2B-GGUF'];
const paddle = 'snowfluke/ppu-paddle-ocr-models';
const lama = 'ogkalu/lama-manga-onnx-dynamic';
const kokoro = 'kokoro-v1.1-zh';
const qwen = 'qwen3-asr-0.6b';
const inlineChineseSources = [
  {path:'src/core/i18n/messages/zh-CN.ts',sha256:'7ae35602395e4432c6678b5d319d6caa55ade65737dcdaf0dbb8b3c08b78edcc'},
  {path:'src/core/i18n/index.ts',sha256:'264fc1cb3c28766731e8ceb7700988bd83674e2cd332f126d77e64dc725e718c'},
];

export async function collectInlineChineseSources(sourceRoot) {
  const observed=[];
  for(const file of inlineChineseSources)observed.push({path:file.path,sha256:hash(await fs.readFile(path.join(sourceRoot,file.path)))});
  assert.deepEqual(observed,inlineChineseSources,'Inline Chinese source differs from the fixed acceptance source');
  return observed;
}
const rolesByCase = {
  'PRIVATE-01':['network','storage'],'PRIVATE-02':['network','storage'],
  'YT-01':['timing'],'YT-03':['timing'],'YT-04':['timing'],
  'TTS-02':['timing'],'TTS-03':['timing'],'TTS-04':['network','storage'],
  'MT-03':['timing'],'MT-04':['network','storage'],
};

export async function loadAcceptanceCatalog(root) {
  const catalog = JSON.parse(await fs.readFile(path.join(root,'docs/browser-acceptance/model-catalog.json'),'utf8'));
  for(const file of catalog.sourceFiles) assert.equal(hash(await fs.readFile(path.join(root,file.path))),file.sha256,`Frozen catalog source changed: ${file.path}`);
  return catalog;
}

export function validateFileManifest(value, kind) {
  assert(value && value.kind===kind && value.algorithm==='sha256' && Array.isArray(value.files) && value.files.length>0,`Expected structured ${kind} manifest`);
  assert.equal(hash(JSON.stringify(value.files)),value.manifestSha256,'Manifest digest does not match files');
  const files = new Map();
  for(const file of value.files) {
    assert(nonempty(file.path) && !path.isAbsolute(file.path) && !file.path.includes('\\') && !file.path.split('/').includes('..'),'Unsafe manifest path');
    assert(Number.isSafeInteger(file.size) && file.size>0 && /^[a-f0-9]{64}$/u.test(file.sha256),'Invalid manifest file');
    assert(!files.has(file.path),'Duplicate manifest path');files.set(file.path,file);
  }
  if(kind==='extension-build') {
    for(const name of ['manifest.json','background.js','options.html','popup.html','offscreen.html','localTranslationWorker.js','localTtsWorker.js','qwenAsrWorker.js']) assert(files.has(name),`Build manifest missing ${name}`);
    assert([...files.keys()].some(file=>file.endsWith('.wasm')),'Build manifest missing packaged WASM');
    assert(nonempty(value.extensionManifestText),'Build manifest must retain actual extension manifest text');
    const extension=JSON.parse(value.extensionManifestText);
    assert(extension.manifest_version===3 && nonempty(extension.name) && nonempty(extension.version),'Invalid extension manifest identity');
    assert.equal(hash(value.extensionManifestText),files.get('manifest.json').sha256,'Extension manifest hash mismatch');
    assert.equal(Buffer.byteLength(value.extensionManifestText),files.get('manifest.json').size,'Extension manifest size mismatch');
  } else {
    // Native UI_LANGUAGE_BUNDLES excludes inline Chinese; the userscript generator also excludes inline English.
    for(const locale of ['es-ES','fr-FR','ja-JP','ko-KR','ru-RU']) assert([...files.keys()].some(file=>new RegExp(`^${locale}\\.[a-f0-9]{16}\\.json$`,'u').test(file)),`Generated locale missing: ${locale}`);
    assert.deepEqual(value.inlineChineseSources,inlineChineseSources,'Missing or mismatched inline Chinese source evidence');
  }
  return files;
}

export async function validatePassEvidence(report, artifacts, root) {
  const passed=report.cases.filter(item=>item.status==='pass');
  if(!passed.length)return;
  const get=(name,role)=>{const value=artifacts.get(name);assert(value && value.role===role,`Expected ${role} evidence: ${name}`);return value;};
  const json=(name,role)=>JSON.parse(get(name,role).bytes.toString());
  const roleFiles=role=>[...artifacts.values()].filter(file=>file.role===role);
  const hasRole=(item,role)=>assert(item.evidence.some(name=>artifacts.get(name)?.role===role),`${item.id}: missing ${role} evidence`);
  const env=report.environment, provenance=report.provenance;
  for(const field of ['os','browser','browserVersion','browserosVersion','launchMode','profileMarker','focusPolicy','windowPlacement','extensionId','extensionName','extensionVersion','nodeVersion','pnpmVersion']) assert(nonempty(env[field]),`Pass requires environment.${field}`);
  assert(/^v?22\./u.test(env.nodeVersion) && /^9\.12\.1$/u.test(env.pnpmVersion),'Pass requires Node22 / pnpm9.12.1');
  assert(env.launchArguments.length>0 && env.capabilityEvidence.length>0,'Pass requires launch arguments and capability evidence');
  assert(provenance.commands.some(value=>value.includes('generate:userscript-languages')) && provenance.commands.some(value=>/\bbuild\b/u.test(value)),'Pass requires locale generation and build commands');
  for(const name of env.capabilityEvidence) {
    const capability=json(name,'capabilities');
    assert(capability.browserosVersion===env.browserosVersion && Array.isArray(capability.tools) && capability.tools.length>0 && Array.isArray(capability.operations) && capability.operations.length>0,'Missing observed BrowserOS capabilities');
  }
  assert(roleFiles('source').some(file=>{try {const data=JSON.parse(file.bytes);return ['publishedSourceCommit','checkoutCommit','observedSourceTree','lockfileSha256','worktreeCleanBeforeLocaleGeneration'].every(field=>data[field]===provenance[field]);}catch{return false;}}),'Pass requires matching structured source evidence');
  const build=json(provenance.buildManifest,'build-manifest');
  const buildFiles=validateFileManifest(build,'extension-build');
  validateFileManifest(json(provenance.generatedLocalesManifest,'locale-manifest'),'generated-locales');
  const extension=JSON.parse(build.extensionManifestText);
  assert(extension.name===env.extensionName && extension.version===env.extensionVersion,'Loaded extension differs from build manifest');
  for(const file of artifacts.values()) {
    if(file.role==='screenshot') assert(file.mediaType==='image/png' && file.bytes.length>32 && file.bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && file.bytes.toString('ascii',12,16)==='IHDR' && file.bytes.readUInt32BE(16)>0 && file.bytes.readUInt32BE(20)>0,'Screenshot must contain PNG pixels');
    if(['browser-log','gpu-log','timing','network','storage','injection'].includes(file.role)) {
      const data=JSON.parse(file.bytes);
      assert(Array.isArray(data.events) && data.events.length>0 && data.events.every(event=>nonempty(event.event) && nonempty(event.context) && Number.isFinite(Date.parse(event.at))),`Invalid structured ${file.role}`);
    }
  }
  const catalog=await loadAcceptanceCatalog(root), profiles=new Map(catalog.profiles.map(profile=>[key(profile),profile]));
  assert.equal(catalog.sourceTree,report.expectedSourceTree,'Catalog source mismatch');
  const models=new Map();
  const referencedModels=new Set(passed.flatMap(item=>item.models));
  for(const model of report.models) {
    if(!referencedModels.has(model.id))continue; // Incomplete metadata from blocked cases is not a pass claim.
    const profile=profiles.get(key(model));assert(profile,`Unknown model profile ${key(model)}`);
    assert(!models.has(key(model)),`Duplicate model ${key(model)}`);models.set(key(model),model);
    assert.deepEqual(model.files.map(artifactKey).sort(),profile.artifacts.map(artifactKey).sort(),`Incomplete fixed assets: ${key(model)}`);
    for(const expected of profile.artifacts) {
      const file=model.files.find(file=>artifactKey(file)===artifactKey(expected));
      assert(file.expectedSize===expected.size && file.observedSize===expected.size && file.expectedSha256===expected.sha256 && file.observedSha256===expected.sha256,`Fixed asset mismatch: ${artifactKey(expected)}`);
    }
    assert(model.runtimeFiles.length>0,'Missing runtime identities');
    for(const file of model.runtimeFiles)assert(buildFiles.get(file.path)?.sha256===file.sha256,`Runtime hash absent from exact build: ${file.path}`);
    for(const entry of profile.requiredRuntimeEntries)assert(model.runtimeFiles.some(file=>file.path===entry),`Missing executed runtime entry ${entry}`);
    assert(model.runtimeFiles.some(file=>/\.(?:js|mjs)$/u.test(file.path)) && model.runtimeFiles.some(file=>file.path.endsWith('.wasm')),'Record executed JS/MJS and WASM runtime hashes');
  }
  const requireGpu=()=>{
    const h=report.hardware;
    assert(h.status==='physical' && h.isFallbackAdapter===false && nonempty(h.osGpuDescription) && nonempty(h.adapterDescription),'Physical GPU observation required');
    // An observed empty optional-feature set is valid for Qwen q4 and OPUS FP32.
    // Profile-specific requirements below still reject missing shader-f16 for FP16/Index.
    assert(Array.isArray(h.features) && Object.keys(h.limits).length>0,'Missing raw GPU features/limits');
    for(const limit of ['maxBufferSize','maxStorageBufferBindingSize'])assert(h.limits[limit]>0,`Missing GPU limit ${limit}`);
    assert(h.evidence.some(name=>{try {const d=json(name,'gpu-log');return d.osGpuDescription===h.osGpuDescription && d.adapter?.description===h.adapterDescription && d.adapter?.isFallbackAdapter===false && JSON.stringify(d.adapter.features)===JSON.stringify(h.features) && JSON.stringify(d.adapter.limits)===JSON.stringify(h.limits);}catch{return false;}}),'GPU evidence must retain matching OS and raw adapter observations');
  };
  for(const item of passed) {
    hasRole(item,'screenshot');hasRole(item,'browser-log');
    if(item.id==='ENV-01') {
      const h=report.hardware;
      assert(h.status!=='unverified'&&nonempty(h.osGpuDescription)&&h.evidence.length>0,'ENV-01 requires completed OS/browser GPU discovery');
      assert(h.evidence.some(name=>{try {const d=json(name,'gpu-log');return d.osGpuDescription===h.osGpuDescription&&(h.status==='none'?d.adapter===null:d.adapter?.description===h.adapterDescription&&d.adapter?.isFallbackAdapter===h.isFallbackAdapter&&JSON.stringify(d.adapter?.features)===JSON.stringify(h.features)&&JSON.stringify(d.adapter?.limits)===JSON.stringify(h.limits));}catch{return false;}}),'ENV-01 requires actual GPU discovery evidence');
    }
    for(const role of rolesByCase[item.id] || [])hasRole(item,role);
    const real=item.kind==='real-model'||item.kind==='real-site-model';
    const fault=item.kind==='fault-injection';
    if(real||fault) {
      assert(item.models.length>0 && new Set(item.models).size===item.models.length,`${item.id}: identify each model once`);
      assert(item.models.every(id=>[...models.values()].some(model=>model.id===id)),`${item.id}: unknown/incomplete model`);
      assert(item.backend!=='unverified',`${item.id}: observed backend is required`);
    }
    if(real) {
      requireGpu();assert(gpuBackends.has(item.backend),`${item.id}: cannot substitute CPU/software`);
      assert(item.runs.length>0,`${item.id}: no real inference output`);
      for(const run of item.runs) {
        const profile=profiles.get(`${run.model}@${run.variant}`);
        assert(profile && models.has(key(profile)) && item.models.includes(run.model) && profile.directions.includes(run.direction),`${item.id}: unsupported run profile/direction`);
        for(const feature of profile.requiredFeatures)assert(report.hardware.features.includes(feature),`Missing actual GPU feature ${feature}`);
        assert(run.completed && gpuBackends.has(run.backend) && nonempty(run.outputSummary),`${item.id}: no completed real output`);
        const output=get(run.outputArtifact,'inference-output');assert(item.evidence.includes(run.outputArtifact) && output.bytes.length===run.outputBytes && output.bytes.length>0,'Missing real output bytes');
        const observed=JSON.parse(output.bytes);
        assert(observed.model===run.model && observed.variant===run.variant && observed.direction===run.direction && observed.inputSha256===run.inputSha256 && observed.completed===true,'Output record does not match the actual run');
        if(run.model===kokoro || run.model===lama) {
          const payload=get(observed.payloadArtifact,'inference-payload');
          assert(item.evidence.includes(observed.payloadArtifact),'Output payload must belong to the case');
          if(run.model===kokoro)assert(payload.mediaType==='audio/wav'&&payload.bytes.length>44&&payload.bytes.toString('ascii',0,4)==='RIFF'&&payload.bytes.toString('ascii',8,12)==='WAVE'&&observed.audible===true,'TTS requires actual audible WAV evidence');
          else assert(payload.mediaType==='image/png'&&payload.bytes.length>32&&payload.bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'LaMa requires actual image output');
        } else assert(nonempty(observed.text),'Text inference output is missing');
        const gpu=json(run.gpuEvidence,'gpu-log');assert(item.evidence.includes(run.gpuEvidence),'GPU proof belongs to the case');
        assert(gpu.events.some(event=>event.model===run.model && event.variant===run.variant && (run.model==='IndexTeam/Index-Translate-2B-GGUF'
          ? event.event==='offload' && event.loadedLayers>0 && event.loadedLayers===event.totalLayers && event.gpuModelBufferBytes>0
          : event.event==='dispatch' && event.count>0)),'Missing execution dispatch/offload evidence');
      }
      const ids=new Set(item.runs.map(run=>run.model));
      if(item.id.startsWith('TTS-'))assert(ids.has(kokoro),'TTS must execute fixed Kokoro');
      if(item.id.startsWith('YT-'))assert(ids.has(qwen),'YouTube must execute fixed Qwen ASR');
      if(item.id==='OCR-01')assert(ids.has(paddle),'Single-image Paddle execution missing');
      if(item.id==='OCR-02')assert(ids.has(paddle)&&ids.has(lama),'Both Paddle and LaMa execution required');
      if(item.id.startsWith('MT-'))assert([...ids].every(id=>mtIds.includes(id)),'MT must use supported strict GPU profiles');
      if(['MT-01','MT-04'].includes(item.id))for(const profile of catalog.profiles.filter(profile=>mtIds.includes(profile.id)))for(const direction of profile.directions)assert(item.runs.some(run=>run.model===profile.id&&run.variant===profile.variant&&run.direction===direction),`${item.id}: missing ${key(profile)} ${direction}`);
      if(item.id==='MT-03')assert(ids.size>=2,'MT-03 requires two different actual models');
    }
    if(fault) {
      if(item.id!=='YT-05')assert(gpuBackends.has(item.backend),`${item.id}: strict GPU fault cases cannot report CPU/software execution`);
      hasRole(item,'injection');assert(item.faults.length>0,`${item.id}: injection records missing`);
      const required=item.id==='YT-05'?['protected-media','initial-track-muted','live-track-muted']:item.id==='OCR-03'?['unavailable','init-failure','device-loss','recognition-error']:['unavailable','init-failure','device-loss'];
      const expected=item.id==='TTS-05'?[kokoro]:item.id==='MT-02'?mtIds:item.id==='OCR-03'?[paddle,lama]:[qwen];
      for(const id of expected)for(const mode of required.filter(mode=>mode!=='recognition-error'||id===paddle))assert(item.faults.some(f=>f.model===id&&f.mode===mode),`${item.id}: missing ${id} ${mode}`);
      for(const f of item.faults) {
        assert(expected.includes(f.model)&&models.has(`${f.model}@${f.variant}`)&&item.models.includes(f.model),'Fault model must match fixed catalog');
        assert(Number.isFinite(Date.parse(f.startedAt))&&Date.parse(f.endedAt)>=Date.parse(f.startedAt),'Fault timing missing/invalid');
        assert(f.execution===(item.id==='YT-05'?'capture-refusal':'gpu')&&f.cpuRebuilds===0&&f.resourcesReleased&&f.recovered,'Fault recovery must preserve strict execution');
        const change=get(f.changeArtifact,'injection');assert(change.sha256===f.changeSha256 && nonempty(JSON.parse(change.bytes).change),'Injection change/hash missing');
        for(const name of [f.changeArtifact,f.logArtifact,f.recoveryArtifact])assert(item.evidence.includes(name),'Fault evidence must belong to case');
        const log=json(f.logArtifact,'browser-log'), recovery=json(f.recoveryArtifact,'browser-log');
        assert(log.events.some(e=>e.event===f.mode&&e.model===f.model&&e.target===f.target&&e.injectionPoint===f.injectionPoint),'Missing observed injection scope');
        assert(recovery.events.some(e=>e.event==='recovery'&&e.model===f.model&&e.resourcesReleased===true&&e.cpuRebuilds===0),'Missing observed recovery');
        if(f.mode==='device-loss'){requireGpu();assert(f.deviceLossObserved&&log.events.some(e=>e.event==='device-loss'&&e.deviceLossObserved===true),'Device loss must be observed');}
      }
    }
  }
}

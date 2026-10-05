/** Synthetic validator regressions only. These examples never claim browser/model acceptance. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {loadAcceptanceCatalog} from './browser-acceptance-evidence.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const at='2026-10-05T00:00:00.000Z';

export async function runEvidenceRegressions(validateReport,root) {
  const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'fluentread-evidence-contract-'));
  try {
    const catalog=await loadAcceptanceCatalog(root);
    const report=JSON.parse(await fs.readFile(path.join(root,'docs/browser-acceptance/result.template.json'),'utf8'));
    report.runId='SYNTHETIC-VALIDATOR-EXAMPLE-NOT-BROWSER-EVIDENCE';report.startedAt=report.finishedAt=at;
    const add=async(name,role,data,mediaType='application/json')=>{
      const bytes=Buffer.isBuffer(data)?data:Buffer.from(JSON.stringify(data));
      await fs.writeFile(path.join(scratch,name),bytes);
      report.artifacts.push({path:name,role,sha256:hash(bytes),mediaType});return name;
    };
    const event=(event,rest={})=>({event,at,context:'synthetic-validator-fixture',...rest});
    await add('screen.png','screenshot',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf1sAAAAASUVORK5CYII=','base64'),'image/png');
    await add('browser.json','browser-log',{events:[event('observed')]});
    Object.assign(report.environment,{os:'Synthetic OS',browser:'Synthetic Chromium',browserVersion:'1',browserosVersion:'1',launchMode:'isolated test',profileMarker:'owned synthetic',focusPolicy:'background no focus',windowPlacement:'secondary normal size',extensionId:'synthetic-id',extensionName:'FluentRead synthetic fixture',extensionVersion:'0.0.35',nodeVersion:'22.23.3',pnpmVersion:'9.12.1',browserExecutableSha256:hash('synthetic browser'),profileKind:'dedicated-temporary',launchArguments:['--synthetic-validator-example'],capabilityEvidence:['capabilities.json']});
    await add('capabilities.json','capabilities',{browserosVersion:'1',tools:['synthetic'],operations:['inspect']});
    const runtimeNames=['background.js','options.html','popup.html','offscreen.html','localTranslationWorker.js','localTtsWorker.js','qwenAsrWorker.js','runtime.wasm'];
    const manifestText=JSON.stringify({manifest_version:3,name:report.environment.extensionName,version:report.environment.extensionVersion});
    const files=[{path:'manifest.json',size:Buffer.byteLength(manifestText),sha256:hash(manifestText)},...runtimeNames.map(name=>({path:name,size:20,sha256:hash(`synthetic ${name}`)}))];
    await add('build.json','build-manifest',{kind:'extension-build',algorithm:'sha256',files,manifestSha256:hash(JSON.stringify(files)),extensionManifestText:manifestText});
    const localeFiles=['zh-CN','es-ES','fr-FR','ja-JP','ko-KR','ru-RU'].map(locale=>({path:`${locale}.0123456789abcdef.json`,size:20,sha256:hash(locale)}));
    await add('locales.json','locale-manifest',{kind:'generated-locales',algorithm:'sha256',files:localeFiles,manifestSha256:hash(JSON.stringify(localeFiles))});
    Object.assign(report.provenance,{publishedSourceCommit:'c68a53af300b33109375665197951331e45ae18a',checkoutCommit:'c68a53af300b33109375665197951331e45ae18a',observedSourceTree:report.expectedSourceTree,worktreeCleanBeforeLocaleGeneration:true,lockfileSha256:hash('synthetic lock'),buildManifest:'build.json',generatedLocalesManifest:'locales.json',commands:['pnpm generate:userscript-languages','pnpm build']});
    await add('source.json','source',report.provenance);
    const h={status:'physical',osGpuDescription:'SYNTHETIC validator GPU',adapterDescription:'SYNTHETIC validator adapter',isFallbackAdapter:false,features:['shader-f16'],limits:{maxBufferSize:1073741824,maxStorageBufferBindingSize:1073741824},evidence:['gpu.json']};report.hardware=h;
    const gpuEvents=[event('adapter')];
    const saveGpu=async()=>{const data={osGpuDescription:h.osGpuDescription,adapter:{description:h.adapterDescription,isFallbackAdapter:false,features:h.features,limits:h.limits},events:gpuEvents};const bytes=Buffer.from(JSON.stringify(data));await fs.writeFile(path.join(scratch,'gpu.json'),bytes);const existing=report.artifacts.find(a=>a.path==='gpu.json');if(existing)existing.sha256=hash(bytes);else report.artifacts.push({path:'gpu.json',role:'gpu-log',sha256:hash(bytes),mediaType:'application/json'});};
    await saveGpu();
    const prepare=id=>{const item=report.cases.find(c=>c.id===id);Object.assign(item,{status:'pass',reason:'Synthetic validator positive example only',observations:['Synthetic contract validation; not a browser result'],evidence:['screen.png','browser.json'],backend:'none'});return item;};
    prepare('ENV-01');await validateReport(report,scratch);
    let negativeRegressions=0;
    const rejects=async(label,mutate)=>{const copy=structuredClone(report);mutate(copy);await assert.rejects(()=>validateReport(copy,scratch),undefined,label);negativeRegressions++;};
    for(const field of ['os','extensionName','extensionVersion'])await rejects(`ENV missing ${field}`,r=>{r.environment[field]=null;});
    for(const field of ['launchArguments','capabilityEvidence'])await rejects(`ENV missing ${field}`,r=>{r.environment[field]=[];});
    await rejects('ENV no GPU discovery',r=>{r.hardware.status='unverified';r.hardware.evidence=[];});
    await rejects('ENV no commands',r=>{r.provenance.commands=[];});
    await rejects('ENV no generated locale manifest',r=>{r.provenance.generatedLocalesManifest=null;});
    await add('README.md','build-manifest',Buffer.from('# Not a build manifest'),'text/markdown');
    await rejects('README cannot be build manifest',r=>{r.provenance.buildManifest='README.md';});
    const addModel=profile=>{if(report.models.some(m=>m.id===profile.id&&m.variant===profile.variant))return;report.models.push({id:profile.id,variant:profile.variant,files:profile.artifacts.map(f=>({repo:f.repo,revision:f.revision,path:f.path,expectedSize:f.size,observedSize:f.size,expectedSha256:f.sha256,observedSha256:f.sha256})),runtimeFiles:[...new Set([...profile.requiredRuntimeEntries,'localTranslationWorker.js','runtime.wasm'])].map(name=>({path:name,sha256:files.find(f=>f.path===name).sha256})),notes:['Synthetic declarations only; no weights were read']});};
    const mt=prepare('MT-01');mt.backend='hardware-webgpu';
    for(const profile of catalog.profiles.filter(p=>p.id.startsWith('fluentread/opus-')||p.id==='IndexTeam/Index-Translate-2B-GGUF')) {
      addModel(profile);mt.models.push(profile.id);
      for(const direction of profile.directions) {
        const inputSha256=hash(`${profile.id}:${direction}`),name=`output-${mt.runs.length}.json`;
        await add(name,'inference-output',{model:profile.id,variant:profile.variant,direction,inputSha256,completed:true,text:'Synthetic output for validator testing only.'});
        const bytes=await fs.readFile(path.join(scratch,name));mt.evidence.push(name);
        mt.runs.push({model:profile.id,variant:profile.variant,direction,inputSha256,outputArtifact:name,gpuEvidence:'gpu.json',outputBytes:bytes.length,outputSummary:'Synthetic complete output',completed:true,backend:'hardware-webgpu'});
        gpuEvents.push(event(profile.id==='IndexTeam/Index-Translate-2B-GGUF'?'offload':'dispatch',{model:profile.id,variant:profile.variant,count:1,loadedLayers:1,totalLayers:1,gpuModelBufferBytes:1024}));
      }
    }
    await saveGpu();mt.evidence.push('gpu.json');await validateReport(report,scratch);
    await rejects('MT invented model',r=>{r.models[0].id='invented/model';});
    await rejects('MT main revision',r=>{r.models[0].files[0].revision='main';});
    await rejects('MT zero-size asset',r=>{r.models[0].files[0].expectedSize=r.models[0].files[0].observedSize=0;});
    await rejects('MT config-only assets',r=>{r.models[0].files=r.models[0].files.filter(f=>f.path==='config.json');});
    await rejects('MT no GPU features',r=>{r.hardware.features=[];});
    await rejects('MT no GPU limits',r=>{r.hardware.limits={};});
    await rejects('MT no output',r=>{r.cases.find(c=>c.id==='MT-01').runs=[];});
    await rejects('MT missing reverse direction',r=>{r.cases.find(c=>c.id==='MT-01').runs.shift();});
    await add('timing.json','timing',{events:[event('model-switch')]});
    const mtSwitch=report.cases.find(c=>c.id==='MT-03');Object.assign(mtSwitch,structuredClone(mt),{id:'MT-03',evidence:[...mt.evidence,'timing.json']});
    await validateReport(report,scratch);
    await rejects('MT03 only one model',r=>{r.cases.find(c=>c.id==='MT-03').runs=[r.cases.find(c=>c.id==='MT-01').runs[0]];});
    const tts=prepare('TTS-05'),profile=catalog.profiles.find(p=>p.id==='kokoro-v1.1-zh');addModel(profile);tts.models=[profile.id];tts.backend='hardware-webgpu';
    for(const mode of ['unavailable','init-failure','device-loss']) {
      const target='synthetic isolated worker',injectionPoint='synthetic GPU boundary';
      const change=await add(`change-${mode}.json`,'injection',{change:'Synthetic injection diff for validator testing only',events:[event('injection',{mode})]});
      const log=await add(`fault-${mode}.json`,'browser-log',{events:[event(mode,{model:profile.id,target,injectionPoint,deviceLossObserved:mode==='device-loss'})]});
      const recovery=await add(`recovery-${mode}.json`,'browser-log',{events:[event('recovery',{model:profile.id,resourcesReleased:true,cpuRebuilds:0})]});
      tts.evidence.push(change,log,recovery);
      tts.faults.push({model:profile.id,variant:profile.variant,mode,injectionPoint,target,startedAt:at,endedAt:at,changeSha256:report.artifacts.find(a=>a.path===change).sha256,changeArtifact:change,logArtifact:log,recoveryArtifact:recovery,observedError:'Synthetic injected error',cpuRebuilds:0,resourcesReleased:true,recovered:true,deviceLossObserved:mode==='device-loss',execution:'gpu'});
    }
    await validateReport(report,scratch);
    await rejects('TTS05 unverified backend',r=>{r.cases.find(c=>c.id==='TTS-05').backend='unverified';});
    await rejects('TTS05 WASM backend',r=>{r.cases.find(c=>c.id==='TTS-05').backend='wasm';});
    await rejects('TTS05 software WebGPU backend',r=>{r.cases.find(c=>c.id==='TTS-05').backend='software-webgpu';});
    await rejects('TTS05 no model',r=>{r.cases.find(c=>c.id==='TTS-05').models=[];});
    await rejects('TTS05 no injection',r=>{r.cases.find(c=>c.id==='TTS-05').faults=[];});
    await rejects('TTS05 no device-loss observation',r=>{r.cases.find(c=>c.id==='TTS-05').faults[2].deviceLossObserved=false;});
    await rejects('TTS05 implicit CPU fallback',r=>{r.cases.find(c=>c.id==='TTS-05').faults[2].cpuRebuilds=1;});
    console.log(JSON.stringify({evidenceContracts:true,positiveSyntheticCases:['ENV-01','MT-01','TTS-05'],negativeRegressions,browserRun:false,modelRun:false}));
  } finally {await fs.rm(scratch,{recursive:true,force:true});}
}

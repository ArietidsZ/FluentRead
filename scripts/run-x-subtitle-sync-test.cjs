#!/usr/bin/env node
// Deterministic spoken-audio and HLS fixture against the production extension.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {createRequire} = require('node:module');
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1]; };
const artifacts = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-x-sync-proof'));
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const runtime = arg('playwright-root');
const helperPath = arg('focus-safe-helper');
if (!runtime || !helperPath) throw new Error('Explicit Playwright runtime and focus-safe helper are required');
const {chromium} = createRequire(path.join(runtime, 'x-proof.cjs'))('playwright');
const helper = require(path.resolve(helperPath));
const model = arg('model', 'tiny');
const mediaMode = arg('media-source', 'hls');
const displayMode = arg('display-mode', 'original-only');
const nativeTrack = arg('native-track','false') === 'true';
const startPlaying = arg('start-playing', 'false') === 'true';
const earlyHls = arg('early-hls','false') === 'true';
fs.mkdirSync(artifacts, {recursive: true});
const media = path.join(artifacts, 'media');
fs.mkdirSync(media, {recursive: true});
function command(program, args) { const r = spawnSync(program, args, {encoding: 'utf8'}); if(r.status !== 0) throw new Error(`${program}: ${r.stderr}`); }
const lines = [
  'At sunrise, the research team opened the lab and checked the new system.',
  'A few moments later, the first results appeared clearly on the screen.',
  'The speaker reviewed the numbers and explained why the change mattered.',
];
if(arg('long', 'false') === 'true') lines.push(
  'Outside the building, a small crowd waited for the afternoon announcement.',
  'The project manager answered questions and described the next steps.',
  'After a short break, everyone returned to the meeting room.',
  'The final experiment confirmed that the new design worked as expected.',
  'Several engineers compared the results with their earlier measurements.',
  'Before leaving, the team saved its notes and closed the laboratory.',
);
const speech = lines.join(' [[slnc 1200]] ');
command('/usr/bin/say', ['-v','Samantha','-r','175','-o',path.join(media,'speech.aiff'),speech]);
const durationProbe=spawnSync('/opt/homebrew/bin/ffprobe',['-v','quiet','-show_entries','format=duration','-of','json',path.join(media,'speech.aiff')],{encoding:'utf8'});
assert.equal(durationProbe.status,0,durationProbe.stderr);
const speechDuration=Number(JSON.parse(durationProbe.stdout).format.duration);
command('/opt/homebrew/bin/ffmpeg',['-y','-i',path.join(media,'speech.aiff'),'-c:a','aac','-b:a','64k','-ar','48000','-f','hls','-hls_time','4','-hls_playlist_type','vod','-hls_segment_type','fmp4','-hls_segment_filename',path.join(media,'a%02d.m4s'),path.join(media,'audio.m3u8')]);
command('/opt/homebrew/bin/ffmpeg',['-y','-f','lavfi','-i','color=c=0x10283f:s=960x540:r=24','-i',path.join(media,'speech.aiff'),'-t',String(speechDuration),'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-b:a','64k','-movflags','frag_keyframe+empty_moov+default_base_moof',path.join(media,'video.mp4')]);
const silenceScan = spawnSync('/opt/homebrew/bin/ffmpeg',['-i',path.join(media,'speech.aiff'),'-af','silencedetect=n=-40dB:d=0.7','-f','null','-'],{encoding:'utf8'});
assert.equal(silenceScan.status,0,silenceScan.stderr);
const silenceStarts=[...silenceScan.stderr.matchAll(/silence_start: ([\d.]+)/g)].map(match=>Number(match[1]));
const silenceEnds=[...silenceScan.stderr.matchAll(/silence_end: ([\d.]+)/g)].map(match=>Number(match[1]));
const master = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",DEFAULT=YES,URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=300000,AUDIO="audio"\nvideo.m3u8\n';
const base = 'https://video.twimg.com/ext_tw_video/424242/pu/';
const profile = fs.mkdtempSync(path.join(os.tmpdir(),'fluentread-x-sync-profile-'));
let browser, control, page;
const report = {mediaMode,model,lines,displayMode,startPlaying,earlyHls,errors:[],console:[],requests:[],samples:[],diagnostics:[]};
async function main() {
 browser = await helper.launchFocusSafePersistentContext({chromium,profileDir:profile,browserPath:'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',headless:false,background:true,displayTarget:'secondary',browserArgs:[`--disable-extensions-except=${extensionDir}`,`--load-extension=${extensionDir}`,'--autoplay-policy=no-user-gesture-required','--no-first-run','--no-default-browser-check'],viewport:{width:1280,height:900}});
 const context = browser.context;
 context.on('page', p => {p.on('pageerror', e => report.errors.push(e.message)); p.on('console',m => { if(m.type()==='error'||m.type()==='warning') report.console.push(m.text()); });});
 await context.route('https://video.twimg.com/**', async route => {
   const name = new URL(route.request().url()).pathname.split('/').at(-1);
   report.requests.push({name,at:Date.now()});
   const body = name==='master.m3u8' ? master : fs.readFileSync(path.join(media,name));
   await route.fulfill({status:200,headers:{'access-control-allow-origin':'*'},contentType:name.endsWith('m3u8')?'application/vnd.apple.mpegurl':'video/mp4',body});
 });
 await context.route('https://x.com/fluentread-fixture-ready.js',async route=>{await new Promise(resolve=>setTimeout(resolve,800));await route.fulfill({status:200,contentType:'text/javascript',body:''});});
 await context.route('https://x.com/cerebras/status/2089870131291943228', route => route.fulfill({status:200,contentType:'text/html',body:`<!doctype html><html><head><title>X subtitle synchronization fixture</title>${earlyHls?`<script>fetch('${base}master.m3u8')</script><script src="/fluentread-fixture-ready.js"></script>`:''}</head><body style="margin:24px;background:#f3f5f9"><h1>X subtitle synchronization fixture</h1><div data-testid="videoPlayer" style="position:relative;width:960px;height:540px;background:#10283f"><video style="width:100%;height:100%" controls></video></div></body></html>`}));
 const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker',{timeout:30000});
 const id = new URL(worker.url()).host;
 report.extensionId = id;
 await worker.evaluate(() => {
   const originalFetch = globalThis.fetch;
   globalThis.videoProofTranslations = [];
   globalThis.fetch = async (input, init) => {
     const url = String(input?.url || input);
     if (!url.startsWith('https://edge.microsoft.com/translate/translatetext')) return originalFetch(input, init);
     const source = JSON.parse(init.body)[0];
     const entry = {source,started:Date.now()};globalThis.videoProofTranslations.push(entry);
     await new Promise((resolve,reject) => {
       const timer=setTimeout(resolve,1200);
       init.signal?.addEventListener('abort',()=>{clearTimeout(timer);entry.cancelled=true;reject(new DOMException('aborted','AbortError'));},{once:true});
     });
     entry.finished=Date.now();
     return new Response(JSON.stringify([{translations:[{text:'译文：'+source}]}]),{status:200,headers:{'content-type':'application/json'}});
   };
 });
 control = await helper.newPageWithoutForeground(context);
 await control.goto(`chrome-extension://${id}/popup.html`);
 await control.waitForTimeout(500);
 const configResult = await control.evaluate(async ({model,displayMode}) => {
   const r = await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});
   if(!r?.success) throw new Error('configStorageRead failed');
   const current = typeof r.value==='string'?JSON.parse(r.value):r.value||{};
   return chrome.runtime.sendMessage({type:'persistConfig',clientId:'x-sync-browser-proof',sequence:1,config:{...current,on:true,from:'en',to:'zh-Hans',videoTranslationEnabled:true,videoService:'microsoft',videoServiceDefaultMigrated:true,videoLocalModel:model,videoSubtitleVisible:true,videoSubtitleDisplayMode:displayMode,useCache:false},...(Number.isSafeInteger(current.__fluentConfigRevision)?{baseRevision:current.__fluentConfigRevision}:{})});
 },{model,displayMode});
 assert.equal(configResult?.success,true,'configuration persisted through real background');
 const prepareAt = Date.now();
 const prepared = await control.evaluate(model=>chrome.runtime.sendMessage({type:'fluentReadPrepareLocalVideoModel',model}),model);
 report.prepareMs=Date.now()-prepareAt;report.prepared=prepared;
 assert.equal(prepared?.success,true,JSON.stringify(prepared));
 page=await helper.newPageWithoutForeground(context);
 page.on('console',m=>report.console.push(`${m.type()}: ${m.text()}`));
 await page.goto('https://x.com/cerebras/status/2089870131291943228');
 await helper.activateExtensionTabWithoutForeground(context,page);
 await page.evaluate(async ({base,mode,nativeTrack,earlyHls})=>{
   const video=document.querySelector('video');
   if(mode==='hls'){
     const mediaSource=new MediaSource();video.src=URL.createObjectURL(mediaSource);
     await new Promise(resolve=>mediaSource.addEventListener('sourceopen',resolve,{once:true}));
     const buffer=mediaSource.addSourceBuffer('video/mp4; codecs="avc1.42C01F, mp4a.40.2"');
     const data=await (await fetch(base+'video.mp4')).arrayBuffer();
     buffer.appendBuffer(data);await new Promise(resolve=>buffer.addEventListener('updateend',resolve,{once:true}));mediaSource.endOfStream();
     // Real MAIN-world fetch bridge discovers this audio rendition.
     if(!earlyHls) await fetch(base+'master.m3u8');
   }else video.src=base+'video.mp4';
   if(nativeTrack){
     const alternative=video.addTextTrack('captions','French','fr');alternative.addCue(new VTTCue(0,120,'French native fixture'));alternative.mode='disabled';window.proofAlternativeTrack=alternative;
     const track=video.addTextTrack('captions','English','en');track.addCue(new VTTCue(0,120,'Native source fixture'));track.mode='showing';window.proofTrack=track;
   }
   window.proofSamples=[];window.proofDiagnostics=[];
   const read=()=>{const panel=document.getElementById('fluent-read-video-subtitle-original');window.proofSamples.push({at:performance.now(),time:video.currentTime,paused:video.paused,text:panel?.textContent||'',translation:document.getElementById('fluent-read-video-subtitle')?.textContent||'',source:document.getElementById('fluent-read-video-ai-caption-container')?.dataset.fluentReadCaptionSource||''});};
   window.proofTimer=setInterval(read,50);
   window.addEventListener('fluent-read-video-ai-diagnostic',e=>window.proofDiagnostics.push(e.detail));
 },{base,mode:mediaMode,nativeTrack,earlyHls});
 await page.waitForFunction(()=>document.querySelector('video').readyState>=2);
 await page.waitForSelector('#fluent-read-video-subtitle-button',{timeout:15000});
 await page.locator('#fluent-read-video-subtitle-button').click({force:true});
 const before=await page.evaluate(()=>{const v=document.querySelector('video');v.currentTime=2;return {time:v.currentTime,paused:v.paused,rate:v.playbackRate,volume:v.volume,muted:v.muted};});
 await page.waitForTimeout(150);
 if(startPlaying) await page.evaluate(()=>document.querySelector('video').play());
 const began=Date.now();
 await page.locator('[data-action="toggle-ai-subtitle"]').click({force:true});
 if(arg('background-generation','false')==='true'){
   await control.evaluate(async()=>{
     const controlTab=await chrome.tabs.getCurrent();
     const [videoTab]=await chrome.tabs.query({url:'https://x.com/cerebras/status/2089870131291943228'});
     if(controlTab.windowId!==videoTab.windowId) await chrome.tabs.move(controlTab.id,{windowId:videoTab.windowId,index:-1});
   });
   await helper.activateExtensionTabWithoutForeground(context,control);
   report.generatedWhileHidden=await page.evaluate(()=>document.visibilityState==='hidden');
   report.generatedInInactiveTab=await control.evaluate(async()=>!(await chrome.tabs.query({url:'https://x.com/cerebras/status/2089870131291943228'}))[0].active);
   assert.equal(report.generatedInInactiveTab,true);
 }
 await page.waitForFunction(()=>{const text=document.querySelector('[data-action="toggle-ai-subtitle"] [data-state]')?.textContent||'';if(/失败|超时|格式暂不支持|无法|不支持|Model|Error/.test(text))throw new Error(text);return text.includes('已就绪');},{},{timeout:120000});
 report.generationMs=Date.now()-began;
 await helper.activateExtensionTabWithoutForeground(context,page);
 if(nativeTrack) assert.equal(await page.evaluate(()=>window.proofTrack.mode),'hidden','native rendering is hidden during AI takeover');
 report.before=before;report.after=await page.evaluate(()=>{const v=document.querySelector('video');return {time:v.currentTime,paused:v.paused,rate:v.playbackRate,volume:v.volume,muted:v.muted};});
 if(startPlaying){assert.equal(report.after.paused,false);assert.ok(report.after.time>before.time);assert.equal(report.after.rate,before.rate);assert.equal(report.after.volume,before.volume);assert.equal(report.after.muted,before.muted);}
 else assert.deepEqual(report.after,before,'generation preserves user playback state');
 await page.screenshot({path:path.join(artifacts,'ready.png')});
 const downloadPromise=page.waitForEvent('download');
 await page.locator('[data-action="download-subtitles"]').click({force:true});
 const download=await downloadPromise;
 await download.saveAs(path.join(artifacts,'original.srt'));
 report.srt=fs.readFileSync(path.join(artifacts,'original.srt'),'utf8');
 const seconds=value=>value.split(/[:,]/).map(Number).reduce((total,value,index)=>total+value*[3600,60,1,.001][index],0);
 report.exportedCues=report.srt.trim().split(/\n\s*\n/).map(block=>{const rows=block.split('\n');const [start,end]=rows[1].split(' --> ');return {start:seconds(start),end:seconds(end),text:rows.slice(2).join('\n')};});
 report.audioDuration=speechDuration;
 report.referenceSpeech=lines.map((text,index)=>({start:index===0?0:silenceEnds[index-1],end:silenceStarts[index]??speechDuration,text}));
 assert.equal(report.exportedCues.length,lines.length,'every sentence has one exported cue');
 report.alignmentErrors=report.exportedCues.map((cue,index)=>({startMs:Math.round((cue.start-report.referenceSpeech[index].start)*1000),endMs:Math.round((cue.end-report.referenceSpeech[index].end)*1000)}));
 assert.ok(report.alignmentErrors.every(error=>Math.abs(error.startMs)<=250&&Math.abs(error.endMs)<=250),'sentence bounds stay within 250 ms of independent audio silence detection');
 assert.ok(report.exportedCues.every((cue,index)=>index===0||cue.start>=report.exportedCues[index-1].end),'exported sentences do not overlap');
 if(arg('owner-handoff','false')==='true'){
   const secondPage=await helper.newPageWithoutForeground(context);
   await secondPage.goto('https://x.com/cerebras/status/2089870131291943228');
   await helper.activateExtensionTabWithoutForeground(context,secondPage);
   await secondPage.evaluate(base=>{
     const video=document.querySelector('video');
     video.src=base+'video.mp4';
     video.load();
   },base);
   await secondPage.waitForFunction(()=>document.querySelector('video').readyState>=2,{},{timeout:15000});
   await secondPage.waitForSelector('#fluent-read-video-subtitle-button',{timeout:15000});
   await secondPage.locator('#fluent-read-video-subtitle-button').click({force:true});
   await secondPage.locator('[data-action="toggle-ai-subtitle"]').click({force:true});
   await secondPage.waitForFunction(()=>{const text=document.querySelector('[data-action="toggle-ai-subtitle"] [data-state]')?.textContent||'';if(/失败|超时|格式暂不支持|无法|不支持|Model|Error/.test(text))throw new Error(text);return text.includes('已就绪');},{},{timeout:120000});
   const secondReady=await secondPage.evaluate(()=>({
     state:document.querySelector('[data-action="toggle-ai-subtitle"] [data-state]')?.textContent||'',
     text:document.getElementById('fluent-read-video-subtitle-original')?.textContent||'',
   }));
   assert.match(secondReady.state,/已就绪/,'another tab can prepare through the real extension UI after completed subtitles');
   await secondPage.locator('[data-action="toggle-ai-subtitle"]').click({force:true});
   await secondPage.waitForTimeout(400);
   const secondStopped=await secondPage.evaluate(()=>({
     state:document.querySelector('[data-action="toggle-ai-subtitle"] [data-state]')?.textContent||'',
     text:document.getElementById('fluent-read-video-subtitle-original')?.textContent||'',
   }));
   assert.equal(secondStopped.text,'','second tab releases ownership and clears its generated subtitles');
   report.ownerHandoff={
     prepared:{success:true,transport:'second-tab-extension-ui',state:secondReady.state},
     cancelled:{success:true,transport:'second-tab-extension-ui',state:secondStopped.state},
   };
   await secondPage.close();
 }
 await page.locator('#fluent-read-video-subtitle-button').click({force:true});
 report.generationSamples=await page.evaluate(()=>window.proofSamples);
 await page.evaluate(()=>{window.proofSamples=[];const v=document.querySelector('video');v.currentTime=0;return v.play();});
 await page.waitForFunction(()=>document.querySelector('video').ended,{},{timeout:90000});
 report.samples=await page.evaluate(()=>window.proofSamples);
 report.translationRequests=await worker.evaluate(()=>globalThis.videoProofTranslations);
 if(displayMode==='bilingual'){assert.ok(report.translationRequests.length>=3);assert.ok(report.samples.some(sample=>sample.translation.includes('译文：')),'bilingual translations appear');}
 report.diagnostics=await page.evaluate(()=>window.proofDiagnostics);
 report.texts=[...new Set(report.samples.filter(s=>!s.paused&&s.text).map(s=>s.text))];
 assert.deepEqual(report.texts,lines,'all spoken sentences are recognized once without boundary fragments');
 report.transitions=[];
 let previousText;
 for(const sample of report.samples.filter(sample=>!sample.paused)){ if(sample.text!==previousText){report.transitions.push({time:sample.time,text:sample.text});previousText=sample.text;} }
 const checks=[];
 for(const time of [1,4.7,8,9.8,12,13.74,0.2]){
   await page.evaluate(time=>{const v=document.querySelector('video');v.currentTime=time;},time);
   await page.waitForTimeout(200);
   checks.push(await page.evaluate(()=>({time:document.querySelector('video').currentTime,text:document.getElementById('fluent-read-video-subtitle-original')?.textContent||''})));
 }
 report.seekChecks=checks;
 assert.equal(checks[1].text,'','the first long pause clears subtitles');
 assert.equal(checks[3].text,'','the second long pause clears subtitles');
 assert.equal(checks[0].text,lines[0]);assert.equal(checks[2].text,lines[1]);assert.equal(checks[4].text,lines[2]);
 await page.screenshot({path:path.join(artifacts,'seek.png')});
 await page.locator('#fluent-read-video-subtitle-button').click({force:true});
 await page.locator('[data-action="toggle-ai-subtitle"]').click({force:true});
 await page.waitForTimeout(400);
 report.afterStop=await page.evaluate(()=>({text:document.getElementById('fluent-read-video-subtitle-original')?.textContent||'',videos:document.querySelectorAll('video').length}));
 if(nativeTrack){
   assert.equal(report.afterStop.text,'Native source fixture');
   await page.locator('[data-action="toggle-translation"]').click({force:true});
   await page.waitForFunction(()=>window.proofTrack.mode==='showing');
   report.nativeTrackRestored=await page.evaluate(()=>window.proofTrack.mode);
   assert.equal(await page.evaluate(()=>window.proofAlternativeTrack.mode),'disabled','the unselected language remains disabled after restoration');
 }else assert.equal(report.afterStop.text,'');
 assert.equal(report.afterStop.videos,1);
 report.launchMode=browser.launchMode;report.focusPolicy=browser.focusPolicy;report.windowPlacement=browser.windowPlacement;
 assert.equal(report.windowPlacement.browserFrontmost,false);
 report.success=true;
}
main().catch(async e=>{report.failure=e.stack;process.exitCode=1;if(page)await page.screenshot({path:path.join(artifacts,'failure.png')}).catch(()=>{});}).finally(async()=>{
 fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({success:report.success,generationMs:report.generationMs,prepareMs:report.prepareMs,texts:report.texts,failure:report.failure,artifacts},null,2));
 if(browser)await browser.close();fs.rmSync(profile,{recursive:true,force:true});
});

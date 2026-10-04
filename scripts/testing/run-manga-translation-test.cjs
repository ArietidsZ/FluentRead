'use strict';
/** 漫画生产扩展专项：临时 profile、关闭 Shadow DOM 可信点击、真实 OCR；区分在线站点、提前页和滚动返页稳定性；仅夹具可控地挂起文字服务；性能模式复用同一原图和真实模型，记录冷启动、逐次推理和编码。 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
function arg(name, fallback) {const index = process.argv.indexOf(`--${name}`); return index < 0 ? fallback : process.argv[index + 1];}
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifacts = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-manga-browser'));
const packages = arg('playwright-root', process.env.PLAYWRIGHT_ROOT);
const helper = arg('focus-safe-helper', process.env.FLUENTREAD_FOCUS_SAFE_HELPER);
if (!packages || !helper) throw new Error('Provide --playwright-root and --focus-safe-helper');
const {chromium} = require(path.join(packages, 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground} = require(helper);
const liveSite = process.argv.includes('--live-site');
const liveTranslation = process.argv.includes('--live-translation');
const qualityPages = Number(arg('quality-pages','2'));
const blockedOfficial = process.argv.includes('--blocked-official');
const blockedAll = process.argv.includes('--blocked-all-model-sources');
const offlineModels = arg('offline-models-dir',null);
const preloadModels = arg('preload-models-dir',null);
const baseline = process.argv.includes('--baseline');
const readingPauseMs=Number(arg('reading-pause-ms','0'));
const skipFirstCancel=process.argv.includes('--skip-first-cancel');
const readAheadTest=process.argv.includes('--prefetch-pages');
const scrollStabilityTest=process.argv.includes('--scroll-stability');
const cacheNavigationTest=process.argv.includes('--cache-navigation');
const tieredCacheTest=process.argv.includes('--tiered-cache');
const prefetchPages=Number(arg('prefetch-pages','0'));
const pipelineInputs=arg('pipeline-inputs',null)?.split(',').map(file=>path.resolve(file));
const pipelineRounds=Number(arg('pipeline-rounds','3'));
const graphOverride=arg('pipeline-graph',null);
const gpuDiagnosis=process.argv.includes('--gpu-diagnosis');
const forceCpu=process.argv.includes('--pipeline-cpu');
const extensionDebugging=process.argv.includes('--extension-debugging');
const traceReader=process.argv.includes('--trace-reader');
const targetUrl = arg('site-url','https://mangaplus.shueisha.co.jp/viewer/1024050');
const pixiv=targetUrl.includes('pixiv.net/artworks/');
const readerSelector=pixiv?'img[src*="/img-master/"][src*="/150354216_p"], img[src*="/img-original/"][src*="/150354216_p"]':'.zao-image';
const profile = fs.mkdtempSync('/private/tmp/fluentread-manga-profile-');
fs.mkdirSync(artifacts, {recursive: true});
const report = {site: liveSite ? 'live MANGA Plus' : 'controlled MANGA Plus reader fixture',
    translation: liveTranslation ? 'live Google' : 'deterministic Google text transport',
    ocr: 'real production PaddleOCR', cases: [], screenshots: [], errors: [], hostErrors: [], pageErrors: [], consoleErrors: []};
if(pixiv)report.site='live Pixiv artwork 150354216';
report.prefetchPages=prefetchPages;
let launched, page, worker, cdp, popup, modelObserver, browserPid,loadedExtensionId;
function focusGuard() {
    const current=JSON.parse(execFileSync('/usr/bin/osascript',['-l','JavaScript','-e',"ObjC.import('AppKit');const app=$.NSWorkspace.sharedWorkspace.frontmostApplication;JSON.stringify({pid:Number(app.processIdentifier),name:ObjC.unwrap(app.localizedName)});"],{encoding:'utf8'}));
    assert.notEqual(current.pid,browserPid,'Isolated test browser must stay behind the user app');
    report.focusChecks??=[];report.focusChecks.push(current);
}
// Offscreen 文档不在 Playwright 的 page/request 集合里，必须观察自己的隔离浏览器 CDP target。
async function observeModelDownloads(extensionId) {
    const [port,endpoint]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split('\n');
    const socket=new WebSocket(`ws://127.0.0.1:${Number(port)}${endpoint}`),pending=new Map();let sequence=0;
    await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
    function command(method,params={},sessionId) {
        const id=++sequence;
        return new Promise((resolve,reject)=>{
            const timeout=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},10000);
            pending.set(id,{resolve:value=>{clearTimeout(timeout);resolve(value);},reject:error=>{clearTimeout(timeout);reject(error);}});
            socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
        });
    }
    socket.addEventListener('message',event=>{
        const message=JSON.parse(String(event.data));
        if(message.id){const callback=pending.get(message.id);if(callback){pending.delete(message.id);message.error?callback.reject(new Error(message.error.message)):callback.resolve(message.result);}}
        if(message.method==='Runtime.consoleAPICalled'){
            const text=message.params.args.map(a=>a.value ?? a.description ?? '').join(' ');
            (report.offscreenDiagnostics ??= []).push({level:message.params.type,text});
            if(message.params.type==='error')report.consoleErrors.push(text);
        }
        if(message.method==='Network.requestWillBeSent'){
            const url=new URL(message.params.request.url);
            if(['huggingface.co','hf-mirror.net'].includes(url.host))report.modelRequests.push({source:url.host,file:url.pathname.split('/').pop(),target:'offscreen'});
        }
    });
    const {targetInfos}=await command('Target.getTargets');
    const target=targetInfos.find(target=>target.url.startsWith(`chrome-extension://${extensionId}/offscreen.html`));
    assert.ok(target,'Own isolated extension Offscreen target exists');
    const {sessionId}=await command('Target.attachToTarget',{targetId:target.targetId,flatten:true});
    await command('Network.enable',{},sessionId);
    await command('Runtime.enable',{},sessionId);
    if(blockedOfficial || blockedAll)await command('Network.setBlockedURLs',{urls:blockedAll?['https://huggingface.co/*','https://hf-mirror.net/*']:['https://huggingface.co/*']},sessionId);
    socket.command=(method,params)=>command(method,params,sessionId);return socket;
}

const fixture = `<!doctype html><html><head><meta charset="utf-8"><title>Manga reader fixture</title><style>
body{margin:0;background:#171923;color:white;font:16px system-ui}.heading{padding:22px;text-align:center}
.zao-image-container{width:760px;margin:0 auto 50px}.zao-image{width:760px;height:1100px;display:block}
#decoy{width:500px;height:500px;display:block;margin:auto}
button{border:24px solid green!important;font:60px monospace!important;background:red!important}
</style></head><body><div class="heading">漫画连续翻译 · 原文 / 译文 · 滚动自动继续</div><main id="reader"></main><img id="decoy" alt="logo"><script>
window.addPage=(text,id)=>{
 const canvas=document.createElement('canvas');canvas.width=760;canvas.height=1100;
 const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,760,1100);
 ctx.strokeStyle='#222';ctx.lineWidth=4;ctx.strokeRect(24,24,712,500);ctx.strokeRect(24,550,712,520);
 ctx.beginPath();ctx.ellipse(380,160,310,100,0,0,Math.PI*2);ctx.stroke();
 ctx.fillStyle='#111';ctx.textAlign='center';ctx.font='bold 36px Arial';ctx.fillText(text,380,150);
 ctx.font='32px Arial';ctx.fillText('Read every page',380,205);ctx.fillText('Scroll to continue',380,680);
 const wrap=document.createElement('div');wrap.className='zao-image-container';
 const image=document.createElement('img');image.className='zao-image';image.id=id;wrap.append(image);document.querySelector('#reader').append(wrap);
 canvas.toBlob(blob=>{image.src=URL.createObjectURL(blob)});
 return image;
};addPage('Welcome to FluentRead','page-one');addPage('Second manga page','page-two');addPage('Third manga page','page-three');
${readAheadTest || scrollStabilityTest || cacheNavigationTest || tieredCacheTest ? "addPage('Fourth manga page','page-four');addPage('Fifth manga page','page-five');addPage('Sixth manga page','page-six');" : ''}
</script></body></html>`;
async function ui(hostId, code) {
    const tree = await cdp.send('DOM.getDocument', {depth: -1, pierce: true}); let host;
    function visit(node) {
        const attrs = node.attributes || [];
        for (let i=0; i<attrs.length; i+=2) if (attrs[i] === 'id' && attrs[i+1] === hostId) host=node;
        for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) visit(child);
    }
    visit(tree.root); const shadow = host?.shadowRoots?.[0]; if (!shadow) return null;
    let objectId;
    try {objectId = (await cdp.send('DOM.resolveNode', {nodeId: shadow.nodeId})).object.objectId;}
    catch(error){if(error.message.includes('No node with given id'))return null;throw error;}
    try {
        const result=await cdp.send('Runtime.callFunctionOn', {objectId, functionDeclaration:`function(){${code}}`, returnByValue:true});
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
        return result.result.value;
    } finally {await cdp.send('Runtime.releaseObject', {objectId});}
}
const ball = code => ui('fluent-read-floating-ball-container', code);
const imageUi = code => ui('fluent-read-image-translation-root', code);
const mangaEntry = code => ui('fluent-read-manga-entry-container',code);
async function wait(test, timeout=180000, allowFailure=false) {
    const deadline=Date.now()+timeout;
    while(Date.now()<deadline) {if(await test())return;
        const failure=await imageUi(`const e=this.querySelector('.fr-image-feedback[data-phase="error"] .fr-image-status');return e?.textContent`);
        if(failure&&!allowFailure)throw new Error(`Image pipeline failed: ${failure}`);
        await page.waitForTimeout(200);}
    throw new Error(`Timed out: ${report.currentCase}; image controls: ${await imageUi('return Array.from(this.querySelectorAll(".fr-image-status")).map(e=>e.textContent).join(" | ")')}`);
}
async function toggle() {
    const point=await ball(`const b=this.querySelector('.floating-ball-manga');if(!b)return null;const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}`);
    assert.ok(point,'Manga button exists'); await page.mouse.click(point.x,point.y);
}
async function ops() {return worker.evaluate(()=>globalThis.__mangaTest.operations.length);}
async function screenshot(name) {focusGuard();await page.mouse.move(30,30);await page.waitForTimeout(300);const file=path.join(artifacts,`${name}.png`);await page.screenshot({path:file});report.screenshots.push(file);}
async function toolScreenshot(name){
    await page.mouse.move(30,30);
    const box=await ball(`const r=this.querySelector('.floating-ball-manga').getBoundingClientRect();return {x:r.x-8,y:r.y-8,width:r.width+16,height:r.height+16}`);
    const file=path.join(artifacts,`button-${name}.png`);await page.screenshot({path:file,clip:box});report.screenshots.push(file);
    const metrics=await ball(`const b=this.querySelector('.floating-ball-manga'),c=b.querySelector('.manga-check');return {button:b.getBoundingClientRect().width,badge:c?.getBoundingClientRect().width,pressed:b.getAttribute('aria-pressed'),busy:b.getAttribute('aria-busy')}`);
    report.buttonStates??={};report.buttonStates[name]=metrics;
}
async function captureSource(image, name) {
    await image.evaluate(i=>i.complete && i.naturalWidth ? undefined : new Promise((resolve,reject)=>{i.addEventListener('load',resolve,{once:true});i.addEventListener('error',reject,{once:true});}));
    const data = await image.evaluate(i=>{const c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;c.getContext('2d').drawImage(i,0,0);return c.toDataURL('image/png').split(',')[1];});
    fs.writeFileSync(path.join(artifacts,`${name}-original.png`),Buffer.from(data,'base64'));
}
async function patch(config) {
    return popup.evaluate(async config=>{
        const read=await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});
        const current=read.value;
        const response=await chrome.runtime.sendMessage({type:'persistConfig',mode:'patch',config,
            expected:Object.fromEntries(Object.keys(config).map(key=>[key,current[key]])),
            clientId:'manga-browser-test',sequence:Date.now(),baseRevision:current.__fluentConfigRevision||0});
        if(!response.success)throw new Error(response.error);
    },config);
}
async function assertQuietReading() {
    assert.equal(await mangaEntry('return !!this.querySelector(".fr-manga-entry")'),false,'No automatic reader panel');
    assert.equal(await imageUi('return [...this.querySelectorAll(".fr-image-feedback")].some(e=>!e.hidden && getComputedStyle(e).display!=="none")'),false,'No per-image progress or error cards');
    assert.equal(await imageUi('return [...this.querySelectorAll(".fr-image-controls[data-phase=loading]")].some(e=>!e.hidden && getComputedStyle(e).display!=="none")'),false,'No per-image cancel popup while reading');
}

function auditPageErrors() {
    // 匿名广告脚本没有文件 URL；只有 CDP 能证明其默认网页上下文时才归入宿主，未知错误仍使测试失败。
    report.errors=report.pageErrors.filter(error=>{
        if(report.hostErrors.some(host=>host.stack===error.stack))return false;
        const exception=report.scriptExceptions?.find(event=>event.details.exception?.description===error.stack);
        if(liveSite&&!error.stack.includes('chrome-extension://')&&exception?.context?.auxData?.isDefault===true) {
            report.hostErrors.push({...error,context:exception.context});return false;
        }
        return true;
    }).map(error=>error.message);
}

async function verifyPipelinePerformance(extensionId) {
    assert.ok(pipelineRounds>=2 && pipelineRounds<=5,'Measure first use separately from bounded warm runs');
    const chunks=fs.readdirSync(path.join(extensionDir,'chunks'));
    const ortFiles=chunks.filter(name=>/^ort\.(?:webgpu\.)?bundle\.min-/.test(name));
    assert.ok(ortFiles.length,'Production ORT namespace is exported');
    // 只在自有临时扩展 Offscreen 中测量；不改变宿主页或普通生产代码。
    await modelObserver.command('Runtime.evaluate',{expression:`(async()=>{
        if(${forceCpu})Object.defineProperty(navigator,'gpu',{value:undefined,configurable:true});
        const samples=globalThis.__pipelineSamples={sessions:[],runs:[],encodes:[],gpuSubmissions:0,adapters:[],userAgent:navigator.userAgent};
        if(globalThis.GPUQueue){const submit=GPUQueue.prototype.submit;GPUQueue.prototype.submit=function(...args){samples.gpuSubmissions++;return submit.apply(this,args);};}
        if(navigator.gpu){const request=navigator.gpu.requestAdapter.bind(navigator.gpu);navigator.gpu.requestAdapter=async(...args)=>{const start=performance.now();const adapter=await request(...args);samples.adapters.push({ms:performance.now()-start,available:!!adapter,fallback:adapter?.isFallbackAdapter,info:adapter?.info&&{vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description}});return adapter;};}
        const constructors=new Set();
        for(const file of ${JSON.stringify(ortFiles)}) {
            const module=await import(chrome.runtime.getURL('chunks/'+file));
            const ort=Object.values(module).find(value=>value?.InferenceSession);
            if(!ort || constructors.has(ort.InferenceSession))continue;constructors.add(ort.InferenceSession);
            const create=ort.InferenceSession.create.bind(ort.InferenceSession);
            if(${gpuDiagnosis} && file.includes('webgpu')) {
                try {
                    ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;ort.env.wasm.wasmPaths={mjs:chrome.runtime.getURL('/fluent-read-manga/ort-wasm-simd-threaded.asyncify.mjs'),wasm:chrome.runtime.getURL('/fluent-read-manga/ort-wasm-simd-threaded.asyncify.wasm')};
                    const cache=await caches.open('fluent-read-manga-ocr-v1'),keys=await cache.keys();
                    const key=keys.find(key=>key.url.includes('small_det'));
                    const model=await(await cache.match(key)).arrayBuffer();
                    const session=await create(model,{executionProviders:['webgpu']});await session.release();samples.gpuDiagnosis='success';
                } catch(error){samples.gpuDiagnosis=String(error);}
            }
            ort.InferenceSession.create=async(model,options)=>{
                const start=performance.now();const session=await create(model,{...options,${graphOverride?`graphOptimizationLevel:${JSON.stringify(graphOverride)}`:''}});
                const kind=session.inputNames.includes('mask')?'inpaint':'ocr';
                samples.sessions.push({kind,ms:performance.now()-start,providers:options?.executionProviders});
                const run=session.run.bind(session);
                session.run=async(...args)=>{const start=performance.now();const result=await run(...args);samples.runs.push({kind,ms:performance.now()-start,inputs:Object.fromEntries(Object.entries(args[0]).map(([name,tensor])=>[name,tensor.dims]))});return result;};
                return session;
            };
        }
        const encode=HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL=function(...args){const start=performance.now();const value=encode.apply(this,args);samples.encodes.push({width:this.width,height:this.height,ms:performance.now()-start,bytes:value.length,method:'toDataURL'});return value;};
        const toBlob=HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob=function(callback,...args){const start=performance.now(),width=this.width,height=this.height;return toBlob.call(this,blob=>{samples.encodes.push({width,height,ms:performance.now()-start,bytes:blob?.size,method:'toBlob'});callback(blob);},...args);};
        samples.gpu=navigator.gpu?await navigator.gpu.requestAdapter({powerPreference:'high-performance'}).then(adapter=>({available:!!adapter,info:adapter?.info&&{vendor:adapter.info.vendor,architecture:adapter.info.architecture}})):null;
    })()`,awaitPromise:true,returnByValue:true});
    report.pipeline=[];report.graphOverride=graphOverride;
    for(const input of pipelineInputs) for(let round=0;round<pipelineRounds;round++) {
        report.currentCase=`pipeline ${path.basename(input)} round ${round+1}`;
        await page.goto(targetUrl,{waitUntil:'domcontentloaded'});
        const data='data:image/png;base64,'+fs.readFileSync(input).toString('base64');
        await page.evaluate(async data=>{
            const images=[...document.querySelectorAll('.zao-image')];images.slice(1).forEach(image=>image.parentElement.remove());
            const image=images[0];image.src=data;await image.decode();window.scrollTo(0,0);
        },data);
        await wait(async()=>!!await ball(`return this.querySelector('.floating-ball-manga')`),30000);
        const before=await ops();const start=Date.now();
        await modelObserver.command('Runtime.evaluate',{expression:'globalThis.__pipelineSamples.runs=[];globalThis.__pipelineSamples.encodes=[];globalThis.__pipelineSamples.sessions=[];globalThis.__pipelineSamples.gpuSubmissions=0'});
        await toggle();
        await wait(async()=>await page.locator('.zao-image').first().evaluate(i=>i.style.opacity==='0'),180000);
        assert.equal(await page.locator('.zao-image').first().evaluate(i=>i.src),data,'Source stays the exact benchmark image');
        const end=Date.now();
        const requestId=await worker.evaluate(index=>globalThis.__mangaTest.operations[index],before);
        const progress=await worker.evaluate(id=>globalThis.__mangaTest.progress.filter(p=>p.requestId===id),requestId);
        const texts=await worker.evaluate(()=>globalThis.__mangaTest.textBatches.at(-1));
        const sampled=await modelObserver.command('Runtime.evaluate',{expression:'globalThis.__pipelineSamples',returnByValue:true});
        const translated=await imageUi(`const surface=this.querySelector('.fluent-read-image-translation-bitmap');return surface?.tagName==='CANVAS'?surface.toDataURL('image/png'):surface?.src`);
        assert.ok(translated?.startsWith('data:image/png;base64,'),'Lossless translated output exists');
        const output=path.join(artifacts,`${path.basename(input,'.png')}-round-${round+1}-translated.png`);
        fs.writeFileSync(output,Buffer.from(translated.split(',')[1],'base64'));
        report.pipeline.push({input,round,cold:report.pipeline.length===0,totalMs:end-start,requestId,progress,texts,...sampled.result.value,output});
        assert.ok(texts.length>0,'Actual text recognition ran');await assertQuietReading();
        await toggle();await wait(async()=>await page.locator('.zao-image').first().evaluate(i=>i.style.opacity!=='0'));
        focusGuard();console.log(JSON.stringify({input:path.basename(input),round,totalMs:end-start,runs:sampled.result.value.runs.length}));
    }
    report.cases.push('same-source uncached pipeline runs with real production OCR and inpainting');
    auditPageErrors();assert.deepEqual(report.errors,[]);assert.deepEqual(report.consoleErrors,[]);
}

async function verifyScrollStability() {
    assert.equal(prefetchPages,0,'Scroll overlap test processes visible pages only');
    const images=page.locator(readerSelector);
    await page.setViewportSize({width:1280,height:700});
    // Pixiv 的站点 resize 回调可能晚于 CDP viewport 返回；原图快照必须取自本次布局，而不是上次高度。
    let previousLayout='',stableSince=0;
    report.layoutBeforeTranslation=[];
    await wait(async()=>{
        const layout=await images.evaluateAll(items=>items.map(i=>({src:i.src,style:i.getAttribute('style')})));
        const signature=JSON.stringify(layout);
        if(signature!==previousLayout){previousLayout=signature;stableSince=Date.now();report.layoutBeforeTranslation.push({at:stableSince,layout});}
        return Date.now()-stableSince>=300;
    },10000);
    assert.equal(await ball('return this.querySelector(".floating-ball-manga")?.getAttribute("aria-pressed")'),'false');
    await wait(async()=>await images.evaluateAll((items,isPixiv)=>items.some(i=>
        (!isPixiv||i.closest('.gtm-expand-full-size-illust'))&&i.complete&&i.naturalWidth>80&&i.getBoundingClientRect().width>80&&i.getBoundingClientRect().bottom>0&&i.getBoundingClientRect().top<700),pixiv),30000);
    const index=await images.evaluateAll((items,isPixiv)=>items.findIndex(i=>
        (!isPixiv||i.closest('.gtm-expand-full-size-illust'))&&i.complete&&i.naturalWidth>80&&i.getBoundingClientRect().width>80&&i.getBoundingClientRect().bottom>0&&i.getBoundingClientRect().top<700),pixiv);
    assert.ok(index>=0,'Visible loaded reader page found');
    const first=images.nth(index),second=images.nth(index+1);
    assert.ok(await second.count(),'At least two pages are present');
    const originals=await images.evaluateAll(items=>items.map(i=>({src:i.src,srcset:i.getAttribute('srcset'),sizes:i.getAttribute('sizes'),style:i.getAttribute('style')})));
    report.returnDurationsMs=[];report.scrollStability=true;report.overlapSource=liveSite?'actual OCR/inpainting stages':'actual OCR followed by held deterministic text transport';
    const scroll=async image=>{
        await image.evaluate(i=>i.scrollIntoView({block:'start',behavior:'instant'}));
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    };
    async function returnFirst(image=first) {
        const duration=await image.evaluate(async i=>{
            const start=performance.now();i.scrollIntoView({block:'start',behavior:'instant'});
            for(let frame=0;frame<90;frame++) {
                await new Promise(resolve=>requestAnimationFrame(resolve));
                if(i.style.opacity==='0')return performance.now()-start;
            }
            throw new Error('Returning translated image did not appear within 90 frames');
        });
        report.returnDurationsMs.push(duration);
        const rect=await image.evaluate(i=>{const r=i.getBoundingClientRect();return {top:r.top,bottom:r.bottom}});
        assert.equal(await imageUi(`return [...this.querySelectorAll('.fluent-read-image-translation-bitmap')].some(i=>{const r=i.getBoundingClientRect();return getComputedStyle(i.parentElement).display!=='none' && r.width>80 && Math.abs(r.top-${rect.top})<2 && r.bottom>0})`),true,'Actual translated bitmap follows the returned image');
        return duration;
    }
    async function noVisibleReversion(image) {
        const samples=await image.evaluate(async i=>{
            const bad=[];
            for(let frame=0;frame<30;frame++) {await new Promise(resolve=>requestAnimationFrame(resolve));
                const r=i.getBoundingClientRect();if(r.bottom>0&&r.top<innerHeight&&i.style.opacity!=='0')bad.push({frame,opacity:i.style.opacity});}
            return bad;
        });
        assert.deepEqual(samples,[],'A translated visible page never flashes back to the original');
    }
    report.currentCase='completed current page remains readable with cache disabled';
    await patch({useCache:false});await scroll(first);const started=Date.now();await toggle();
    await wait(async()=>await first.evaluate(i=>i.style.opacity==='0'));
    report.firstPageMs=Date.now()-started;const initialOps=report.initialPageOperations=await ops();
    if(!liveSite)assert.equal(initialOps,1);await assertQuietReading();
    await noVisibleReversion(first);report.cases.push(report.currentCase);
    report.currentCase='next page in progress does not block returning to the translated page';
    if(!liveSite)await worker.evaluate(()=>{globalThis.__mangaTest.holdNext=true;});
    await scroll(second);
    await wait(async()=>(await ops())===initialOps+1,15000);
    if(!liveSite)await wait(async()=>await worker.evaluate(()=>!!globalThis.__mangaTest.releaseHeld),90000);
    assert.equal(await ball('return this.querySelector(".floating-ball-manga")?.getAttribute("aria-busy")'),'true','Another page is still processing when returning');
    await returnFirst();await noVisibleReversion(first);assert.equal(await ops(),initialOps+1);
    report.cases.push(report.currentCase);await screenshot('return-during-next-page');
    report.currentCase='repeated fast forward/back scrolling reuses the same result without extra OCR';
    for(let attempt=0;attempt<6;attempt++) {await scroll(second);await returnFirst();}
    assert.equal(await ops(),initialOps+1);await assertQuietReading();report.cases.push(report.currentCase);
    report.currentCase='pause restores original host sources and styles; late completion cannot revive translations';
    // 在线阅读器会把初始占位图换成真正的 blob；核对暂停前当前资源，不能要求宿主回到旧占位图。
    const sourcesBeforePause=await images.evaluateAll(items=>items.map(i=>({src:i.src,srcset:i.getAttribute('srcset'),sizes:i.getAttribute('sizes')})));
    await toggle();
    if(!liveSite)await worker.evaluate(()=>{globalThis.__mangaTest.releaseHeld?.();});
    await page.waitForTimeout(1000);
    await wait(async()=>await imageUi('return this.querySelectorAll(".fluent-read-image-translation-bitmap").length===0'));
    const restored=await images.evaluateAll(items=>items.map(i=>({src:i.src,srcset:i.getAttribute('srcset'),sizes:i.getAttribute('sizes'),style:i.getAttribute('style')})));
    assert.deepEqual(restored.map(({style,...source})=>source),sourcesBeforePause);
    assert.deepEqual(restored.slice(0,originals.length).map(i=>i.style),originals.map(i=>i.style));report.cases.push(report.currentCase);
    await toggle();await returnFirst();assert.equal(await ops(),initialOps+1);report.cases.push('resume restores the completed visible result without another recognition request');
    await toggle();
    if(!liveSite) {
        await page.reload({waitUntil:'domcontentloaded'});
        await wait(async()=>!!await ball('return this.querySelector(".floating-ball-manga")'),30000);
        const inFlightFirst=page.locator('#page-one'),inFlightNext=page.locator('#page-two');
        report.currentCase='scrolling away before the first result finishes preserves its task and result for return';
        const beforeOverlap=await ops(),cancelBefore=await worker.evaluate(()=>globalThis.__mangaTest.cancellations.length);
        await scroll(inFlightFirst);await worker.evaluate(()=>{globalThis.__mangaTest.holdNext=true;});await toggle();
        await wait(async()=>await worker.evaluate(()=>!!globalThis.__mangaTest.releaseHeld),90000);
        await scroll(inFlightNext);assert.equal(await ops(),beforeOverlap+1,'Heavy tasks remain serial');
        assert.equal(await worker.evaluate(()=>globalThis.__mangaTest.cancellations.length),cancelBefore,'Scrolling alone does not cancel the first task');
        await worker.evaluate(()=>{globalThis.__mangaTest.holdNext=true;globalThis.__mangaTest.releaseHeld();});
        await wait(async()=>(await ops())===beforeOverlap+2&&await worker.evaluate(()=>!!globalThis.__mangaTest.releaseHeld),90000);
        await returnFirst(inFlightFirst);await noVisibleReversion(inFlightFirst);assert.equal(await ops(),beforeOverlap+2);
        report.cases.push(report.currentCase);await screenshot('return-after-first-finished-offscreen');
        await toggle();await worker.evaluate(()=>{globalThis.__mangaTest.releaseHeld?.();});await page.waitForTimeout(500);
        await patch({useCache:true});await page.reload({waitUntil:'domcontentloaded'});
        await wait(async()=>!!await ball('return this.querySelector(".floating-ball-manga")'),30000);
        const near=page.locator('#page-one'),far=page.locator('#page-five');
        await scroll(near);const before=await ops();await toggle();
        await wait(async()=>await near.evaluate(i=>i.style.opacity==='0'));
        assert.equal(await ops(),before+1);
        report.currentCase='returning from outside the two-page retention window restores a cached bitmap during another request';
        await worker.evaluate(()=>{globalThis.__mangaTest.holdNext=true;});await scroll(far);
        await wait(async()=>await worker.evaluate(()=>!!globalThis.__mangaTest.releaseHeld),90000);
        assert.equal(await near.evaluate(i=>i.style.opacity),'','Offscreen original is restored after release');
        await returnFirst(near);await noVisibleReversion(near);assert.equal(await ops(),before+2);
        report.cases.push(report.currentCase);await screenshot('cached-return-during-next-page');
        report.currentCase='changing a retained source invalidates its translation and keeps the new original readable';
        await near.evaluate(i=>{i.src=document.querySelector('#page-three').src;});
        await wait(async()=>await near.evaluate(i=>i.complete&&i.style.opacity!=='0'),10000);
        await page.waitForTimeout(300);assert.equal(await near.evaluate(i=>i.style.opacity),'');
        assert.equal(await ops(),before+2,'New source waits behind actual in-flight work rather than receiving a stale bitmap');
        report.cases.push(report.currentCase);
        report.currentCase='chapter change cancels the old request and ignores its late provider result';
        await page.evaluate(()=>{history.pushState(null,'','/viewer/1024051');document.dispatchEvent(new Event('fluentread-route-change'));});
        await wait(async()=>(await ball('return this.querySelector(".floating-ball-manga")?.getAttribute("aria-pressed")'))==='false',10000);
        await worker.evaluate(()=>{globalThis.__mangaTest.releaseHeld?.();});await page.waitForTimeout(1000);
        assert.equal(await imageUi('return this.querySelectorAll(".fluent-read-image-translation-bitmap").length'),0);
        assert.equal(await ops(),before+2);report.cases.push(report.currentCase);
    }
    report.progress=await worker.evaluate(()=>globalThis.__mangaTest.progress);
    report.cancellations=await worker.evaluate(()=>globalThis.__mangaTest.cancellations);
    if(blockedAll)assert.equal(report.modelRequests.length,0);
    assert.ok(!(report.offscreenDiagnostics||[]).some(d=>['warning','error'].includes(d.level)&&d.text.includes('Unknown CPU vendor')));
    auditPageErrors();assert.deepEqual(report.errors,[]);assert.deepEqual(report.consoleErrors,[]);
}

async function verifyTieredCache(extensionId) {
    assert.equal(liveSite,false);assert.equal(prefetchPages,0);
    report.currentCase='brand manga selects support keyboard, theme, narrow screens and persisted cache capacity';
    await popup.goto(`chrome-extension://${extensionId}/options.html#settings-image-translation`);
    const root=popup.locator('[data-testid=manga-settings]');await root.waitFor();
    assert.equal(await root.locator('select').count(),0,'Manga fields use branded custom controls');
    assert.match(await popup.getByRole('combobox',{name:'漫画翻译服务',exact:true}).locator('xpath=ancestor::div[contains(concat(" ",normalize-space(@class)," ")," el-select ")][1]').textContent(),/跟随网页翻译服务/);
    const cache=popup.getByRole('combobox',{name:'快速缓存图片数量',exact:true});
    const selected=()=>cache.locator('xpath=ancestor::div[contains(concat(" ",normalize-space(@class)," ")," el-select ")][1]').textContent();
    assert.match(await selected(),/12/,'Default fast cache holds twelve normal pages');
    await cache.press('Enter');await popup.locator('.el-popper.fluentread-select-popper:visible').waitFor();
    await popup.waitForTimeout(300);await popup.screenshot({path:path.join(artifacts,'manga-select-light.png')});report.screenshots.push(path.join(artifacts,'manga-select-light.png'));
    await cache.press('ArrowDown');await cache.press('Enter');
    await popup.waitForTimeout(250);
    // Read through the production configuration message, with no assumption about storage serialization.
    const read=()=>popup.evaluate(async()=>{const r=await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});return typeof r.value==='string'?JSON.parse(r.value):r.value;});
    assert.equal((await read()).imageTranslationMangaCachePages,13,'Keyboard selection is persisted');
    await cache.press('Enter');await popup.getByRole('option',{name:'2 张图片',exact:true}).click();
    await popup.close();popup=await newPageWithoutForeground(launched.context);await popup.goto(`chrome-extension://${extensionId}/options.html#settings-image-translation`);
    await popup.locator('[data-testid=manga-settings]').waitFor();assert.equal((await read()).imageTranslationMangaCachePages,2,'Fast close preserves the latest configuration');
    report.persistenceCases=[{field:'imageTranslationMangaCachePages',default:12,keyboard:13,reopened:2,quickClose:true}];
    await patch({theme:'dark'});await popup.reload();await popup.getByRole('combobox',{name:'提前翻译后续页面',exact:true}).press('Enter');
    await popup.locator('.el-popper.fluentread-select-popper:visible').waitFor();await popup.waitForTimeout(300);await popup.screenshot({path:path.join(artifacts,'manga-select-dark.png')});report.screenshots.push(path.join(artifacts,'manga-select-dark.png'));
    await popup.getByRole('combobox',{name:'提前翻译后续页面',exact:true}).press('Escape');await popup.locator('.el-popper.fluentread-select-popper:visible').waitFor({state:'hidden'});
    await popup.setViewportSize({width:390,height:850});await popup.reload();const narrow=popup.getByRole('combobox',{name:'快速缓存图片数量',exact:true});await narrow.scrollIntoViewIfNeeded();await narrow.press('Enter');
    const menu=popup.locator('.el-popper.fluentread-select-popper:visible');await menu.waitFor();const bounds=await menu.boundingBox();assert.ok(bounds.x>=-1&&bounds.x+bounds.width<=391,'Dropdown fits narrow viewport');
    await popup.waitForTimeout(300);await popup.screenshot({path:path.join(artifacts,'manga-select-narrow.png')});report.screenshots.push(path.join(artifacts,'manga-select-narrow.png'));await narrow.press('Escape');
    report.cases.push(report.currentCase);await patch({theme:'light'});await popup.close();popup=await newPageWithoutForeground(launched.context);await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.setViewportSize({width:800,height:700});
    const pages=['#page-one','#page-four','#page-six'].map(id=>page.locator(id));
    await pages[0].evaluate(i=>i.scrollIntoView({block:'start',behavior:'instant'}));const start=await ops();await toggle();
    const settle=()=>wait(async()=>await ball('return this.querySelector(".floating-ball-manga")?.getAttribute("aria-busy")')==='false');
    for(let i=0;i<pages.length;i++){
        await pages[i].evaluate(i=>i.scrollIntoView({block:'start',behavior:'instant'}));await wait(async()=>await pages[i].evaluate(i=>i.style.opacity==='0'));await settle();
        assert.equal(await imageUi('return [...this.querySelectorAll(".fluent-read-image-translation-bitmap")].filter(i=>getComputedStyle(i.parentElement).display!=="none").every(i=>i.tagName==="CANVAS")'),true);
    }
    assert.equal(await ops(),start+3);report.cases.push('new manga outputs display composed canvases directly');
    report.currentCase='return from compact cache reconstructs without any extra OCR, translation or full-page PNG encoding';
    report.tieredReturnDurationsMs=[];
    for(let round=0;round<3;round++)for(const image of [pages[0],pages[2]]){
        const ms=await image.evaluate(async i=>{const start=performance.now();i.scrollIntoView({block:'start',behavior:'instant'});for(let frame=0;frame<120;frame++){await new Promise(resolve=>requestAnimationFrame(resolve));if(i.style.opacity==='0')return performance.now()-start;}throw new Error('Compact cache did not restore image');});
        report.tieredReturnDurationsMs.push(ms);await settle();assert.equal(await ops(),start+3);await assertQuietReading();
    }
    await screenshot('tiered-cache-return');report.cases.push(report.currentCase);
    report.currentCase='horizontal navigation reconstructs cached pages with host-safe geometry';
    await page.evaluate(()=>{const reader=document.querySelector('#reader');reader.style.display='flex';reader.style.width='max-content';for(const wrap of reader.children){wrap.style.flexShrink='0';wrap.style.margin='0 50px 0 0';}window.dispatchEvent(new Event('resize'));});
    for(const image of [pages[0],pages[2],pages[0]]){await image.evaluate(i=>i.scrollIntoView({block:'start',inline:'start',behavior:'instant'}));await wait(async()=>await image.evaluate(i=>i.style.opacity==='0'));await settle();assert.equal(await ops(),start+3);}
    await screenshot('tiered-cache-horizontal');report.cases.push(report.currentCase);
    await toggle();assert.equal(await page.locator('.zao-image').evaluateAll(images=>images.every(i=>i.style.opacity!=='0')),true);
    report.cases.push('pause restores every original without reading popovers');
    report.textBatches=await worker.evaluate(()=>globalThis.__mangaTest.textBatches);if(blockedAll)assert.equal(report.modelRequests.length,0);
    auditPageErrors();assert.deepEqual(report.errors,[]);assert.deepEqual(report.consoleErrors,[]);
}

async function verifyCacheNavigation() {
    assert.equal(liveSite,false,'Cache mutation checks belong only to the owned fixture');
    assert.equal(prefetchPages,0,'Navigation checks must not translate unrelated upcoming pages');
    await page.setViewportSize({width:800,height:700});
    const first=page.locator('#page-one'),far=page.locator('#page-five');
    const settle=()=>wait(async()=>await ball('return this.querySelector(".floating-ball-manga")?.getAttribute("aria-busy")')==='false');
    const visit=async image=>{
        const ms=await image.evaluate(async i=>{
            const start=performance.now();i.scrollIntoView({block:'start',inline:'start',behavior:'instant'});
            for(let frame=0;frame<90;frame++) {await new Promise(resolve=>requestAnimationFrame(resolve));if(i.style.opacity==='0')return performance.now()-start;}
            throw new Error('Cached translated image did not return within 90 frames');
        });
        const rect=await image.evaluate(i=>{const r=i.getBoundingClientRect();return {left:r.left,top:r.top}});
        assert.equal(await imageUi(`return [...this.querySelectorAll('.fluent-read-image-translation-bitmap')].some(i=>{const r=i.getBoundingClientRect();return getComputedStyle(i.parentElement).display!=='none'&&Math.abs(r.left-${rect.left})<2&&Math.abs(r.top-${rect.top})<2})`),true);
        report.cacheReturnDurationsMs.push(ms);
    };
    report.cacheReturnDurationsMs=[];
    await first.evaluate(i=>i.scrollIntoView({block:'start',behavior:'instant'}));const before=await ops();await toggle();
    await wait(async()=>await first.evaluate(i=>i.style.opacity==='0'));await settle();assert.equal(await ops(),before+1);
    await far.evaluate(i=>i.scrollIntoView({block:'start',behavior:'instant'}));
    await wait(async()=>await far.evaluate(i=>i.style.opacity==='0'));await settle();assert.equal(await ops(),before+2);
    report.currentCase='vertical navigation beyond nearby retention reuses cached bitmaps without another OCR request';
    for(let i=0;i<3;i++){await visit(first);await visit(far);}assert.equal(await ops(),before+2);report.cases.push(report.currentCase);
    await page.evaluate(()=>{
        const reader=document.querySelector('#reader');reader.style.display='flex';reader.style.width='max-content';
        for(const wrap of reader.children){wrap.style.flexShrink='0';wrap.style.margin='0 50px 0 0';}
        window.dispatchEvent(new Event('resize'));
    });
    report.currentCase='horizontal left/right navigation reuses the same cached bitmaps with correct overlay geometry';
    for(let i=0;i<3;i++){await visit(first);await visit(far);}assert.equal(await ops(),before+2);await assertQuietReading();
    report.cases.push(report.currentCase);await screenshot('cache-horizontal-translated');await visit(first);
    report.currentCase='native same-URL image load invalidates completion and performs exactly one fresh recognition';
    const oldSource=await first.getAttribute('src'),beforeReload=await ops();
    await first.evaluate(i=>new Promise((resolve,reject)=>{i.addEventListener('load',resolve,{once:true});i.addEventListener('error',reject,{once:true});i.src=i.src;}));
    await wait(async()=>await ops()===beforeReload+1&&await first.evaluate(i=>i.style.opacity==='0'));await settle();
    assert.equal(await first.getAttribute('src'),oldSource);assert.equal(await ops(),beforeReload+1);report.cases.push(report.currentCase);
    report.currentCase='real OCR of a blank page stores a lightweight completion marker and leaves the original visible';
    const beforeBlank=await ops();await first.evaluate(i=>{
        const canvas=document.createElement('canvas');canvas.width=760;canvas.height=1100;
        const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,760,1100);i.src=canvas.toDataURL('image/png');
    });
    await wait(async()=>await ops()>=beforeBlank+1);await settle();assert.equal(await ops(),beforeBlank+1);assert.equal(await first.evaluate(i=>i.style.opacity),'');
    report.cases.push(report.currentCase);
    report.currentCase='original pause and resume reuse blank-page completion without rerunning OCR';
    await toggle();await toggle();await settle();assert.equal(await ops(),beforeBlank+1);report.cases.push(report.currentCase);
    report.currentCase='blank-page completion survives navigation beyond the nearby window without a bitmap or extra OCR';
    await visit(far);
    await first.evaluate(i=>i.scrollIntoView({block:'start',inline:'start',behavior:'instant'}));
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await settle();
    assert.equal(await ops(),beforeBlank+1);assert.equal(await first.evaluate(i=>i.style.opacity),'');await assertQuietReading();report.cases.push(report.currentCase);
    report.currentCase='target-language changes invalidate even the lightweight blank-page result';
    await patch({to:'en'});await wait(async()=>await ops()===beforeBlank+2);await settle();assert.equal(await ops(),beforeBlank+2);
    report.cases.push(report.currentCase);await screenshot('cache-blank-original');await toggle();
    assert.equal(await page.locator('.zao-image').evaluateAll(items=>items.every(i=>i.style.opacity!=='0')),true);
    if(blockedAll)assert.equal(report.modelRequests.length,0);
    auditPageErrors();assert.deepEqual(report.errors,[]);assert.deepEqual(report.consoleErrors,[]);
}

async function verifyReadAhead() {
    report.currentCase='reader detects real image pages and default upcoming-page option';
    const images=page.locator(readerSelector);
    await wait(async()=>await images.evaluateAll(items=>items.some(i=>i.complete&&i.naturalWidth>80&&i.getBoundingClientRect().width>80)),30000);
    report.readerImages=await images.evaluateAll(items=>items.map(i=>{const r=i.getBoundingClientRect();return {width:i.naturalWidth,height:i.naturalHeight,top:r.top,bottom:r.bottom,displayWidth:r.width,src:i.src}}));
    const visibleIndex=pixiv?await images.evaluateAll(items=>items.findIndex(i=>i.closest('.gtm-expand-full-size-illust')&&i.getBoundingClientRect().width>=80&&i.getBoundingClientRect().bottom>0&&i.getBoundingClientRect().top<900)):report.readerImages.findIndex(i=>i.displayWidth>=80&&i.bottom>0&&i.top<900);
    assert.ok(visibleIndex>=0,'At least one loaded reader image is visible');
    const first=images.nth(visibleIndex);
    const originals=await images.evaluateAll(items=>items.map(i=>({src:i.src,srcset:i.getAttribute('srcset'),sizes:i.getAttribute('sizes'),style:i.getAttribute('style')})));
    await screenshot('read-ahead-original');report.cases.push(report.currentCase);
    report.currentCase='current page is shown before upcoming preparation finishes';
    const started=Date.now();await toggle();
    await wait(async()=>(await ball('return this.querySelector(".floating-ball-manga")?.getAttribute("aria-busy")'))==='true');
    await assertQuietReading();await screenshot('read-ahead-processing-unobstructed');
    await wait(async()=>await first.evaluate(i=>i.style.opacity==='0'));
    report.firstPageMs=Date.now()-started;report.cases.push(report.currentCase);
    await screenshot('read-ahead-first-visible');
    report.currentCase='bounded upcoming pages prepared with real OCR';
    await wait(async()=>(await ball('return this.querySelector(".floating-ball-manga")?.getAttribute("aria-busy")'))==='false');
    report.prepareWindowMs=Date.now()-started;
    report.displayedIndices=await images.evaluateAll(items=>items.flatMap((i,index)=>i.style.opacity==='0'?[index]:[]));
    report.windowOperations=await ops();
    if(pixiv){assert.ok(report.windowOperations>=3,'All three artwork pages were scanned');assert.ok(report.displayedIndices.includes(visibleIndex));assert.ok(!report.displayedIndices.includes(0),'Behind-reader duplicate cover is untouched');}
    else assert.ok(report.windowOperations>=2,'Current page and at least one upcoming page processed');
    if(!liveSite){assert.equal(report.windowOperations,4);assert.equal(await page.locator('#decoy').evaluate(i=>i.style.opacity),'');}
    await screenshot('read-ahead-window-ready');report.cases.push(report.currentCase);
    report.currentCase=pixiv?'no-text upcoming page keeps its original artwork':'prepared upcoming translation follows the image into view';
    const nextIndex=visibleIndex+1;
    const next=images.nth(nextIndex),startedScroll=Date.now();
    await next.evaluate(i=>i.scrollIntoView({block:'start',behavior:'instant'}));
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await next.evaluate(i=>i.style.opacity),pixiv?'':'0');report.preparedPageScrollMs=Date.now()-startedScroll;
    report.progress=await worker.evaluate(()=>globalThis.__mangaTest.progress);
    const rectangles=await imageUi('return [...this.querySelectorAll(".fluent-read-image-translation-bitmap")].map(i=>{const r=i.getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:r.width}})');
    if(!pixiv)assert.ok(rectangles.some(r=>r.width>80&&r.bottom>0&&r.top<900),'Translated bitmap follows the prepared image into the viewport');
    await assertQuietReading();
    await screenshot('read-ahead-next-visible');report.cases.push(report.currentCase);
    report.currentCase='original pause restores all prepared host images';
    const sourcesBeforePause=await images.evaluateAll(items=>items.map(i=>({src:i.src,srcset:i.getAttribute('srcset'),sizes:i.getAttribute('sizes')})));
    await toggle();
    await wait(async()=>await imageUi('return this.querySelectorAll(".fluent-read-image-translation-bitmap").length === 0'));
    // 阅读器翻页可能追加新的懒加载图片；核对原有节点，另行确认追加节点没有残留透明样式。
    const restored=await images.evaluateAll(items=>items.map(i=>({src:i.src,srcset:i.getAttribute('srcset'),sizes:i.getAttribute('sizes'),style:i.getAttribute('style')})));
    assert.deepEqual(restored.map(({style,...source})=>source),sourcesBeforePause);
    assert.deepEqual(restored.slice(0,originals.length).map(i=>i.style),originals.map(i=>i.style));
    assert.equal(await images.evaluateAll(items=>items.every(i=>i.style.opacity!== '0')),true);
    report.cases.push(report.currentCase);
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/options.html#settings-image-translation`);
    const select=popup.getByRole('combobox',{name:'提前翻译后续页面',exact:true});await select.press('Enter');await popup.getByRole('option',{name:'只翻译当前页面',exact:true}).click();await popup.reload();assert.match(await select.locator('xpath=ancestor::div[contains(@class,"el-select")][1]').textContent(),/只翻译当前页面/);report.cases.push('upcoming-page setting persists and allows current-page-only mode');
    report.textBatches=await worker.evaluate(()=>globalThis.__mangaTest.textBatches);
    assert.ok(!(report.offscreenDiagnostics || []).some(d=>['warning','error'].includes(d.level)&&d.text.includes('Unknown CPU vendor')),'Known WASM CPU diagnostic is not a warning or error');
    if(blockedAll){assert.equal(report.modelRequests.length,0);report.cases.push('no model downloads during prepared local reading');}
    auditPageErrors();assert.deepEqual(report.errors,[]);assert.deepEqual(report.consoleErrors,[]);
}
(async()=>{
    launched=await launchFocusSafePersistentContext({chromium,profileDir:profile,
        browserPath:arg('browser-path','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),headless:false,background:true,
        browserArgs:[...(extensionDebugging?['--enable-unsafe-extension-debugging']:[`--disable-extensions-except=${extensionDir}`,`--load-extension=${extensionDir}`]),'--no-first-run','--no-default-browser-check'],
        viewport:{width:1280,height:900},timeout:30000});
    Object.assign(report,{launchMode:launched.launchMode,focusPolicy:launched.focusPolicy,windowPlacement:launched.windowPlacement});
    assert.equal(report.launchMode,'macos-background-cdp');
    assert.equal(report.focusPolicy,'launchservices-no-foreground');
    assert.equal(report.windowPlacement.mode,'background-visible-no-focus');
    assert.equal(report.windowPlacement.browserFrontmost,false);
    const context=launched.context;
    const system=await context.browser().newBrowserCDPSession();browserPid=(await system.send('SystemInfo.getProcessInfo')).processInfo.find(p=>p.type==='browser').id;if(extensionDebugging){report.extensionLoad=await system.send('Extensions.loadUnpacked',{path:extensionDir});loadedExtensionId=report.extensionLoad.id;}await system.detach();focusGuard();
    report.blockedOfficial=blockedOfficial;report.blockedAllModelSources=blockedAll;report.modelRequests=[];
    context.on('console',message=>{if(message.type()==='error'&&message.text().includes('FluentRead'))report.consoleErrors.push(message.text());});
    if(loadedExtensionId)await context.pages()[0].goto(`chrome-extension://${loadedExtensionId}/popup.html`);
    const ownWorker=w=>w.url().startsWith(loadedExtensionId?`chrome-extension://${loadedExtensionId}/`:'chrome-extension://');
    worker=context.serviceWorkers().find(ownWorker)||await context.waitForEvent('serviceworker',{predicate:ownWorker,timeout:30000});
    const extensionId=new URL(worker.url()).host;

    popup=context.pages()[0];
    const options=popup,reopened=popup,modelSettings=popup;
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await patch({on:true,uiLanguage:'zh-CN',uiLanguageSetupCompleted:true,disableImageTranslator:false,
        imageTranslationMangaEnabled:true,imageTranslationMangaDownloadConfirmed:true,imageTranslationMangaPromptEnabled:false,imageTranslationHoverEnabled:false,disableFloatingBall:false,
        imageTranslationMangaPrefetchPages:prefetchPages,
        service:'google',from:pixiv?'ja':'en',to:'zh-Hans',useCache:true,enableAIContext:false,animations:false});
    await worker.evaluate(({live,trace})=>{
        const original=globalThis.fetch.bind(globalThis);
        const test=globalThis.__mangaTest={operations:[],inputs:[],requests:[],cancellations:[],textBatches:[],progress:[]};
        chrome.runtime.onMessage.addListener(message=>{
            if(message.type==='fluentReadImageTranslate') {
                test.operations.push(message.requestId);
                if(trace) {
                    let hash=2166136261;for(const char of message.image)hash=Math.imul(hash^char.charCodeAt(0),16777619);
                    test.inputs.push({at:Date.now(),requestId:message.requestId,bytes:message.image.length,hash:hash>>>0});
                }
            }
            if(message.type==='fluentReadImageProgress')test.progress.push({at:Date.now(),requestId:message.requestId,stage:message.stage,progress:message.progress});
            if(message.type==='fluentReadImageCancel')test.cancellations.push(message.requestId);
            if(message.type==='fluentReadImageTranslateTexts')test.textBatches.push(message.texts);
            return false;
        });
        globalThis.fetch=async(input,options)=>{
            const url=String(typeof input==='string'?input:input.url||input);
            if(url.includes('/_/TranslateWebserverUi/data/batchexecute')){
                const rpc=JSON.parse(new URLSearchParams(options.body).get('f.req'))[0][0];
                const source=JSON.parse(rpc[1])[0][0];test.requests.push(source);
                if(live)return original(input,options);
                if(test.holdNext) {test.holdNext=false;await new Promise(resolve=>{test.releaseHeld=()=>{delete test.releaseHeld;resolve();};});}
                await new Promise(resolve=>setTimeout(resolve,250));
                const entry=[null,null,null,null,null,[['流畅阅读：看懂每一页漫画']]];
                return new Response(JSON.stringify([['wrb.fr','MkEWBc',JSON.stringify([null,[[entry]]])]]),{status:200});
            }
            return original(input,options);
        };
    },{live:liveTranslation,trace:traceReader});
    await worker.evaluate(async()=>{await chrome.offscreen.createDocument({url:chrome.runtime.getURL('offscreen.html'),reasons:['DOM_PARSER'],justification:'Verify local manga processing in an isolated test profile'});});
    modelObserver=await observeModelDownloads(extensionId);
    if(preloadModels){
        await modelSettings.goto(`chrome-extension://${extensionId}/options.html#settings-image-translation`);
        if(!baseline)await modelSettings.locator('.manga-resources > summary').click();
        await modelSettings.locator('.manga-model-settings').waitFor();
        if(!baseline)await modelSettings.locator('.manga-download-settings > summary').click();
        await modelSettings.locator('.manga-model-settings input[type=file]').setInputFiles(['PP-OCRv6_small_det.onnx','PP-OCRv6_small_rec.onnx','ppocrv6_dict.txt','lama-manga-dynamic.onnx'].map(name=>path.join(preloadModels,name)));
        const until=Date.now()+60000;let prepared=false;while(Date.now()<until){const s=await modelSettings.evaluate(()=>chrome.runtime.sendMessage({type:'fluentReadMangaModelStatus'}));if(s.ready&&s.inpaintingReady){prepared=true;break;}await modelSettings.waitForTimeout(150);}assert.ok(prepared,'All four imported resources are ready before leaving settings');
        const audit=async()=>{const cache=await caches.open('fluent-read-manga-ocr-v1');return Promise.all((await cache.keys()).map(async key=>{const response=await cache.match(key);const bytes=await response.arrayBuffer();return {url:key.url,status:response.status,bytes:bytes.byteLength,sha:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('')}}));};
        report.preloadedCacheOptions=await modelSettings.evaluate(audit);assert.equal(report.preloadedCacheOptions.length,4,'All four validated files exist before navigation');
        const audited=await modelObserver.command('Runtime.evaluate',{expression:`(${audit.toString()})()`,returnByValue:true,awaitPromise:true});report.preloadedCacheOffscreen=audited.result.value;
        report.modelsPreloaded=true;await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    }
    if(!liveSite)await context.route(targetUrl,route=>route.fulfill({status:200,contentType:'text/html',body:pipelineInputs?fixture.replace("canvas.toBlob(blob=>{image.src=URL.createObjectURL(blob)})","image.src=canvas.toDataURL('image/png')"):fixture}));
    page=await newPageWithoutForeground(context);page.on('pageerror',error=>{
        const stack=error.stack||'';
        report.pageErrors.push({message:error.message,stack});
        if(liveSite&&!stack.includes('chrome-extension://')&&/https?:\/\//.test(stack))report.hostErrors.push({message:error.message,stack});
        else report.errors.push(error.message);
    });
    await page.goto(targetUrl,{waitUntil:'domcontentloaded',timeout:60000});
    cdp=await context.newCDPSession(page);
    if(liveSite||traceReader) {
        const scripts=new Map(),contexts=new Map();report.scriptExceptions=[];
        cdp.on('Runtime.executionContextCreated',event=>contexts.set(event.context.id,event.context));
        if(traceReader)cdp.on('Debugger.scriptParsed',script=>scripts.set(script.scriptId,{url:script.url,sourceMapURL:script.sourceMapURL}));
        cdp.on('Runtime.exceptionThrown',event=>report.scriptExceptions.push({details:event.exceptionDetails,context:contexts.get(event.exceptionDetails.executionContextId),scripts:(event.exceptionDetails.stackTrace?.callFrames||[]).map(frame=>scripts.get(frame.scriptId))}));
        if(traceReader)await cdp.send('Debugger.enable');await cdp.send('Runtime.enable');
    }
    if(liveSite){const reject=page.locator('#onetrust-reject-all-handler');await reject.waitFor({timeout:12000}).then(()=>reject.click()).catch(()=>undefined);}
    if(pixiv) {
        await page.locator(readerSelector).first().waitFor();
        const read=page.getByText('阅读作品',{exact:true});
        const alreadyOpen=await page.locator(readerSelector).evaluateAll(items=>items.some(i=>!i.closest('main')&&i.getBoundingClientRect().width>80));
        if(!alreadyOpen&&await read.isVisible().catch(()=>false))await read.click({timeout:5000});
    }
    await page.locator(readerSelector).first().waitFor();
    if(traceReader)await page.evaluate(selector=>{
        const ids=new WeakMap();let next=0;const traces=globalThis.__readerTrace=[];
        const capture=reason=>traces.push({at:Date.now(),reason,images:[...document.querySelectorAll(selector)].map(i=>{
            if(!ids.has(i))ids.set(i,++next);const rect=i.getBoundingClientRect();
            return {id:ids.get(i),src:i.currentSrc,raw:i.getAttribute('src'),srcset:i.getAttribute('srcset'),sizes:i.getAttribute('sizes'),complete:i.complete,width:i.naturalWidth,height:i.naturalHeight,top:rect.top,bottom:rect.bottom,expanded:!!i.closest('.gtm-expand-full-size-illust')};
        })});
        capture('initial');new MutationObserver(records=>{if(records.some(r=>r.type==='childList'||r.target.matches?.(selector)))capture('mutation');}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src','srcset','sizes']});
        addEventListener('scroll',()=>capture('scroll'),true);
        document.addEventListener('load',event=>{if(event.target.matches?.(selector))capture('load:'+event.target.id);},true);
    },readerSelector);
    await wait(async()=>!!await ball(`return this.querySelector('.floating-ball-manga')`),30000);
    if(pipelineInputs){await verifyPipelinePerformance(extensionId);report.status='passed';return;}
    if(tieredCacheTest){await verifyTieredCache(extensionId);report.status='passed';focusGuard();return;}
    if(cacheNavigationTest){await verifyCacheNavigation();report.status='passed';focusGuard();return;}
    if(scrollStabilityTest){await verifyScrollStability();report.status='passed';focusGuard();return;}
    if(readAheadTest){await verifyReadAhead();report.status='passed';focusGuard();return;}
    report.currentCase='one click activates and translates only visible pages';
    const source=page.locator('.zao-image').first();
    const original=await source.evaluate(i=>({src:i.src,srcset:i.getAttribute('srcset'),sizes:i.getAttribute('sizes'),style:i.getAttribute('style')}));
    await captureSource(source,'01');
    let started=Date.now();report.pageDurationsMs=[];
    await toolScreenshot('idle');await toggle();
    await wait(async()=>(await ball(`return this.querySelector('.floating-ball-manga').getAttribute('aria-busy')`))==='true',10000);
    await toolScreenshot('pending');
    if(!baseline){await assertQuietReading();await screenshot('pending-unobstructed');}
    if(report.buttonStates.pending.busy==='true')assert.equal(report.buttonStates.pending.badge,undefined,'Pending shows progress instead of a completion check');
    if(!skipFirstCancel){
    report.currentCase='cancel first preparation restores originals and can resume';
    await toggle();await wait(async()=>(await worker.evaluate(()=>globalThis.__mangaTest.cancellations.length))>0);
    assert.equal(await imageUi(`return this.querySelectorAll('.fluent-read-image-translation-bitmap').length`),0);
    assert.deepEqual(await source.evaluate(i=>({src:i.src,srcset:i.getAttribute('srcset'),sizes:i.getAttribute('sizes'),style:i.getAttribute('style')})),original);
    report.cases.push(report.currentCase);await toggle();
    }
    report.currentCase='one click activates and translates only visible pages';
    await wait(async()=>(await imageUi(`return this.querySelectorAll('.fluent-read-image-translation-bitmap').length`))>0);
    await wait(async()=>(await ball(`return this.querySelector('.floating-ball-manga').getAttribute('aria-busy')`))==='false');
    assert.equal(await ball(`return this.querySelector('.floating-ball-manga').getAttribute('aria-pressed')`),'true');
    report.pageDurationsMs.push({page:1,ms:Date.now()-started,includesFirstModelPreparation:true});
    await toolScreenshot('active');assert.ok(report.buttonStates.active.badge>=19);
    if(!liveSite){assert.ok((await ops())<=2,'Only the visible page and its canceled preparation/retry run');
        assert.equal(await imageUi(`return this.querySelectorAll('.fluent-read-image-translation-overlay').length`),1);}
    report.firstOperationCount=await ops();report.cases.push(report.currentCase);
    if(!baseline){await assertQuietReading();report.cases.push('translated reading has no automatic panel');}
    await screenshot('01-translated');
    report.currentCase='original pauses and repeated toggles reuse visible results';
    await toggle();await wait(async()=>(await imageUi(`return this.querySelectorAll('.fluent-read-image-translation-bitmap').length`))===0);
    assert.deepEqual(await source.evaluate(i=>({src:i.src,srcset:i.getAttribute('srcset'),sizes:i.getAttribute('sizes'),style:i.getAttribute('style')})),original);
    const before=await ops();await toggle();await wait(async()=>(await imageUi(`return this.querySelectorAll('.fluent-read-image-translation-bitmap').length`))>0);
    assert.equal(await ops(),before);report.cases.push(report.currentCase);
    report.currentCase='scroll automatically translates a new visible page';
    const second=page.locator('.zao-image').nth(1);started=Date.now();await second.scrollIntoViewIfNeeded();
    await captureSource(second,'02');
    await wait(async()=>(await ops())>before);
    await wait(async()=>(await ball(`return this.querySelector('.floating-ball-manga').getAttribute('aria-busy')`))==='false');
    assert.ok((await imageUi(`return this.querySelectorAll('.fluent-read-image-translation-bitmap').length`))>0);
    report.pageDurationsMs.push({page:2,ms:Date.now()-started,mayIncludeFirstInpaintingPreparation:true});
    await screenshot('02-scrolled-translated');report.cases.push(report.currentCase);
    if(liveSite)for(let index=2;index<qualityPages;index++){
        if(index===3 && readingPauseMs){report.readingPauseMs=readingPauseMs;await page.waitForTimeout(Math.min(60000,readingPauseMs));if(readingPauseMs>60000)await page.waitForTimeout(readingPauseMs-60000);}
        report.currentCase=`live page ${index+1} translates automatically`;
        const previous=await ops(), image=page.locator('.zao-image').nth(index);started=Date.now();
        await image.scrollIntoViewIfNeeded();await captureSource(image,String(index+1).padStart(2,'0'));
        await wait(async()=>(await ops())>previous);
        await wait(async()=>(await ball(`return this.querySelector('.floating-ball-manga').getAttribute('aria-busy')`))==='false');
        assert.ok((await imageUi(`return this.querySelectorAll('.fluent-read-image-translation-bitmap').length`))>0);
        assert.equal(await image.evaluate(i=>i.style.opacity),'0');
        report.pageDurationsMs.push({page:index+1,ms:Date.now()-started});
        await screenshot(`${String(index+1).padStart(2,'0')}-dialogue-translated`);report.cases.push(report.currentCase);
    }
    if(!liveSite){
        report.currentCase='dynamic image discovery and source replacement';
        await page.evaluate(()=>window.addPage('Dynamic manga page','page-four'));
        await page.locator('#page-four').scrollIntoViewIfNeeded();let previous=await ops();
        await wait(async()=>(await ops())>previous);await wait(async()=>(await ball(`return this.querySelector('.floating-ball-manga').getAttribute('aria-busy')`))==='false');
        previous=await ops();await page.locator('#page-four').evaluate(i=>{const canvas=document.createElement('canvas');canvas.width=760;canvas.height=1100;
            const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,760,1100);ctx.fillStyle='black';ctx.font='48px Arial';ctx.fillText('Source changed',90,200);canvas.toBlob(b=>{i.src=URL.createObjectURL(b)});});
        await wait(async()=>(await ops())>previous);await wait(async()=>(await ball(`return this.querySelector('.floating-ball-manga').getAttribute('aria-busy')`))==='false');
        assert.equal(await page.locator('#decoy').evaluate(i=>i.style.opacity),'');report.cases.push(report.currentCase);
        report.currentCase='unrecognized page retains original and shows an amber status';
        await page.evaluate(async()=>{
            const canvas=document.createElement('canvas');canvas.width=760;canvas.height=1100;
            const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,760,1100);
            const blob=await new Promise(resolve=>canvas.toBlob(resolve));
            const wrap=document.createElement('div');wrap.className='zao-image-container';const image=document.createElement('img');
            image.className='zao-image';image.id='blank-page';image.src=URL.createObjectURL(blob);wrap.append(image);document.querySelector('#reader').append(wrap);
        });
        await page.locator('#blank-page').scrollIntoViewIfNeeded();
        await wait(async()=>!!await ball(`return this.querySelector('.manga-error')`),60000,true);
        assert.notEqual(await page.locator('#blank-page').evaluate(i=>i.style.opacity),'0');
        await toolScreenshot('partial-error');report.cases.push(report.currentCase);
        if(!baseline){await assertQuietReading();report.cases.push('failed page never opens a reading panel');}
        report.currentCase='chapter change resets continuous mode and restores originals';
        await page.evaluate(()=>history.pushState({},'', '/viewer/555'));
        await wait(async()=>(await ball(`return this.querySelector('.floating-ball-manga').getAttribute('aria-pressed')`))==='false');
        assert.equal(await imageUi(`return this.querySelectorAll('.fluent-read-image-translation-bitmap').length`),0);report.cases.push(report.currentCase);
    }
    if(!baseline){
        if(liveSite){await assertQuietReading();report.cases.push('scroll and hover never open a reading panel');}
        report.currentCase='manga button matches brand button size and progress ring stays inside';
        const metrics=await ball(`const a=this.querySelector('.floating-ball-manga').getBoundingClientRect(),b=this.querySelector('.floating-ball-main').getBoundingClientRect();return {manga:a.width,brand:b.width}`);
        assert.equal(metrics.manga,metrics.brand);assert.equal(metrics.manga,40);report.buttonSize=metrics;report.cases.push(report.currentCase);
    }
    report.currentCase='settings switch persists across unmount and reopen';
    await patch({imageTranslationMangaEnabled:false});
    await wait(async()=>!(await ball(`return !!this.querySelector('.floating-ball-manga')`)));
    await options.goto(`chrome-extension://${extensionId}/options.html#settings-image-translation`);
    await options.getByRole('switch',{name:baseline?'显示漫画翻译按钮':'启用漫画连续翻译',exact:true}).waitFor({state:'attached'});
    assert.equal(await options.getByRole('switch',{name:baseline?'显示漫画翻译按钮':'启用漫画连续翻译',exact:true}).getAttribute('aria-checked'),'false');
    await options.locator('.el-switch').filter({has:options.getByRole('switch',{name:baseline?'显示漫画翻译按钮':'启用漫画连续翻译',exact:true})}).click();await options.goto(`chrome-extension://${extensionId}/popup.html`);
    await reopened.goto(`chrome-extension://${extensionId}/options.html#settings-image-translation`);
    await reopened.getByRole('switch',{name:baseline?'显示漫画翻译按钮':'启用漫画连续翻译',exact:true}).waitFor({state:'attached'});
    assert.equal(await reopened.getByRole('switch',{name:baseline?'显示漫画翻译按钮':'启用漫画连续翻译',exact:true}).getAttribute('aria-checked'),'true');
    const settingsShot=path.join(artifacts,'03-settings-reopened.png');await reopened.screenshot({path:settingsShot});report.screenshots.push(settingsShot);
    await reopened.goto(`chrome-extension://${extensionId}/popup.html`);report.cases.push(report.currentCase);
    report.currentCase='master disable removes image UI and restores all source styles';
    await patch({on:false});await wait(async()=>(await page.locator('#fluent-read-image-translation-root').count())===0);
    assert.equal(await page.locator('.zao-image').evaluateAll(images=>images.filter(i=>i.style.opacity==='0').length),0);
    report.cases.push(report.currentCase);
    report.currentCase='cached manga model status and clear action';
    report.modelStatusBefore=await popup.evaluate(()=>chrome.runtime.sendMessage({type:'fluentReadMangaModelStatus'}));
    assert.equal(report.modelStatusBefore.ready,true);assert.ok(report.modelStatusBefore.bytes>30000000);
    await modelSettings.goto(`chrome-extension://${extensionId}/options.html#settings-image-translation`);
    if(!baseline)await modelSettings.locator('.manga-resources > summary').click();
    if(!baseline)await modelSettings.locator('.manga-download-settings > summary').click();
    await modelSettings.getByRole('button',{name:baseline?'清除漫画模型':'清除已下载资源',exact:true}).waitFor();
    await modelSettings.getByLabel('模型下载来源',{exact:true}).selectOption('mirror');
    await modelSettings.reload();
    if(!baseline)await modelSettings.locator('.manga-resources > summary').click();
    await modelSettings.waitForFunction(()=>document.querySelector('.manga-model-settings select')?.value==='mirror');
    if(!baseline)await modelSettings.locator('.manga-download-settings > summary').click();
    report.cases.push('model source selection persists on reopen');
    await modelSettings.locator('.manga-model-settings').scrollIntoViewIfNeeded();
    const modelShot=path.join(artifacts,'models-before-clear.png');await modelSettings.screenshot({path:modelShot});report.screenshots.push(modelShot);
    await modelSettings.getByRole('button',{name:baseline?'清除漫画模型':'清除已下载资源',exact:true}).click();
    await modelSettings.locator('.manga-model-settings small').filter({hasText:/^(?:已占用空间 · )?0 MB$/}).waitFor();
    report.modelStatusAfter=await popup.evaluate(()=>chrome.runtime.sendMessage({type:'fluentReadMangaModelStatus'}));
    assert.deepEqual(report.modelStatusAfter,{success:true,ready:false,bytes:0,inpaintingReady:false,source:'mirror'});
    if(offlineModels){
        await modelSettings.locator('.manga-model-settings input[type=file]').setInputFiles(['PP-OCRv6_small_det.onnx','PP-OCRv6_small_rec.onnx','ppocrv6_dict.txt','lama-manga-dynamic.onnx'].map(name=>path.join(offlineModels,name)));
        await modelSettings.locator('.manga-model-settings small').filter({hasText:'226 MB'}).waitFor({timeout:60000});
        report.offlineStatus=await popup.evaluate(()=>chrome.runtime.sendMessage({type:'fluentReadMangaModelStatus'}));
        assert.equal(report.offlineStatus.ready,true);assert.equal(report.offlineStatus.inpaintingReady,true);
        report.cases.push('offline files import and verify without model network requests');
        const offlineShot=path.join(artifacts,'models-offline-imported.png');await modelSettings.screenshot({path:offlineShot});report.screenshots.push(offlineShot);
        await patch({theme:'dark'});await modelSettings.waitForFunction(()=>document.documentElement.classList.contains('dark'));
        await modelSettings.setViewportSize({width:420,height:900});await modelSettings.locator('.manga-model-settings').scrollIntoViewIfNeeded();
        const bounds=await modelSettings.locator('.manga-model-settings').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=421);
        const darkShot=path.join(artifacts,'models-dark-mobile.png');await modelSettings.screenshot({path:darkShot});report.screenshots.push(darkShot);
        report.cases.push('model controls fit narrow viewport and dark theme');
        await modelSettings.getByRole('button',{name:baseline?'清除漫画模型':'清除已下载资源',exact:true}).click();
        await modelSettings.locator('.manga-model-settings small').filter({hasText:/^(?:已占用空间 · )?0 MB$/}).waitFor();
    }
    report.cases.push(report.currentCase);
    report.progress=await worker.evaluate(()=>globalThis.__mangaTest.progress);
    report.operations=await ops();report.translationRequests=await worker.evaluate(()=>globalThis.__mangaTest.requests.length);
    report.textBatches=await worker.evaluate(()=>globalThis.__mangaTest.textBatches);
    if(liveSite&&qualityPages>=5){
        const all=report.textBatches.flat().join(' ').toUpperCase().replace(/\s+/g,'');
        for(const phrase of ['IHAVEAFAVORTOASKOFYOUONHISBEHALF','HESHOULDHAVEABOUTTENMILLIONDOLLARSONHIM','THEPOSSESSOROFTHEGOLDENARMS','BUTGOAFTERMYPREY','YOUINSULTME'])assert.ok(all.includes(phrase),`Recognized complete dialogue: ${phrase}`);
        report.cases.push('key complete dialogue recognized on three later pages');
    }
    if(blockedAll)report.cases.push('real OCR and inpainting execute with both remote model sources blocked');
    if(blockedOfficial){assert.ok(report.modelRequests.some(r=>r.source==='huggingface.co'));assert.ok(report.modelRequests.some(r=>r.source==='hf-mirror.net'));report.cases.push('actual Offscreen official-source block falls back to verified mirror files');}
    auditPageErrors();assert.deepEqual(report.errors,[]);assert.deepEqual(report.consoleErrors,[]);report.status='passed';
    focusGuard();
})().catch(async error=>{report.status='failed';report.failure=error.stack;process.exitCode=1;console.error(error);if(cdp){report.lastImageUi=await imageUi('return [...this.querySelectorAll(".fr-image-feedback .fr-image-status")].map(s=>s.textContent)').catch(()=>null);report.lastProgress=await worker.evaluate(()=>globalThis.__mangaTest.progress).catch(()=>null);}if(page)await page.screenshot({path:path.join(artifacts,'failed-reader.png')}).catch(()=>{});})
.finally(async()=>{
    if(worker)await worker.evaluate(()=>({operations:globalThis.__mangaTest?.operations.length,inputs:globalThis.__mangaTest?.inputs,textBatches:globalThis.__mangaTest?.textBatches})).then(data=>Object.assign(report,data)).catch(()=>{});
    if(page&&traceReader)report.readerTrace=await page.evaluate(()=>globalThis.__readerTrace).catch(()=>null);
    if(page&&report.status==='failed')await screenshot('failure').catch(()=>{});
    if(modelObserver && pipelineInputs)report.pipelineLast=(await modelObserver.command('Runtime.evaluate',{expression:'globalThis.__pipelineSamples',returnByValue:true}).catch(()=>({result:{value:null}}))).result.value;
    modelObserver?.close();
    if(launched)await launched.close();
    fs.rmSync(profile,{recursive:true,force:true});report.profileRemoved=!fs.existsSync(profile);
    fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({status:report.status,cases:report.cases,report:path.join(artifacts,'report.json')},null,2));
});

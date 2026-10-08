/** 仅对固定 89fd0580 官方生产产物运行真实 Neo 文档 Port 合成验收；无模型 API 和额外依赖。 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {openOwnedNeo, until, delay, desktopWindows} from './neo-owned-session.mjs';

const evidence = path.resolve(process.argv[2] || path.dirname(new URL(import.meta.url).pathname));
fs.mkdirSync(evidence, {recursive: true});
const driverDir = path.dirname(new URL(import.meta.url).pathname);
const driverHashes = {};
fs.mkdirSync(path.join(evidence, 'driver'), {recursive: true});
for (const name of ['neo-owned-session.mjs','run-neo-port-fixture.mjs']) {
    const bytes = fs.readFileSync(path.join(driverDir,name)); fs.writeFileSync(path.join(evidence,'driver',name),bytes);
    driverHashes[name] = crypto.createHash('sha256').update(bytes).digest('hex');
}
fs.writeFileSync(path.join(evidence,'driver-source-binding.json'),JSON.stringify(driverHashes,null,2)+'\n');
const extension = '/home/arietids/Documents/Codex/2026-10-06/task/FluentRead-transaction-wxt-validation-20261008/.output/chrome-mv3';
const expectedExtensionId = 'djnlaiohfaaifbibleebjggkghlmcpcj';
const extensionName = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8')).name;
const report = {status: 'running', applicationCommit: '89fd05806c4c41778e8a47817988130ef09ca583',
    scope: 'real Linux Neo headed browser + native extension content context + production document Port/source verifier/image fetch/area screenshot; synthetic PNG and HTTP only',
    cases: [], http: [], syntheticFetch: [], errors: [], notTested: ['real HTTPS/TLS/public network', 'macOS', 'Firefox without documentId', 'production client automatic reconnect UI', 'OCR model execution', 'real provider/model/search API', 'RTX5090 WebGPU', 'native Wayland desktop Cua acceptance']};
const write = (name, value) => fs.writeFileSync(path.join(evidence, name), JSON.stringify(value, null, 2) + '\n');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const held = new Map();
const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const row = {url: url.pathname + url.search, method: request.method, destination: request.headers['sec-fetch-dest'], receivedAt: Date.now(), ended: false, closedEarly: false};
    report.http.push(row);
    response.on('close', () => {row.closedEarly = !response.writableEnded; row.closedAt = Date.now();});
    response.setHeader('cache-control', 'no-store');
    if (url.pathname === '/sample.png') {
        response.setHeader('content-type', 'image/png');
        const finish = () => {if (!response.destroyed) {response.end(png); row.ended = true;}};
        if (url.searchParams.has('hold') && request.headers['sec-fetch-dest'] !== 'image') held.set(url.searchParams.get('case'), finish);
        else if (url.searchParams.has('delay') && request.headers['sec-fetch-dest'] !== 'image') setTimeout(finish, 500);
        else finish();
    } else {
        response.setHeader('content-type', 'text/html; charset=utf-8');
        response.end('<!doctype html><html><head><title>FluentRead synthetic Port fixture</title><style>body{font:20px sans-serif;margin:40px;background:#edf0f6}img{width:80px;height:80px;image-rendering:pixelated}</style></head><body><h1>FluentRead · isolated Neo Port fixture</h1><p>Only synthetic local content. Normal headed window.</p><div id="images"></div></body></html>'); row.ended = true;
    }
});

const installBridge = `(() => {
    if (!chrome.runtime?.id) throw new Error('not a real extension content context');
    const channels = new Map(); let rpcSequence = 0;
    globalThis.__neoFixture = {
        extensionId: chrome.runtime.id,
        open(name) {
            const port = chrome.runtime.connect({name:'fluentReadImageDocument:v1'});
            const state = {port, packets:[], results:{}, disconnected:false, pending:new Map()}; channels.set(name,state);
            port.onMessage.addListener(packet => {
                state.packets.push(packet);
                if (packet.kind === 'sourceChallenge') {
                    const message = packet.message;
                    const valid = message?.type === 'fluentReadImageValidateSource' && message.documentUrl === document.URL
                        && [...document.querySelectorAll('img')].some(img => img.isConnected && img.currentSrc === message.url);
                    port.postMessage({kind:'sourceReply',rpcId:packet.rpcId,response:{valid}});
                }
                if (packet.kind === 'result') {state.results[packet.rpcId]=packet.response; state.pending.get(packet.rpcId)?.(packet.response); state.pending.delete(packet.rpcId);}
            });
            port.onDisconnect.addListener(() => {state.disconnected=true;});
            return true;
        },
        start(name, message) {const state=channels.get(name), rpcId='fixture-'+(++rpcSequence);
            state.port.postMessage({kind:'request',version:1,rpcId,message}); return rpcId;},
        state(name) {const state=channels.get(name); return {disconnected:state.disconnected,packets:state.packets,results:state.results};},
        close(name) {channels.get(name).port.disconnect();},
    };
    return {extensionId:chrome.runtime.id,documentUrl:document.URL};
})()`;
let owned, pageSession, contextId, targetId, fixtureOrigin;
const syntheticImageOrigin = 'https://fluentread-fixture.example.com';
const sessionKinds = new Map();
async function interceptSyntheticImages(sessionId, kind) {
    sessionKinds.set(sessionId,kind);
    await owned.cdp.send('Network.enable',{},sessionId);
    await owned.cdp.send('Fetch.enable',{patterns:[{urlPattern:syntheticImageOrigin+'/*',requestStage:'Request'}]},sessionId);
}
const cdpEval = (expression, inExtension = true) => owned.cdp.evaluate(pageSession, expression, inExtension ? contextId : undefined);
async function contentContext() {
    await owned.cdp.send('Runtime.enable', {}, pageSession);
    const context = await until(() => {
        const destroyed = new Set(owned.cdp.events.filter(event => event.sessionId === pageSession && event.method === 'Runtime.executionContextDestroyed').map(event => event.params.executionContextId));
        const clearedAt = owned.cdp.events.findLastIndex(event => event.sessionId === pageSession && event.method === 'Runtime.executionContextsCleared');
        const found = owned.cdp.events.slice(clearedAt + 1).filter(event => event.sessionId === pageSession && event.method === 'Runtime.executionContextCreated').map(event => event.params.context)
            .find(context => !destroyed.has(context.id) && !context.auxData?.isDefault
                && (context.origin === 'chrome-extension://' + expectedExtensionId || context.name === expectedExtensionId || context.name === extensionName));
        return found;
    }, 30_000, 'native extension content execution context');
    contextId = context.id;
    const native = await cdpEval(installBridge);
    assert.equal(native.extensionId, expectedExtensionId);
    write('native-content-context.json', {targetId, contextId, context, native, fixtureOrigin});
    return native;
}
async function open(name) {await cdpEval(`__neoFixture.open(${JSON.stringify(name)})`);
    await until(async () => (await cdpEval(`__neoFixture.state(${JSON.stringify(name)})`)).packets.some(packet => packet.kind === 'ready' && packet.version === 1), 10_000, 'Port ready');}
async function image(caseId, extra = '') {
    const url = `${syntheticImageOrigin}/sample.png?case=${caseId}${extra}`;
    await cdpEval(`new Promise((resolve,reject)=>{const image=document.createElement('img');image.onload=()=>resolve(true);image.onerror=reject;image.src=${JSON.stringify(url)};document.querySelector('#images').append(image);})`, false);
    return url;
}
const start = (name, message) => cdpEval(`__neoFixture.start(${JSON.stringify(name)},${JSON.stringify({...message,timeoutMs:10000})})`);
async function result(name, rpcId) {
    const response = await until(async () => (await cdpEval(`__neoFixture.state(${JSON.stringify(name)})`)).results[rpcId], 15_000, `${name}:${rpcId}`);
    const {image,...metadata}=response;
    write(`port-result-${name}-${rpcId}.json`,{...metadata,...(image?{imageBytes:Buffer.from(image.split(',')[1]||'','base64').length,
        imageSha256:crypto.createHash('sha256').update(Buffer.from(image.split(',')[1]||'','base64')).digest('hex')}:{} )});
    return response;
}
const fetchMessage = (requestId, url) => ({type:'fluentReadImageFetch',requestId,url});
async function record(name, operation) {const before=Date.now(); const details=await operation(); report.cases.push({name,status:'passed',durationMs:Date.now()-before,...details}); write('browser-report.json',report); console.log(JSON.stringify({case:name,status:'passed'}));}
try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); fixtureOrigin=`http://127.0.0.1:${server.address().port}`;
    owned=await openOwnedNeo(extension,evidence);
    owned.cdp.onEvent = event => {
        if(event.method==='Network.loadingFailed') {
            const row=report.syntheticFetch.find(row=>row.sessionId===event.sessionId&&row.networkId===event.params.requestId);
            if(row){row.loadingFailed={errorText:event.params.errorText,canceled:event.params.canceled};row.aborted=event.params.canceled===true||event.params.errorText==='net::ERR_ABORTED';}
        }
        if(event.method!=='Fetch.requestPaused'||!sessionKinds.has(event.sessionId))return;
        const url=new URL(event.params.request.url);assert.equal(url.origin,syntheticImageOrigin);
        const row={url:url.href,sessionId:event.sessionId,kind:sessionKinds.get(event.sessionId),requestId:event.params.requestId,
            networkId:event.params.networkId,fulfilled:false,aborted:false};report.syntheticFetch.push(row);
        const finish=async()=>{
            try {await owned.cdp.send('Fetch.fulfillRequest',{requestId:row.requestId,responseCode:200,
                responseHeaders:[{name:'content-type',value:'image/png'},{name:'cache-control',value:'no-store'},{name:'access-control-allow-origin',value:'*'}],body:png.toString('base64')},event.sessionId);row.fulfilled=true;}
            catch(error){row.fulfillRejected=error.message;}
        };
        if(row.kind==='offscreen'&&url.searchParams.has('hold'))held.set(url.searchParams.get('case'),finish);
        else if(row.kind==='offscreen'&&url.searchParams.has('delay'))setTimeout(()=>void finish(),500);
        else void finish();
    };
    const targets=await until(async () => {const value=await owned.cdp.send('Target.getTargets');return value.targetInfos.some(info=>info.type==='service_worker'&&info.url==='chrome-extension://'+expectedExtensionId+'/background.js')&&value.targetInfos;},30000,'production service worker');
    write('initial-targets.json',targets.map(({targetId,type,url})=>({targetId,type,url})));
    const workerTarget=targets.find(info=>info.type==='service_worker'&&info.url==='chrome-extension://'+expectedExtensionId+'/background.js');
    const {sessionId:workerSession}=await owned.cdp.send('Target.attachToTarget',{targetId:workerTarget.targetId,flatten:true});
    await owned.cdp.evaluate(workerSession,`(async()=>{if(!await chrome.offscreen.hasDocument())await chrome.offscreen.createDocument({url:'offscreen.html',reasons:['DOM_SCRAPING','AUDIO_PLAYBACK','WORKERS'],justification:'Owned synthetic Port integration fixture'});return true;})()`);
    const offscreenTarget=await until(async()=>{const {targetInfos}=await owned.cdp.send('Target.getTargets');return targetInfos.find(info=>info.url==='chrome-extension://'+expectedExtensionId+'/offscreen.html');},10000,'production offscreen target');
    const {sessionId:offscreenSession}=await owned.cdp.send('Target.attachToTarget',{targetId:offscreenTarget.targetId,flatten:true});
    await interceptSyntheticImages(offscreenSession,'offscreen');
    ({targetId}=await owned.cdp.send('Target.createTarget',{url:fixtureOrigin,background:false,newWindow:true,width:1280,height:900}));
    ({sessionId:pageSession}=await owned.cdp.send('Target.attachToTarget',{targetId,flatten:true}));
    await interceptSyntheticImages(pageSession,'synthetic-page');
    await owned.cdp.send('Page.enable',{},pageSession);
    const navigation = await owned.cdp.send('Page.navigate',{url:fixtureOrigin},pageSession);
    write('initial-navigation.json',navigation); assert.ok(!navigation.errorText,navigation.errorText);
    await contentContext(); await open('A');
    const window=await owned.cdp.send('Browser.getWindowForTarget',{targetId}); assert.equal(window.bounds.windowState,'normal');
    write('headed-window.json',window);
    await record('normal image source challenge and fetch over real production Port',async()=>{
        const url=await image('normal'),rpc=await start('A',fetchMessage('normal',url)); const response=await result('A',rpc);
        assert.equal(response.success,true,response.error); assert.ok(response.image.startsWith('data:image/png'));
        const state=await cdpEval(`__neoFixture.state('A')`);assert.ok(state.packets.some(packet=>packet.kind==='sourceChallenge'&&packet.message.requestId==='normal'));
        return {nativePort:true,samePeerSourceChallenge:true,imageBytes:Buffer.from(response.image.split(',')[1],'base64').length,
            imageSha256:crypto.createHash('sha256').update(Buffer.from(response.image.split(',')[1],'base64')).digest('hex')};
    });
    await record('production area capture on the owned active headed tab',async()=>{
        await owned.cdp.send('Target.activateTarget',{targetId});
        const rpc=await start('A',{type:'fluentReadAreaCapture',requestId:'capture'}),response=await result('A',rpc);
        assert.equal(response.success,true);assert.ok(response.image.startsWith('data:image/'));
        const bytes=Buffer.from(response.image.split(',')[1],'base64');fs.writeFileSync(path.join(evidence,'production-area-capture.png'),bytes);
        return {realCaptureVisibleTab:true,imageBytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
    });
    await record('two real Ports with same public request ID remain independent',async()=>{
        await open('B'); const u1=await image('concurrent-a','&delay=1'),u2=await image('concurrent-b','&delay=1');
        const a=await start('A',fetchMessage('shared-ID',u1)),b=await start('B',fetchMessage('shared-ID',u2));
        const [ra,rb]=await Promise.all([result('A',a),result('B',b)]);assert.equal(ra.success,true);assert.equal(rb.success,true);
        const sa=await cdpEval(`__neoFixture.state('A')`),sb=await cdpEval(`__neoFixture.state('B')`);
        assert.ok(!sa.results[b]&&!sb.results[a]);return {twoBrowserOwnedPorts:true,samePublicId:'shared-ID',resultsOnlyOnOriginalPeers:true};
    });
    await record('foreign peer cancel denied; original peer cancel aborts held browser fetch',async()=>{
        const url=await image('cancel','&hold=1'),a=await start('A',fetchMessage('cancel-ID',url));
        await until(()=>held.has('cancel'),10000,'held extension fetch');
        const foreign=await start('B',{type:'fluentReadImageCancel',requestId:'cancel-ID'});assert.equal((await result('B',foreign)).cancelled,false);
        const cancel=await start('A',{type:'fluentReadImageCancel',requestId:'cancel-ID'});assert.equal((await result('A',cancel)).cancelled,true);
        const response=await result('A',a);assert.equal(response.success,false);assert.equal(response.errorName,'AbortError');
        await until(()=>report.syntheticFetch.some(row=>row.url.includes('case=cancel')&&row.kind==='offscreen'&&row.aborted),10000,'cancelled native browser fetch');
        await held.get('cancel')();return {foreignCancelled:false,ownerCancelled:true,errorName:response.errorName,heldBrowserFetchAborted:true,syntheticResponseBoundary:true};
    });
    await record('same URL navigation closes old work; new document accepts the same public ID',async()=>{
        const oldUrl=await image('navigation-old','&hold=1');await start('A',fetchMessage('navigation-ID',oldUrl));
        await until(()=>held.has('navigation-old'),10000,'old document held fetch'); const oldContext=contextId;
        await owned.cdp.send('Page.navigate',{url:fixtureOrigin},pageSession);await contentContext();assert.notEqual(contextId,oldContext);
        await open('new-owner');const newUrl=await image('navigation-new');const rpc=await start('new-owner',fetchMessage('navigation-ID',newUrl));
        const response=await result('new-owner',rpc);assert.equal(response.success,true);
        await until(()=>report.syntheticFetch.some(row=>row.url.includes('navigation-old')&&row.kind==='offscreen'&&row.aborted),10000,'navigation aborts old browser fetch');
        const before=(await cdpEval(`__neoFixture.state('new-owner')`)).packets.length;await held.get('navigation-old')();await delay(300);
        const after=(await cdpEval(`__neoFixture.state('new-owner')`)).packets.length;assert.equal(after,before);
        return {oldExecutionContext:oldContext,newExecutionContext:contextId,sameUrlReload:true,oldBrowserFetchAborted:true,newPublicIdReused:true,noLateOldPacketOnNewPeer:true,syntheticResponseBoundary:true};
    });
    const desktop=desktopWindows();assert.ok(desktop.every(window=>!owned.owned().some(p=>p.pid===Number(window.pid))));
    write('ownership-after-cases.json',{ownedProcesses:owned.owned(),ownedListeners:owned.listeners(),dailyDesktopWindows:desktop,testWindowsOnDailyDesktop:0});
    report.status='passed';report.caseCount=report.cases.length;
} catch(error) {report.status='failed';report.errors.push({name:error.name,message:error.message,stack:error.stack});console.error(error.message);process.exitCode=1;}
finally {
    if(owned){try{write('last-owned-page-state.json',await owned.cdp.evaluate(pageSession,'({url:document.URL,readyState:document.readyState,title:document.title})'));}catch{}}
    if(owned)write('cdp-context-events.json',owned.cdp.events.filter(event=>event.method.startsWith('Runtime.executionContext')||event.method==='Target.attachedToTarget'));
    if(owned)try{await owned.close();}catch(error){report.cleanupError=error.message;report.status='failed';process.exitCode=1;}
    for(const finish of held.values())finish();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    report.fixtureListenerClosed=!server.listening;write('browser-report.json',report);console.log(JSON.stringify({status:report.status,cases:report.cases.length,evidence}));
}

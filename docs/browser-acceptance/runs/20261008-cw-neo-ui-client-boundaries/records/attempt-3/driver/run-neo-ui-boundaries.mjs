/** 固定 89fd0580 的生产 UI/来源授权/一次断连重连验收；HTTP 只在隔离 CDP 测试边界合成。 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import {openOwnedNeo, until, delay, desktopWindows} from './neo-owned-session.mjs';

const evidence=path.resolve(process.argv[2]);fs.mkdirSync(evidence,{recursive:true});
const application='/home/arietids/Documents/Codex/2026-10-06/task/FluentRead-transaction-wxt-validation-20261008';
const extension=path.join(application,'.output/chrome-mv3'), extensionId='djnlaiohfaaifbibleebjggkghlmcpcj';
const imageOrigin='https://fluentread-fixture.example.com';
const onlyReconnect=process.argv.includes('--only-reconnect');
const write=(name,value)=>fs.writeFileSync(path.join(evidence,name),JSON.stringify(value,null,2)+'\n');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function artifacts() {
    const result={};
    const visit=directory=>{for(const name of fs.readdirSync(directory).sort()){const file=path.join(directory,name);
        if(fs.statSync(file).isDirectory())visit(file);else result[path.relative(application,file)]=sha(fs.readFileSync(file));}};
    for(const name of ['chrome-mv3','firefox-mv2','userscript'])visit(path.join(application,'.output',name));
    return result;
}
function fixturePng() {
    const table=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c;}
    const crc=bytes=>{let c=0xffffffff;for(const byte of bytes)c=table[(c^byte)&255]^(c>>>8);return(c^0xffffffff)>>>0;};
    const chunk=(name,body)=>{const type=Buffer.from(name),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(body.length);checksum.writeUInt32BE(crc(Buffer.concat([type,body])));return Buffer.concat([length,type,body,checksum]);};
    const width=400,height=180,raw=Buffer.alloc(height*(width*3+1));
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const offset=y*(width*3+1)+1+x*3;const stripe=x>35&&x<365&&y>45&&y<135&&((x%44)<12||y<57||y>122);raw[offset]=stripe?40:235;raw[offset+1]=stripe?70:242;raw[offset+2]=stripe?100:250;}
    const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
    return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const png=fixturePng();fs.writeFileSync(path.join(evidence,'synthetic-image.png'),png);
const report={status:'running',applicationCommit:'89fd05806c4c41778e8a47817988130ef09ca583',
    scope:'production UI and production native document client; observation-only source challenge; one explicit real peer disconnect fault; synthetic HTTP only',
    cases:[],http:[],network:[],executionSelection:onlyReconnect?'reconnect only; retain prior area/auth evidence':'all three boundaries',
    faultInjection:'one captured background-side real image document peer disconnect after the production translate start arrives',
    notTested:['complete translation','OCR/model execution','real provider API','new cancellation source','Firefox without documentId','RTX5090 WebGPU','daily desktop Cua/Wayland input']};
let owned,origin,pageSession,pageTarget,contextId,workerSession;
const sessionKinds=new Map(),requestKinds=new Map(),attaching=new Map();
const server=http.createServer((req,res)=>{report.http.push({path:new URL(req.url,'http://localhost').pathname,method:req.method});
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
    res.end(`<!doctype html><html><head><title>FluentRead isolated production UI fixture</title><style>body{font:20px system-ui;margin:45px;background:#edf1f7}h1{font-size:28px}article{display:flex;gap:35px;margin-top:45px}img{width:400px;height:180px}p{max-width:1000px}</style></head><body><h1>CW production UI fixture</h1><p>Alpha and Beta are synthetic local test text. No models, accounts or public content.</p><article><div><p>Source A</p><img id="source-a" alt="Synthetic text specimen A" src="${imageOrigin}/source-a.png"></div><div><p>Source B</p><img id="source-b" alt="Synthetic text specimen B" src="${imageOrigin}/source-b.png"></div></article><script>window.__trustedInputs=[];for(const type of ['keydown','pointerdown','pointerup'])document.addEventListener(type,e=>window.__trustedInputs.push({type,isTrusted:e.isTrusted,key:e.key,x:e.clientX,y:e.clientY}),true)</script></body></html>`);
});
const contentObserver=`(() => {
    if(globalThis.__neoUiObserver)return {alreadyInstalled:true};
    const ports=[],events=[],captures=[];
    const summarize=packet=>{
        const value=JSON.parse(JSON.stringify(packet));
        for(const part of [value.message,value.response])if(part&&typeof part.image==='string'){part.imageDataUrlLength=part.image.length;part.imagePrefix=part.image.slice(0,30);delete part.image;}
        return value;
    };
    const original=chrome.runtime.connect;
    chrome.runtime.connect=function(...args){const port=original.apply(this,args);
        if(port.name!=='fluentReadImageDocument:v1')return port;
        const id='content-peer-'+(ports.length+1),row={id,createdAt:Date.now(),name:port.name,disconnected:false};ports.push(row);
        const requests=new Map(),post=port.postMessage.bind(port);
        port.postMessage=function(packet){events.push({direction:'out',peer:id,at:Date.now(),packet:summarize(packet)});
            if(packet.kind==='request')requests.set(packet.rpcId,packet.message?.type);
            const result=post(packet);
            return result;
        };
        port.onMessage.addListener(packet=>{
            events.push({direction:'in',peer:id,at:Date.now(),packet:summarize(packet)});
            if(packet.kind==='result'&&requests.get(packet.rpcId)==='fluentReadAreaCapture'&&packet.response?.image)captures.push({rpcId:packet.rpcId,image:packet.response.image});
        });
        port.onDisconnect.addListener(()=>{row.disconnected=true;events.push({direction:'disconnect',peer:id,at:Date.now()});});
        return port;
    };
    globalThis.__neoUiObserver={snapshot:()=>({ports,events}),captures:()=>captures};
    return {extensionId:chrome.runtime.id,observerOnlyExceptExplicitDisconnect:true,sourceChallengeRepliesSentByDriver:0};
})()`;
const workerObserver=`(() => {
    const events=[],peers=[];let faultArmed=false,faultCount=0;
    globalThis.__neoUiWorkerObserver={snapshot:()=>({events,peers,faultCount}),arm:()=>{faultArmed=true;}};
    const original=chrome.offscreen.createDocument;
    chrome.offscreen.createDocument=function(...args){events.push({kind:'production-createDocument',at:Date.now(),options:args[0]});return original.apply(this,args);};
    chrome.runtime.onConnect.addListener(port=>{
        if(port.name!=='fluentReadImageDocument:v1')return;
        const id='worker-peer-'+(peers.length+1);peers.push({id,at:Date.now(),sender:{id:port.sender?.id,url:port.sender?.url,documentId:port.sender?.documentId,frameId:port.sender?.frameId,tabId:port.sender?.tab?.id}});
        port.onMessage.addListener(packet=>{
            events.push({kind:'incoming',peer:id,at:Date.now(),rpcId:packet.rpcId,packetKind:packet.kind,messageType:packet.message?.type,requestId:packet.message?.requestId,timeoutMs:packet.message?.timeoutMs,sourceReplyValid:packet.response?.valid});
            if(faultArmed&&faultCount===0&&packet.kind==='request'&&packet.message?.type==='fluentReadImageTranslate'){
                faultArmed=false;faultCount++;events.push({kind:'explicit-real-background-peer-disconnect',peer:id,at:Date.now(),rpcId:packet.rpcId,requestId:packet.message.requestId});port.disconnect();
            }
        });
        port.onDisconnect.addListener(()=>events.push({kind:'disconnect',peer:id,at:Date.now()}));
    });return {observational:true,driverCreateDocumentCalls:0};
})()`;
async function attachNetwork(target,kind){
    if(attaching.has(target.targetId))return attaching.get(target.targetId);
    const promise=(async()=>{const {sessionId}=await owned.cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});sessionKinds.set(sessionId,kind);
        await owned.cdp.send('Network.enable',{},sessionId);
        await owned.cdp.send('Fetch.enable',{patterns:[{urlPattern:'http://*',requestStage:'Request'},{urlPattern:'https://*',requestStage:'Request'}]},sessionId);
        return sessionId;})();attaching.set(target.targetId,promise);return promise;
}
async function targets(){return(await owned.cdp.send('Target.getTargets')).targetInfos;}
async function offscreens(){return(await targets()).filter(t=>t.url===`chrome-extension://${extensionId}/offscreen.html`).map(t=>({targetId:t.targetId,type:t.type,url:t.url}));}
async function capture(name){const result=await owned.cdp.send('Page.captureScreenshot',{format:'png'},pageSession);const bytes=Buffer.from(result.data,'base64');fs.writeFileSync(path.join(evidence,name+'.png'),bytes);return {bytes:bytes.length,sha256:sha(bytes)};}
const pageEval=expression=>owned.cdp.evaluate(pageSession,expression);
const extEval=expression=>owned.cdp.evaluate(pageSession,expression,contextId);
async function tree(){await owned.cdp.send('DOM.enable',{},pageSession);const {root}=await owned.cdp.send('DOM.getDocument',{depth:-1,pierce:true},pageSession);return root;}
function nodes(root){const result=[];const visit=node=>{result.push(node);for(const key of ['children','shadowRoots','pseudoElements'])for(const child of node[key]||[])visit(child);if(node.contentDocument)visit(node.contentDocument);};visit(root);return result;}
const attrs=node=>Object.fromEntries(Array.from({length:(node.attributes?.length||0)/2},(_,i)=>[node.attributes[2*i],node.attributes[2*i+1]]));
async function nodeText(){return nodes(await tree()).filter(n=>n.nodeType===3).map(n=>n.nodeValue).join('\n');}
async function mouse(type,x,y,extra={}){await owned.cdp.send('Input.dispatchMouseEvent',{type,x,y,...extra},pageSession);}
async function clickPoint(x,y){await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y,{button:'left',buttons:1,clickCount:1});await mouse('mouseReleased',x,y,{button:'left',buttons:0,clickCount:1});}
async function clickNode(node){const {model}=await owned.cdp.send('DOM.getBoxModel',{backendNodeId:node.backendNodeId},pageSession);const box=model.border;
    await clickPoint((box[0]+box[2]+box[4]+box[6])/4,(box[1]+box[3]+box[5]+box[7])/4);}
async function key(key,code,vk,modifiers=0){await owned.cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk,modifiers},pageSession);await owned.cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk,modifiers},pageSession);}
async function caseRun(name,operation){const started=Date.now();try{const details=await operation();report.cases.push({name,status:details.status||'passed',durationMs:Date.now()-started,...details});}
    catch(error){report.cases.push({name,status:'failed',durationMs:Date.now()-started,error:error.message,stack:error.stack});await capture('failure-'+report.cases.length).catch(()=>undefined);}
    write('browser-report.json',report);console.log(JSON.stringify(report.cases.at(-1)));}
try {
    const before=artifacts();write('APPLICATION-BINDING.json',{applicationCommit:report.applicationCommit,artifactCount:Object.keys(before).length,before});
    const policy='/home/arietids/.config/cua-driver/policies/pi-gui-only.rego';const policyBefore=sha(fs.readFileSync(policy));
    const desktopBefore=desktopWindows();write('daily-desktop-before.json',desktopBefore);
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
    owned=await openOwnedNeo(extension,evidence);
    owned.cdp.onEvent=event=>{
        if(event.method==='Target.targetCreated'&&event.params.targetInfo.url===`chrome-extension://${extensionId}/offscreen.html`)void attachNetwork(event.params.targetInfo,'offscreen').catch(error=>report.network.push({setupError:error.message}));
        if(event.method!=='Fetch.requestPaused')return;
        const kind=sessionKinds.get(event.sessionId);if(!kind)return;
        const request=event.params.request,url=new URL(request.url),row={at:Date.now(),kind,url:url.origin+url.pathname,method:request.method,resourceType:event.params.resourceType,networkId:event.params.networkId};report.network.push(row);
        if(url.origin===imageOrigin){row.responseHeaders=['content-type:image/png','cache-control:no-store'];row.hasACAO=false;void owned.cdp.send('Fetch.fulfillRequest',{requestId:event.params.requestId,responseCode:200,responseHeaders:[{name:'content-type',value:'image/png'},{name:'cache-control',value:'no-store'}],body:png.toString('base64')},event.sessionId).then(()=>{row.fulfilled=true;},error=>{row.error=error.message;});}
        else if(url.origin===origin)void owned.cdp.send('Fetch.continueRequest',{requestId:event.params.requestId},event.sessionId);
        else{row.blockedExternal=true;void owned.cdp.send('Fetch.failRequest',{requestId:event.params.requestId,errorReason:'BlockedByClient'},event.sessionId).catch(()=>undefined);}
    };
    await owned.cdp.send('Target.setDiscoverTargets',{discover:true});
    const worker=await until(async()=> (await targets()).find(t=>t.type==='service_worker'&&t.url===`chrome-extension://${extensionId}/background.js`),30000,'fixed production service worker');
    workerSession=await attachNetwork(worker,'service-worker');await owned.cdp.evaluate(workerSession,workerObserver);
    const initial=await targets();write('initial-targets.json',initial.map(({targetId,type,url})=>({targetId,type,url})));assert.equal((await offscreens()).length,0,'offscreen must be absent before first production area gesture');
    ({targetId:pageTarget}=await owned.cdp.send('Target.createTarget',{url:'about:blank',background:false,newWindow:true,width:1280,height:900}));
    pageSession=await attachNetwork({targetId:pageTarget},'fixture-page');await owned.cdp.send('Runtime.enable',{},pageSession);await owned.cdp.send('Page.enable',{},pageSession);
    await owned.cdp.send('Page.navigate',{url:origin},pageSession);
    const context=await until(()=>owned.cdp.events.filter(e=>e.sessionId===pageSession&&e.method==='Runtime.executionContextCreated').map(e=>e.params.context).find(c=>!c.auxData?.isDefault&&(c.origin===`chrome-extension://${extensionId}`||[extensionId,JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'))).name].includes(c.name))),30000,'production content execution context');contextId=context.id;
    write('native-content-context.json',{pageTarget,context,observer:await extEval(contentObserver)});
    write('language-status-before.json',await until(async()=>{try{return await extEval(`chrome.runtime.sendMessage({type:'fluentReadImageOcrStatus'})`);}catch{return undefined;}},10000,'production public OCR status from actual content sender'));
    await until(async()=>await pageEval(`document.querySelector('#source-a')?.complete&&document.querySelector('#source-b')?.naturalWidth===400`),10000,'two synthetic no-CORS images');
    await owned.cdp.send('Target.activateTarget',{targetId:pageTarget});
    if(!onlyReconnect)await caseRun('cold production area UI with trusted Shift+Z and drag',async()=>{
        const cold=await offscreens();assert.equal(cold.length,0);
        await clickPoint(40,40);await key('Z','KeyZ',90,8);
        await until(async()=>nodes(await tree()).some(n=>attrs(n).class?.includes('fr-area-selecting')),10000,'production selection UI');
        await mouse('mousePressed',60,55,{button:'left',buttons:1,clickCount:1});await mouse('mouseMoved',610,145,{button:'left',buttons:1});await mouse('mouseReleased',610,145,{button:'left',buttons:0,clickCount:1});
        const error=await until(async()=>{const state=await extEval('__neoUiObserver.snapshot()');return state.events.find(e=>e.direction==='in'&&e.packet.kind==='result'&&e.packet.response?.success===false&&/语言包/.test(e.packet.response.error||''));},15000,'production missing-language preparation error');
        const state=await extEval('__neoUiObserver.snapshot()');write('area-native-client.json',state);write('area-ui-text.json',{text:await nodeText()});
        const actualCapture=state.events.find(e=>e.direction==='in'&&e.packet.response?.success===true&&e.packet.response?.imageDataUrlLength>1000);assert.ok(actualCapture,'real area capture response required');
        const [captured]=await extEval('__neoUiObserver.captures()');const bytes=Buffer.from(captured.image.split(',')[1],'base64');fs.writeFileSync(path.join(evidence,'production-area-captured.png'),bytes);
        const after=await offscreens();write('area-offscreen-cold-check.json',{before:cold,after,worker:await owned.cdp.evaluate(workerSession,'__neoUiWorkerObserver.snapshot()')});
        await capture('area-preparation-error');await key('Escape','Escape',27);
        return {status:after.length?'passed':'partial-blocked',trustedUiTriggered:true,realProductionAreaCapture:true,preparationError:error.packet.response.error,
            offscreenPresentBefore:false,offscreenCreatedByArea:after.length>0,offscreenFirstCreationBlockedReason:after.length?undefined:'production OCR language preflight fails before any offscreen call; no pack download or bypass performed',captureBytes:bytes.length,captureSha256:sha(bytes)};
    });
    // Only temporary feature/OCR preferences are set through the real options UI. No downloads, credentials or security preferences.
    const {targetId:optionsTarget}=await owned.cdp.send('Target.createTarget',{url:`chrome-extension://${extensionId}/options.html#settings-image-translation`,background:false});
    const fixtureSession=pageSession;pageSession=await attachNetwork({targetId:optionsTarget},'owned-options');await owned.cdp.send('Page.enable',{},pageSession);
    await until(async()=>await pageEval(`Boolean(document.querySelector('[data-testid="image-recognition-settings"] [role="combobox"]'))`),15000,'real OCR engine setting');
    const selectRect=await pageEval(`(()=>{const e=document.querySelector('[data-testid="image-recognition-settings"] [role="combobox"]');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);await clickPoint(selectRect.x,selectRect.y);
    const optionRect=await until(async()=>await pageEval(`(()=>{const e=[...document.querySelectorAll('.el-select-dropdown__item')].find(e=>e.textContent.includes('Tesseract')&&e.getBoundingClientRect().height);if(!e)return;const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`),5000,'Tesseract option');await clickPoint(optionRect.x,optionRect.y);
    const switchRect=await pageEval(`(()=>{const e=document.querySelector('[data-testid="image-recognition-settings"] button[role="switch"]');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,checked:e.getAttribute('aria-checked')};})()`);if(switchRect.checked!=='true')await clickPoint(switchRect.x,switchRect.y);
    await delay(1200);write('owned-feature-settings-ui.json',await pageEval(`({imageEnabled:document.querySelector('[data-testid="image-recognition-settings"] button[role="switch"]').getAttribute('aria-checked'),engineText:document.querySelector('[data-testid="image-recognition-settings"]').innerText,credentialsRead:false,downloadsClicked:false})`));
    await owned.cdp.send('Target.closeTarget',{targetId:optionsTarget});pageSession=fixtureSession;await owned.cdp.send('Target.activateTarget',{targetId:pageTarget});
    for(const target of await targets())if(target.url===`chrome-extension://${extensionId}/offscreen.html`)await attachNetwork(target,'offscreen');
    async function imageButton(imageId){const rect=await pageEval(`(()=>{const r=document.querySelector('#${imageId}').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,left:r.left,right:r.right,top:r.top,bottom:r.bottom};})()`);await mouse('mouseMoved',rect.x,rect.y);
        const button=await until(async()=>{for(const node of nodes(await tree()))if(attrs(node).class?.split(' ').includes('fluent-read-image-translation-button')){
            try{const {model}=await owned.cdp.send('DOM.getBoxModel',{backendNodeId:node.backendNodeId},pageSession);const x=(model.border[0]+model.border[2])/2,y=(model.border[1]+model.border[5])/2;if(x>=rect.left&&x<=rect.right&&y>=rect.top&&y<=rect.bottom)return node;}catch{}}
        },10000,'actual production image button');await clickNode(button);}
    if(!onlyReconnect)await caseRun('production image button authorizes a tainted no-ACAO cross-origin image',async()=>{
        const before=(await extEval('__neoUiObserver.snapshot()')).events.length;
        write('source-dom-contract.json',await pageEval(`[...document.querySelectorAll('img')].map(i=>({id:i.id,currentSrc:i.currentSrc,crossorigin:i.getAttribute('crossorigin'),naturalWidth:i.naturalWidth,naturalHeight:i.naturalHeight}))`));
        await imageButton('source-a');
        const state=await until(async()=>{const s=await extEval('__neoUiObserver.snapshot()');return s.events.slice(before).some(e=>e.direction==='in'&&e.packet.kind==='result'&&/语言包/.test(e.packet.response?.error||''))&&s;},20000,'real image translate preparation error');
        const events=state.events.slice(before),start=events.find(e=>e.direction==='out'&&e.packet.message?.type==='fluentReadImageFetch');assert.ok(start,'production authorized fetch required');
        const challenge=events.find(e=>e.direction==='in'&&e.packet.kind==='sourceChallenge'&&e.packet.message?.requestId===start.packet.message.requestId);assert.ok(challenge);
        const reply=events.find(e=>e.direction==='out'&&e.packet.kind==='sourceReply'&&e.packet.rpcId===challenge.packet.rpcId);assert.equal(reply?.packet.response?.valid,true);assert.equal(reply.peer,challenge.peer);
        const fetched=events.find(e=>e.direction==='in'&&e.packet.kind==='result'&&e.packet.rpcId===start.packet.rpcId);assert.equal(fetched?.packet.response?.success,true);
        assert.ok(report.network.some(n=>n.kind==='offscreen'&&n.url===imageOrigin+'/source-a.png'&&n.fulfilled));
        write('image-native-client.json',state);write('image-ui-text.json',{text:await nodeText()});await capture('image-preparation-error');
        return {productionImageButton:true,driverSourceReplies:0,sourceAuthorizationReplyValid:true,samePeerChallenge:true,actualOffscreenFetch:true,noACAO:true,noCrossoriginAttribute:true,endpoint:'production missing-pack preparation error; translation not completed'};
    });
    await caseRun('real translateImageInExtension reconnects once after an explicit captured peer disconnect',async()=>{
        const before=(await extEval('__neoUiObserver.snapshot()')).events.length;await owned.cdp.evaluate(workerSession,'__neoUiWorkerObserver.arm()');await imageButton('source-b');
        const state=await until(async()=>{const s=await extEval('__neoUiObserver.snapshot()');return s.events.slice(before).some(e=>e.direction==='disconnect')&&s.events.slice(before).some(e=>e.direction==='in'&&e.packet.kind==='result'&&/语言包/.test(e.packet.response?.error||''))&&s;},20000,'reconnected production translation preparation error');
        const events=state.events.slice(before),starts=events.filter(e=>e.direction==='out'&&e.packet.kind==='request'&&e.packet.message?.type==='fluentReadImageTranslate');assert.equal(starts.length,2,'one retry only');
        assert.notEqual(starts[0].peer,starts[1].peer);assert.notEqual(starts[0].packet.message.requestId,starts[1].packet.message.requestId);
        assert.ok(starts[1].packet.message.timeoutMs<starts[0].packet.message.timeoutMs,'remaining timeout must decrease, never reset');
        const worker=await owned.cdp.evaluate(workerSession,'__neoUiWorkerObserver.snapshot()');assert.equal(worker.faultCount,1);assert.ok(worker.peers.length>=2);
        write('reconnect-native-client.json',state);write('reconnect-worker-peers.json',worker);write('reconnect-ui-text.json',{text:await nodeText()});await capture('reconnect-preparation-error');
        return {explicitFaults:1,translationStarts:2,reconnects:1,oldPeer:starts[0].peer,newPeer:starts[1].peer,
            oldRequestId:starts[0].packet.message.requestId,newRequestId:starts[1].packet.message.requestId,
            firstRemainingTimeoutMs:starts[0].packet.message.timeoutMs,retryRemainingTimeoutMs:starts[1].packet.message.timeoutMs,
            fetchImageAutomaticRetries:0,endpoint:'production missing-pack preparation error; translation not completed'};
    });
    write('trusted-input-events.json',await pageEval('window.__trustedInputs'));
    write('worker-observations-final.json',await owned.cdp.evaluate(workerSession,'__neoUiWorkerObserver.snapshot()'));
    write('ownership-after-cases.json',{ownedProcesses:owned.owned(),ownedListeners:owned.listeners(),dailyDesktopWindows:desktopWindows(),testWindowsOnDailyDesktop:0});
    const after=artifacts();assert.deepEqual(after,before);write('APPLICATION-BINDING.json',{applicationCommit:report.applicationCommit,artifactCount:Object.keys(before).length,before,artifactChangesAfterRun:[]});
    assert.equal(sha(fs.readFileSync(policy)),policyBefore);write('isolation-verification.json',{cuaPolicySha256:policyBefore,unchanged:true,dailyDesktopBefore:desktopBefore,dailyDesktopAfter:desktopWindows(),newDependenciesInstalled:false,credentialsChanged:false,driverOffscreenPrecreation:false,sourceChallengeRepliesByDriver:0});
    report.status=report.cases.some(c=>c.status==='failed')?'failed':report.cases.some(c=>c.status==='partial-blocked')?'partial-blocked':'passed';
}catch(error){report.status='failed';report.error={message:error.message,stack:error.stack};console.error(error.message);process.exitCode=1;}
finally{
    if(owned){try{write('content-observer-final.json',await extEval('__neoUiObserver.snapshot()'));}catch{}try{await owned.close();}catch(error){report.cleanupError=error.message;report.status='failed';process.exitCode=1;}}
    server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));report.fixtureListenerClosed=!server.listening;
    write('browser-report.json',report);console.log(JSON.stringify({status:report.status,cases:report.cases.length,evidence}));if(report.status==='failed')process.exitCode=1;
}

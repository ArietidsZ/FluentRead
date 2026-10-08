/** CW 固定 89fd：真实配置持久化、区域 UI 冷 offscreen 与仅回环 synthetic vision 验收。 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {openOwnedNeo, until, desktopWindows} from './neo-owned-session.mjs';

const evidence=path.resolve(process.argv[2]); fs.mkdirSync(evidence,{recursive:true});
const application='/home/arietids/Documents/Codex/2026-10-06/task/FluentRead-transaction-wxt-validation-20261008';
const extension=path.join(application,'.output/chrome-mv3'), extensionId='djnlaiohfaaifbibleebjggkghlmcpcj';
const commit='89fd05806c4c41778e8a47817988130ef09ca583';
const write=(name,value)=>fs.writeFileSync(path.join(evidence,name),JSON.stringify(value,null,2)+'\n');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function artifacts(){const found={};const visit=dir=>{for(const name of fs.readdirSync(dir).sort()){const file=path.join(dir,name);if(fs.statSync(file).isDirectory())visit(file);else found[path.relative(application,file)]=sha(fs.readFileSync(file));}};for(const name of ['chrome-mv3','firefox-mv2','userscript'])visit(path.join(application,'.output',name));return found;}
function imageRecord(data,name){
    const match=/^data:(image\/[\w+-]+);base64,(.+)$/.exec(data);assert.ok(match,'image data URL');const bytes=Buffer.from(match[2],'base64');let width,height;
    if(bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a'){width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);}
    else if(bytes[0]===0xff&&bytes[1]===0xd8){let p=2;while(p<bytes.length){if(bytes[p++]!==0xff)continue;let tag=bytes[p++];while(tag===0xff)tag=bytes[p++];if(tag===0xd9||tag===0xda)break;const len=bytes.readUInt16BE(p);if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(tag)){height=bytes.readUInt16BE(p+3);width=bytes.readUInt16BE(p+5);break;}p+=len;}}
    assert.ok(width&&height,'decoded image dimensions');const file=name+(match[1]==='image/png'?'.png':'.jpg');fs.writeFileSync(path.join(evidence,file),bytes);return {file,mime:match[1],width,height,bytes:bytes.length,sha256:sha(bytes)};
}
const report={status:'running',applicationCommit:commit,scope:'only production area vision UI, cold offscreen and close/reopen; local synthetic HTTP provider',cases:[],network:[],http:[],providerRequests:[],driverCreateDocumentCalls:0,realProviderApiCalls:0,notTested:['real model quality','OCR packs','RTX5090 WebGPU','daily Wayland/Cua input','image authorization/reconnect rerun','ed89 cancellation GUI']};
let owned,origin,endpoint,pageSession,pageTarget,contextId,workerSession;
let visionNumber=0,textNumber=0;
const server=http.createServer(async(req,res)=>{
    const pathname=new URL(req.url,'http://127.0.0.1').pathname;report.http.push({at:Date.now(),pathname,method:req.method});
    if(req.method==='GET'&&pathname==='/fixture'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(`<!doctype html><html><head><title>CW synthetic area vision fixture</title><style>body{margin:45px;background:#edf1f7;font:22px system-ui}h1{font-size:28px}p{max-width:1000px}</style></head><body><h1>Local synthetic area specimen</h1><p>ALPHA 123 — synthetic text only.</p><p>BETA 456 — second isolated selection.</p><script>window.__trustedInputs=[];for(const type of ['keydown','pointerdown','pointerup'])document.addEventListener(type,e=>window.__trustedInputs.push({type,isTrusted:e.isTrusted,key:e.key,x:e.clientX,y:e.clientY}),true)</script></body></html>`);return;}
    if(req.method!=='POST'||pathname!=='/v1/chat/completions'){res.writeHead(404);res.end('Only the local synthetic fixture is served');return;}
    try {
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>5_000_000)throw new Error('fixture request too large');chunks.push(chunk);}
        const raw=Buffer.concat(chunks),body=JSON.parse(raw);const imageParts=body.messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(p=>p.type==='image_url');
        const kind=imageParts.length?'vision':'translation',ordinal=kind==='vision'?++visionNumber:++textNumber;
        const row={at:Date.now(),kind,ordinal,method:req.method,url:endpoint,bodyBytes:raw.length,bodySha256:sha(raw),model:body.model,stream:body.stream,
            authorizationIsFixtureOnly:req.headers.authorization==='Bearer cw-synthetic-not-a-real-key',credentialsRecorded:false,
            payload:JSON.parse(JSON.stringify(body)),images:[]};
        for(const part of row.payload.messages.flatMap(m=>Array.isArray(m.content)?m.content:[]))if(part.type==='image_url'){
            const record=imageRecord(part.image_url.url,`provider-crop-${ordinal}`);row.images.push(record);part.image_url.url=`<synthetic-crop:${record.sha256}>`;
        }
        report.providerRequests.push(row);write('provider-requests.json',report.providerRequests);
        assert.equal(row.authorizationIsFixtureOnly,true);assert.equal(body.model,'gpt-4.1-mini');assert.equal(body.stream,false);
        const content=kind==='vision'?`SYNTHETIC SOURCE ${ordinal}: ALPHA 123`:`合成译文 ${ordinal}：阿尔法 123`;
        const response={id:`cw-local-${kind}-${ordinal}`,object:'chat.completion',created:Math.floor(Date.now()/1000),model:'gpt-4.1-mini',choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:9,total_tokens:21}};
        row.syntheticResponse=response;row.respondedAt=Date.now();write('provider-requests.json',report.providerRequests);
        res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(response));
    }catch(error){report.fixtureError=error.message;res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'synthetic fixture validation failed'}}));}
});
const sessions=new Map(),attaching=new Map();
async function targets(){return(await owned.cdp.send('Target.getTargets')).targetInfos;}
async function offscreens(){return(await targets()).filter(t=>t.url===`chrome-extension://${extensionId}/offscreen.html`).map(({targetId,type,url})=>({targetId,type,url}));}
async function attach(target,kind){if(attaching.has(target.targetId))return attaching.get(target.targetId);const p=(async()=>{const {sessionId}=await owned.cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});sessions.set(sessionId,kind);await owned.cdp.send('Runtime.enable',{},sessionId);await owned.cdp.send('Network.enable',{},sessionId);await owned.cdp.send('Fetch.enable',{patterns:[{urlPattern:'http://*',requestStage:'Request'},{urlPattern:'https://*',requestStage:'Request'}]},sessionId);return sessionId;})();attaching.set(target.targetId,p);return p;}
const pageEval=e=>owned.cdp.evaluate(pageSession,e),extEval=e=>owned.cdp.evaluate(pageSession,e,contextId);
function nodes(root){const found=[];const visit=n=>{found.push(n);for(const key of ['children','shadowRoots'])for(const child of n[key]||[])visit(child);if(n.contentDocument)visit(n.contentDocument);};visit(root);return found;}
const attrs=n=>Object.fromEntries(Array.from({length:(n.attributes?.length||0)/2},(_,i)=>[n.attributes[2*i],n.attributes[2*i+1]]));
async function dom(){await owned.cdp.send('DOM.enable',{},pageSession);return nodes((await owned.cdp.send('DOM.getDocument',{depth:-1,pierce:true},pageSession)).root);}
async function text(){return(await dom()).filter(n=>n.nodeType===3).map(n=>n.nodeValue).join('\n');}
async function mouse(type,x,y,extra={}){return owned.cdp.send('Input.dispatchMouseEvent',{type,x,y,...extra},pageSession);}
async function click(x,y){await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y,{button:'left',buttons:1,clickCount:1});await mouse('mouseReleased',x,y,{button:'left',buttons:0,clickCount:1});}
async function key(key,code,vk,modifiers=0){for(const type of ['keyDown','keyUp'])await owned.cdp.send('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk,modifiers},pageSession);}
async function screenshot(name){const r=await owned.cdp.send('Page.captureScreenshot',{format:'png'},pageSession);fs.writeFileSync(path.join(evidence,name+'.png'),Buffer.from(r.data,'base64'));}
const contentObserver=`(()=>{const events=[],images=[];const summarize=p=>{const c=JSON.parse(JSON.stringify(p));for(const part of [c.message,c.response])if(part&&typeof part.image==='string'){images.push({at:Date.now(),kind:c.kind,rpcId:c.rpcId,type:c.message?.type,image:part.image});part.imageLength=part.image.length;part.imagePrefix=part.image.slice(0,30);delete part.image;}return c;};const original=chrome.runtime.connect;chrome.runtime.connect=function(...args){const port=original.apply(this,args);if(port.name!=='fluentReadImageDocument:v1')return port;const post=port.postMessage.bind(port);port.postMessage=function(packet){events.push({at:Date.now(),direction:'out',packet:summarize(packet)});return post(packet);};port.onMessage.addListener(packet=>events.push({at:Date.now(),direction:'in',packet:summarize(packet)}));port.onDisconnect.addListener(()=>events.push({at:Date.now(),direction:'disconnect'}));return port;};globalThis.__areaObserver={snapshot:()=>({events}),images:()=>images};return {extensionId:chrome.runtime.id,observationOnly:true};})()`;
const workerObserver=`(()=>{const events=[];const create=chrome.offscreen.createDocument;chrome.offscreen.createDocument=function(...args){events.push({at:Date.now(),kind:'production-createDocument',options:args[0]});return create.apply(this,args);};const send=chrome.runtime.sendMessage;chrome.runtime.sendMessage=function(...args){const m=args[0];if(m&&typeof m.type==='string')events.push({at:Date.now(),kind:'production-sendMessage',type:m.type,requestId:m.requestId,selection:m.selection,imageLength:typeof m.image==='string'?m.image.length:undefined});return send.apply(this,args);};globalThis.__areaWorkerObserver={snapshot:()=>({events})};return {observationOnly:true,driverCreateDocumentCalls:0};})()`;
try{
    const before=artifacts(),policy='/home/arietids/.config/cua-driver/policies/pi-gui-only.rego',policyBefore=sha(fs.readFileSync(policy)),desktopBefore=desktopWindows();
    write('APPLICATION-BINDING.json',{applicationCommit:commit,tree:execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:application,encoding:'utf8'}).trim(),artifactCount:Object.keys(before).length,before});write('daily-desktop-before.json',desktopBefore);
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;endpoint=origin+'/v1/chat/completions';
    owned=await openOwnedNeo(extension,evidence);
    owned.cdp.onEvent=event=>{
        if(event.method==='Target.targetCreated'&&event.params.targetInfo.url===`chrome-extension://${extensionId}/offscreen.html`){report.network.push({at:Date.now(),kind:'real-offscreen-target-created',targetId:event.params.targetInfo.targetId});void attach(event.params.targetInfo,'offscreen').catch(error=>{report.network.push({setupError:error.message});});}
        if(event.method!=='Fetch.requestPaused'||!sessions.has(event.sessionId))return;
        const request=event.params.request,url=new URL(request.url),row={at:Date.now(),kind:sessions.get(event.sessionId),url:url.origin+url.pathname,method:request.method};report.network.push(row);
        if(url.origin===origin)void owned.cdp.send('Fetch.continueRequest',{requestId:event.params.requestId},event.sessionId);
        else{row.blockedExternal=true;void owned.cdp.send('Fetch.failRequest',{requestId:event.params.requestId,errorReason:'BlockedByClient'},event.sessionId).catch(()=>undefined);}
    };
    await owned.cdp.send('Target.setDiscoverTargets',{discover:true});
    const worker=await until(async()=>(await targets()).find(t=>t.type==='service_worker'&&t.url===`chrome-extension://${extensionId}/background.js`),30000,'production worker');workerSession=await attach(worker,'service-worker');await owned.cdp.evaluate(workerSession,workerObserver);
    assert.equal((await offscreens()).length,0);
    // 现有 manifest 资源页是真实扩展 origin，无 options 模块和 OCR/model 状态查询。
    const {targetId:configTarget}=await owned.cdp.send('Target.createTarget',{url:`chrome-extension://${extensionId}/manifest.json`,background:true});
    const configSession=await attach({targetId:configTarget},'minimal-extension-config-page');
    await until(async()=>{try{return await owned.cdp.evaluate(configSession,`chrome.runtime.id===${JSON.stringify(extensionId)}`);}catch{return false;}},10000,'real extension resource page binding');
    const configuration=await owned.cdp.evaluate(configSession,`(async()=>{
        const read=()=>chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});
        const before=await read();if(!before.success)throw new Error('config read failed');const old=typeof before.value==='string'?JSON.parse(before.value):before.value;
        const patch={on:true,selectionAreaEnabled:true,selectionAreaHotkey:'Shift+Z',customSelectionAreaHotkey:'',areaRecognitionMode:'prefer-vision',areaTranslationService:'openai',areaTranslationMode:'standard',from:'en',to:'zh-Hans',model:{...old.model,openai:'gpt-4.1-mini'},modelVision:{...old.modelVision,openai:{...old.modelVision?.openai,'gpt-4.1-mini':true}},proxy:{...old.proxy,openai:${JSON.stringify(endpoint)}},token:{openai:'cw-synthetic-not-a-real-key'},translationMaxRetries:0};
        const saved=await chrome.runtime.sendMessage({type:'persistConfig',mode:'replace',clientId:'cw-area-vision-cold-fixture',sequence:1,baseRevision:old.__fluentConfigRevision,config:{...old,...patch}});if(!saved.success)throw new Error(saved.error||'persistConfig failed');
        const response=await read();if(!response.success)throw new Error('readback failed');const next=typeof response.value==='string'?JSON.parse(response.value):response.value;
        const fields=['on','selectionAreaEnabled','selectionAreaHotkey','customSelectionAreaHotkey','areaRecognitionMode','areaTranslationService','areaTranslationMode','from','to','translationMaxRetries'];
        return {pageUrl:location.href,extensionId:chrome.runtime.id,apiSequence:['configStorageRead local:config','persistConfig replace','configStorageRead local:config'],before:{revision:old.__fluentConfigRevision,areaRecognitionMode:old.areaRecognitionMode,areaTranslationService:old.areaTranslationService,service:old.service,areaModel:old.model?.[old.areaTranslationService||old.service]},saved,readback:{...Object.fromEntries(fields.map(k=>[k,next[k]])),model:{openai:next.model?.openai},modelVision:{openai:next.modelVision?.openai},proxy:{openai:next.proxy?.openai},revision:next.__fluentConfigRevision},fixtureTokenProvidedInPersist:true,credentialRecordsRead:false,tokenPublished:false,enabledFieldPresent:Object.prototype.hasOwnProperty.call(next,'enabled')};
    })()`);
    write('production-config-persistence.json',configuration);
    for(const [k,v]of Object.entries({on:true,selectionAreaEnabled:true,areaRecognitionMode:'prefer-vision',areaTranslationService:'openai',areaTranslationMode:'standard',from:'en',to:'zh-Hans',translationMaxRetries:0}))assert.equal(configuration.readback[k],v);
    assert.equal(configuration.readback.model.openai,'gpt-4.1-mini');assert.equal(configuration.readback.modelVision.openai['gpt-4.1-mini'],true);assert.equal(configuration.readback.proxy.openai,endpoint);assert.equal(configuration.saved.revision,configuration.readback.revision);assert.equal(configuration.fixtureTokenProvidedInPersist,true);
    await owned.cdp.send('Target.closeTarget',{targetId:configTarget});
    ({targetId:pageTarget}=await owned.cdp.send('Target.createTarget',{url:'about:blank',background:false,newWindow:true,width:1280,height:900}));pageSession=await attach({targetId:pageTarget},'fixture-page');await owned.cdp.send('Page.enable',{},pageSession);await owned.cdp.send('Page.navigate',{url:origin+'/fixture'},pageSession);
    const context=await until(()=>owned.cdp.events.filter(e=>e.sessionId===pageSession&&e.method==='Runtime.executionContextCreated').map(e=>e.params.context).find(c=>!c.auxData?.isDefault&&(c.origin===`chrome-extension://${extensionId}`||[extensionId,JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'))).name].includes(c.name))),30000,'real production content context');contextId=context.id;write('native-content-context.json',{pageTarget,context,observer:await extEval(contentObserver)});
    await until(async()=>await pageEval(`document.querySelector('h1')?.textContent==='Local synthetic area specimen'`),10000,'fixture document');await owned.cdp.send('Target.activateTarget',{targetId:pageTarget});
    const cold=await offscreens(),workerCold=await owned.cdp.evaluate(workerSession,'__areaWorkerObserver.snapshot()');write('offscreen-before-trusted-gesture.json',{at:Date.now(),offscreenTargets:cold,worker:workerCold,configPageClosed:true,statusQueries:0,driverCreateDocumentCalls:0});assert.equal(cold.length,0);assert.equal(workerCold.events.filter(e=>e.kind==='production-createDocument').length,0);
    for(let round=1;round<=2;round++){
        const started=Date.now(),firstEvent=(await extEval('__areaObserver.snapshot()')).events.length;
        await click(40,40);await key('Z','KeyZ',90,8);await until(async()=>(await dom()).some(n=>attrs(n).class?.includes('fr-area-selecting')),10000,'trusted selection UI');
        if(round===2){const reopened=await text();write('area-reopened-empty.json',{at:Date.now(),text:reopened,priorResultPresent:reopened.includes('SYNTHETIC SOURCE 1')||reopened.includes('合成译文 1')});assert.ok(!reopened.includes('SYNTHETIC SOURCE 1')&&!reopened.includes('合成译文 1'));await screenshot('area-reopened-empty');}
        const geometry=round===1?{left:60,top:55,right:610,bottom:145}:{left:70,top:150,right:620,bottom:240};
        await mouse('mousePressed',geometry.left,geometry.top,{button:'left',buttons:1,clickCount:1});await mouse('mouseMoved',geometry.right,geometry.bottom,{button:'left',buttons:1});await mouse('mouseReleased',geometry.right,geometry.bottom,{button:'left',buttons:0,clickCount:1});
        const state=await until(async()=>{const s=await extEval('__areaObserver.snapshot()');const result=s.events.slice(firstEvent).find(e=>e.direction==='in'&&e.packet.kind==='result'&&e.packet.response?.translatedText);const error=s.events.slice(firstEvent).find(e=>e.direction==='in'&&e.packet.kind==='result'&&e.packet.response?.success===false);if(error)throw new Error(error.packet.response.error);return result&&{...s,result};},20000,'production area synthetic vision result');
        assert.equal(state.result.packet.response.success,true);assert.equal(state.result.packet.response.recognitionMethod,'vision');assert.equal(state.result.packet.response.sourceText,`SYNTHETIC SOURCE ${round}: ALPHA 123`);assert.equal(state.result.packet.response.translatedText,`合成译文 ${round}：阿尔法 123`);
        const ui=await until(async()=>{const t=await text();return t.includes(`合成译文 ${round}`)&&t;},5000,'area result visible');write(`area-${round}-native-client.json`,state);write(`area-${round}-ui-text.json`,{text:ui});await screenshot(`area-${round}-result`);
        const images=await extEval('__areaObserver.images()');const events=state.events.slice(firstEvent),captureResponse=events.find(e=>e.direction==='in'&&e.packet.kind==='result'&&e.packet.response?.success&&e.packet.response?.imageLength&&!e.packet.response.translatedText);
        assert.ok(captureResponse);const rawCapture=images.find(i=>i.kind==='result'&&i.rpcId===captureResponse.packet.rpcId);const rawResult=images.find(i=>i.kind==='result'&&i.rpcId===state.result.packet.rpcId);const full=imageRecord(rawCapture.image,`area-${round}-production-capture`),cropped=imageRecord(rawResult.image,`area-${round}-production-crop`);
        const provider=report.providerRequests.find(r=>r.kind==='vision'&&r.ordinal===round);assert.ok(provider);assert.equal(provider.images[0].sha256,cropped.sha256);assert.equal(cropped.width,550);assert.equal(cropped.height,90);assert.ok(full.width>cropped.width&&full.height>cropped.height);
        const workerState=await owned.cdp.evaluate(workerSession,'__areaWorkerObserver.snapshot()');write(`area-${round}-offscreen-and-images.json`,{geometry,full,cropped,offscreenTargets:await offscreens(),worker:workerState});
        assert.equal(workerState.events.filter(e=>e.kind==='production-createDocument').length,1);assert.ok(workerState.events.some(e=>e.type==='FLUENT_READ_AREA_CROP_OFFSCREEN'));assert.ok(!workerState.events.some(e=>e.type==='FLUENT_READ_AREA_TRANSLATE_OFFSCREEN'));
        if(round===2){assert.ok(!ui.includes('SYNTHETIC SOURCE 1')&&!ui.includes('合成译文 1'));}
        report.cases.push({name:round===1?'cold area vision: trusted UI -> capture -> first production offscreen -> crop -> synthetic vision -> result':'close/reopen -> no stale result -> second production area vision result',status:'passed',durationMs:Date.now()-started,recognitionMethod:'vision',full,cropped,syntheticEndpoint:endpoint,providerVisionOrdinal:round});write('browser-report.json',report);
        const close=(await dom()).find(n=>n.nodeName==='BUTTON'&&attrs(n)['aria-label']==='关闭圈选翻译结果');assert.ok(close);const {model}=await owned.cdp.send('DOM.getBoxModel',{backendNodeId:close.backendNodeId},pageSession);const b=model.border;await click((b[0]+b[2]+b[4]+b[6])/4,(b[1]+b[3]+b[5]+b[7])/4);
        await until(async()=>!(await dom()).some(n=>attrs(n).class==='fr-area-translation'),5000,'closed result removed');write(`area-${round}-closed.json`,{at:Date.now(),text:await text(),resultNodeRemoved:true});await screenshot(`area-${round}-closed`);
    }
    assert.equal(report.fixtureError,undefined);assert.equal(visionNumber,2);assert.equal(textNumber,2);assert.equal(report.providerRequests.length,4);
    write('trusted-input-events.json',await pageEval('window.__trustedInputs'));write('worker-observations-final.json',await owned.cdp.evaluate(workerSession,'__areaWorkerObserver.snapshot()'));
    assert.deepEqual(artifacts(),before);assert.equal(sha(fs.readFileSync(policy)),policyBefore);const desktopAfter=desktopWindows();assert.deepEqual(desktopAfter,desktopBefore);
    write('APPLICATION-BINDING.json',{applicationCommit:commit,tree:execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:application,encoding:'utf8'}).trim(),artifactCount:Object.keys(before).length,before,artifactChangesAfterRun:[]});
    const ownedProcesses=owned.owned(),ownedListeners=owned.listeners();assert.ok(ownedListeners.every(l=>l.loopback));assert.ok(desktopAfter.every(w=>!ownedProcesses.some(p=>p.pid===Number(w.pid))));
    const renderers=ownedProcesses.filter(p=>p.args.some(arg=>/(?:^|\s)--type=renderer(?:\s|$)/.test(arg)));assert.ok(renderers.length>0);assert.ok(renderers.every(p=>p.security.Seccomp==='2'&&p.security.NoNewPrivs==='1'&&/^0+$/.test(p.security.CapEff)));
    write('isolation-verification.json',{cuaPolicySha256:policyBefore,unchanged:true,dailyDesktopBefore:desktopBefore,dailyDesktopAfter:desktopAfter,ownedProcesses,ownedListeners,rendererCount:renderers.length,rendererSandboxPass:true,testWindowsOnDailyDesktop:0,newDependenciesInstalled:false,dailyCredentialsChanged:false,fixtureTokenOnly:true,driverCreateDocumentCalls:0,statusQueries:0});report.status='passed';
}catch(error){report.status='failed';report.error={message:error.message,stack:error.stack};console.error(error.message);process.exitCode=1;if(pageSession)await screenshot('failure').catch(()=>undefined);}
finally{
    if(owned){try{write('content-observer-final.json',await extEval('__areaObserver.snapshot()'));}catch{}try{write('worker-observations-final.json',await owned.cdp.evaluate(workerSession,'__areaWorkerObserver.snapshot()'));}catch{}try{await owned.close();}catch(error){report.cleanupError=error.message;report.status='failed';process.exitCode=1;}}
    server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));report.fixtureListenerClosed=!server.listening;write('provider-requests.json',report.providerRequests);write('browser-report.json',report);console.log(JSON.stringify({status:report.status,cases:report.cases.length,evidence}));
}

/** 固定 PR #883 合并提交的真实工具栏 Popup 验证；仅操作隔离 Neo 的无凭据合成配置。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {openOwnedNeo, until, delay, desktopWindows} from './neo-owned-session.mjs';

const application='/home/arietids/Documents/Codex/2026-10-06/task/FluentRead-pr883-popup-sync-20261008';
const extension=path.join(application,'.output/chrome-mv3');
const evidence=path.resolve(process.argv[2]);fs.mkdirSync(evidence,{recursive:true});
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const write=(name,value)=>fs.writeFileSync(path.join(evidence,name),JSON.stringify(value,null,2)+'\n');
const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json')));
const extensionId=sha(Buffer.from(manifest.key,'base64')).slice(0,32).replace(/[0-9a-f]/g,h=>String.fromCharCode(97+parseInt(h,16)));
const prefix=`chrome-extension://${extensionId}/`;
const policy='/home/arietids/.config/cua-driver/policies/pi-gui-only.rego';
const baseline={binarySha256:sha(fs.readFileSync('/usr/lib/browserclaw/browserclaw')),policySha256:sha(fs.readFileSync(policy)),desktop:desktopWindows()};
const defaultModel='cw-ui/default-custom-model-with-a-long-name-for-full-title-and-ellipsis-verification';
const config={service:'ollama',uiLanguage:'zh-CN',uiLanguageSetupCompleted:true,
  model:{ollama:'自定义模型'},customModel:{ollama:defaultModel},customModels:{ollama:['cw-ui/search-only-model']},
  selectionTranslationService:'microsoft',hoverTranslationService:'',inputBoxTranslationService:'ollama',inputBoxTranslationModel:'cw-ui/input-override',
  documentService:'ollama',documentModel:{ollama:'自定义模型'},documentCustomModel:{ollama:'cw-ui/document-custom'},
  harness:{service:'',model:'cw-ui/reading-override'},writing:{service:'ollama',model:'cw-ui/writing-override'}};
const report={status:'running',sourceCommit:'d6b3a203e03bb3b1ee5c8796ee7153d7b40e561d',extensionId,
  scope:'production toolbar popup model display and local service picker; isolated synthetic preferences through production persistConfig',
  cases:[],network:[],errors:[],toolbarPopupVerified:false,
  notTested:['real provider/search/model API','model execution or download','RTX5090 WebGPU','Firefox runtime','daily GNOME Wayland/Cua input'],
  credentialsRead:false,credentialPayloadFields:[],securitySettingsChanged:false};
let owned,workerSession,setupSession,pageSession,popupTarget;
const sessions=new Map();
const targets=async()=>(await owned.cdp.send('Target.getTargets')).targetInfos;
async function attach(targetId,kind){
  const {sessionId}=await owned.cdp.send('Target.attachToTarget',{targetId,flatten:true});sessions.set(sessionId,kind);
  await owned.cdp.send('Network.enable',{},sessionId);
  await owned.cdp.send('Fetch.enable',{patterns:[{urlPattern:'http://*'},{urlPattern:'https://*'}]},sessionId);
  return sessionId;
}
const evaluate=expression=>owned.cdp.evaluate(pageSession,expression);
async function click(selector){
  const rect=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing selector');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height};})()`);
  assert.ok(rect.width>0&&rect.height>0);
  for(const type of ['mouseMoved','mousePressed','mouseReleased'])await owned.cdp.send('Input.dispatchMouseEvent',{type,x:rect.x,y:rect.y,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})},pageSession);
  await delay(150);
}
async function screenshot(name){
  const {data}=await owned.cdp.send('Page.captureScreenshot',{format:'png'},pageSession);const bytes=Buffer.from(data,'base64');fs.writeFileSync(path.join(evidence,name),bytes);return {file:name,bytes:bytes.length,sha256:sha(bytes)};
}
async function rows(){return evaluate(`Array.from(document.querySelectorAll('[data-feature-service]')).map(e=>{const s=e.querySelector('small');return{id:e.dataset.featureService,ariaLabel:e.getAttribute('aria-label'),service:e.querySelector('.assignment-value')?.innerText,model:s?.innerText||'',title:s?.title||'',smallWidth:s?.clientWidth||0,smallScrollWidth:s?.scrollWidth||0,warning:Boolean(e.querySelector('.assignment-warning'))}})`);}
async function caseRun(name,test){try{const result=await test();report.cases.push({name,status:'passed',...result});write('report.json',report);}catch(error){report.cases.push({name,status:'failed',error:error.stack});throw error;}}

try{
  write('baseline.json',baseline);write('synthetic-public-config.json',config);
  owned=await openOwnedNeo(extension,evidence);
  owned.cdp.onEvent=event=>{
    if(event.method==='Fetch.requestPaused'){
      const {requestId,request}=event.params;
      report.network.push({kind:sessions.get(event.sessionId),url:new URL(request.url).origin+new URL(request.url).pathname,blocked:true});
      void owned.cdp.send('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'},event.sessionId).catch(error=>report.errors.push(error.message));
    }
  };
  const worker=await until(async()=>(await targets()).find(t=>t.type==='service_worker'&&t.url===prefix+'background.js'),30000,'production service worker');
  workerSession=await attach(worker.targetId,'production-worker');
  assert.deepEqual(await owned.cdp.evaluate(workerSession,'({name:chrome.runtime.getManifest().name,version:chrome.runtime.getManifest().version})'),{name:manifest.name,version:manifest.version});
  const {targetId:setupTarget}=await owned.cdp.send('Target.createTarget',{url:prefix+'options.html',background:false});
  setupSession=await attach(setupTarget,'synthetic-config-setup');
  await until(async()=>{try{return await owned.cdp.evaluate(setupSession,'Boolean(chrome?.runtime?.id)');}catch{return false;}},10000,'extension setup context');
  const saved=await owned.cdp.evaluate(setupSession,`chrome.runtime.sendMessage({type:'persistConfig',clientId:'cw-pr883-popup-fixture',sequence:1,mode:'replace',config:${JSON.stringify(config)}})`);
  assert.equal(saved.success,true);write('production-config-save-response.json',saved);
  // This setup tab is never counted as toolbar-popup acceptance.
  const action=await owned.cdp.send('Runtime.evaluate',{expression:'(async()=>{const w=await chrome.windows.getCurrent();await chrome.action.openPopup({windowId:w.id});return {opened:true,windowId:w.id};})()',returnByValue:true,awaitPromise:true,userGesture:true},setupSession);
  write('toolbar-open-response.json',action);
  if(action.exceptionDetails)throw new Error(action.exceptionDetails.exception?.description||action.exceptionDetails.text);
  const popup=await until(async()=>(await targets()).find(t=>t.url===prefix+'popup.html'),10000,'toolbar popup target');popupTarget=popup.targetId;
  pageSession=await attach(popupTarget,'actual-toolbar-popup');await owned.cdp.send('Page.enable',{},pageSession);
  const viewIdentity=await owned.cdp.evaluate(setupSession,`chrome.extension.getViews({type:'popup'}).map(w=>({url:w.location.href,width:w.innerWidth,height:w.innerHeight}))`);
  assert.ok(viewIdentity.some(v=>v.url===prefix+'popup.html'),'extension.getViews must identify an actual popup, not a tab');
  report.toolbarPopupVerified=true;write('toolbar-view-identity.json',{target:{targetId:popup.targetId,type:popup.type,url:popup.url},viewIdentity,ordinaryPopupTabOpened:false});
  await until(async()=>await evaluate(`document.querySelector('[data-config-ready="true"] [data-testid="popup-feature-services"]')!==null`),15000,'hydrated production popup');
  await caseRun('actual toolbar opens the production services drawer',async()=>{await click('[data-testid="popup-feature-services"]');await until(async()=>await evaluate(`document.querySelectorAll('[data-feature-service]').length===10`),5000,'model overview');return {screenshot:await screenshot('toolbar-model-overview.png'),geometry:await evaluate('({width:innerWidth,height:innerHeight,activeElement:document.activeElement?.tagName})')};});
  await caseRun('default inherited custom and feature overrides resolve with full titles and labels',async()=>{
    const values=await rows();write('model-overview-rows.json',values);const byId=Object.fromEntries(values.map(v=>[v.id,v]));
    for(const id of ['default','hover','video','image','area']){assert.equal(byId[id].title,defaultModel);assert.equal(byId[id].model,'当前模型：'+defaultModel);assert.ok(byId[id].ariaLabel.includes(defaultModel));assert.equal(byId[id].warning,false);}
    for(const [id,model] of [['input','cw-ui/input-override'],['document','cw-ui/document-custom'],['reading','cw-ui/reading-override'],['writing','cw-ui/writing-override']]){assert.equal(byId[id].title,model);assert.equal(byId[id].model,'当前模型：'+model);assert.ok(byId[id].ariaLabel.includes(model));}
    assert.ok(byId.hover.ariaLabel.includes('跟随默认'));assert.equal(byId.selection.model,'');assert.equal(byId.selection.title,'');assert.ok(!byId.selection.ariaLabel.includes('当前模型'));
    return {rows:values.length,defaultAndInheritedModel:defaultModel,defaultModelEllipsized:byId.default.smallScrollWidth>byId.default.smallWidth};
  });
  await caseRun('provider search preserves saved default and feature model choices',async()=>{
    await click('[data-feature-service="hover"]');await until(async()=>await evaluate(`Boolean(document.querySelector('input[type="search"]'))`),5000,'local picker');
    assert.equal(await evaluate(`document.activeElement===document.querySelector('input[type="search"]')`),true);
    await owned.cdp.send('Input.insertText',{text:'cw-ui/search-only-model'},pageSession);await delay(180);
    const search=await evaluate(`({query:document.querySelector('input[type="search"]').value,choices:Array.from(document.querySelectorAll('[data-service-choice]')).map(e=>({service:e.dataset.serviceChoice,text:e.innerText,disabled:e.disabled}))})`);write('local-search.json',search);assert.ok(search.choices.some(v=>v.service==='ollama'&&v.text.includes('cw-ui/search-only-model')));
    await screenshot('toolbar-model-search.png');await click('.service-picker-back');await until(async()=>await evaluate(`document.querySelectorAll('[data-feature-service]').length===10`),5000,'overview after search');
    const current=await rows();assert.equal(current.find(v=>v.id==='default').title,defaultModel);assert.equal(current.find(v=>v.id==='input').title,'cw-ui/input-override');assert.equal(current.find(v=>v.id==='hover').title,defaultModel);
    assert.equal(await evaluate(`document.activeElement===document.querySelector('[data-feature-service="hover"]')`),true);
    return {searchOnly:true,defaultAndFeatureModelsPreserved:true,focusReturnedToOwnedRow:true};
  });
  await caseRun('machine selection removes only its model text and preserves default title',async()=>{
    await click('[data-feature-service="hover"]');await until(async()=>await evaluate(`Boolean(document.querySelector('input[type="search"]'))`),5000,'picker reopened');
    await click('[data-service-choice="microsoft"]');await until(async()=>await evaluate(`Boolean(document.querySelector('[data-feature-service="hover"]'))`),5000,'machine overview');
    const values=await rows();write('machine-overview-rows.json',values);assert.equal(values.find(v=>v.id==='hover').model,'');assert.equal(values.find(v=>v.id==='hover').title,'');assert.equal(values.find(v=>v.id==='default').title,defaultModel);
    return {screenshot:await screenshot('toolbar-machine-row.png'),machineModelHidden:true};
  });
  report.status='passed';
}catch(error){report.status=report.toolbarPopupVerified?'failed':'toolbar-blocked';report.error=error.stack;process.exitCode=1;}
finally{
  if(owned){try{await owned.close();}catch(error){report.cleanupError=error.stack;process.exitCode=1;}}
  const after={binarySha256:sha(fs.readFileSync('/usr/lib/browserclaw/browserclaw')),policySha256:sha(fs.readFileSync(policy)),desktop:desktopWindows()};
  report.isolation={binaryUnchanged:after.binarySha256===baseline.binarySha256,policyUnchanged:after.policySha256===baseline.policySha256,dailyWindowsBefore:baseline.desktop,dailyWindowsAfter:after.desktop,newDailyTestWindows:false,newDependenciesInstalled:false,dailyCredentialsTouched:false};
  if(!report.isolation.binaryUnchanged||!report.isolation.policyUnchanged)process.exitCode=1;
  write('report.json',report);console.log(JSON.stringify({status:report.status,toolbarPopupVerified:report.toolbarPopupVerified,cases:report.cases.map(({name,status})=>({name,status})),networkRequestsBlocked:report.network.length,error:report.error,cleanupError:report.cleanupError},null,2));
}

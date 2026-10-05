#!/usr/bin/env node
// 统一卡片与稳定位置专项：使用生产扩展、独立 profile 与焦点安全 helper。AI/译文由本地确定性夹具返回。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const support = require('./run-selection-trigger-test.cjs');
const arg = (key) => process.argv[process.argv.indexOf(`--${key}`) + 1];
const output = path.resolve(arg('artifacts-dir'));
const extensionDir = path.resolve(arg('extension-dir'));
const {chromium} = createRequire(path.join(arg('playwright-root'), 'package.json'))('playwright');
const helper = require(path.resolve(arg('focus-safe-helper')));
const sentence = 'The curious reader explores new ideas.';
const grammar = '### 主干\nThe reader explores ideas. 读者探索想法。\n\n### 词性与句法\n| Text | POS | Role | Meaning |\n| --- | --- | --- | --- |\n| The | article | 限定 reader | 这位 |\n| curious | adjective | 修饰 reader | 好奇的 |\n| reader | noun | 主语 | 读者 |\n| explores | verb | 谓语 | 探索 |\n| new | adjective | 修饰 ideas | 新的 |\n| ideas | noun | 宾语 | 想法 |\n\n### 关键点\n形容词描述名词，词性和句中作用分开理解。';
const report = {providerEvidence:'Production extension in isolated Edge; translation and AI responses use deterministic local fixtures. Dictionary uses the real dictionary pipeline. No authenticated AI quality claim.',ok:false,cases:[],screenshots:[],consoleErrors:[],translationRequests:0,aiRequests:0,persistenceCases:[],quickClose:{},crossPageSync:{},latestWriteWins:{}};
const record = name => {report.cases.push(name); console.log('PASS',name);};
const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
let session, context, worker, server, optionsPage, popup, page;
async function screenshot(target,name) {const file=path.join(output,name+'.png'); await target.screenshot({path:file,fullPage:false}); report.screenshots.push(file);}
async function node(predicate) {const {root}=await support.getSelectionUiTree(page); return support.findCdpNode(root,predicate);}
const cls = name => n => support.hasCdpClass(n,name);
async function until(predicate,message) {for(let i=0;i<80;i++){if(await predicate()) return; await wait(100);} throw new Error(message);}
async function clickNode(predicate) {const {session:cdp,root}=await support.getSelectionUiTree(page); const n=support.findCdpNode(root,predicate); assert(n,'Missing UI node'); await cdp.send('DOM.scrollIntoViewIfNeeded',{nodeId:n.nodeId}); const {model}=await cdp.send('DOM.getBoxModel',{nodeId:n.nodeId}); const q=model.content; await page.mouse.click((q[0]+q[2]+q[4]+q[6])/4,(q[1]+q[3]+q[5]+q[7])/4);}
const button = text => n=> n.nodeName==='BUTTON' && support.cdpText(n).trim()===text;
async function choose(selector) {
 await helper.activateExtensionTabWithoutForeground(context,page);
 const points=await page.evaluate(selector=>{
  const target=document.querySelector(selector),text=target.firstChild,range=document.createRange();
  range.setStart(text,0);range.setEnd(text,1);const first=range.getBoundingClientRect();
  range.setStart(text,text.length-1);range.setEnd(text,text.length);const last=range.getBoundingClientRect();
  return {start:{x:first.left,y:first.top+first.height/2},end:{x:last.right+2,y:last.top+last.height/2}};
 },selector);
 await page.mouse.move(points.start.x,points.start.y);await page.mouse.down();await page.mouse.move(points.end.x,points.end.y,{steps:12});await page.mouse.up();
}
async function select(selector) {await helper.activateExtensionTabWithoutForeground(context,page); await page.mouse.click(20,20); await choose(selector); await until(()=>node(cls('fr-selection-indicator')),'selection indicator missing');
 const state=await support.getSelectionUiTree(page);const indicator=support.findCdpNode(state.root,cls('fr-selection-indicator'));const {model}=await state.session.send('DOM.getBoxModel',{nodeId:indicator.nodeId});
 const anchor=await page.evaluate(()=>{const r=getSelection().getRangeAt(0).getBoundingClientRect();return {right:r.right,bottom:r.bottom};});
 assert(Math.abs(model.border[0]+model.width/2-anchor.right)<24 && Math.abs(model.border[1]+model.height/2-anchor.bottom)<24,'selection icon is not anchored beside the selected text');
 await clickNode(cls('fr-selection-indicator')); await until(()=>node(cls('fr-translation-tooltip')),'selection popup missing');}
async function patch(value) {await support.patchStoredConfig(popup,value); await wait(350);}
async function inspectCard(fn) {
 const {session:cdp,root}=await support.getSelectionUiTree(page);const card=support.findCdpNode(root,cls('fr-translation-tooltip'));assert(card);
 const {object}=await cdp.send('DOM.resolveNode',{nodeId:card.nodeId});
 const value=await cdp.send('Runtime.callFunctionOn',{objectId:object.objectId,returnByValue:true,awaitPromise:true,functionDeclaration:fn});return value.result.value;
}
const geometry=()=>inspectCard('function(){const b=this.getBoundingClientRect();return {left:b.left,top:b.top,width:b.width,height:b.height,right:b.right,bottom:b.bottom}}');
async function trackCard() {
 await inspectCard(`function(){const card=this;globalThis.__cardSamples=[];globalThis.__cardTracking=true;const sample=()=>{if(!globalThis.__cardTracking)return;const b=card.getBoundingClientRect();globalThis.__cardSamples.push({left:b.left,top:b.top,width:b.width,height:b.height});requestAnimationFrame(sample)};sample()}`);
}
async function assertStable(name,initial,full=false) {
 const samples=await page.evaluate(()=>{globalThis.__cardTracking=false;return globalThis.__cardSamples});assert(samples.length>2);
 const dimensions=full?['left','top','width','height']:['left','top','width'];
 for(const sample of samples)for(const key of dimensions)assert(Math.abs(sample[key]-initial[key])<1,`${name} changed ${key}: ${initial[key]} -> ${sample[key]}`);
 report.geometry=report.geometry||[];report.geometry.push({name,frames:samples.length,initial,final:samples.at(-1)});record(name);
}
function silentWav(seconds=8) {
 const rate=24000,bytes=rate*seconds*2,buf=Buffer.alloc(44+bytes);buf.write('RIFF',0);buf.writeUInt32LE(36+bytes,4);buf.write('WAVEfmt ',8);buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(1,22);buf.writeUInt32LE(rate,24);buf.writeUInt32LE(rate*2,28);buf.writeUInt16LE(2,32);buf.writeUInt16LE(16,34);buf.write('data',36);buf.writeUInt32LE(bytes,40);return buf;
}
async function main(){
 fs.mkdirSync(output,{recursive:true});const profileDir=fs.mkdtempSync(path.join(os.tmpdir(),'fluentread-selection-stable-'));
 server=http.createServer(async(req,res)=>{
  if(req.url==='/translate'){report.translationRequests++;let body='';for await(const chunk of req)body+=chunk;const texts=JSON.parse(body);res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(texts.map(text=>({translations:[{text:text===sentence?'这位好奇的读者探索新的想法。':'好奇的；求知欲强的',to:'zh-Hans'}]}))));return;}
  report.aiRequests++;let body='';for await(const chunk of req)body+=chunk;
  const answer=body.includes('Text | POS | Role | Meaning')?grammar:'### 学习要点\n这位好奇的读者探索新的想法。\n\n### 用法\ncurious reader 描述读者的好奇心。';
  res.writeHead(200,{'content-type':'text/event-stream','access-control-allow-origin':'*'});
  for(const part of answer.match(/[\s\S]{1,40}/g)){res.write('data: '+JSON.stringify({id:'fixture',choices:[{index:0,delta:{content:part},finish_reason:null}]})+'\n\n');await wait(20);}
  res.end('data: '+JSON.stringify({id:'fixture',choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 try {
  session=await helper.launchFocusSafePersistentContext({chromium,profileDir,browserPath:'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',headless:false,background:true,browserArgs:[`--disable-extensions-except=${extensionDir}`,`--load-extension=${extensionDir}`,'--no-first-run','--no-default-browser-check','--mute-audio'],viewport:{width:1440,height:960}});
  context=session.context;Object.assign(report,{launchMode:session.launchMode,focusPolicy:session.focusPolicy,windowPlacement:session.windowPlacement,extensionDir,audio:{muted:true,listeningVerified:false}});
  const ready=await support.waitForWorker(context);worker=ready.worker;const id=ready.extensionId;
  const newPage=async()=>{const p=await helper.newPageWithoutForeground(context);p.on('pageerror',e=>report.consoleErrors.push(e.message));return p};
  popup=await newPage();await popup.goto(`chrome-extension://${id}/popup.html`);await popup.locator('.popup-shell[data-config-ready="true"]').waitFor();
  const saved=await support.readStoredConfig(popup);
  await patch({on:true,uiLanguage:'zh-CN',uiLanguageSetupCompleted:true,service:'microsoft',from:'auto',to:'zh-Hans',selectionTranslatorMode:'bilingual',selectionTranslatorPresentation:'card',selectionTranslatorTrigger:'icon',selectionTranslatorAutoDismiss:false,selectionTranslatorDelay:0,hotkey:'none',floatingBallHotkey:'none',useCache:false,selectionTtsMode:'online-first',harness:{...saved.harness,enabled:true,memoryEnabled:true,service:'custom:fixture',model:'learning-fixture',trigger:'click'},customOpenAIProviders:[{id:'custom:fixture',name:'Local fixture',endpoint:`http://127.0.0.1:${port}/v1/chat/completions`,models:['learning-fixture']}],token:{'custom:fixture':'fixture-token'},model:{...saved.model,'custom:fixture':'learning-fixture'}});
  assert.equal((await support.readStoredConfig(popup)).selectionTranslatorPresentation,'card');
  await worker.evaluate(url=>{const native=fetch.bind(globalThis);globalThis.fetch=(input,init)=>String(input).startsWith('https://edge.microsoft.com/translate/translatetext')?native(url,init):native(input,init)},`http://127.0.0.1:${port}/translate`);
  await context.route('https://dev.microsofttranslator.com/apps/endpoint?api-version=1.0',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({t:'fixture-tts-token',r:'fixture'})}));
  await context.route('https://fixture.tts.speech.microsoft.com/cognitiveservices/v1',route=>{report.audio.requests=(report.audio.requests||0)+1;return route.fulfill({status:200,contentType:'audio/wav',body:silentWav()})});
  optionsPage=await newPage();await optionsPage.goto(`chrome-extension://${id}/options.html#settings-selection`);await optionsPage.locator('#settings-selection').waitFor();
  assert.equal(await optionsPage.getByRole('group',{name:'划词默认呈现'}).count(),0);
  await popup.reload();await popup.locator('.popup-shell[data-config-ready="true"]').waitFor();
  await popup.locator('[data-popup-quick-feature="selection"]').click();assert.equal(await popup.getByRole('group',{name:'划词默认呈现'}).count(),0);record('settings and popup use one card presentation');
  await context.route('https://example.com/**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="en"><head><title>Stable selection card</title><style>body{margin:80px;color:#253248;font:20px/1.8 system-ui}p{max-width:750px}#sentence{margin-top:300px}#word{margin-top:120px}</style></head><body><h1>Stable translation card</h1><p id="sentence">${sentence}</p><p id="word">curious</p><p id="neighbor">Learning grows with every question.</p><div style="height:1500px"></div></body></html>`}));
  page=await newPage();await page.goto('https://example.com/');await page.locator('#fluent-read-selection-translator-container').waitFor({state:'attached'});
  await select('#sentence');await until(async()=>support.cdpText(await node(cls('fr-translation-tooltip'))).includes('这位好奇'),'translation missing');await wait(200);
  assert.equal(report.aiRequests,0);assert(await inspectCard(`function(){return [...this.querySelectorAll('.fr-close-btn,.fr-text-audio-btn')].every(b=>getComputedStyle(b).visibility==='visible')}`));const tabs=await inspectCard(`function(){return [...this.querySelector('.fr-study-toolbar').querySelectorAll('button')].map(b=>({text:b.textContent.trim(),pressed:b.getAttribute('aria-pressed')}))}`);
  assert.deepEqual(tabs.map(t=>t.text),['翻译','读懂','词性与句法','用法','练习','记录']);assert.equal(tabs[0].pressed,'true');assert.equal(await node(cls('fr-mode-btn')),null);record('translation is the first default tab and opening it does not request AI');
  const initial=await geometry();assert.equal((await inspectCard('function(){return this.dataset.placement}')),'top');await screenshot(page,'translation-first');
  await trackCard();await clickNode(button('词性与句法'));await until(()=>node(cls('fr-sentence-tokens')),'grammar missing');await until(()=>node(button('保存到学习记忆')),'answer still streaming');await wait(200);await assertStable('grammar switch and streaming preserve the opening anchor',initial);
  assert.equal(await node(cls('fr-reading-actions')),null);await screenshot(page,'grammar-stable');
  await trackCard();await clickNode(button('用法'));await until(()=>node(button('保存到学习记忆')),'usage incomplete');await wait(200);await assertStable('usage tab preserves the same anchor',initial);
  await clickNode(button('保存到学习记忆'));await until(()=>node(button('查看学习记忆')),'memory save did not succeed');await screenshot(page,'memory-saved');
  // 导航点击仍经过真实 runtime handler；为保护焦点，仅将浏览器原生新页创建替换成预创建的后台页 URL 更新。
  const memoryPage=await newPage();await memoryPage.goto(`chrome-extension://${id}/options.html?reserved-memory=1#settings-general`);await memoryPage.locator('.settings-app').waitFor();
  const memoryTabId=await memoryPage.evaluate(async()=> (await chrome.tabs.getCurrent()).id);assert(Number.isSafeInteger(memoryTabId));
  await worker.evaluate(targetId=>{globalThis.__learningOpen=[];chrome.tabs.create=(properties,callback)=>{globalThis.__learningOpen.push(properties);const promise=chrome.tabs.update(targetId,{url:properties.url,active:false});if(callback)promise.then(callback);return promise}},memoryTabId);
  await helper.activateExtensionTabWithoutForeground(context,page);await clickNode(button('查看学习记忆'));await wait(250);report.memoryClicked=await worker.evaluate(()=>globalThis.__learningOpen);await memoryPage.waitForURL(/learningTab=memory/);await memoryPage.locator('.fr-memory-item').waitFor();
  assert((await memoryPage.locator('.fr-memory-item').innerText()).includes(sentence));assert((await memoryPage.locator('.fr-memory-item').innerText()).includes('学习要点'));assert.equal(await memoryPage.locator('.fr-learning-center .segmented-control button[aria-checked="true"]').innerText(),'学习记忆');
  await screenshot(memoryPage,'learning-memory-destination');report.memoryNavigation={requests:await worker.evaluate(()=>globalThis.__learningOpen),adapter:'precreated background tab, native tabs.update(active:false); runtime validation and options UI are real',nativeTabCreation:false};record('saved key points appear in Learning memory and view opens that tab directly');
  await helper.activateExtensionTabWithoutForeground(context,page);const requests=report.aiRequests;await trackCard();await clickNode(button('翻译'));await wait(250);await assertStable('return to translation preserves the anchor',initial);await clickNode(button('词性与句法'));await wait(350);assert.equal(report.aiRequests,requests);record('completed grammar is reused without a second AI request');await clickNode(button('翻译'));
  for(const label of ['播放原文','播放译文']) {
   const before=await geometry();await trackCard();await clickNode(n=>n.nodeName==='BUTTON'&&support.cdpAttribute(n,'aria-label')===label);await until(()=>node(button('停止')),'speech did not begin');await wait(300);await clickNode(n=>support.cdpAttribute(n,'aria-label')==='停止播放');await wait(250);await assertStable(`${label} start and stop keep position and height`,before,true);
  }
  await page.keyboard.press('Escape');await select('#word');await until(()=>node(cls('fr-word-meaning')),'dictionary missing');await wait(200);const wordBefore=await geometry();await trackCard();await clickNode(cls('fr-text-audio-btn'));await until(()=>node(button('停止')),'word audio missing');await wait(250);await clickNode(n=>support.cdpAttribute(n,'aria-label')==='停止播放');await wait(200);await assertStable('word pronunciation start and stop keep position and height',wordBefore,true);await screenshot(page,'word-stable');
  await page.setViewportSize({width:390,height:800});await wait(350);let bounds=await geometry();assert(bounds.left>=11&&bounds.right<=391&&bounds.bottom<=789);const narrow=await geometry();await trackCard();await clickNode(button('用法'));await until(()=>node(button('保存到学习记忆')),'narrow usage missing');await wait(200);await assertStable('narrow viewport tab switch stays anchored and scrolls inside',narrow);bounds=await geometry();assert(bounds.bottom<=789);await screenshot(page,'narrow-stable');
  await page.keyboard.press('Escape');await wait(150);assert.equal(await node(cls('fr-translation-tooltip')),null);await page.setViewportSize({width:1440,height:960});await select('#sentence');await until(()=>node(cls('fr-translation-result')),'reopened translation missing');assert.equal((await inspectCard(`function(){return this.querySelector('.fr-study-toolbar button').getAttribute('aria-pressed')}`)),'true');record('close and reselect restore the translation tab and fresh geometry');
  assert.equal(report.consoleErrors.length,0);assert(report.audio.requests>=3);report.ok=true;
 }catch(error){report.error=error.stack;report.navigationDiagnostic=await worker?.evaluate(()=>globalThis.__learningOpen).catch(()=>null);if(page&&!page.isClosed())await screenshot(page,'failure-page').catch(()=>{});if(popup&&!popup.isClosed())await screenshot(popup,'failure-popup').catch(()=>{});throw error}
 finally{fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));await session?.close();server.close();fs.rmSync(profileDir,{recursive:true,force:true})}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1});

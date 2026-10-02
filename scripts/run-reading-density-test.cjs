#!/usr/bin/env node
// 学习面板密度专项：在隔离生产扩展中用用户反馈的原句检查首屏、点词、常驻句子结构、键盘、折叠操作和追问。
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
const sentence = 'Different printing sequences have different filament switching sequences';
const grammar = '| Text | POS | Role | Meaning |\n| --- | --- | --- | --- |\n| Different | adjective | 定语，修饰 printing sequences | 不同的 |\n| printing sequences | phrase | 主语 | 打印顺序 |\n| have | verb | 谓语 | 具有、带来 |\n| different | adjective | 定语，修饰后面的名词短语 | 不同的 |\n| filament switching sequences | phrase | 宾语 | 耗材切换顺序 |\n\n### 句子主干\n打印顺序不同，耗材的切换顺序也会不同。\n\n这里的 switching 修饰 sequences，说明是“切换的顺序”。';
let nextAnswer = grammar;
const report = {providerEvidence:'Production extension in isolated Edge; translation and AI responses use deterministic local fixtures. No live translation or AI quality claim.',ok:false,cases:[],screenshots:[],consoleErrors:[],translationRequests:0,aiRequests:0};
const record = name => {report.cases.push(name); console.log('PASS',name);};
const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
let session, context, worker, server, optionsPage, popup, page;
async function screenshot(target,name) {const file=path.join(output,name+'.png'); await target.screenshot({path:file,fullPage:false}); report.screenshots.push(file);}
async function node(predicate) {const {root}=await support.getSelectionUiTree(page); return support.findCdpNode(root,predicate);}
const cls = name => n => support.hasCdpClass(n,name);
async function until(predicate,message) {for(let i=0;i<80;i++){if(await predicate()) return; await wait(100);} throw new Error(message);}
async function clickNode(predicate) {const {session:cdp,root}=await support.getSelectionUiTree(page); const n=support.findCdpNode(root,predicate); assert(n,'Missing UI node'); const {model}=await cdp.send('DOM.getBoxModel',{nodeId:n.nodeId}); const q=model.content; await page.mouse.click((q[0]+q[2]+q[4]+q[6])/4,(q[1]+q[3]+q[5]+q[7])/4);}
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
async function ui(fn, value) {
 const state=await support.getSelectionUiTree(page), card=support.findCdpNode(state.root,cls('fr-translation-tooltip'));assert(card,'popup missing');
 const object=await state.session.send('DOM.resolveNode',{nodeId:card.nodeId});
 const result=await state.session.send('Runtime.callFunctionOn',{objectId:object.object.objectId,functionDeclaration:fn.toString(),arguments:[{value}],returnByValue:true});
 if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;
}
async function settled() {await until(()=>ui(function(){return !!this.querySelector('.fr-reading-answer[aria-busy="false"]')}),'answer did not finish');}
async function menu() {await clickNode(n=>n.nodeName==='SUMMARY'&&support.cdpAttribute(n,'aria-label')==='更多操作');}
async function shot(name) {
 const box=await ui(function(){const r=this.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}});
 const file=path.join(output,name+'.png');await page.screenshot({path:file,clip:box});report.screenshots.push(file);
}
async function layout() {return ui(function(){
 const area=this.querySelector('.fr-reading-result').getBoundingClientRect(),tokens=this.querySelector('.fr-sentence-tokens'),detail=this.querySelector('.fr-sentence-detail').getBoundingClientRect(),card=this.getBoundingClientRect();
 return{cardHeight:card.height,cardWidth:card.width,answerHeight:area.height,tokensHeight:tokens.getBoundingClientRect().height,sourceCopies:this.querySelectorAll('.fr-reading-source').length,sourceText:[...tokens.children].map(element=>element.matches('button') ? (element.querySelector('.fr-sentence-token-text')||element).textContent : element.textContent).join(''),labels:[...tokens.querySelectorAll('.fr-sentence-token-meta')].map(element=>({text:element.textContent.trim(),visible:element.getBoundingClientRect().bottom<=area.bottom&&element.getBoundingClientRect().top>=area.top,clipped:element.scrollWidth>element.clientWidth+1})),detailVisible:detail.top>=area.top&&detail.bottom<=area.bottom,overflow:this.scrollWidth>this.clientWidth+1,hostScroll:scrollY};
});}
async function main(){
 fs.mkdirSync(output,{recursive:true});const profileDir=fs.mkdtempSync(path.join(os.tmpdir(),'fluentread-reading-density-'));
 server=http.createServer(async(req,res)=>{
  if(req.url==='/translate'){report.translationRequests++;let raw='';for await(const part of req)raw+=part;res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(JSON.parse(raw).map(()=>({translations:[{text:'不同的打印顺序会带来不同的耗材切换顺序。',to:'zh-Hans'}]}))));return;}
  report.aiRequests++;for await(const part of req){};
  res.writeHead(200,{'content-type':'text/event-stream','access-control-allow-origin':'*'});
  const response=nextAnswer;
  for(const part of response.match(/[\s\S]{1,40}/g)){res.write('data: '+JSON.stringify({id:'fixture',choices:[{index:0,delta:{content:part},finish_reason:null}]})+'\n\n');await wait(15);}
  res.end('data: '+JSON.stringify({id:'fixture',choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 try{
   session=await helper.launchFocusSafePersistentContext({chromium,profileDir,browserPath:'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',headless:false,background:true,browserArgs:[`--disable-extensions-except=${extensionDir}`,`--load-extension=${extensionDir}`,'--no-first-run','--no-default-browser-check'],viewport:{width:1440,height:960}});
   context=session.context;Object.assign(report,{launchMode:session.launchMode,focusPolicy:session.focusPolicy,windowPlacement:session.windowPlacement,extensionDir});
   const ready=await support.waitForWorker(context);worker=ready.worker;const id=ready.extensionId;
   const newPage=async()=>{const p=await helper.newPageWithoutForeground(context);p.on('pageerror',error=>report.consoleErrors.push(error.message));return p;};
   popup=await newPage();await popup.goto(`chrome-extension://${id}/popup.html`);await popup.locator('.popup-shell[data-config-ready="true"]').waitFor();
   const saved=await support.readStoredConfig(popup);
   await patch({on:true,uiLanguage:'zh-CN',uiLanguageSetupCompleted:true,service:'microsoft',from:'auto',to:'zh-Hans',selectionTranslatorMode:'bilingual',selectionTranslatorPresentation:'card',selectionTranslatorTrigger:'icon',selectionTranslatorDelay:0,hotkey:'none',floatingBallHotkey:'none',useCache:false,harness:{...saved.harness,enabled:true,service:'custom:fixture',model:'learning-fixture',trigger:'click'},customOpenAIProviders:[{id:'custom:fixture',name:'Local fixture',endpoint:`http://127.0.0.1:${port}/v1/chat/completions`,models:['learning-fixture']}],token:{'custom:fixture':'fixture-token'},model:{...saved.model,'custom:fixture':'learning-fixture'}});
   await worker.evaluate(url=>{const native=fetch.bind(globalThis);globalThis.__selectionTestNativeFetch=native;globalThis.fetch=(input,init)=>String(input).startsWith('https://edge.microsoft.com/translate/translatetext')?native(url,init):native(input,init);},`http://127.0.0.1:${port}/translate`);

  await context.route('https://example.com/**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="en"><head><style>body{margin:50px;font:20px/1.8 system-ui;color:#253248}p{max-width:730px}button{font-size:32px!important}section{padding:50px!important}</style></head><body><p><span id="sentence">${sentence}</span>.</p><p>Keep reading without losing your place.</p><div style="height:2400px"></div></body></html>`}));
  page=await newPage();await page.goto('https://example.com/');await page.locator('#fluent-read-selection-translator-container').waitFor({state:'attached'});
  await select('#sentence');await until(()=>node(cls('fr-study-toolbar')),'learning entry missing');await clickNode(button('词性与句法'));await settled();
  report.initial=await layout();
  if(process.argv.includes('--baseline')){await shot('before');report.ok=true;return;}
  if (process.argv.includes('--multilingual-only')) {
    for (const language of ['zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'ru-RU', 'es-ES']) {
      await patch({uiLanguage: language});
      await wait(250);
      for (const width of [1440, 390]) {
        await page.setViewportSize({width, height: width === 390 ? 844 : 960}); await wait(100);
        const clipped = await ui(function() {
          return [...this.querySelectorAll('.fr-reading-actions button, .fr-reading-footer button, .fr-tooltip-title span')].filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.textContent.trim());
        });
        assert.deepEqual(clipped, [], `${language} ${width}px labels must stay complete`);
        assert.equal((await layout()).overflow, false);
        await shot(`reading-${language}-${width}`);
      }
      record(`${language}: complete reading actions at desktop and 390px, source remains unchanged`);
      assert.equal((await layout()).sourceText.trim(), sentence);
    }
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en', 'host language is unchanged');
    report.ok = true; return;
  }
  assert.equal(report.initial.sourceCopies,0);assert.equal(report.initial.sourceText.trim(),sentence);assert(report.initial.answerHeight>=365,'too little room for the answer');assert(report.initial.tokensHeight<115,'annotations still occupy too much space');assert(report.initial.detailVisible);assert.equal(report.initial.overflow,false);
  await shot('grammar-after');record('user sentence stays in source order with no repeated original and selected details visible');
  assert.deepEqual(report.initial.labels.map(item=>item.text),['定语 · 形容词','主语 · 短语','谓语 · 动词','定语 · 形容词','宾语 · 短语']);assert(report.initial.labels.every(item=>item.visible&&!item.clipped));record('all fragment roles and word classes are visible before any click');
  await clickNode(n=>support.cdpAttribute(n,'data-pos')==='phrase');
  assert.equal(await ui(function(){return this.querySelector('.fr-sentence-meaning').textContent}),'打印顺序');
  await page.keyboard.press('ArrowRight');assert.equal(await ui(function(){return this.querySelector('.fr-sentence-detail-heading strong').textContent}),'have');
  await page.keyboard.press('End');assert.equal(await ui(function(){return this.querySelector('.fr-sentence-detail-heading strong').textContent}),'filament switching sequences');
  await page.keyboard.press('Home');assert.equal(await ui(function(){return this.querySelector('.fr-sentence-detail-heading strong').textContent}),'Different');
  assert.equal(await page.evaluate(()=>scrollY),0);record('click, arrows, Home and End reveal meaning and role without scrolling host');
  const reference=n=>n.nodeName==='SUMMARY'&&support.cdpText(n).trim()==='词性说明';
  await clickNode(reference);assert(await ui(function(){return this.querySelector('.fr-sentence-reference').open}));
  await clickNode(n=>support.cdpAttribute(n,'data-pos')==='verb');assert.equal(await ui(function(){return this.querySelector('.fr-sentence-reference').open}),false);record('optional word class notes collapse when switching words');
  await menu();assert(await ui(function(){return this.querySelector('.fr-reading-tools').open}));await shot('more-actions');
  await page.keyboard.press('Escape');assert.equal(await ui(function(){return this.querySelector('.fr-reading-tools').open}),false);record('Escape dismisses secondary actions and preserves the answer');
  await menu();await clickNode(n=>n.nodeName==='INPUT'&&support.cdpAttribute(n,'aria-label')==='继续追问');assert.equal(await ui(function(){return this.querySelector('.fr-reading-tools').open}),false);
  await page.keyboard.type('Why switching?');await menu();const count=report.aiRequests;await clickNode(button('阅读记录'));await until(()=>node(cls('fr-reading-records')),'records missing');await clickNode(button('‹ 返回当前阅读'));
  assert.equal(await ui(function(){return this.querySelector('.fr-reading-followup input').value}),'Why switching?');assert.equal(report.aiRequests,count);record('history round trip preserves answer and unsent follow-up without a new request');
  nextAnswer='Switching describes the type of sequence. Here it modifies sequences.';
  await clickNode(n=>n.nodeName==='INPUT'&&support.cdpAttribute(n,'aria-label')==='继续追问');await page.keyboard.press('Enter');await settled();assert.equal(report.aiRequests,count+1);
  assert.equal(await ui(function(){return this.querySelector('.fr-reading-source').open}),false);await clickNode(n=>n.nodeName==='SUMMARY'&&support.cdpText(n).startsWith('原文'));assert(await ui(function(){return this.querySelector('.fr-reading-source').open}));
  record('follow-up sends once and ordinary answers retain an expandable source');
  nextAnswer=grammar;await menu();await clickNode(button('重新生成'));await settled();assert.equal(report.aiRequests,count+2);assert.equal(await ui(function(){return !!this.querySelector('.fr-reading-source')}),false);record('regenerate is available on demand and restores compact annotations');
  await clickNode(button('返回译文'));await clickNode(button('词性与句法'));await settled();assert.equal(report.aiRequests,count+2);record('returning from translation reuses the current explanation');
  await page.setViewportSize({width:390,height:800});await wait(200);report.narrow=await layout();assert.equal(report.narrow.overflow,false);assert(report.narrow.detailVisible);assert(report.narrow.labels.every(item=>item.visible&&!item.clipped));await shot('grammar-390');
  await patch({theme:'dark'});await shot('grammar-dark');await patch({uiLanguage:'en-US'});await wait(150);
  await clickNode(n=>n.nodeName==='SUMMARY'&&support.cdpAttribute(n,'aria-label')==='More actions');await clickNode(button('Regenerate'));await settled();
  assert(await ui(function(){return [...this.querySelectorAll('.fr-reading-actions button')].every(button=>button.scrollWidth<=button.clientWidth+1)}),'English action labels are clipped');
  assert.equal(await ui(function(){return this.querySelector('.fr-reading-actions button[aria-pressed=true]').textContent}),'Grammar');
  assert((await ui(function(){return this.querySelector('.fr-sentence-detail').textContent})).includes('adjective'));await shot('grammar-english-dark');record('390px, dark theme and English remain compact and localized');
  await patch({theme:'light',uiLanguage:'zh-CN'});await page.setViewportSize({width:1440,height:960});
  await menu();await clickNode(button('理解整句'));await settled();assert.equal(await ui(function(){return [...this.querySelector('.fr-sentence-tokens').children].map(element=>element.matches('button') ? element.querySelector('.fr-sentence-token-text').textContent : element.textContent).join('').trim()}),sentence+'.');record('sentence expansion remains available without a permanent toolbar row');
  await menu();await clickNode(n=>n.nodeName==='BUTTON'&&support.cdpAttribute(n,'aria-label')==='打开划词翻译设置');await until(async()=>context.pages().some(p=>p.url().includes('options.html')),'settings did not open');record('settings remain accessible through secondary actions');
  await helper.activateExtensionTabWithoutForeground(context,page);
  nextAnswer=grammar+'\n\n'+('Additional explanatory detail. '.repeat(90));await menu();await clickNode(button('重新生成'));await settled();
  const area=await ui(function(){const r=this.querySelector('.fr-reading-result').getBoundingClientRect();return{x:r.x+20,y:r.y+50}});await page.mouse.move(area.x,area.y);await page.mouse.wheel(0,600);await wait(200);
  assert((await ui(function(){return this.querySelector('.fr-reading-result').scrollTop}))>0);assert.equal(await page.evaluate(()=>scrollY),0);
  await page.mouse.wheel(0,5000);await wait(150);await page.mouse.wheel(0,500);await wait(150);assert.equal(await page.evaluate(()=>scrollY),0);record('long analysis scrolls internally and contains wheel movement at its boundary');
  assert.equal(report.consoleErrors.length,0);report.ok=true;
 }catch(error){report.error=error.stack;if(page&&!page.isClosed())await screenshot(page,'failure').catch(()=>{});throw error;}
 finally{fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));await session?.close();server.close();fs.rmSync(profileDir,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});

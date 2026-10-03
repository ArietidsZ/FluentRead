// 划词等待与词性标签专项：生产扩展、独立 Edge profile、真实选择手势和焦点安全 CDP。
// 词库使用真实打包数据；在线词典、翻译和句法回复由确定性夹具控制，覆盖等待与失败边界。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const {execFileSync} = require('node:child_process');
const support = require('./run-selection-trigger-test.cjs');
const arg = key => process.argv[process.argv.indexOf(`--${key}`) + 1];
const output = path.resolve(arg('artifacts-dir'));
const extensionDir = path.resolve(arg('extension-dir'));
const {chromium} = createRequire(path.join(arg('playwright-root'), 'package.json'))('playwright');
const helper = require(path.resolve(arg('focus-safe-helper')));
const source = 'Custom Mode Supports manual grouping of filament.';
const grammar = `### 词性与句法
| Text | POS | Role | Meaning |
| --- | --- | --- | --- |
| Custom Mode | noun phrase | subject | 自定义模式 |
| Supports | verb | predicate | 支持 |
| manual | adjective | modifier | 手动的 |
| grouping | noun | object | 分组 |
| of filament | preposition | modifier | 耗材的 |
`;
const report = {ok:false, cases:[], screenshots:[], consoleErrors:[], translationRequests:0,
  evidence:'Production extension in isolated Edge. Real local dictionary; deterministic online dictionary, translation and AI fixtures. No live provider quality claim.'};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let session, context, worker, server, popup, page;
let browserPid;
function guardFocus() {
  const state=JSON.parse(execFileSync('/usr/bin/osascript',['-l','JavaScript','-e',"ObjC.import('AppKit');const app=$.NSWorkspace.sharedWorkspace.frontmostApplication;JSON.stringify({pid:Number(app.processIdentifier),name:ObjC.unwrap(app.localizedName)})"],{encoding:'utf8',timeout:5_000}).trim());
  assert.notEqual(state.pid,browserPid,'test browser became the foreground application');
  report.foregroundAfter=state;
}
const cls = name => n => support.hasCdpClass(n, name);
async function node(predicate) {const {root} = await support.getSelectionUiTree(page); return support.findCdpNode(root, predicate);}
async function until(predicate, label) {for(let i=0;i<70;i++){if(await predicate())return;await wait(75);}throw new Error(label);}
async function inspect(predicate, fn) {
  const tree = await support.getSelectionUiTree(page);
  const n = support.findCdpNode(tree.root, predicate); assert(n, 'UI element missing');
  const {object} = await tree.session.send('DOM.resolveNode', {nodeId:n.nodeId});
  const result = await tree.session.send('Runtime.callFunctionOn', {objectId:object.objectId, returnByValue:true, functionDeclaration:fn});
  return result.result.value;
}
async function clickNode(predicate) {
  const tree = await support.getSelectionUiTree(page); const n = support.findCdpNode(tree.root,predicate); assert(n);
  const {model} = await tree.session.send('DOM.getBoxModel', {nodeId:n.nodeId}); const q=model.content;
  await page.mouse.click((q[0]+q[2]+q[4]+q[6])/4, (q[1]+q[3]+q[5]+q[7])/4);
}
async function capture(name) {
  const bounds = await inspect(cls('fr-translation-tooltip'), 'function(){const b=this.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};}');
  const file=path.join(output,`${name}.png`); await page.screenshot({path:file,clip:bounds});report.screenshots.push(file);
}
async function patch(value) {await support.patchStoredConfig(popup,value);await wait(200);}
async function select(text, selector='#word') {
  guardFocus();
  await page.keyboard.press('Escape');await page.mouse.click(20,20);
  await page.evaluate(({text,selector}) => {document.querySelector(selector).textContent=text;}, {text,selector});
  await helper.activateExtensionTabWithoutForeground(context,page);
  const points=await page.evaluate(selector=>{
    const text=document.querySelector(selector).firstChild,range=document.createRange();
    range.setStart(text,0);range.setEnd(text,1);const first=range.getBoundingClientRect();
    range.setStart(text,text.length-1);range.setEnd(text,text.length);const last=range.getBoundingClientRect();
    return {x:first.left,y:first.top+first.height/2,endX:last.right+2,endY:last.top+last.height/2};
  },selector);
  await page.mouse.move(points.x,points.y);await page.mouse.down();await page.mouse.move(points.endX,points.endY,{steps:12});await page.mouse.up();
  await until(()=>node(cls('fr-selection-indicator')),'selection entry missing');
  await clickNode(cls('fr-selection-indicator'));
  await until(()=>node(cls('fr-translation-tooltip')),'selection card missing');
}
async function mode(value) {await worker.evaluate(value=>{globalThis.__wordFixtureMode=value;},value);}
function pass(name, details={}) {guardFocus();report.cases.push({name,...details});console.log('PASS',name);}
async function main() {
  fs.mkdirSync(output,{recursive:true});const profile=fs.mkdtempSync(path.join(os.tmpdir(),'fluentread-word-feedback-'));
  server=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    if(req.url==='/translate') {
      report.translationRequests++;const texts=JSON.parse(body);
      if(texts.some(text=>text.includes('in between')))await wait(1_800);
      res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(texts.map(text=>({translations:[{text:text==='between'?'在……之间':text===source?'自定义模式支持手动分组耗材。':'测试译文',to:'zh-Hans'}]}))));return;
    }
    res.writeHead(200,{'content-type':'text/event-stream','access-control-allow-origin':'*'});
    for(const content of grammar.match(/[\s\S]{1,40}/g)) {
      res.write('data: '+JSON.stringify({id:'fixture',choices:[{index:0,delta:{content},finish_reason:null}]})+'\n\n');
      await wait(20);
    }
    res.end('data: '+JSON.stringify({id:'fixture',choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
  try {
    session=await helper.launchFocusSafePersistentContext({chromium,profileDir:profile,
      browserPath:'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',headless:false,background:true,
      browserArgs:[`--disable-extensions-except=${extensionDir}`,`--load-extension=${extensionDir}`,'--no-first-run','--no-default-browser-check'],viewport:{width:1440,height:960}});
    context=session.context;Object.assign(report,{launchMode:session.launchMode,focusPolicy:session.focusPolicy,windowPlacement:session.windowPlacement,extensionDir});
    const systemSession=await context.browser().newBrowserCDPSession();
    browserPid=(await systemSession.send('SystemInfo.getProcessInfo')).processInfo.find(process=>process.type==='browser').id;
    await systemSession.detach();
    const ready=await support.waitForWorker(context);worker=ready.worker;
    const newPage=async()=>{const p=await helper.newPageWithoutForeground(context);p.on('pageerror',error=>report.consoleErrors.push(error.message));return p;};
    popup=await newPage();await popup.goto(`chrome-extension://${ready.extensionId}/popup.html`);await popup.locator('.popup-shell[data-config-ready="true"]').waitFor();
    const saved=await support.readStoredConfig(popup);
    await patch({on:true,uiLanguage:'zh-CN',uiLanguageSetupCompleted:true,service:'microsoft',selectionTranslationService:'microsoft',from:'auto',to:'zh-Hans',selectionTranslatorMode:'bilingual',selectionTranslatorPresentation:'card',selectionTranslatorTrigger:'icon',selectionTranslatorDelay:0,useCache:false,
      hotkey:'none',floatingBallHotkey:'none',theme:'light',harness:{...saved.harness,enabled:true,service:'custom:fixture',model:'fixture',trigger:'click'},customOpenAIProviders:[{id:'custom:fixture',name:'Fixture',endpoint:`http://127.0.0.1:${port}/v1/chat/completions`,models:['fixture']}],token:{'custom:fixture':'fixture-token'},model:{...saved.model,'custom:fixture':'fixture'}});
    await worker.evaluate(url=>{
      const native=fetch.bind(globalThis);globalThis.__wordFixtureMode='miss';globalThis.__dictionaryRequests=0;globalThis.__dictionaryAborts=0;
      globalThis.fetch=async(input,init)=>{
        const address=String(input);
        if(address.startsWith('https://edge.microsoft.com/translate/translatetext'))return native(url,init);
        if(/cdn\.jsdmirror|raw\.githubusercontent|cdn\.jsdelivr/.test(address))return new Response('',{status:404});
        if(/dict\.youdao|dictionaryapi\.dev|datamuse\.com|wiktionary\.org\/api|api\.wiktapi/.test(address)){
          globalThis.__dictionaryRequests++;
          const state=globalThis.__wordFixtureMode;
          if(state==='stall'||(state==='race'&&address.includes('dict.youdao'))){
            return new Promise((_resolve,reject)=>{const abort=()=>{globalThis.__dictionaryAborts++;reject(new DOMException('fixture abort','AbortError'));};if(init?.signal?.aborted)abort();else init?.signal?.addEventListener('abort',abort,{once:true});});
          }
          if(state==='race'&&address.includes('dictionaryapi.dev')){
            await new Promise(resolve=>setTimeout(resolve,200));
            const word=decodeURIComponent(address.split('/').pop());
            return new Response(JSON.stringify([{word,meanings:[{partOfSpeech:'noun',definitions:[{definition:'a fast fixture definition'}]}]}]),{headers:{'content-type':'application/json'}});
          }
          return new Response('{}',{status:address.includes('dict.youdao')?200:404,headers:{'content-type':'application/json'}});
        }
        return native(input,init);
      };
    },`http://127.0.0.1:${port}/translate`);
    await context.route('https://example.com/**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="en"><head><style>body{margin:80px;font:22px/1.8 system-ui;color:#273142}p{max-width:900px}</style></head><body><h1>Selection feedback</h1><p id="word">between</p><p id="sentence">${source}</p><p id="neighbor">The host page stays readable.</p></body></html>`}));
    // 复用 helper 已创建并校验过的空白页，避免在配置页之后再次创建窗口/页签。
    page=context.pages().find(candidate=>candidate!==popup&&candidate.url().startsWith('about:blank#fluentread-background-'));
    assert(page,'helper initial background tab missing');guardFocus();
    page.on('pageerror',error=>report.consoleErrors.push(error.message));
    await page.goto('https://example.com/');await page.locator('#fluent-read-selection-translator-container').waitFor({state:'attached'});
    await select('between');await until(()=>node(cls('fr-word-meaning')),'local dictionary missing');
    assert(await node(cls('fr-word-support-loading')),'raw card was blocked by auxiliary translation');
    assert.equal(await node(cls('fr-word-card-loading')),null);await capture('local-result-before-support');
    assert.equal(await worker.evaluate(()=>globalThis.__dictionaryRequests),0);
    pass('local definition renders before auxiliary translation without online lookup');
    await until(async()=>!(await node(cls('fr-word-support-loading'))),'support did not finish');
    await mode('stall');const slowStart=Date.now();await select('zzqslowword');
    await until(()=>node(cls('fr-word-card-loading')),'compact waiting state missing');
    const loading=await inspect(cls('fr-word-card-loading'),'function(){return {height:this.getBoundingClientRect().height,text:this.textContent};}');
    assert(loading.height<35,'loading row wastes vertical space');assert(await node(cls('fr-text-block')));
    await capture('compact-waiting');await until(()=>node(cls('fr-word-fallback-note')),'slow dictionary never ended');
    const elapsed=Date.now()-slowStart;assert(elapsed<4_000);assert(support.cdpText(await node(cls('fr-word-fallback-note'))).includes('可稍后重查'));
    assert(await node(cls('fr-translation-result')));await capture('dictionary-timeout');pass('slow online lookup ends within budget and keeps ordinary translation',{elapsedMs:elapsed,loading});
    await mode('race');const requests=report.translationRequests;
    await clickNode(n=>n.nodeName==='BUTTON'&&support.cdpText(n).trim()==='重查词典');
    await until(()=>node(cls('fr-word-meaning')),'retry did not recover');
    await until(()=>report.translationRequests===requests+1,'dictionary retry should only translate auxiliary definitions');
    assert((await worker.evaluate(()=>globalThis.__dictionaryAborts))>0);pass('timeout is not cached as a missing word; retry accepts fast source and aborts slow source');
    await mode('miss');await select('zzqnotaword');await until(()=>node(cls('fr-word-fallback-note')),'missing-word hint absent');
    assert(support.cdpText(await node(cls('fr-word-fallback-note'))).includes('请检查拼写'));
    const before=await worker.evaluate(()=>globalThis.__dictionaryRequests);const translations=report.translationRequests;
    await clickNode(n=>n.nodeName==='BUTTON'&&support.cdpText(n).trim()==='重查词典');await wait(150);
    assert.equal(await worker.evaluate(()=>globalThis.__dictionaryRequests),before);assert.equal(report.translationRequests,translations);
    await capture('word-not-found');pass('missing word gives spelling hint and repeat lookup uses negative cache');
    await mode('stall');await select('zzqoldrequest');await select('between');await until(()=>node(cls('fr-word-meaning')),'new selection missing');
    await wait(2_700);assert(support.cdpText(await node(cls('fr-word-heading'))).includes('between'));assert.equal(await node(cls('fr-word-fallback-note')),null);
    await page.keyboard.press('Escape');await wait(100);assert.equal(await node(cls('fr-translation-tooltip')),null);pass('late lookup cannot overwrite new selection or reopen a closed card');
    await select(source,'#sentence');
    await until(async()=>{const n=await node(cls('fr-translation-result'));return n&&support.cdpText(n).includes('自定义模式支持');},'sentence translation missing');
    await wait(150);
    await clickNode(n=>n.nodeName==='BUTTON'&&support.cdpText(n).trim()==='词性与句法');
    await until(async()=>{const n=await node(cls('fr-sentence-tokens'));return n&&support.cdpText(n).includes('Custom Mode');},'grammar annotations missing');
    const labels=()=>inspect(cls('fr-sentence-tokens'),'function(){return Array.from(this.querySelectorAll("button"),button=>({label:button.querySelector(".fr-sentence-token-meta").textContent,title:button.title}));}');
    assert.equal(await node(cls('fr-reading-error')),null,'fixture AI response did not complete');
    assert.deepEqual((await labels()).map(item=>item.label),['名词短语','动词','形容词','名词','介词']);
    assert((await labels()).every(item=>!/subject|predicate|object|modifier/.test(item.title)));await capture('grammar-chinese');
    await patch({uiLanguage:'en-US'});await until(async()=>(await labels())[0].label==='noun phrase','English labels missing');
    assert.deepEqual((await labels()).map(item=>item.label),['noun phrase','verb','adjective','noun','preposition']);await capture('grammar-english');
    await patch({uiLanguage:'zh-CN',theme:'dark'});await page.setViewportSize({width:390,height:800});await wait(250);
    const fit=await inspect(cls('fr-translation-tooltip'),'function(){const b=this.getBoundingClientRect();return {left:b.left,right:b.right,viewport:innerWidth};}');
    assert(fit.left>=0&&fit.right<=fit.viewport+1);await capture('grammar-chinese-dark-390');pass('grammar chips show only localized parts of speech in Chinese and English; narrow dark layout fits',{fit});
    assert.equal(await page.locator('#neighbor').innerText(),'The host page stays readable.');assert.equal(report.consoleErrors.length,0);
    report.windowPlacement=session.windowPlacement;assert.equal(report.windowPlacement.browserFrontmost,false);report.ok=true;
  } catch(error) {
    report.error=error.stack;
    if(page) {
      const tree=await support.getSelectionUiTree(page).catch(()=>null);
      if(tree)report.failureUi=support.cdpText(tree.root);
      await page.screenshot({path:path.join(output,'failure-page.png')}).catch(()=>{});
    }
    await capture('failure').catch(()=>{});throw error;
  }
  finally {fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));await session?.close();server.close();fs.rmSync(profile,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});

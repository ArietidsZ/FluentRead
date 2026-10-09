#!/usr/bin/env node
/**
 * @file scripts/testing/run-information-highlight-test.cjs
 * 文件职责：在独立真实 Edge 中验证生产信息高亮的页面保护、启停、动态正文与设置持久化。
 * 主要内容：通过现有后台无焦点浏览器 helper 加载本地扩展和只读正文 fixture，执行实际消息和 UI 控件，保存布局、范围、控制台及截图证据。
 * 模块边界：只清理本次 profile；关键词证据与模型推理证据分开记录，不把 fixture 结果称为任意网站或阅读效果证明。
 */
'use strict';
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {createHash,randomUUID}=require('node:crypto');
const assert=require('node:assert/strict');
const support=require('../run-selection-trigger-test.cjs');
const {createRequire}=require('node:module');
const {guardBrowserClose,getGuardedBrowserPid}=require('./owned-browser-close.cjs');
const args={};
for(let i=2;i<process.argv.length;i+=2) args[process.argv[i].replace(/^--/,'')]=process.argv[i+1];
for(const field of ['extension-dir','playwright-root','artifacts-dir']) assert(args[field],`Missing --${field}`);
const {chromium}=createRequire(path.join(args['playwright-root'],'information-highlight.cjs'))('playwright');
const helper=require(args['focus-safe-helper']||'./focus-safe-browser.cjs');
const extensionDir=path.resolve(args['extension-dir']);
const artifacts=path.resolve(args['artifacts-dir']);
const manifest=JSON.parse(fs.readFileSync(path.join(extensionDir,'manifest.json'),'utf8'));
fs.mkdirSync(artifacts,{recursive:true});
const profileDir=fs.mkdtempSync(path.join(os.tmpdir(),'fluentread-information-highlight-'));
const report={ok:false,extensionDir,build:extensionDir.endsWith('-dev')?'development':'production',
  evidence:'real-extension-controlled-pages',cases:[],screenshots:[],consoleErrors:[],persistenceCases:[],consoleWarnings:[],
  quickClose:false,crossPageSync:false,latestWriteWins:false,
  unverified:['Firefox browser execution','reading-speed benefit','arbitrary-site compatibility','local model inference']};
const fixture=`<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>Information highlighting fixture</title>
<style>body{margin:0;background:#fafaf7;color:#24312b;font:18px/1.8 system-ui}main{max-width:760px;margin:40px auto;padding:24px}p{margin:20px 0}a{color:inherit}pre{background:#eee}#excluded{position:fixed;right:10px;bottom:10px}</style></head>
<body><main><h1>浏览器本地语言模型与阅读辅助</h1>
<article id="article">${Array.from({length:240},(_,i)=>`<p data-paragraph="${i}">第 ${i+1} 段：浏览器<em>本地模型</em>分析正文，在 <a href="#source">阅读位置附近</a>优先计算。信息意外度与关键词是不同的方法；高亮并不证明内容正确。只有满足条件时才缓存结果，不能上传原文。Unicode 包含 é、👩🏽‍💻 和中文标点。</p>`).join('')}</article>
<div id="shadow-anchor"></div><pre id="code">const unexpectedWords = ['local model', '关键词'];</pre>
<div contenteditable="true" id="editor">此处是可编辑的正文，不能参与评分。</div>
<button id="excluded">浏览器模型与关键词按钮</button><p hidden>隐藏的模型文字</p></main>
<script>const root=document.querySelector('#shadow-anchor').attachShadow({mode:'open'});root.innerHTML='<p style="font:18px/1.8 system-ui">开放 Shadow DOM 的本地语言模型正文需要正确定位原文与意外度词语。</p>';</script></body></html>`;
const modelManifest=args['model-dir']?JSON.parse(fs.readFileSync(path.join(args['model-dir'],'manifest.json'),'utf8')):[];
const server=http.createServer((req,res)=>{
  const model=modelManifest.find(file=>req.url===`/models/${file.path}`);
  if(model){
    res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Content-Type','application/octet-stream');
    const range=/^bytes=(\d+)-(\d+)$/.exec(req.headers.range||'');
    const start=range?Number(range[1]):0,end=range?Math.min(Number(range[2]),model.size-1):model.size-1;
    res.statusCode=range?206:200;res.setHeader('Content-Length',end-start+1);
    if(range)res.setHeader('Content-Range',`bytes ${start}-${end}/${model.size}`);
    fs.createReadStream(path.join(args['model-dir'],model.path),{start,end}).pipe(res);return;
  }
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture);
});
const save=()=>fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify(report,null,2));
async function shot(page,name){const file=`${name}.png`;await page.screenshot({path:path.join(artifacts,file),caret:'initial'});report.screenshots.push(file);}
async function textRanges(page){return page.evaluate(()=>{
  const ranges=[];if(!CSS.highlights)return ranges;
  for(const [name,highlight]of CSS.highlights) if(name.includes('information'))
    for(const range of highlight)ranges.push({name,text:range.toString(),parent:range.startContainer.parentElement?.id||'',root:range.startContainer.getRootNode()===document?'document':'shadow'});
  return ranges;
});}
(async()=>{
  let session,primaryError,focusTimer,focusError,focusMonitor,browserPid;
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const fixtureUrl=`http://127.0.0.1:${server.address().port}/article`;
  focusMonitor=helper.startFocusEventMonitor({onEvent(event){
    if(browserPid&&event.pid===browserPid){focusError=new Error('Owned browser activated during continuous native focus observation');primaryError||=focusError;void session?.close().catch(()=>{});}
  },onError(error){focusError=error;primaryError||=error;void session?.close().catch(()=>{});}});
  report.focusObserver=await focusMonitor.ready;
  session=await helper.launchFocusSafePersistentContext({chromium,profileDir,background:true,headless:false,displayTarget:'secondary',
    browserPath:args['browser-path']||'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',viewport:{width:1440,height:1000},timeout:30000,
    browserArgs:[`--disable-extensions-except=${extensionDir}`,`--load-extension=${extensionDir}`,'--no-first-run','--no-default-browser-check']});
  guardBrowserClose(session,profileDir);
  Object.assign(report,{launchMode:session.launchMode,focusPolicy:session.focusPolicy,windowPlacement:session.windowPlacement});
  assert.equal(session.launchMode,'macos-background-cdp');assert.equal(session.focusPolicy,'launchservices-no-foreground');
  assert.equal(session.windowPlacement.mode,'background-visible-no-focus');assert.equal(session.windowPlacement.browserFrontmost,false);
  browserPid=await getGuardedBrowserPid(session);report.browserPid=browserPid;report.focusSamples=[];
  if(focusMonitor.events.some(event=>event.pid===browserPid))throw new Error('Owned browser activated during launch');
  const checkFocus=async()=>{
    const front=await helper.queryMacFrontmostApplication();
    report.focusSamples.push({at:Date.now(),pid:front?.pid,name:front?.name});
    if(focusMonitor.error)throw focusMonitor.error;
    if(focusError)throw focusError;
    if(!front||front.pid===browserPid){focusError=new Error('Focus protection stopped the owned test browser');throw focusError;}
  };
  await checkFocus();
  // Observe the asynchronous native window creation before opening additional
  // targets; never restore another app to conceal an activation.
  for(let i=0;i<5;i++){await new Promise(resolve=>setTimeout(resolve,200));await checkFocus();}
  let checking=false;
  focusTimer=setInterval(()=>{if(checking)return;checking=true;void checkFocus().catch(error=>{primaryError||=error;void session.close().catch(()=>{});}).finally(()=>{checking=false;});},500);
  const context=session.context;context.setDefaultTimeout(15000);
  let bootstrap=context.pages().find(p=>p.url().startsWith('about:blank#fluentread-background-'));
  const open=async(url)=>{await checkFocus();const p=bootstrap||await helper.newPageWithoutForeground(context,30000);bootstrap=null;p.on('pageerror',e=>report.consoleErrors.push({surface:url,message:e.message}));p.on('console',m=>{if(m.type()==='warning'&&url.startsWith('chrome-extension://'))report.consoleWarnings.push({surface:url,message:m.text()});});await p.goto(url);await checkFocus();return p;};
  const worker=context.serviceWorkers().find(w=>w.url().startsWith('chrome-extension://'))||await context.waitForEvent('serviceworker',{timeout:30000});
  worker.on('console',m=>{if(m.type()==='error')report.consoleErrors.push({surface:'worker',message:m.text()});});
  const origin=`chrome-extension://${new URL(worker.url()).host}`;
  const control=await open(`${origin}/${manifest.options_page||manifest.options_ui.page}#settings-translation`);
  await control.waitForFunction(()=>Boolean(document.querySelector('#information-highlight-settings')));
  await support.patchStoredConfig(control,{on:true,disableFloatingBall:false,uiLanguage:'zh-CN',uiLanguageSetupCompleted:true});
  const page=await open(fixtureUrl);await helper.activateExtensionTabWithoutForeground(context,page);
  await page.waitForFunction(()=>Boolean(document.querySelector('#fluent-read-floating-ball-container')),null,{timeout:30000});
  const tabId=await control.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url)?.id,fixtureUrl);assert(Number.isInteger(tabId));
  const send=(type,extra={})=>control.evaluate(async({tabId,type,extra})=>chrome.tabs.sendMessage(tabId,{type,...extra}),{tabId,type,extra});
  const initial=await send('GET_INFORMATION_HIGHLIGHT_STATE');assert.equal((initial.state||initial).enabled,false);
  await page.evaluate(()=>{window.__highlightFixture={nodes:[...document.querySelectorAll('#article p,#article em,#article a')],html:document.querySelector('#article').innerHTML,text:document.querySelector('#article').textContent,rect:document.querySelector('#article').getBoundingClientRect().toJSON()};});
  const popupUrl=`${origin}/${manifest.action.default_popup}`;
  let popup=await open(popupUrl);await popup.setViewportSize({width:400,height:600});
  await popup.locator('[data-popup-quick-feature="highlight"]').click();
  const drawer=popup.locator('[data-information-highlight-drawer]');await drawer.waitFor();
  await drawer.locator('[data-information-highlight-enabled]').click();
  await page.waitForFunction(()=>CSS.highlights&&[...CSS.highlights].some(([name,h])=>name.includes('information')&&h.size>0),null,{timeout:30000});
  let ranges=await textRanges(page);assert(ranges.length>0);assert(ranges.every(r=>!['code','editor','excluded'].includes(r.parent)));
  const protection=await page.evaluate(()=>{const f=window.__highlightFixture;const article=document.querySelector('#article');return{textSame:f.text===article.textContent,htmlSame:f.html===article.innerHTML,nodeIdentity:f.nodes.every(n=>n.isConnected),rect:article.getBoundingClientRect().toJSON(),before:f.rect};});
  assert(protection.textSame&&protection.htmlSame&&protection.nodeIdentity);assert.deepEqual(protection.rect,protection.before);
  report.cases.push({id:'keywords-original-node-and-geometry-preservation',ranges:ranges.length,protection});
  await helper.activateExtensionTabWithoutForeground(context,page);
  await page.waitForFunction(()=>CSS.highlights?.get('fluentread-information-highlight')?.size>0,null,{timeout:30000});await new Promise(resolve=>setTimeout(resolve,500));
  report.nativePaint=await page.evaluate(()=>({styles:[...document.querySelectorAll('[data-fr-information-highlight-style]')].map(style=>({text:style.textContent,rules:[...style.sheet.cssRules].map(rule=>rule.cssText)})),ranges:[...CSS.highlights.get('fluentread-information-highlight')].map(range=>({text:range.toString(),rect:range.getBoundingClientRect().toJSON()}))}));
  await shot(page,'keywords-page');await shot(popup,'popup-enabled');
  await page.screenshot({path:path.join(artifacts,'keywords-default-caret.png')});report.screenshots.push('keywords-default-caret.png');
  assert((await textRanges(page)).length>0,'Excluded editor caret changes must not clear reading highlights');
  report.cases.push({id:'excluded-editor-screenshot-does-not-clear-paint'});
  if(args['paint-diagnose']){
    await helper.activateExtensionTabWithoutForeground(context,page);await page.waitForFunction(()=>CSS.highlights?.get('fluentread-information-highlight')?.size>0);
    const inspectPaint=()=>page.evaluate(()=>{const name='fluentread-information-highlight',h=CSS.highlights.get(name),range=[...h][0],el=range.startContainer.parentElement;return{background:getComputedStyle(el,`::highlight(${name})`).backgroundColor,count:h.size,visibility:document.visibilityState,range:range.toString(),rect:range.getBoundingClientRect().toJSON()};});
    report.paintDiagnostics=[{stage:'product',value:await inspectPaint()}];
    await page.evaluate(()=>{const name='fluentread-information-highlight';window.__paintOwner=CSS.highlights.get(name);CSS.highlights.set(name,new Highlight(...[...window.__paintOwner].map(range=>range.cloneRange())));});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await shot(page,'paint-main-world-clone');report.paintDiagnostics.push({stage:'main-world-clone',value:await inspectPaint()});
    await page.evaluate(()=>{const style=document.createElement('style');style.id='fluent-read-paint-probe';style.textContent='*::highlight(fluentread-information-highlight){background-color:rgb(255,0,255)!important}';document.head.append(style);});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await shot(page,'paint-forced-selector');report.paintDiagnostics.push({stage:'forced-selector',value:await inspectPaint()});
    await page.evaluate(()=>{document.querySelector('#fluent-read-paint-probe').remove();CSS.highlights.set('fluentread-information-highlight',window.__paintOwner);delete window.__paintOwner;});save();
  }
  await drawer.locator('[data-information-highlight-color="mint"]').click();await popup.close();
  popup=await open(popupUrl);await popup.setViewportSize({width:400,height:600});await popup.locator('[data-popup-quick-feature="highlight"]').click();
  assert.equal(await popup.locator('[data-information-highlight-color="mint"]').getAttribute('aria-pressed'),'true');
  report.quickClose=true;report.persistenceCases.push({id:'popup-color-quick-close',value:'mint'});
  await popup.locator('[data-information-highlight-color="amber"]').click();await popup.locator('[data-information-highlight-color="blue"]').click();await popup.close();
  await control.reload();await control.locator('#information-highlight-settings').waitFor();
  assert.equal(await control.locator('[data-information-highlight-color="blue"]').getAttribute('aria-pressed'),'true');
  report.latestWriteWins=true;report.crossPageSync=true;report.persistenceCases.push({id:'latest-write-and-options-sync',value:'blue'});
  for(const width of [1440,820,390]){await control.setViewportSize({width,height:1000});await control.locator('#information-highlight-settings').scrollIntoViewIfNeeded();
    const metrics=await control.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:innerHeight,scrollHeight:document.documentElement.scrollHeight}));
    assert(metrics.scrollWidth<=width+1);assert(metrics.scrollHeight<=metrics.height+1);report.cases.push({id:`settings-layout-${width}`,metrics});await shot(control,`settings-${width}`);}
  await page.evaluate(()=>{const p=document.querySelector('[data-paragraph="0"]');const clone=p.cloneNode(true);p.replaceWith(clone);clone.firstChild.textContent='动态更新后的技术主题：浏览器本地语言模型需要取消迟到结果。';});
  await new Promise(resolve=>setTimeout(resolve,1000));ranges=await textRanges(page);
  assert(ranges.every(r=>!r.text.includes('第 1 段：')));report.cases.push({id:'dynamic-replaced-text-snapshot',ranges:ranges.length});
  await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await new Promise(resolve=>setTimeout(resolve,1200));
  const bottom=await send('GET_INFORMATION_HIGHLIGHT_STATE');report.cases.push({id:'long-page-scroll',state:bottom.state||bottom,ranges:(await textRanges(page)).length});
  await send('SET_INFORMATION_HIGHLIGHT_ENABLED',{enabled:false});assert.equal((await textRanges(page)).length,0);
  await new Promise(resolve=>setTimeout(resolve,500));assert.equal((await textRanges(page)).length,0);report.cases.push({id:'disable-clears-and-does-not-repaint'});
  await send('SET_INFORMATION_HIGHLIGHT_ENABLED',{enabled:true});await send('SET_INFORMATION_HIGHLIGHT_ENABLED',{enabled:false});
  await new Promise(resolve=>setTimeout(resolve,500));assert.equal((await textRanges(page)).length,0);report.cases.push({id:'rapid-enable-disable'});
  const second=await open(`${fixtureUrl}?second`);await helper.activateExtensionTabWithoutForeground(context,second);
  await second.waitForFunction(()=>Boolean(document.querySelector('#fluent-read-floating-ball-container')));
  const secondId=await control.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url)?.id,`${fixtureUrl}?second`);
  const secondState=await control.evaluate(async id=>chrome.tabs.sendMessage(id,{type:'GET_INFORMATION_HIGHLIGHT_STATE'}),secondId);
  assert.equal((secondState.state||secondState).enabled,false);report.cases.push({id:'new-tab-does-not-inherit-enabled'});
  await shot(second,'disabled-page');
  let modelPopup=await open(popupUrl);await modelPopup.setViewportSize({width:400,height:600});await modelPopup.locator('[data-popup-quick-feature="highlight"]').click();
  const modeSelect=modelPopup.locator('[data-information-highlight-mode-select]');assert((await modeSelect.boundingBox()).height>20,'Popup model selector must be visibly rendered');
  await modeSelect.click();await modelPopup.locator('[data-information-highlight-mode="surprisal-local"]').click();
  await modelPopup.locator('[data-testid="information-highlight-model-card"]').waitFor();
  assert.equal((await support.readStoredConfig(control)).informationHighlight.mode,'surprisal-local');
  report.cases.push({id:'popup-real-model-mode-selector',visible:true});await shot(modelPopup,'popup-model-mode');await modelPopup.close();
  if(modelManifest.length){
    // 本地测试文件也逐个核对实际字节和 SHA；此步骤不冒充产品下载链路。
    for(const file of modelManifest){
      assert.equal(fs.statSync(path.join(args['model-dir'],file.path)).size,file.size);
      const hash=createHash('sha256');for await(const chunk of fs.createReadStream(path.join(args['model-dir'],file.path)))hash.update(chunk);
      assert.equal(hash.digest('hex'),file.sha256);
    }
    const localModelOrigin=`http://127.0.0.1:${server.address().port}`;
    const imported=await control.evaluate(async({manifest,localOrigin})=>{
      const cache=await caches.open('fluent-read-information-highlight-model-v1');let total=0;
      for(const file of manifest){
        for(let offset=0,index=0;offset<file.size;offset+=4*1024*1024,index++){
          const end=Math.min(file.size-1,offset+4*1024*1024-1);
          const response=await fetch(`${localOrigin}/models/${file.path}`,{headers:{Range:`bytes=${offset}-${end}`}});
          if(response.status!==206)throw Error('Test artifact range fetch failed');
          const bytes=await response.arrayBuffer();
          await cache.put(`${file.url}?fluent-read-part=${index}`,new Response(bytes,{headers:{'Content-Length':String(bytes.byteLength)}}));total+=bytes.byteLength;
        }
        await cache.put(`${file.url}?fluent-read-verified=${file.sha256}`,new Response(JSON.stringify({size:file.size,sha256:file.sha256})));
      }
      return total;
    },{manifest:modelManifest,localOrigin:localModelOrigin});
    report.model={artifactImport:'sha-verified-local-files-to-temporary-extension-cache',importedBytes:imported,files:modelManifest};
    let status;for(let attempt=0;attempt<5;attempt++){
      status=await control.evaluate(()=>chrome.runtime.sendMessage({type:'GET_INFORMATION_HIGHLIGHT_MODEL_STATUS'}));
      if(status?.status?.downloaded)break;await new Promise(resolve=>setTimeout(resolve,500));
    }
    report.model.status=status;assert(status.success&&status.status.downloaded);
    if(status.status.supported){
      const forbidden=[];await context.route(/^https:\/\/(?:huggingface\.co|hf-mirror\.com)\//,route=>{forbidden.push(route.request().url());return route.abort('blockedbyclient');});
      const documentPage=await open(`${origin}/document.html`);
      for(const [index,text] of ['浏览器本地模型计算信息意外度，不上传正文。','A local model scores cafe\u0301 and 👩🏽‍💻 in the browser.'].entries()){
        const started=performance.now();
        const response=await documentPage.evaluate(({text,id})=>chrome.runtime.sendMessage({type:'SCORE_INFORMATION_HIGHLIGHT',text,requestId:id}),{text,id:randomUUID()});
        const milliseconds=performance.now()-started;
        assert(response.success,JSON.stringify(response));assert(response.result.spans.length>0);
        assert(response.result.spans.every(span=>Number.isFinite(span.score)&&span.score>=0&&span.start>=0&&span.end<=text.length&&span.end>span.start));
        report.cases.push({id:index?'real-model-warm-unicode':'real-model-cold-chinese',milliseconds,text,result:response.result});save();
      }
      const cancellation=await documentPage.evaluate(async({id})=>{
        const score=chrome.runtime.sendMessage({type:'SCORE_INFORMATION_HIGHLIGHT',text:'浏览器本地语言模型支持离线分析，但不能改变原文。'.repeat(35),requestId:id});
        await new Promise(resolve=>setTimeout(resolve,30));
        const cancel=await chrome.runtime.sendMessage({type:'CANCEL_INFORMATION_HIGHLIGHT',requestId:id});
        return {cancel,score:await score};
      },{id:randomUUID()});
      assert(cancellation.cancel.success);assert(!cancellation.score.success);report.cases.push({id:'real-model-cancel',response:cancellation});
      assert.equal(forbidden.length,0,'Local inference attempted a model download');report.model.observedInterceptedModelRequests=forbidden;report.model.networkObservationScope='page-routes-only; extension workers rely on verified local-only model configuration';
      report.unverified=report.unverified.filter(item=>item!=='local model inference');
    }else report.model.gpuInferenceUnavailable=status.status.reason;
  }
  await support.patchStoredConfig(control,{informationHighlight:{mode:'keywords',density:'medium',color:'amber',style:'background'}});
  const documentReader=await open(`${origin}/document.html`);
  await documentReader.locator('.file-drop-zone').waitFor();
  const {PDFDocument,StandardFonts}=require('pdf-lib');const pdf=await PDFDocument.create();const pdfPage=pdf.addPage([595,842]);const pdfFont=await pdf.embedFont(StandardFonts.Helvetica);
  ['Local browser models analyse reading text without uploading.', 'Information highlighting preserves original document layout.', 'Important terms and numerical conditions need careful reading.'].forEach((line,index)=>pdfPage.drawText(line,{font:pdfFont,x:44,y:748-index*32,size:12}));
  await documentReader.locator('input[type=file]').setInputFiles({name:'information-highlight-fixture.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())});
  await documentReader.locator('.workspace-heading h1').filter({hasText:'information-highlight-fixture.pdf'}).waitFor({timeout:60000});
  await documentReader.getByRole('button',{name:'阅读',exact:true}).click();
  const textLayer=documentReader.locator('[data-fluentread-pdf-text]').first();await textLayer.locator('span').first().waitFor({timeout:30000});
  const pdfToggle=documentReader.locator('.pdf-information-highlight');assert(await pdfToggle.isEnabled());assert.equal(await pdfToggle.getAttribute('aria-pressed'),'false');
  const pdfBefore=await textLayer.evaluate(el=>{window.__pdfInfoSource=[...el.querySelectorAll('span')].map(span=>span.firstChild);return{html:el.innerHTML,text:el.textContent,rect:el.getBoundingClientRect().toJSON()};});
  await pdfToggle.click();await documentReader.waitForFunction(()=>CSS.highlights?.get('fluentread-information-highlight')?.size>0,null,{timeout:30000});
  const pdfRanges=await textRanges(documentReader);assert(pdfRanges.length>0);
  report.pdfToggleStyle=await pdfToggle.evaluate(el=>{const c=getComputedStyle(el);return{color:c.color,border:c.borderColor,background:c.backgroundColor,brand:getComputedStyle(el).getPropertyValue('--brand').trim()};});
  assert.notEqual(report.pdfToggleStyle.color,'rgb(39, 49, 43)');
  const pdfAfter=await textLayer.evaluate(el=>({html:el.innerHTML,text:el.textContent,rect:el.getBoundingClientRect().toJSON(),sameNodes:window.__pdfInfoSource.every(node=>node.isConnected&&el.contains(node))}));
  assert.equal(pdfBefore.html,pdfAfter.html);assert.equal(pdfBefore.text,pdfAfter.text);assert.deepEqual(pdfBefore.rect,pdfAfter.rect);assert(pdfAfter.sameNodes);
  report.cases.push({id:'pdf-keywords-native-text-layer-preservation',ranges:pdfRanges,protection:pdfAfter});await shot(documentReader,'pdf-keywords');
  await pdfToggle.click();assert.equal((await textRanges(documentReader)).length,0);report.cases.push({id:'pdf-disable-clears'});
  if(!report.unverified.includes('local model inference')){
    await support.patchStoredConfig(control,{informationHighlight:{mode:'surprisal-local',density:'medium',color:'amber',style:'background'}});
    await documentReader.waitForFunction(()=>document.querySelector('.pdf-information-highlight')?.getAttribute('aria-pressed')==='false');await pdfToggle.click();
    await documentReader.waitForFunction(()=>CSS.highlights?.get('fluentread-information-highlight')?.size>0,null,{timeout:120000});
    report.cases.push({id:'pdf-real-model-text-layer-highlights',ranges:await textRanges(documentReader)});await shot(documentReader,'pdf-local-model');await pdfToggle.click();assert.equal((await textRanges(documentReader)).length,0);
  }
  if(focusError)throw focusError;await checkFocus();assert.equal(report.consoleErrors.length,0,JSON.stringify(report.consoleErrors));assert(!report.consoleWarnings.some(item=>item.message.includes('Failed to resolve component')),JSON.stringify(report.consoleWarnings));report.ok=true;
 }catch(error){primaryError=error;report.error=error.stack||String(error);
    if(session&&!focusError)for(const [index,p]of session.context.pages().entries())try{report.diagnostics??=[];report.diagnostics.push({url:p.url(),text:(await p.locator('body').innerText()).slice(0,15000)});await shot(p,`failure-surface-${index}`);}catch{}
 }
 finally{
  if(focusTimer)clearInterval(focusTimer);
  if(session)try{await session.close();}catch(error){report.cleanupError=String(error);report.ok=false;primaryError||=error;}
  if(focusMonitor){report.focusEvents=focusMonitor.events;try{await focusMonitor.stop();}catch(error){report.focusObserverCleanupError=String(error);report.ok=false;primaryError||=error;}
    if(focusMonitor.error){report.focusObserverError=String(focusMonitor.error);report.ok=false;primaryError||=focusMonitor.error;}}
  await new Promise(resolve=>server.close(resolve));save();
 }
 console.log(JSON.stringify({ok:report.ok,cases:report.cases.length,report:path.join(artifacts,'report.json'),error:report.error}));
 if(primaryError)process.exitCode=1;
})();

#!/usr/bin/env node
'use strict';
// 句子听读生产专项：后台临时 Edge、真实收藏与存储、确定性模型和浏览器语音回退。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const arg = (name, fallback) => {const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1];};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const source = 'Good ideas deserve attention.';
const translated = '好想法值得关注。';
const headingSource = 'Different Parts with the Same Colors';
const wrappedSource = 'This deliberately wrapped sentence provides enough words to compare the same original sentence across several lines without changing the selected sentence or closing its controls.';
const explanation = '这句话强调好想法值得关注。deserve attention 表示“值得关注”。';
async function fixture() {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*'); response.setHeader('Access-Control-Allow-Headers', '*');
    if (request.method === 'OPTIONS') {response.writeHead(204); response.end(); return;}
    if (request.method === 'POST') {
      const chunks = []; for await (const part of request) chunks.push(part);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const prompt = JSON.stringify(body.messages); const teaching = prompt.includes('最多三句');
      const content = teaching ? explanation : prompt.includes(headingSource) ? '不同部位颜色相同' : prompt.includes(wrappedSource) ? '这个刻意换行的句子提供足够的文字，用来跨多行比较同一句原文，并且不改变选中的句子或关闭操作入口。' : translated + '练习带来进步。';
      requests.push({kind:teaching ? 'explanation' : 'translation'});
      if (body.stream) {
        response.setHeader('Content-Type', 'text/event-stream');
        for (const text of [content.slice(0, 15), content.slice(15)]) response.write(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta:{content:text},finish_reason:null}]})}\n\n`);
        response.end(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);
      } else {response.setHeader('Content-Type','application/json'); response.end(JSON.stringify({id:'fixture',object:'chat.completion',model:'fixture',choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}]}));}
      return;
    }
    response.setHeader('Content-Type','text/html');
    response.end(`<html lang="en"><head><title>Sentence listening fixture</title><style>body{margin:70px;font:21px/1.8 system-ui}p{max-width:720px}h2{font-size:36px;line-height:1.6}#wrapped{max-width:360px}button{letter-spacing:7px!important}aside{height:1200px}</style></head><body><h1 translate="no">Read and listen</h1><p id="primary">${source} Practice makes progress.</p><h2 id="heading">${headingSource}</h2><p id="wrapped">${wrappedSource}</p><aside></aside></body></html>`);
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  return {url:`http://127.0.0.1:${server.address().port}`,requests,close:()=>new Promise(resolve=>server.close(resolve))};
}
async function main() {
  const extensionDir = path.resolve(arg('extension-dir','.output/chrome-mv3'));
  const artifactsDir = path.resolve(arg('artifacts-dir','/private/tmp/fluentread-sentence-listening'));
  const packages = arg('playwright-root'); const helper = arg('focus-safe-helper');
  assert(packages && helper); assert(fs.existsSync(path.join(extensionDir,'manifest.json')));
  const {chromium} = require(path.join(packages,'playwright'));
  const {launchFocusSafePersistentContext,newPageWithoutForeground,activateExtensionTabWithoutForeground} = require(helper);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(),'fluentread-sentence-listening-edge-'));
  fs.mkdirSync(artifactsDir,{recursive:true});
  const local = await fixture();
  const report = {ok:false,extensionDir,artifactsDir,profileDir,profileMode:'temporary',checks:[],consoleErrors:[],screenshots:[],evidenceBoundary:'Real production extension and storage; local deterministic translation/explanation; synthetic browser voice validates text and stop lifecycle, not audible voice quality or Firefox runtime.'};
  let launched; let page; let options;
  try {
    launched = await launchFocusSafePersistentContext({chromium,profileDir,background:true,headless:false,browserPath:'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',viewport:{width:1440,height:960},timeout:30000,
      browserArgs:[`--disable-extensions-except=${extensionDir}`,`--load-extension=${extensionDir}`,'--no-first-run','--no-default-browser-check']});
    Object.assign(report,{launchMode:launched.launchMode,focusPolicy:launched.focusPolicy,windowPlacement:launched.windowPlacement});
    assert.equal(report.windowPlacement.browserFrontmost,false);
    const context = launched.context;
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker',{timeout:30000});
    const origin = /^chrome-extension:\/\/[^/]+/u.exec(worker.url())[0];
    const createPage = async url => {const p = await newPageWithoutForeground(context,30000);p.on('pageerror',e=>report.consoleErrors.push(e.message));await p.goto(url,{waitUntil:'domcontentloaded'});return p;};
    options = await createPage(`${origin}/options.html#settings-vocabulary`);
    const readConfig = () => options.evaluate(async()=>{const result=await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});return typeof result.value==='string'?JSON.parse(result.value):result.value;});
    let config; for(let i=0;i<150;i++){config=await readConfig();if(config?.to)break;await wait(100);} assert(config?.to);
    const service = 'custom:sentence-listening-fixture';
    const patch = {on:true,uiLanguage:'zh-CN',uiLanguageSetupCompleted:true,from:'en',to:'zh-Hans',service,display:1,style:1,autoTranslate:false,
      bilingualSentenceHighlightEnabled:true,vocabularyBookEnabled:false,selectionTranslatorMode:'disabled',disableSelectionTranslator:true,animations:false,
      customOpenAIProviders:[{id:service,name:'句子听读夹具',endpoint:`${local.url}/v1/chat/completions`,models:['fixture']}],
      token:{[service]:'synthetic-fixture'},model:{[service]:'fixture'},user_role:{[service]:'SOURCE_BEGIN{{origin}}SOURCE_END'},glossaryEnabled:false,enableAIContext:false,enableAIMultiSegment:false,
      hotkey:'Control',mouseHoverTranslationDelay:0,selectionTtsMode:'local-only',harness:{...config.harness,enabled:true,service,model:'fixture'}};
    const saved = await options.evaluate(({config,patch})=>chrome.runtime.sendMessage({type:'persistConfig',mode:'replace',config:{...config,...patch},baseRevision:config.__fluentConfigRevision,clientId:`listening-${crypto.randomUUID()}`,sequence:1}),{config,patch});
    assert.equal(saved.success,true,saved.error); await wait(350);
    page = await createPage(local.url);
    await page.evaluate(()=>{
      globalThis.__sentencePointerEvents=[];
      for(const type of ['pointermove','pointerout','selectionchange','scroll','blur']) {
        (type==='blur'?window:document).addEventListener(type,event=>{
          const target=event.composedPath()[0];
          globalThis.__sentencePointerEvents.push({type,x:event.clientX,y:event.clientY,buttons:event.buttons,target:target?.className||target?.nodeName,related:event.relatedTarget?.nodeName});
          if(globalThis.__sentencePointerEvents.length>80)globalThis.__sentencePointerEvents.shift();
        },true);
      }
    });
    await page.locator('#fluent-read-page-styles').waitFor({state:'attached'});
    await page.locator('#fluent-read-sentence-actions').waitFor({state:'attached'});
    await activateExtensionTabWithoutForeground(context,page,30000);
    await page.locator('#primary').hover(); await page.keyboard.press('Control');
    await page.locator('#primary > .fluent-read-bilingual-content').waitFor();
    const toggleCounts=[await page.locator('#primary > .fluent-read-bilingual-content').count()];
    const before = await page.locator('#primary').evaluate(el=>({html:el.innerHTML,rect:JSON.stringify(el.getBoundingClientRect())}));
    const hover = async (translatedSide, offset=0) => {
      const point = await page.evaluate(({source,translated,translatedSide})=>{
        const root=document.querySelector(translatedSide?'#primary .fluent-read-bilingual-content':'#primary');const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
        while(walker.nextNode()){const node=walker.currentNode;const index=node.textContent.indexOf(translatedSide?translated:source);if(index<0)continue;const range=document.createRange();range.setStart(node,index);range.setEnd(node,index+2);const rect=range.getClientRects()[0];return{x:rect.left+rect.width/2,y:rect.top+rect.height/2};}throw new Error('sentence missing');
      },{source,translated,translatedSide});await page.mouse.move(point.x+offset,point.y);await wait(100);
    };
    const shot = async (p,name,options={})=>{const file=path.join(artifactsDir,`${name}.png`);await p.screenshot({path:file,...options});report.screenshots.push(file);};
    const entry = page.locator('#fluent-read-sentence-actions').getByRole('button',{name:'句子操作',exact:true});
    await hover(true);
    const toolbar = page.locator('#fluent-read-sentence-actions').getByRole('toolbar');
    assert.equal(await entry.count(),0);assert.equal(await toolbar.count(),0);
    await page.mouse.move(1300,500);await wait(900);assert.equal(await entry.count(),0);
    report.checks.push('brief passes and pointer exit cancel the delayed entry without displaying the toolbar');
    await hover(true);
    // 重新定位真实文字，连续移动必须重置停留计时。
    for(let i=0;i<4;i++){await hover(true,i%2?1:-1);await wait(200);assert.equal(await entry.count(),0);}
    await entry.waitFor();assert.equal(await toolbar.count(),0);
    assert.equal((await entry.innerText()).includes('句子操作'),true);
    const entryPosition=await entry.boundingBox();
    await hover(true,5);assert.deepEqual(await entry.boundingBox(),entryPosition);
    const bounds=await page.locator('#primary').evaluate(el=>{
      const ranges=[];const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
      while(walker.nextNode()){const range=document.createRange();range.selectNodeContents(walker.currentNode);ranges.push(...range.getClientRects());}
      return {left:Math.min(...ranges.map(rect=>rect.left)),right:Math.max(...ranges.map(rect=>rect.right)),top:Math.min(...ranges.map(rect=>rect.top)),bottom:Math.max(...ranges.map(rect=>rect.bottom))};
    });
    assert(entryPosition.x>=bounds.right+7 || entryPosition.x+entryPosition.width<=bounds.left-7);
    await page.mouse.move(entryPosition.x+entryPosition.width/2,entryPosition.y+entryPosition.height/2,{steps:20});
    await wait(300);assert.equal(await entry.isVisible(),true);await shot(page,'sentence-entry');
    report.checks.push('labelled entry stays beside both source and translation and survives same-sentence movement and pointer transfer');
    await entry.click();
    await toolbar.waitFor(); await toolbar.getByRole('button',{name:'收藏句子',exact:true}).click();
    await toolbar.getByRole('button',{name:'已收藏',exact:true}).waitFor();
    await shot(page,'highlight-save');
    const session = await context.newCDPSession(page); const worlds=[];
    session.on('Runtime.executionContextCreated',event=>worlds.push(event.context));await session.send('Runtime.enable');
    const contentWorld=worlds.find(world=>world.origin===origin && world.auxData?.isDefault===false);assert(contentWorld,'extension isolated world exists');
    await session.send('Runtime.evaluate',{contextId:contentWorld.id,expression:`globalThis.__sentenceSpeech=[];globalThis.SpeechSynthesisUtterance=class{constructor(text){this.text=text}};Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{speak:u=>globalThis.__sentenceSpeech.push({text:u.text,language:u.lang}),cancel:()=>globalThis.__sentenceSpeech.push({stopped:true})}});`});
    const contentSpeech=async()=>JSON.parse((await session.send('Runtime.evaluate',{contextId:contentWorld.id,expression:'JSON.stringify(globalThis.__sentenceSpeech)',returnByValue:true})).result.value);
    await toolbar.getByRole('button',{name:'播放译文',exact:true}).click();
    for(let i=0;i<200;i++){if((await contentSpeech()).some(item=>item.text))break;await wait(50);}
    assert.deepEqual((await contentSpeech()).find(item=>item.text),{text:translated,language:'zh-CN'});
    await toolbar.getByRole('button',{name:'停止',exact:true}).click();assert((await contentSpeech()).some(item=>item.stopped));
    await context.grantPermissions(['clipboard-read','clipboard-write']);
    await toolbar.getByRole('button',{name:'复制译文',exact:true}).click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),translated);
    await hover(false);assert.equal(await toolbar.count(),0);await entry.waitFor();await entry.click();await toolbar.waitFor();
    await toolbar.getByRole('button',{name:'播放原文',exact:true}).click();
    for(let i=0;i<200;i++){if((await contentSpeech()).some(item=>item.text===source))break;await wait(50);}
    assert.deepEqual((await contentSpeech()).find(item=>item.text===source),{text:source,language:'en-US'});
    await toolbar.getByRole('button',{name:'停止',exact:true}).click();
    await toolbar.getByRole('button',{name:'复制原文',exact:true}).click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),source);
    report.checks.push('same-pair side switching waits again; each side plays and copies its own text with the correct speech language');
    const request = async message => options.evaluate(message=>chrome.runtime.sendMessage(message),message);
    const list = async()=>{const result=await request({type:'fluentReadVocabularyBook',action:'list'});assert(result.success);return result.data;};
    let entries=await list();assert.equal(entries.length,1);assert.equal(entries[0].term,source);assert.equal(entries[0].translations['zh-hans'].text,translated);assert.equal(entries[0].kind,'sentence');
    assert.equal((await readConfig()).vocabularyBookEnabled,true);
    assert.deepEqual(await page.locator('#primary').evaluate(el=>({html:el.innerHTML,rect:JSON.stringify(el.getBoundingClientRect())})),before);
    report.checks.push('translation-side hover saves the exact original and translation, enables saving, preserves host DOM and geometry');
    if(process.argv.includes('--toolbar-only')) {
      await toolbar.getByRole('button',{name:'播放原文',exact:true}).focus();await page.keyboard.press('Escape');await toolbar.waitFor({state:'hidden'});
      await hover(true);await page.mouse.wheel(0,120);await wait(900);assert.equal(await entry.count(),0);
      await page.evaluate(()=>window.scrollTo(0,0));await wait(100);
      await hover(true);await entry.waitFor();await entry.click();await toolbar.waitFor();await page.mouse.wheel(0,120);await toolbar.waitFor({state:'hidden'});
      await page.evaluate(()=>window.scrollTo(0,0));await wait(100);
      report.checks.push('Escape dismisses controls and scrolling cancels both pending and expanded controls');
      const pointOnText=async(selector,last=false)=>page.locator(selector).evaluate((el,last)=>{
        const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);walker.nextNode();const node=walker.currentNode;
        const range=document.createRange();range.setStart(node,last?node.textContent.length-3:0);range.setEnd(node,last?node.textContent.length:3);
        const rect=range.getClientRects()[0];return{x:rect.left+rect.width/2,y:rect.top+rect.height/2};
      },last);
      await page.locator('#heading').hover();await page.keyboard.press('Control');await page.locator('#heading > .fluent-read-bilingual-content').waitFor();
      const headingPoint=await pointOnText('#heading');await page.mouse.move(headingPoint.x,headingPoint.y);await entry.waitFor();
      const headingRects=await page.locator('#heading').evaluate(el=>{
        const rects=[];const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
        while(walker.nextNode()){const range=document.createRange();range.selectNodeContents(walker.currentNode);rects.push(...Array.from(range.getClientRects(),rect=>({left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom})));}
        return rects;
      });
      const avoidsHeading=box=>headingRects.every(rect=>box.x+box.width<=rect.left || box.x>=rect.right || box.y+box.height<=rect.top || box.y>=rect.bottom);
      const headingClip=box=>{
        const left=Math.min(box.x,...headingRects.map(rect=>rect.left))-12;const top=Math.min(box.y,...headingRects.map(rect=>rect.top))-12;
        return {x:left,y:top,width:Math.max(box.x+box.width,...headingRects.map(rect=>rect.right))-left+12,height:Math.max(box.y+box.height,...headingRects.map(rect=>rect.bottom))-top+12};
      };
      assert(avoidsHeading(await entry.boundingBox()));
      await shot(page,'sentence-heading-entry',{clip:headingClip(await entry.boundingBox())});await entry.click();await toolbar.waitFor();
      assert.equal(await toolbar.getByText('当前原句',{exact:true}).isVisible(),true);
      assert(avoidsHeading(await toolbar.boundingBox()));
      await shot(page,'sentence-heading-actions',{clip:headingClip(await toolbar.boundingBox())});
      await toolbar.getByRole('button',{name:'关闭句子操作',exact:true}).click();
      await page.locator('#wrapped').hover();await page.keyboard.press('Control');await page.locator('#wrapped > .fluent-read-bilingual-content').waitFor();
      const firstLine=await pointOnText('#wrapped');const lastLine=await pointOnText('#wrapped',true);assert(lastLine.y>firstLine.y);
      await page.mouse.move(firstLine.x,firstLine.y);await entry.waitFor();const wrappedPosition=await entry.boundingBox();
      await page.mouse.move(lastLine.x,lastLine.y);await wait(100);assert.equal(await entry.isVisible(),true);assert.deepEqual(await entry.boundingBox(),wrappedPosition);
      await entry.click();await toolbar.waitFor();await page.mouse.move(firstLine.x,firstLine.y);await wait(100);assert.equal(await toolbar.isVisible(),true);
      await shot(page,'sentence-wrapped-actions');await toolbar.getByRole('button',{name:'关闭句子操作',exact:true}).click();
      report.checks.push('screenshot heading keeps both lines unobscured; same sentence across wrapped lines retains entry position and expanded controls');
      await page.setViewportSize({width:390,height:844});await wait(100);await hover(true);await entry.waitFor();
      const compact=await entry.boundingBox();assert(compact.width>=70);assert(compact.x>=8 && compact.x+compact.width<=382);
      await shot(page,'sentence-entry-mobile');await entry.click();await toolbar.waitFor();
      const expanded=await toolbar.boundingBox();assert(expanded.x>=8 && expanded.x+expanded.width<=382);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await shot(page,'sentence-actions-mobile');
      await toolbar.getByRole('button',{name:'关闭句子操作',exact:true}).click();await toolbar.waitFor({state:'hidden'});
      await page.setViewportSize({width:1440,height:960});await wait(100);
      await hover(false);await entry.waitFor();await entry.click();await toolbar.waitFor();
      await page.locator('#primary').hover();await page.keyboard.press('Control');await page.locator('#primary > .fluent-read-bilingual-content').waitFor({state:'detached'});await toolbar.waitFor({state:'hidden'});assert.equal(await entry.count(),0);
      toggleCounts.push(await page.locator('#primary > .fluent-read-bilingual-content').count());
      await page.locator('#primary').hover();await page.keyboard.press('Control');await page.locator('#primary > .fluent-read-bilingual-content').waitFor();
      toggleCounts.push(await page.locator('#primary > .fluent-read-bilingual-content').count());assert.deepEqual(toggleCounts,[1,0,1]);
      await hover(true);await entry.waitFor();await entry.click();await toolbar.waitFor();assert.equal(await toolbar.getByRole('button',{name:'复制译文',exact:true}).isVisible(),true);
      report.translationToggleCounts=toggleCounts;
      report.checks.push('390px entry and expanded controls stay in viewport; restoring removes highlight actions');
      assert.equal(report.consoleErrors.length,0);report.requests=local.requests;report.ok=true;
      process.stdout.write(JSON.stringify(report,null,2)+'\n');
      return;
    }
    await toolbar.getByRole('button',{name:'收藏列表 ↗',exact:true}).click();
    await options.reload();await options.locator('.word-row').waitFor();
    await options.getByRole('button',{name:'句子',exact:true}).click();assert.equal(await options.locator('.word-row').count(),1);
    await options.getByLabel('更多收藏操作',{exact:true}).click();
    await options.getByRole('button',{name:'添加简短解释',exact:true}).click();
    await options.getByRole('textbox',{name:'收藏的简短解释',exact:true}).fill('deserve attention：值得关注。');
    await options.getByRole('button',{name:'保存解释',exact:true}).click();
    await options.locator('.entry-note').waitFor();
    await options.reload();await options.locator('.entry-note').waitFor();assert.equal(await options.locator('.entry-note').innerText(),'deserve attention：值得关注。');
    report.checks.push('sentence list, manual explanation and reopening persistence');
    await context.grantPermissions(['clipboard-read','clipboard-write']);
    await options.getByLabel('更多收藏操作',{exact:true}).click();
    await options.getByRole('button',{name:'复制原文',exact:true}).click();assert.equal(await options.evaluate(()=>navigator.clipboard.readText()),source);
    await options.getByRole('button',{name:'复制双语',exact:true}).click();assert.equal(await options.evaluate(()=>navigator.clipboard.readText()),`${source}\n${translated}`);
    report.checks.push('quick copy original and bilingual');
    await options.evaluate(()=>{
      window.__sentenceSpeech=[];
      class Utterance{constructor(text){this.text=text;}}
      window.SpeechSynthesisUtterance=Utterance;
      Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[],speak:u=>window.__sentenceSpeech.push({text:u.text,language:u.lang}),cancel:()=>window.__sentenceSpeech.push({stopped:true})}});
    });
    await options.getByRole('button',{name:'朗读原文',exact:true}).click();
    await options.waitForFunction(()=>window.__sentenceSpeech.some(item=>item.text));
    assert.equal((await options.evaluate(()=>window.__sentenceSpeech.find(item=>item.text))).text,source);
    await options.getByRole('button',{name:'停止朗读',exact:true}).click();
    assert((await options.evaluate(()=>window.__sentenceSpeech)).some(item=>item.stopped));
    report.checks.push('existing TTS backend failure routes to browser speech with exact original; stop releases ownership');
    await options.locator('.entry-open').click();
    await options.getByRole('button',{name:'生成简短解释',exact:true}).click();
    await options.getByRole('button',{name:'保存这段解释',exact:true}).waitFor();
    await options.getByRole('button',{name:'保存这段解释',exact:true}).click();
    await options.waitForFunction(text=>document.querySelector('.saved-note')?.textContent===text,explanation);
    assert((await options.locator('.study-workspace').innerText()).includes(explanation),'saving a note preserves the current explanation');
    await shot(options,'sentence-listening-study');
    await options.getByRole('button',{name:'‹ 返回收藏',exact:true}).click();
    report.checks.push('on-demand short explanation uses grounded sentence prompt and saves separately from translation');
    const downloadPromise=options.waitForEvent('download');await options.getByLabel('更多收藏管理',{exact:true}).click();await options.getByRole('button',{name:'导出当前列表',exact:true}).click();const download=await downloadPromise;
    const file=path.join(artifactsDir,'exported-collection.json');await download.saveAs(file);const data=JSON.parse(fs.readFileSync(file,'utf8'));
    assert.equal(data.entries[0].note,explanation);assert.equal(data.entries[0].translations['zh-hans'].text,translated);assert.equal(data.includesPrivateContext,false);assert(!data.entries[0].contexts.some(item=>item.sourceUrl));
    await request({type:'fluentReadVocabularyBook',action:'clear'});await options.reload();await options.getByRole('heading',{name:'还没有学习收藏',exact:true}).waitFor();
    await options.locator('input[type=file][aria-label="导入收藏文件"]').setInputFiles(file);await options.locator('.word-row').waitFor();
    entries=await list();assert.equal(entries.length,1);assert.equal(entries[0].note,explanation);assert.equal(entries[0].kind,'sentence');
    report.checks.push('actual downloaded JSON round trips original, translation, explanation, sentence identity and review records');
    await options.locator('input[type=file][aria-label="导入收藏文件"]').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{oops')});
    await options.getByRole('status').filter({hasText:'无法读取文件'}).waitFor();assert.equal((await list()).length,1);
    report.checks.push('malformed import preserves existing collection and gives retryable feedback');
    await options.locator('.book-toast').waitFor({state:'hidden'});
    await options.getByRole('button',{name:'句子',exact:true}).click();
    await shot(options,'saved-sentences');
    await options.setViewportSize({width:390,height:844});await options.locator('.word-row').scrollIntoViewIfNeeded();await wait(120);assert(await options.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await shot(options,'saved-sentences-mobile');
    await options.setViewportSize({width:1440,height:960});
    await page.mouse.move(1300,500);await toolbar.waitFor({state:'hidden'});
    await hover(false);await page.locator('#primary').hover();await page.keyboard.press('Control');await page.locator('#primary > .fluent-read-bilingual-content').waitFor({state:'detached'});await toolbar.waitFor({state:'hidden'});
    report.checks.push('pointer exit and restore remove sentence actions; narrow layout stays within viewport');
    if (process.argv.includes('--collection-layout')) {
      for (const input of [
        {term:'Instead of trying to remember every word you encounter, make room for the ideas that stay with you after reading, listen to the original sentence, connect its meaning with your own experience, notice how one expression works in context, and return another day to explain the whole idea in your own words without relying on a word-for-word translation.',translation:'与其试图记住阅读时遇到的每一个单词，不如把空间留给那些在读完之后依然留在心中的想法：听一遍原句，把句意与你自己的经历联系起来，留意一个有用表达在上下文中的实际用法，然后隔一天再回来，试试看能否用自己的话讲清这个想法，同时把重点放在整个句子真正表达的意思上，而不是机械地逐词对应。',kind:'sentence',note:'make room for：为……留出空间。这里强调把注意力留给值得记住的内容。'},
        {term:'make room for',translation:'为……留出空间；给……腾出位置。',kind:'expression',note:'We should make room for new ideas. 我们应该为新想法留出空间。'},
      ]) {const result=await request({type:'fluentReadVocabularyBook',action:'upsert',input:{sourceLanguage:'en',targetLanguage:'zh-hans',...input,context:{text:'Make room for useful ideas and keep the original context.',sourceUrl:local.url,pageTitle:'Reading notes'}}});assert(result.success);}
      await options.reload();await options.locator('.word-row').nth(2).waitFor();
      const rows=options.locator('.word-row');const first=rows.first();
      assert.equal(await first.locator('.entry-actions > button').count(),2);
      assert.equal(await first.getByRole('button',{name:'删除收藏',exact:true}).isVisible(),false);
      assert.equal(await first.getByRole('button',{name:'编辑解释',exact:true}).isVisible(),false);
      const more=first.getByLabel('更多收藏操作',{exact:true});await more.focus();await more.press('Enter');
      assert.equal(await first.getByRole('button',{name:'编辑解释',exact:true}).isVisible(),true);
      await more.press('Escape');assert.equal(await first.locator('.entry-more').evaluate(el=>el.open),false);
      await more.click();await first.getByRole('button',{name:'编辑解释',exact:true}).click();
      await first.getByRole('textbox',{name:'收藏的简短解释',exact:true}).waitFor();
      assert(await first.getByRole('textbox',{name:'收藏的简短解释',exact:true}).evaluate(el=>el===document.activeElement));
      await first.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await first.locator('textarea').count(),0);
      report.checks.push('rows show only content, play, copy and more; keyboard Escape closes menu and note editor mounts only on demand');
      await more.click();await first.getByRole('button',{name:'标记掌握',exact:true}).click();await first.getByText('已掌握',{exact:true}).waitFor();
      await more.click();await first.getByRole('button',{name:'重新学习',exact:true}).click();await first.getByText('学习中',{exact:true}).waitFor();
      await options.locator('.book-filter > summary').click();await options.locator('.filter-panel .el-select__wrapper').first().click();
      await options.getByRole('option',{name:'已掌握',exact:true}).click();assert.equal(await rows.count(),0);
      await options.locator('.filter-panel .el-select__wrapper').first().click();await options.getByRole('option',{name:'全部状态',exact:true}).click();await rows.nth(2).waitFor();
      await options.locator('.book-filter > summary').press('Escape');
      report.checks.push('mastery and relearn remain available in row menu; status filter changes actual list and resets');
      await more.click();await first.getByRole('button',{name:'删除收藏',exact:true}).click();await options.locator('.el-message-box').getByRole('button',{name:'删除',exact:true}).click();await options.waitForFunction(()=>document.querySelectorAll('.word-row').length===2);
      await options.getByRole('button',{name:'撤销',exact:true}).click();await rows.nth(2).waitFor();
      report.checks.push('delete from compact row menu and toast undo preserve the saved content');
      await options.getByRole('switch',{name:'学习收藏',exact:true}).click();
      await options.waitForFunction(async()=>{const r=await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});const c=typeof r.value==='string'?JSON.parse(r.value):r.value;return c.vocabularyBookEnabled===false;});
      await options.reload();await rows.nth(2).waitFor();assert.equal(await options.getByRole('switch',{name:'学习收藏',exact:true}).getAttribute('aria-checked'),'false');
      await options.getByRole('switch',{name:'学习收藏',exact:true}).click();
      await options.waitForFunction(async()=>{const r=await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});const c=typeof r.value==='string'?JSON.parse(r.value):r.value;return c.vocabularyBookEnabled===true;});
      await options.locator('.book-toast').waitFor({state:'hidden'});
      report.checks.push('compact saving switch persists on reload and disabling preserves existing collection');
      report.layout=[];
      for (const width of [1440,820,390]) {
        await options.setViewportSize({width,height:960});await options.evaluate(()=>window.scrollTo(0,0));await wait(150);
        assert(await options.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
        const geometry=await options.evaluate(()=>{const row=document.querySelector('.word-row');const translation=row.querySelector('.entry-translation');const book=document.querySelector('.vocabulary-book');const sentence=[...document.querySelectorAll('.word-row')].find(el=>el.querySelector('.entry-open').textContent.startsWith('Instead'));return{rowWidth:row.getBoundingClientRect().width,sourceWidth:row.querySelector('.entry-open').getBoundingClientRect().width,translationWidth:translation.getBoundingClientRect().width,firstContentOffset:row.getBoundingClientRect().top-book.getBoundingClientRect().top,longTranslationCharacters:sentence.querySelector('.entry-translation').textContent.length};});
        assert(geometry.translationWidth/geometry.rowWidth>.88);assert(geometry.firstContentOffset<250);assert(geometry.longTranslationCharacters>120);
        if(width===390)assert(geometry.sourceWidth/geometry.rowWidth>.88);
        report.layout.push({width,...geometry});await shot(options,`collection-layout-${width}`);
      }
      const live=await readConfig();await options.evaluate(config=>chrome.runtime.sendMessage({type:'persistConfig',mode:'replace',config:{...config,theme:'dark'},baseRevision:config.__fluentConfigRevision,clientId:`layout-${crypto.randomUUID()}`,sequence:1}),live);
      await wait(180);await shot(options,'collection-layout-dark');
      report.checks.push('1440, 820 and 390px layouts retain full sentence translation, allocate full width to content and avoid overflow; dark layout captured');
    }
    assert.equal(report.consoleErrors.length,0);report.requests=local.requests;report.ok=true;
  } catch(error){report.error=error.stack||String(error);if(page)try{report.pointerEvents=await page.evaluate(()=>globalThis.__sentencePointerEvents);report.failureUi=await page.locator('#fluent-read-sentence-actions').evaluate(el=>el.shadowRoot?.innerHTML);await page.screenshot({path:path.join(artifactsDir,'failure.png')});}catch{}throw error;}
  finally{if(launched)await launched.close();fs.rmSync(profileDir,{recursive:true,force:true});report.profileRemoved=!fs.existsSync(profileDir);await local.close();fs.writeFileSync(path.join(artifactsDir,'report.json'),JSON.stringify(report,null,2));}
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}
main().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});

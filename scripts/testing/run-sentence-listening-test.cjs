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
      const content = teaching ? explanation : translated + '练习带来进步。';
      requests.push({kind:teaching ? 'explanation' : 'translation'});
      if (body.stream) {
        response.setHeader('Content-Type', 'text/event-stream');
        for (const text of [content.slice(0, 15), content.slice(15)]) response.write(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta:{content:text},finish_reason:null}]})}\n\n`);
        response.end(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);
      } else {response.setHeader('Content-Type','application/json'); response.end(JSON.stringify({id:'fixture',object:'chat.completion',model:'fixture',choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}]}));}
      return;
    }
    response.setHeader('Content-Type','text/html');
    response.end(`<html lang="en"><head><title>Sentence listening fixture</title><style>body{margin:70px;font:21px/1.8 system-ui}p{max-width:720px}button{letter-spacing:7px!important}aside{height:1200px}</style></head><body><h1>Read and listen</h1><p id="primary">${source} Practice makes progress.</p><aside></aside></body></html>`);
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
  const report = {ok:false,extensionDir,artifactsDir,checks:[],consoleErrors:[],screenshots:[],evidenceBoundary:'Real production extension and storage; local deterministic translation/explanation; synthetic browser voice validates text and stop lifecycle, not audible voice quality or Firefox runtime.'};
  let launched; let page;
  try {
    launched = await launchFocusSafePersistentContext({chromium,profileDir,background:true,headless:false,browserPath:'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',viewport:{width:1440,height:960},timeout:30000,
      browserArgs:[`--disable-extensions-except=${extensionDir}`,`--load-extension=${extensionDir}`,'--no-first-run','--no-default-browser-check']});
    Object.assign(report,{launchMode:launched.launchMode,focusPolicy:launched.focusPolicy,windowPlacement:launched.windowPlacement});
    assert.equal(report.windowPlacement.browserFrontmost,false);
    const context = launched.context;
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker',{timeout:30000});
    const origin = /^chrome-extension:\/\/[^/]+/u.exec(worker.url())[0];
    const createPage = async url => {const p = await newPageWithoutForeground(context,30000);p.on('pageerror',e=>report.consoleErrors.push(e.message));await p.goto(url,{waitUntil:'domcontentloaded'});return p;};
    const options = await createPage(`${origin}/options.html#settings-vocabulary`);
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
    await page.locator('#fluent-read-page-styles').waitFor({state:'attached'});
    await page.locator('#fluent-read-sentence-actions').waitFor({state:'attached'});
    await activateExtensionTabWithoutForeground(context,page,30000);
    await page.locator('#primary').hover(); await page.keyboard.press('Control');
    await page.locator('#primary > .fluent-read-bilingual-content').waitFor();
    const before = await page.locator('#primary').evaluate(el=>({html:el.innerHTML,rect:JSON.stringify(el.getBoundingClientRect())}));
    const hover = async translatedSide => {
      const point = await page.evaluate(({source,translated,translatedSide})=>{
        const root=document.querySelector(translatedSide?'#primary .fluent-read-bilingual-content':'#primary');const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
        while(walker.nextNode()){const node=walker.currentNode;const index=node.textContent.indexOf(translatedSide?translated:source);if(index<0)continue;const range=document.createRange();range.setStart(node,index);range.setEnd(node,index+2);const rect=range.getClientRects()[0];return{x:rect.left+rect.width/2,y:rect.top+rect.height/2};}throw new Error('sentence missing');
      },{source,translated,translatedSide});await page.mouse.move(point.x,point.y);await wait(100);
    };
    const shot = async (p,name)=>{const file=path.join(artifactsDir,`${name}.png`);await p.screenshot({path:file});report.screenshots.push(file);};
    await hover(true);
    const toolbar = page.locator('#fluent-read-sentence-actions').getByRole('toolbar');
    await toolbar.waitFor(); await toolbar.getByRole('button',{name:'收藏句子',exact:true}).click();
    await toolbar.getByRole('button',{name:'已收藏',exact:true}).waitFor();
    await shot(page,'highlight-save');
    const session = await context.newCDPSession(page); const worlds=[];
    session.on('Runtime.executionContextCreated',event=>worlds.push(event.context));await session.send('Runtime.enable');
    const contentWorld=worlds.find(world=>world.origin===origin && world.auxData?.isDefault===false);assert(contentWorld,'extension isolated world exists');
    await session.send('Runtime.evaluate',{contextId:contentWorld.id,expression:`globalThis.__sentenceSpeech=[];globalThis.SpeechSynthesisUtterance=class{constructor(text){this.text=text}};Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{speak:u=>globalThis.__sentenceSpeech.push({text:u.text,language:u.lang}),cancel:()=>globalThis.__sentenceSpeech.push({stopped:true})}});`});
    const contentSpeech=async()=>JSON.parse((await session.send('Runtime.evaluate',{contextId:contentWorld.id,expression:'JSON.stringify(globalThis.__sentenceSpeech)',returnByValue:true})).result.value);
    await toolbar.getByRole('button',{name:'播放',exact:true}).click();
    for(let i=0;i<200;i++){if((await contentSpeech()).some(item=>item.text))break;await wait(50);}
    assert.equal((await contentSpeech()).find(item=>item.text)?.text,source);
    await toolbar.getByRole('button',{name:'停止',exact:true}).click();assert((await contentSpeech()).some(item=>item.stopped));
    report.checks.push('highlight toolbar plays original source from the translation side and stops its browser fallback');
    const request = async message => options.evaluate(message=>chrome.runtime.sendMessage(message),message);
    const list = async()=>{const result=await request({type:'fluentReadVocabularyBook',action:'list'});assert(result.success);return result.data;};
    let entries=await list();assert.equal(entries.length,1);assert.equal(entries[0].term,source);assert.equal(entries[0].translations['zh-hans'].text,translated);assert.equal(entries[0].kind,'sentence');
    assert.equal((await readConfig()).vocabularyBookEnabled,true);
    assert.deepEqual(await page.locator('#primary').evaluate(el=>({html:el.innerHTML,rect:JSON.stringify(el.getBoundingClientRect())})),before);
    report.checks.push('translation-side hover saves the exact original and translation, enables saving, preserves host DOM and geometry');
    await toolbar.getByRole('button',{name:'收藏列表 ↗',exact:true}).click();
    await options.reload();await options.locator('.word-row').waitFor();
    await options.getByRole('button',{name:'句子',exact:true}).click();assert.equal(await options.locator('.word-row').count(),1);
    await options.getByRole('button',{name:'添加简短解释',exact:true}).click();
    await options.getByRole('textbox',{name:'收藏的简短解释',exact:true}).fill('deserve attention：值得关注。');
    await options.getByRole('button',{name:'保存解释',exact:true}).click();
    await options.locator('.saved-note').waitFor();
    await options.reload();await options.locator('.saved-note').waitFor();assert.equal(await options.locator('.saved-note').innerText(),'deserve attention：值得关注。');
    report.checks.push('sentence list, manual explanation and reopening persistence');
    await context.grantPermissions(['clipboard-read','clipboard-write']);
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
    await options.getByRole('button',{name:'学习用法',exact:true}).click();
    await options.getByRole('button',{name:'生成简短解释',exact:true}).click();
    await options.getByRole('button',{name:'保存这段解释',exact:true}).waitFor();
    await options.getByRole('button',{name:'保存这段解释',exact:true}).click();
    await options.waitForFunction(text=>document.querySelector('.saved-note')?.textContent===text,explanation);
    assert((await options.locator('.study-workspace').innerText()).includes(explanation),'saving a note preserves the current explanation');
    await shot(options,'sentence-listening-study');
    await options.getByRole('button',{name:'‹ 返回收藏',exact:true}).click();
    report.checks.push('on-demand short explanation uses grounded sentence prompt and saves separately from translation');
    const downloadPromise=options.waitForEvent('download');await options.getByRole('button',{name:'导出当前列表',exact:true}).click();const download=await downloadPromise;
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
    assert.equal(report.consoleErrors.length,0);report.requests=local.requests;report.ok=true;
  } catch(error){report.error=error.stack||String(error);if(page)try{await page.screenshot({path:path.join(artifactsDir,'failure.png')});}catch{}throw error;}
  finally{fs.writeFileSync(path.join(artifactsDir,'report.json'),JSON.stringify(report,null,2));if(launched)await launched.close();fs.rmSync(profileDir,{recursive:true,force:true});await local.close();}
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}
main().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});

#!/usr/bin/env node
'use strict';
// 生产产物的再次遇见专项：隔离 Edge、焦点安全窗口、本地正文/SSE 模型夹具。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const arg = (name, fallback) => {const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1];};
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifacts = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-vocabulary-reencounter'));
const packages = arg('playwright-root'); const helperPath = arg('focus-safe-helper');
if (!packages || !helperPath) throw new Error('Provide --playwright-root and --focus-safe-helper');
const {chromium} = require(path.join(path.resolve(packages), 'playwright'));
const helper = require(path.resolve(helperPath));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const parse = value => typeof value === 'string' ? JSON.parse(value) : value || {};
async function send(page, message) {return page.evaluate(message => chrome.runtime.sendMessage(message), message);}
async function read(page) {
  const config = await send(page, {type: 'configStorageRead', key: 'local:config'});
  const credentials = await send(page, {type: 'configStorageRead', key: 'local:credentials'});
  return {...parse(config.value), ...parse(credentials.value)};
}
async function persist(page, patch) {
  const current = await read(page);
  const result = await send(page, {type: 'persistConfig', config: {...current, ...patch}, clientId: `reencounter-${process.pid}`, sequence: Date.now(), baseRevision: current.__fluentConfigRevision});
  assert.equal(result.success, true, result.error); await wait(300);
}
async function until(check, message) {for (let i = 0; i < 180; i++) {if (await check()) return; await wait(80);} throw new Error(message);}
async function main() {
  fs.mkdirSync(artifacts, {recursive: true});
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-reencounter-edge-'));
  const requests = [];
  let slow = false; let fail = false;
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body);
      if (fail) {fail = false; res.writeHead(401, {'content-type': 'application/json'}).end(JSON.stringify({error: {message: 'fixture failure'}})); return;}
      if (!body.stream) {res.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify({id:'translation-fixture', choices:[{index:0,message:{role:'assistant',content:'测试译文 bank'},finish_reason:'stop'}]}));return;}
      res.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-cache'});
      const event = payload => {if (!res.destroyed) res.write(`data: ${JSON.stringify({id: 'reencounter-fixture', choices: [{index: 0, ...payload}]})}\n\n`);};
      if (body.tools?.length && !body.messages.some(message => message.role === 'tool')) {
        event({delta: {role: 'assistant', tool_calls: [{index: 0, id: 'context', type: 'function', function: {name: 'read_context', arguments: '{}'}}]}, finish_reason: null});
        event({delta: {}, finish_reason: 'tool_calls'});
      } else {
        event({delta: {role: 'assistant', content: '### 当前原句\n'}, finish_reason: null});
        const delayed = slow;
        if (delayed) await wait(1800);
        event({delta: {content: delayed ? '迟到的旧讲解' : '这里的 bank 指河岸；原句中的 river 是依据。'}, finish_reason: null});
        event({delta: {}, finish_reason: 'stop'});
      }
      if (!res.destroyed) {res.write('data: [DONE]\n\n'); res.end();} return;
    }
    res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Saved expressions in a new reading</title><style>body{margin:0;padding:42px 7vw;background:white;color:#283042;font:20px/1.9 system-ui}main{max-width:960px}p{margin:24px 0}a{color:#506bc0}#far{margin-top:2200px}textarea{width:300px}</style></head><body><main><h1 translate="no">A new reading context</h1><p id="river">We rested on the river bank after our walk.</p><p id="phrase">We should not <em>take for</em> granted the help we receive.</p><p id="substring">The article discusses banking, bankruptcy, and banknotes.</p><p id="links"><a href="#target">bank</a> <button>bank</button></p><p hidden>bank</p><p translate="no">bank</p><pre>bank</pre><div contenteditable>bank</div><textarea>bank</textarea><p id="dynamic">A quiet afternoon.</p><div id="shadow-host"></div><div id="later-shadow"></div><p id="far">The river bank is quiet here too.</p><p id="target">The end.</p></main><script>document.getElementById('shadow-host').attachShadow({mode:'open'}).innerHTML='<p>The bank of a river is land beside it.</p>';document.getElementById('river').addEventListener('click',()=>window.hostClicks=(window.hostClicks||0)+1);</script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const report = {ok: false, cases: [], screenshots: [], consoleErrors: [], evidenceBoundary: 'Production extension and real Edge with local HTML and synthetic model responses; no live model or Firefox runtime quality claim.'};
  let session; let page;
  try {
    session = await helper.launchFocusSafePersistentContext({chromium, profileDir: profile, browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', background: true, headless: false,
      browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check'], viewport: {width: 1440, height: 1000}});
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    assert.equal(report.launchMode, 'macos-background-cdp'); assert.equal(report.windowPlacement.browserFrontmost, false);
    const context = session.context; const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const origin = worker.url().match(/^chrome-extension:\/\/[^/]+/u)[0];
    const options = await helper.newPageWithoutForeground(context);
    await options.goto(`${origin}/options.html#settings-vocabulary`); await options.locator('.vocabulary-book').waitFor();
    const before = await read(options); assert.equal(before.vocabularyReencounterEnabled, false);
    const service = 'custom:reencounter-fixture';
    await persist(options, {uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, on: true, autoTranslate: false, disableFloatingBall: true, selectionTranslatorMode: 'disabled', disableSelectionTranslator: true, vocabularyBookEnabled: true,
      customOpenAIProviders: [{id: service, name: 'Local reencounter fixture', endpoint: `${url}/v1/chat/completions`, models: ['fixture']}], token: {[service]: 'synthetic-local-not-a-secret'}, model: {[service]: 'fixture'},
      harness: {...before.harness, enabled: true, service, model: 'fixture', contextMode: 'paragraph', memoryEnabled: false}});
    const seeded = [];
    for (const [term, translation, sentence] of [['bank', 'OLD_REFERENCE_FINANCIAL_BANK', 'I visited the bank to deposit money.'], ['take for granted', 'OLD_REFERENCE_PHRASE', 'Never take your friends for granted.']]) {
      const saved = await send(options, {type: 'fluentReadVocabularyBook', action: 'upsert', input: {term, translation, sourceLanguage: 'en', targetLanguage: 'zh-CN', context: {text: sentence, pageTitle: 'Old reading', sourceUrl: 'https://saved-source.invalid/private'}}});
      assert.equal(saved.success, true); seeded.push(saved.data);
    }
    const snapshot = () => send(options, {type: 'fluentReadVocabularyBook', action: 'list'});
    const initialEntries = await snapshot();
    page = await helper.newPageWithoutForeground(context); page.on('pageerror', error => report.consoleErrors.push(error.message)); page.on('console', message => {if (message.type() === 'error' || message.type() === 'warning') (report.consoleMessages ||= []).push(message.text());});
    await page.goto(url); await page.locator('#fluent-read-page-styles').waitFor({state: 'attached'});
    const marks = () => page.evaluate(() => [...(CSS.highlights.get('fluentread-vocabulary-reencounter') || [])].map(range => range.toString()));
    const record = id => report.cases.push({id, status: 'passed'});
    const shot = async name => {const file = path.join(artifacts, `${name}.png`); (report.screenshotStates ||= []).push({name, marks: await marks(), ui: await ui.locator('.reencounter-panel').innerText().catch(()=>null), config: await read(options).then(c=>({on:c.on,marking:c.vocabularyReencounterEnabled}))}); await page.screenshot({path: file}); report.screenshots.push(file);};
    const ui = page.locator('#fluent-read-vocabulary-reencounter');
    assert.deepEqual(await marks(), []); assert.equal(await ui.count(), 0); record('default-off-with-existing-saved-entries');
    await page.evaluate(() => {window.nativeText=document.querySelector('#river').firstChild;window.markup=document.querySelector('main').innerHTML;window.originalBoxes=['river','phrase'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});});
    await options.locator('.vocabulary-reencounter-control').click();
    await until(async () => (await marks()).includes('bank'), 'No saved-expression marking after enabling');
    assert((await marks()).includes('take for')); assert((await marks()).includes(' granted'));
    assert.equal(requests.length, 0); assert(await page.evaluate(()=>window.nativeText===document.querySelector('#river').firstChild && window.markup===document.querySelector('main').innerHTML));
    assert(await page.evaluate(()=>JSON.stringify(window.originalBoxes)===JSON.stringify(['river','phrase'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}))));
    const exclusions = await page.evaluate(() => [...CSS.highlights.get('fluentread-vocabulary-reencounter')].every(range => !range.startContainer.parentElement.closest('#substring,#links,pre,textarea,[contenteditable],[hidden],[translate="no"],#far')));
    assert(exclusions); record('inline-matching-protected-content-original-text-and-geometry');
    const clickText = async (selector, text) => {
      const point = await page.evaluate(({selector, text}) => {const root=document.querySelector(selector);const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const node=walker.currentNode;const start=node.data.indexOf(text);if(start<0)continue;const range=document.createRange();range.setStart(node,start);range.setEnd(node,start+text.length);const rect=range.getBoundingClientRect();return {x:rect.left+rect.width/2,y:rect.top+rect.height/2};}throw new Error('No expression');},{selector,text});
      await page.mouse.click(point.x, point.y);
    };
    await clickText('#river','bank'); await ui.locator('.reencounter-panel').waitFor();
    await until(async()=>await ui.locator('blockquote').count()===2,'No original-sentence comparison');
    assert.equal(await ui.locator('blockquote').first().innerText(),'We rested on the river bank after our walk.');
    assert.equal(await ui.locator('blockquote').nth(1).innerText(),'I visited the bank to deposit money.');
    assert.equal(await page.evaluate(()=>window.hostClicks),1); assert.equal(requests.length,0); record('click-current-and-saved-sentence-without-model-or-host-event-interference');
    await shot('new-and-saved-sentences');
    await page.keyboard.press('Escape'); assert.equal(await ui.locator('.reencounter-panel').count(),0);
    await ui.locator('.reencounter-entry').focus(); await page.keyboard.press('Enter'); await ui.locator('.reencounter-panel').waitFor();
    assert.equal(requests.length,0); record('keyboard-entry-and-escape-without-model-request');
    const configuredHarness=(await read(options)).harness;
    await persist(options,{harness:{...configuredHarness,contextMode:'selection'}});
    assert.equal(await ui.getByRole('button',{name:'理解当前用法',exact:true}).count(),0);
    assert.equal(await ui.getByRole('button',{name:'设置 AI 与原句范围',exact:true}).count(),1);
    assert.equal(requests.length,0); await persist(options,{harness:configuredHarness}); record('unapproved-sentence-context-disables-explanation');
    await ui.getByRole('button',{name:'理解当前用法',exact:true}).click();
    await until(async()=> (await ui.locator('.reencounter-panel').innerText()).includes('指河岸'),'No contextual explanation');
    assert(JSON.stringify(requests).includes('We rested on the river bank after our walk.'));
    assert(!JSON.stringify(requests).includes('OLD_REFERENCE') && !JSON.stringify(requests).includes('deposit money') && !JSON.stringify(requests).includes('saved-source.invalid'));
    assert.deepEqual((await snapshot()).data,initialEntries.data); record('explicit-current-context-only-and-unchanged-review-data');
    await shot('current-context-explanation');
    await persist(options,{theme:'dark'}); await shot('comparison-dark');
    await page.setViewportSize({width:390,height:844}); await shot('comparison-mobile');
    assert(await ui.locator('.reencounter-panel').evaluate(element=>{const box=element.getBoundingClientRect();return box.left>=0 && box.right<=innerWidth && box.top>=0 && box.bottom<=innerHeight;}));
    await page.setViewportSize({width:1440,height:1000}); await persist(options,{theme:'light'}); record('dark-and-mobile-clamped-layout');
    slow=true; const previous=requests.length; await ui.getByRole('button',{name:'重新讲解当前用法',exact:true}).click(); await until(()=>requests.length>previous,'No delayed request');
    await ui.getByRole('button',{name:'关闭对照卡片',exact:true}).click(); slow=false; await wait(2000); assert.equal(await ui.locator('.reencounter-panel').count(),0); record('close-cancels-delayed-stream-without-resurrection');
    await clickText('#river','bank'); await ui.locator('.reencounter-panel').waitFor();
    fail=true; await ui.getByRole('button',{name:'理解当前用法',exact:true}).click(); await ui.locator('.error').waitFor();
    await ui.locator('.error').getByRole('button',{name:'重试',exact:true}).click(); await until(async()=>(await ui.locator('.reencounter-panel').innerText()).includes('指河岸'),'Retry did not recover'); record('model-failure-and-explicit-retry');
    await ui.getByRole('button',{name:'关闭对照卡片',exact:true}).click();
    await persist(options,{service,from:'en',to:'zh-CN',display:1,style:1});
    const pageMessage=action=>worker.evaluate(async({url,action})=>{const tab=(await chrome.tabs.query({})).find(tab=>tab.url===url+'/');return chrome.tabs.sendMessage(tab.id,{type:'contextMenuTranslate',action});},{url,action});
    for(let cycle=0;cycle<2;cycle++) {
      assert.equal((await pageMessage('fullPage')).status,'success');
      await page.locator('.fluent-read-bilingual-content').first().waitFor(); await wait(500);
      assert(await page.evaluate(()=>[...(CSS.highlights.get('fluentread-vocabulary-reencounter')||[])].every(range=>!range.startContainer.parentElement.closest('.fluent-read-bilingual-content,[data-fr-owned],[data-fr-translation]'))));
      assert.equal((await pageMessage('restore')).status,'success');
      await until(async()=>await page.locator('.fluent-read-bilingual-content').count()===0,'Restore left a translation');
      await until(async()=>(await marks()).includes('bank'),'Restore lost expression marks');
      assert(await page.evaluate(()=>document.querySelector('#river').textContent==='We rested on the river bank after our walk.'));
    }
    assert.deepEqual((await snapshot()).data,initialEntries.data); record('translate-restore-retranslate-excludes-translations-and-preserves-review-data');
    await clickText('#river','bank'); await ui.locator('.reencounter-panel').waitFor();
    await page.evaluate(()=>document.querySelector('#river').textContent='The old paragraph is gone.');
    await until(async()=>await ui.locator('.reencounter-panel').count()===0,'Changed source left a stale card');
    await page.evaluate(()=>document.querySelector('#dynamic').textContent='A new river bank appeared in this paragraph.');
    await until(async()=>await page.evaluate(()=>[...CSS.highlights.get('fluentread-vocabulary-reencounter')].some(range=>range.startContainer.parentElement.id==='dynamic')),'Dynamic text not marked');
    await page.evaluate(()=>document.getElementById('later-shadow').attachShadow({mode:'open'}).innerHTML='<p>Another river bank.</p>');
    await until(async()=>await page.evaluate(()=>[...CSS.highlights.get('fluentread-vocabulary-reencounter')].some(range=>range.startContainer.getRootNode()===document.getElementById('later-shadow').shadowRoot)),'Late open shadow root not marked'); record('dynamic-text-stale-card-and-late-shadow-root');
    await page.locator('#far').scrollIntoViewIfNeeded();
    await until(async()=>await page.evaluate(()=>[...CSS.highlights.get('fluentread-vocabulary-reencounter')].some(range=>range.startContainer.parentElement.id==='far')),'Scroll did not discover a later expression'); record('scroll-discovers-later-reading');
    await page.evaluate(()=>window.scrollTo(0,0)); await wait(300);
    await ui.locator('.reencounter-entry').click(); await ui.locator('.reencounter-panel').waitFor();
    await ui.getByText('标记选项',{exact:true}).click(); await ui.getByRole('button',{name:'本次页面暂停',exact:true}).click();
    assert.deepEqual(await marks(),[]); assert.equal(await ui.locator('.reencounter-entry').count(),0); assert.equal((await read(options)).vocabularyReencounterEnabled,true); record('visit-pause-keeps-global-preference');
    await page.reload(); await until(async()=>(await marks()).length>0,'Reload did not restore visit-paused feature');
    await send(options,{type:'fluentReadVocabularyBook',action:'remove',entryId:seeded[0].id});
    await until(async()=>(await marks()).every(term=>term!=='bank'),'Deleted entry still marked'); record('cross-page-delete-removes-all-corresponding-marks');
    await persist(options,{on:false}); await until(async()=>await ui.count()===0,'Global disable left UI'); assert.deepEqual(await marks(),[]);
    await persist(options,{on:true}); await until(async()=>(await marks()).length>0,'Global resume failed');
    await persist(options,{disabledExtensionDomains:['127.0.0.1']}); await until(async()=>await ui.count()===0,'Site disable left UI'); assert.deepEqual(await marks(),[]);
    await persist(options,{disabledExtensionDomains:[]}); await until(async()=>(await marks()).length>0,'Site resume failed'); record('master-toggle-and-site-disable-clear-and-restore');
    await ui.locator('.reencounter-entry').click(); await ui.getByText('标记选项',{exact:true}).click(); await ui.getByRole('button',{name:'关闭所有网页标记',exact:true}).click();
    await until(async()=>(await read(options)).vocabularyReencounterEnabled===false,'Permanent disable not saved'); await until(async()=>await ui.count()===0,'Permanent disable left UI'); assert.deepEqual(await marks(),[]);
    await page.reload(); await wait(400); assert.deepEqual(await marks(),[]); assert.equal(await ui.count(),0); record('permanent-disable-persists-across-reload');
    assert.equal(report.consoleErrors.length,0); report.ok=true;
  } catch(error) {report.error=error.stack; if(page){report.uiDiagnostics=await page.evaluate(()=>{const host=document.getElementById('fluent-read-vocabulary-reencounter');const panel=host?.shadowRoot?.querySelector('.reencounter-ui');return {host:host?.outerHTML,content:panel?.outerHTML,roots:host?.shadowRoot?.innerHTML.slice(-5000),paint:[...(CSS.highlights.get('fluentread-vocabulary-reencounter')||[])].map(r=>r.toString())};}).catch(()=>null);await page.screenshot({path:path.join(artifacts,'failure.png')}).catch(()=>{});}throw error;}
  finally {fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify(report,null,2));if(session)await session.context.close().catch(()=>{});await new Promise(resolve=>server.close(resolve));fs.rmSync(profile,{recursive:true,force:true});}
  console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});

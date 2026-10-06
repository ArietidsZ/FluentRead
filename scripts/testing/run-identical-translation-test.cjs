/**
 * 相同译文生产浏览器专项：本地确定性网页、悬浮/全文真实手势、动态段落、划词卡片、翻译中心和文档校订。
 * 使用临时 Edge profile 和 focus-safe helper；页面/供应商均为夹具，不代表在线供应商质量或 Firefox 实机行为。
 */
'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const support = require('../run-selection-trigger-test.cjs');
const arg = name => process.argv[process.argv.indexOf(`--${name}`) + 1];
for (const name of ['extension-dir', 'playwright-root', 'focus-safe-helper', 'artifacts-dir']) assert(process.argv.includes(`--${name}`), name);
const extensionDir = path.resolve(arg('extension-dir')), artifacts = path.resolve(arg('artifacts-dir'));
const {chromium} = require(path.join(arg('playwright-root'), 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground, activateExtensionTabWithoutForeground} = require(arg('focus-safe-helper'));
const {assertFreshProductionExtension} = require('../run-site-translation-test.cjs');
fs.mkdirSync(artifacts, {recursive: true});
const profileDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'fluentread-identical-'));
const identity = fs.lstatSync(profileDir);
const report = {scope: 'same-text suppression, Unicode/whitespace equivalence, mixed-page restore and repeat, selection source fallback, comparison results', cases: [], errors: [], screenshots: [], profileMode: 'automatically-created-temporary-profile'};
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Amber Meadow</title></head><body style="font:20px/1.8 system-ui;padding:50px;max-width:900px">
<main><p id="same">Amber Meadow</p><p id="unicode">Café</p>
<p id="rich">Amber <code>protected_code()</code> Meadow</p><p id="changed">This paragraph has changes in translation.</p></main></body></html>`;
const server = http.createServer((_req, res) => {res.writeHead(200, {'content-type':'text/html; charset=utf-8'});res.end(html);});
let launched, page, popup, worker, launchAttempted = false;
const wait = async (check, label) => {const until = Date.now()+15000; while(Date.now()<until){if(await check())return;await page.waitForTimeout(70);}throw new Error(label);};
const count = selector => page.locator(selector+' .fluent-read-bilingual-content').count();
async function gesture(selector){const box=await page.locator(selector).boundingBox();await page.mouse.move(box.x+20,box.y+12);await page.mouse.click(box.x+20,box.y+12);await page.keyboard.down('Control');await page.keyboard.up('Control');}
async function shot(name){const file=path.join(artifacts,name+'.png');await page.screenshot({path:file});report.screenshots.push(file);}
async function selectionUi(fn){const tree=await support.getSelectionUiTree(page);const card=support.findCdpNode(tree.root,node=>(support.cdpAttribute(node,'class')||'').split(' ').includes('fr-translation-tooltip'));if(!card)return null;const {object}=await tree.session.send('DOM.resolveNode',{nodeId:card.nodeId});try{const result=await tree.session.send('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:fn.toString(),returnByValue:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.text);return result.result.value;}finally{await tree.session.send('Runtime.releaseObject',{objectId:object.objectId});}}
(async()=>{
 report.buildFreshness=assertFreshProductionExtension(extensionDir);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 launchAttempted=true;
 launched=await launchFocusSafePersistentContext({chromium,profileDir,browserPath:'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',headless:false,background:true,viewport:{width:1280,height:900},browserArgs:[`--disable-extensions-except=${extensionDir}`,`--load-extension=${extensionDir}`,'--no-first-run','--no-default-browser-check']});
 Object.assign(report,{launchMode:launched.launchMode,focusPolicy:launched.focusPolicy,windowPlacement:launched.windowPlacement});
 assert.equal(report.launchMode,'macos-background-cdp');assert.equal(report.focusPolicy,'launchservices-no-foreground');assert.equal(report.windowPlacement.browserFrontmost,false);
 const context=launched.context;
 worker=context.serviceWorkers().find(w=>w.url().startsWith('chrome-extension://'))||await context.waitForEvent('serviceworker');
 const origin=`chrome-extension://${new URL(worker.url()).host}`;
 popup=await newPageWithoutForeground(context);await popup.goto(origin+'/popup.html');
 await support.patchStoredConfig(popup,{on:true,service:'google',from:'en',to:'zh-Hans',display:1,hotkey:'Control',disableFloatingBall:true,disableSelectionTranslator:true,uiLanguage:'zh-CN',uiLanguageSetupCompleted:true,useCache:true});
  await worker.evaluate(() => {
    const original = globalThis.fetch.bind(globalThis);
    globalThis.__identicalFixture = {origins: [], requests: []};
    globalThis.fetch = async (input, options) => {
      const url = String(typeof input === 'string' ? input : input.url || input);
      const translateFixture = (origin, source, target) => {
        globalThis.__identicalFixture.origins.push(origin);
        globalThis.__identicalFixture.requests.push({origin, source, target});
        return origin.split(/(___FLUENTREAD_[A-Za-z0-9]+_\d+_(?:BEGIN|END)___)/)
          .map(part => part.startsWith('___FLUENTREAD_') || !part.trim() ? part : part.includes('changes in translation') ? '这是一段有变化的译文。' : part.normalize('NFD')).join('');
      };
      if (url.includes('/v1/translateHtml')) {
        const [texts, source, target] = JSON.parse(options.body)[0];
        const translated = texts.map(text => `<pre>${translateFixture(text.replace(/^<pre>|<\/pre>$/g, ''), source, target)}</pre>`);
        await new Promise(resolve => setTimeout(resolve, 60));
        return new Response(JSON.stringify([translated]), {status: 200});
      }
      if (url.includes('/translate_a/t')) {
        const parsed = new URL(url), body = new URLSearchParams(options.body);
        const translated = body.getAll('q').map(text => translateFixture(text, parsed.searchParams.get('sl'), parsed.searchParams.get('tl')));
        await new Promise(resolve => setTimeout(resolve, 60));
        return new Response(JSON.stringify(translated), {status: 200});
      }
      if (url.includes('/_/TranslateWebserverUi/data/batchexecute')) {
        const records = JSON.parse(new URLSearchParams(options.body).get('f.req'))[0].map(rpc => {
          const [origin, source, target] = JSON.parse(rpc[1])[0];
          const entry = [null, null, null, null, null, [[translateFixture(origin, source, target)]]];
          return ['wrb.fr', 'MkEWBc', JSON.stringify([null, [[entry]]]), null, null, null, rpc[3]];
        });
        await new Promise(resolve => setTimeout(resolve, 60));
        return new Response(JSON.stringify(records), {status: 200});
      }
      return original(input, options);
    };
  });
 page=await newPageWithoutForeground(context);page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.locator('#fluent-read-page-styles').waitFor({state:'attached'});await activateExtensionTabWithoutForeground(context,page);
 const original=await page.locator('main').innerHTML();
 for(const selector of ['#same','#unicode','#rich']){await gesture(selector);await page.waitForTimeout(900);assert.equal(await count(selector),0);assert.equal(await page.locator(selector+' .fluent-read-loading, '+selector+' .fluent-read-retry-wrapper').count(),0);}
 assert.equal(await page.locator('main').innerHTML(),original);assert.equal(await page.title(),'Amber Meadow');report.cases.push('hover identical, NFC-equivalent and protected-inline results create no translation or placeholder');
 const toggles=[];for(let i=0;i<3;i++){await gesture('#changed');await wait(async()=>await count('#changed')===(i===1?0:1),'normal hover toggle');toggles.push(await count('#changed'));}assert.deepEqual(toggles,[1,0,1]);report.cases.push('changed hover [1,0,1]');
 await gesture('#changed');
 await page.keyboard.press('Alt+T');await wait(async()=>await count('#changed')===1,'full-page changed result');await page.waitForTimeout(900);
 for(const selector of ['#same','#unicode','#rich'])assert.equal(await count(selector),0);
 assert.equal(await page.locator('.fluent-read-loading').count(),0);await shot('01-mixed-page');
 await page.keyboard.press('Alt+T');await wait(async()=>await count('#changed')===0,'full-page restore');assert.equal(await page.locator('main').innerHTML(),original);
 await page.keyboard.press('Alt+T');await wait(async()=>await count('#changed')===1,'full-page repeat');for(const selector of ['#same','#unicode','#rich'])assert.equal(await count(selector),0);
 await page.keyboard.press('Alt+T');await wait(async()=>await count('#changed')===0,'second restore');report.cases.push('mixed full-page translate/restore/repeat keeps identical paragraphs untouched');
 await page.keyboard.press('Alt+T');await wait(async()=>await count('#changed')===1,'dynamic session start');
 await page.evaluate(()=>document.querySelector('#same').textContent='This paragraph has changes in translation.');await wait(async()=>await count('#same')===1,'dynamic changed paragraph');
 await page.keyboard.press('Alt+T');await wait(async()=>await count('#same')===0,'dynamic restore');await page.evaluate(()=>document.querySelector('#same').textContent='Amber Meadow');report.cases.push('previously unchanged paragraph translates after a live source edit and restores correctly');
 for(const mode of ['bilingual','translation-only']){
  await support.patchStoredConfig(popup,{disableSelectionTranslator:false,selectionTranslatorTrigger:'direct',selectionTranslatorMode:mode,selectionTranslatorDelay:0,selectionTranslatorAutoDismiss:false});
  await page.reload();await page.locator('#fluent-read-selection-translator-container').waitFor({state:'attached'});await activateExtensionTabWithoutForeground(context,page);
  const points=await page.evaluate(()=>{const text=document.querySelector('#same').firstChild,range=document.createRange();range.setStart(text,0);range.setEnd(text,1);const first=range.getBoundingClientRect();range.setStart(text,text.length-1);range.setEnd(text,text.length);const last=range.getBoundingClientRect();return {x:first.left,y:first.top+first.height/2,x2:last.right+2,y2:last.top+last.height/2};});
  await page.mouse.move(points.x,points.y);await page.mouse.down();await page.mouse.move(points.x2,points.y2,{steps:12});await page.mouse.up();
  await wait(async()=>await selectionUi(function(){return !this.querySelector('.fr-loading-state')&&this.querySelector('.fr-original-text pre')?.textContent.includes('Amber Meadow');}),'same selection source fallback');
  const result=await selectionUi(function(){return {source:this.querySelectorAll('.fr-original-text').length,translated:this.querySelectorAll('.fr-translation-result,.fr-word-translation').length,errors:this.querySelectorAll('.fr-error-state').length};});
  assert.deepEqual(result,{source:1,translated:0,errors:0});await shot('02-selection-'+mode);report.cases.push('selection '+mode+' keeps source once and hides equal result');
 }
 page=await newPageWithoutForeground(context);page.on('pageerror',error=>report.errors.push(error.message));await page.goto(origin+'/options.html#settings-translation-center');await page.locator('.translation-center').waitFor();
 await support.patchStoredConfig(page,{translationCenterServices:['google'],translationCenterSourceLanguage:'en',translationCenterTargetLanguage:'zh-Hans'});await page.reload();await page.locator('.translation-center textarea').fill('Amber Meadow');
 await page.getByRole('button',{name:'开始翻译',exact:false}).click();await page.locator('.translation-result-card[data-status="success"]').waitFor();
 assert.equal(await page.locator('.translation-result-content p').count(),0);assert.equal(await page.locator('.copy-all-button').isDisabled(),true);await shot('03-center-same');report.cases.push('comparison keeps success state without duplicate result or copy action');
 page=await newPageWithoutForeground(context);page.on('pageerror',error=>report.errors.push(error.message));await page.goto(origin+'/document.html');
 await page.locator('input[type="file"]').setInputFiles({name:'same.txt',mimeType:'text/plain',buffer:Buffer.from('Amber Meadow')});
 await page.getByRole('button',{name:'开始翻译',exact:true}).click();await page.getByRole('button',{name:'重新翻译',exact:true}).waitFor();
 await page.getByRole('group',{name:'阅读方式'}).getByRole('button',{name:'双语',exact:true}).click();
 const frame=page.frameLocator('.rich-preview-frame');await frame.locator('.reader-source').waitFor();assert.equal(await frame.locator('.reader-translation').count(),0);assert.equal((await frame.locator('body').innerText()).trim(),'Amber Meadow');
 await page.getByRole('group',{name:'文档工作区'}).getByRole('button',{name:'校订译文',exact:true}).click();
 const editor=page.locator('.segment-editor');assert.equal(await editor.locator('textarea').count(),0);await editor.locator('.segment-edit-row button').click();await editor.locator('textarea').fill('中文已修改');
 await page.getByRole('group',{name:'文档工作区'}).getByRole('button',{name:'阅读',exact:true}).click();await frame.locator('.reader-translation').waitFor();assert.equal(await frame.locator('.reader-translation').innerText(),'中文已修改');
 await shot('04-document-review');report.cases.push('same document preview shows source once; folded review can reopen and edit normally');
 assert.deepEqual(report.errors,[]);report.requests=await worker.evaluate(()=>globalThis.__identicalFixture.requests.length);report.success=true;
})().catch(async error=>{report.success=false;report.failure=error.stack;process.exitCode=1;if(page)await shot('failure').catch(()=>{});}).finally(async()=>{
 let closed=!launchAttempted;try{if(launched){await launched.close();closed=true;}}catch(error){report.cleanupError=error.message;process.exitCode=1;}
 if(server.listening)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
 if(closed){const stat=fs.lstatSync(profileDir);assert(!stat.isSymbolicLink()&&stat.ino===identity.ino&&stat.dev===identity.dev);fs.rmSync(profileDir,{recursive:true});report.profileRemoved=true;}else report.retainedProfile=profileDir;
 fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
});

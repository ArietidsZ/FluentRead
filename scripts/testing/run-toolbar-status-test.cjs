// 真实生产扩展的工具栏状态回归；只使用临时 profile 与确定性供应商响应。
const argument=(name,fallback)=>{const i=process.argv.indexOf('--'+name);return i<0?fallback:process.argv[i+1]};
const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const {execFileSync}=require('child_process');
const {chromium}=require(path.join(argument('playwright-root','/Users/thinkstu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'playwright'));
const helper=require(argument('focus-safe-helper','/Users/thinkstu/.codex/skills/fluentread-extension-ui-test/scripts/focus-safe-browser.cjs'));
const out=path.resolve(argument('artifacts-dir','/private/tmp/fluentread-toolbar-status')),ext=path.resolve(argument('extension-dir','.output/chrome-mv3'));fs.mkdirSync(out,{recursive:true});
const windowQuery=argument('window-query',null);
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'fluentread-pr523-'));
const id=crypto.createHash('sha256').update(ext).digest('hex').slice(0,32).replace(/[0-9a-f]/g,x=>String.fromCharCode(97+parseInt(x,16)));
fs.mkdirSync(path.join(profile,'Default'));
fs.writeFileSync(path.join(profile,'Default','Preferences'),JSON.stringify({translate:{enabled:false},extensions:{toolbar:[id],pinned_extensions:[id]},browser:{has_seen_welcome_page:true}}));
const report={profile,expectedId:id,scope:'Production extension; local page fixture and deterministic provider responses',cases:[],errors:[]};
let session;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 try{
 session=await helper.launchFocusSafePersistentContext({chromium,profileDir:profile,browserPath:'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',background:true,headless:false,viewport:{width:1120,height:780},displayTarget:'secondary',timeout:30000,browserArgs:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-features=msEdgeTranslate,msEdgeUpdateNotifications']});
 Object.assign(report,{launchMode:session.launchMode,focusPolicy:session.focusPolicy,windowPlacement:session.windowPlacement});
 const context=session.context;
 let worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 report.browser=await context.browser().version();report.actualId=new URL(worker.url()).host;
 await worker.evaluate(()=>{globalThis.reviewMode='success';globalThis.reviewRequests=0;globalThis.reviewPending=[];const originalFetch=globalThis.fetch.bind(globalThis);globalThis.fetch=async(input,init)=>{const url=new URL(typeof input==='string'||input instanceof URL?String(input):input.url,globalThis.location.href);if(url.protocol==='chrome-extension:')return originalFetch(input,init);globalThis.reviewRequests++;if(globalThis.reviewMode==='pending')await new Promise(r=>globalThis.reviewPending.push(r));if(globalThis.reviewMode==='failure')return new Response('Review simulated service failure',{status:503});const origins=JSON.parse(init?.body??await input.text());return new Response(JSON.stringify(origins.map(()=>({translations:[{text:'这是一段中文译文，用于验证工具栏翻译状态。'}]}))),{status:200,headers:{'content-type':'application/json'}});};});
 const popup=await helper.newPageWithoutForeground(context);await popup.goto(`chrome-extension://${report.actualId}/popup.html`);await sleep(800);
 let sequence=0;
 async function patch(updates){const r=await popup.evaluate(async({updates,sequence})=>{const r=await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});const c=typeof r.value==='string'?JSON.parse(r.value):r.value;return chrome.runtime.sendMessage({type:'persistConfig',mode:'patch',config:updates,expected:Object.fromEntries(Object.keys(updates).map(k=>[k,c[k]])),clientId:'pr523-review',sequence,baseRevision:c.__fluentConfigRevision});},{updates,sequence:++sequence});assert.equal(r.success,true);await sleep(400);}
 await patch({service:'microsoft',to:'zh-Hans',on:true,useCache:false,display:1,translationScope:'content',fullPageTranslationMode:'viewport',enableAIContext:false,enableAIMultiSegment:false,uiLanguage:'zh-CN',uiLanguageSetupCompleted:true});
 const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><title>FluentRead PR 523 — Badge review</title><style>body{font:22px/1.7 system-ui;background:#f6f8fc;color:#182338;margin:0;padding:60px}article{max-width:850px;margin:auto;padding:36px;background:white;border-radius:16px}h1{font-size:32px}p{margin:28px 0}</style></head><body><article><h1>Reading across languages</h1><p>Reading in another language opens a window into new ideas and perspectives.</p><p>A translation should help readers understand the original text while keeping the page comfortable to use.</p></article></body></html>';
 await context.route('https://badge-review.example/**',r=>r.fulfill({status:200,contentType:'text/html',body:html}));
 const page=await helper.newPageWithoutForeground(context);await page.goto('https://badge-review.example/article');await page.waitForSelector('#fluent-read-page-styles',{state:'attached'});await helper.activateExtensionTabWithoutForeground(context,page);
 const tabId=await worker.evaluate(async()=>{const ts=await chrome.tabs.query({});return ts.find(t=>t.url==='https://badge-review.example/article').id});
 async function snap(name){await sleep(700);const badge=await worker.evaluate(async(tabId)=>({text:await chrome.action.getBadgeText({tabId}),background:await chrome.action.getBadgeBackgroundColor({tabId}),foreground:typeof chrome.action.getBadgeTextColor==='function'?await chrome.action.getBadgeTextColor({tabId}):null,state:await chrome.tabs.sendMessage(tabId,{type:'getFullPageTranslationState'}),requests:globalThis.reviewRequests}),tabId);const dom=await page.evaluate(()=>({translated:document.querySelectorAll('.fluent-read-bilingual-content').length,loading:document.querySelectorAll('.fluent-read-loading').length,failures:document.querySelectorAll('.fluent-read-failure').length}));report.cases.push({name,...badge,...dom});await page.screenshot({path:path.join(out,name+'-page.png')});
 if(windowQuery)try{const windows=JSON.parse(execFileSync(windowQuery,[],{encoding:'utf8'}));if(windows.length!==1)throw Error('Expected one matching isolated window, found '+windows.length);execFileSync('/usr/sbin/screencapture',['-x','-o','-l',String(windows[0].kCGWindowNumber),path.join(out,name+'-window.png')]);}catch(e){report.errors.push('native screenshot: '+e.message)}
 fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report.cases.at(-1)));return report.cases.at(-1);}
 report.messageTypes='contextMenuTranslate fullPage/restore';
 async function action(action){await helper.activateExtensionTabWithoutForeground(context,page);return worker.evaluate(({tabId,action})=>chrome.tabs.sendMessage(tabId,{type:'contextMenuTranslate',action}),{tabId,action})}
 assert.equal((await snap('01-original')).text,'');
 await worker.evaluate(()=>globalThis.reviewMode='pending');await action('fullPage');await sleep(700);const pending=await snap('02-pending');assert.equal(pending.translated,0);assert.equal(pending.state.toolbarStatus,'translating');
 await worker.evaluate(()=>{globalThis.reviewMode='success';globalThis.reviewPending.splice(0).forEach(r=>r())});await page.waitForSelector('.fluent-read-bilingual-content');assert.equal((await snap('03-translated')).state.toolbarStatus,'translated');
 await action('restore');assert.equal((await snap('04-restored')).text,'');
 await worker.evaluate(()=>globalThis.reviewMode='failure');await action('fullPage');await sleep(9000);const failed=await snap('05-service-failure');assert.equal(failed.translated,0);assert.equal(failed.state.toolbarStatus,'error');
 await worker.evaluate(()=>globalThis.reviewMode='pending');while(await page.getByText('重试',{exact:true}).count())await page.getByText('重试',{exact:true}).first().click();
 const retry=await snap('05b-retrying');assert.equal(retry.state.toolbarStatus,'translating');
 await worker.evaluate(()=>{globalThis.reviewMode='success';globalThis.reviewPending.splice(0).forEach(r=>r())});await page.waitForFunction(()=>document.querySelectorAll('.fluent-read-bilingual-content').length===3);assert.equal((await snap('05c-retry-success')).state.toolbarStatus,'translated');
 await action('restore');await worker.evaluate(()=>globalThis.reviewMode='success');await action('fullPage');await page.waitForSelector('.fluent-read-bilingual-content');
 const second=await helper.newPageWithoutForeground(context);await second.goto('https://badge-review.example/second');await second.waitForSelector('#fluent-read-page-styles',{state:'attached'});await helper.activateExtensionTabWithoutForeground(context,second);await sleep(500);const other=await worker.evaluate(async()=>{const t=(await chrome.tabs.query({})).find(t=>t.url==='https://badge-review.example/second');return {id:t.id,text:await chrome.action.getBadgeText({tabId:t.id})}});assert.equal(other.text,'');report.tabIsolation=other;
 await helper.activateExtensionTabWithoutForeground(context,page);assert.equal((await snap('06-return-to-translated-tab')).state.toolbarStatus,'translated');
 report.workerRestart={verified:false,scope:'activation recovery covered; forced worker restart not exercised by this suite'};
 await page.reload();await page.waitForSelector('#fluent-read-page-styles',{state:'attached'});assert.equal((await snap('07-reloaded')).text,'');
 report.completed=true;
 }finally{fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));if(session)await session.close();}
}
main().catch(e=>{report.fatal=e.stack;fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));console.error(e);process.exitCode=1});

#!/usr/bin/env node
/**
 * @file scripts/testing/run-service-library-ui-test.cjs
 * 在隔离后台 Edge 中验证翻译服务目录、星标持久化、配置与默认服务的边界及响应式布局。
 * 仅在本次临时 profile 写入示例配置，不请求真实翻译服务，不接触用户的浏览器或凭据。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => {if(v.startsWith('--'))a.push([v.slice(2),all[i+1]]);return a;}, []));
for(const field of ['extension-dir','playwright-root','focus-safe-helper','artifacts-dir']) assert(args[field], `Missing --${field}`);
const {chromium} = createRequire(path.join(args['playwright-root'], 'service-library.cjs'))('playwright');
const helper = require(args['focus-safe-helper']);
const extensionDir=path.resolve(args['extension-dir']), artifacts=path.resolve(args['artifacts-dir']);
const browserPath=args['browser-path'] || '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
fs.mkdirSync(artifacts,{recursive:true});
const profileDir=fs.mkdtempSync(path.join(os.tmpdir(),'fluentread-service-library-'));
const report={ok:false, evidence:'production-extension-ui-with-fixture-config',browserPath,cases:[],screenshots:[],consoleErrors:[],persistenceCases:[],quickClose:false,latestWriteWins:false,crossPageSync:false};
let session, page;
const save=()=>fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify(report,null,2));
(async()=>{
 try {
  session=await helper.launchFocusSafePersistentContext({chromium,profileDir,browserPath,headless:false,background:true,displayTarget:'secondary',viewport:{width:1440,height:1000},timeout:30000,browserArgs:[`--disable-extensions-except=${extensionDir}`,`--load-extension=${extensionDir}`,'--no-first-run','--no-default-browser-check']});
  Object.assign(report,{launchMode:session.launchMode,focusPolicy:session.focusPolicy,windowPlacement:session.windowPlacement});
  assert.equal(report.windowPlacement.browserFrontmost,false);
  const context=session.context;
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:30000});
  const id=new URL(worker.url()).host;
  const url=`chrome-extension://${id}/options.html#settings-services`;
  const attach=p=>p.on('pageerror',e=>report.consoleErrors.push(e.message));
  const newOptions=async()=>{const p=await helper.newPageWithoutForeground(context,30000);attach(p);await p.goto(url);return p;};
  page=await newOptions();
  const seed=async(patch)=>{
   const result=await page.evaluate(async patch=>{
    const read=await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});
    const c=typeof read.value==='string'?JSON.parse(read.value):read.value;
    return chrome.runtime.sendMessage({type:'persistConfig',config:{...c,...patch},clientId:'service-library-ui-fixture',sequence:Date.now(),baseRevision:c.__fluentConfigRevision});
   },patch);assert.equal(result.success,true);
  };
  await seed({uiLanguage:'zh-CN',uiLanguageSetupCompleted:true,service:'freeTranslation',favoriteServices:[],theme:'light'});
  await page.reload();
  await page.locator('[data-service-view="mine"]').waitFor({state:'visible'});
  const mine=()=>page.locator('.catalog-layout:visible');
  const all=()=>page.locator('.service-directory:visible');
  const select=service=>page.locator(`[data-service-value="${service}"]:visible`);
  const star=service=>page.locator(`[data-service-favorite="${service}"]:visible`);
  const browse=async()=>page.locator('[data-service-view="all"]').click();
  const shot=async name=>{const file=path.join(artifacts,`${name}.png`);await page.screenshot({path:file,fullPage:true});report.screenshots.push(file);};
  const invariant=async expected=>assert.equal(await page.locator('.service-catalog').getAttribute('data-default-service'),expected);
  const viewButton=view=>page.locator(`[data-service-view="${view}"]:visible`);
  // 自定义服务不再占用独立视图，只作为“全部服务”中的目录分类出现。
  const customCategory=()=>all().getByRole('button',{name:'自定义服务',exact:true});
  assert.deepEqual(await page.locator('[data-service-view]').evaluateAll(nodes=>nodes.map(n=>n.dataset.serviceView)),['mine','all']);
  for(const view of ['mine','all']) {
   const box=await viewButton(view).boundingBox();
   assert(box&&box.width>0&&box.height>=40,`服务视图入口不可见：${view}`);
  }
  assert.equal(await mine().locator('[data-service-value]').count(),1);
  await shot('01-first-use');report.cases.push('new-user-default-only');
  await browse();
  assert.equal(await all().getAttribute('data-directory-view'),'all');
  assert.equal(await viewButton('all').getAttribute('aria-pressed'),'true');
  assert((await all().locator('[data-service-value]').count())>40);
  assert.equal(await all().locator('[data-service-section="custom"]').count(),0);
  assert.equal(await customCategory().count(),0);
  report.cases.push('no-custom-category-before-first-custom-service');
  await select('openai').click();await invariant('freeTranslation');
  assert.equal(await page.locator('.service-catalog').getAttribute('data-editing-service'),'openai');
  assert.equal(await mine().locator('[data-personal-group="viewing"] [data-service-value="openai"]').count(),1);
  report.cases.push('browse-changes-editing-only');
  await star('openai').click();
  await browse();await select('deepseek').click();await star('deepseek').click();
  await page.close();page=await newOptions();await page.locator('[data-service-view="mine"]').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelectorAll('[data-personal-group="favorites"] [data-service-value]').length===2);
  assert.deepEqual(await mine().locator('[data-personal-group="favorites"] [data-service-value]').evaluateAll(nodes=>nodes.map(n=>n.dataset.serviceValue)),['openai','deepseek']);
  report.quickClose=true;report.latestWriteWins=true;report.persistenceCases.push('two-favorites-survive-immediate-close-and-reopen');
  await invariant('freeTranslation');
  await seed({token:{openai:'fixture-not-a-live-key'},customOpenAIProviders:[{id:'custom:work',name:'工作翻译接口',endpoint:'http://localhost:11434/v1',models:['local-model']} ]});
  await page.reload();await star('openai').waitFor();await star('openai').click();
  await page.waitForFunction(()=>!!document.querySelector('[data-personal-group="configured"] [data-service-value="openai"]'));
  await page.close();page=await newOptions();await page.locator('[data-personal-group="configured"] [data-service-value="openai"]').waitFor();
  assert.equal(await star('openai').getAttribute('aria-pressed'),'false');
  report.persistenceCases.push('unfavorite-retains-saved-service-after-reopen');
  await browse();
  assert.equal(await all().locator('[data-service-section="custom"] [data-service-value]').count(),1);
  assert.equal(await all().locator('[data-service-section="custom"] [data-service-value]').getAttribute('data-service-value'),'custom:work');
  await customCategory().click();
  assert.equal(await customCategory().getAttribute('aria-pressed'),'true');
  assert.deepEqual(await all().locator('[data-service-section]').evaluateAll(nodes=>nodes.map(n=>n.dataset.serviceSection)),['custom']);
  assert.equal(await all().locator('[data-service-value]').count(),1);
  await browse();assert.equal(await customCategory().getAttribute('aria-pressed'),'false');
  report.cases.push('custom-service-is-a-full-catalog-category');
  await select('deepseek').click();await shot('02-my-services');
  await browse();await shot('03-all-services');
  const icons=await all().locator('[data-service-value]').evaluateAll(nodes=>nodes.map(n=>({service:n.dataset.serviceValue,svg:!!n.querySelector('svg'),text:!!n.querySelector('svg text'),image:!!n.querySelector('img, image'),fallback:!!n.querySelector('[data-service-icon-fallback]')})));
  assert(icons.every(i=>i.svg&&!i.text&&!i.image&&!i.fallback),JSON.stringify(icons));report.cases.push({id:'all-service-icons-inline-svg',count:icons.length});
  await page.getByRole('button',{name:'模型服务商',exact:true}).click();await shot('03-model-provider-icons');
  await page.getByRole('button',{name:'聚合平台与接口',exact:true}).click();await shot('03-platform-icons');

  await page.getByRole('button',{name:'云服务厂商',exact:true}).click();
  assert.equal(await all().locator('[data-service-value]').count(),6);report.cases.push('category-filter');
  await page.getByRole('searchbox',{name:'搜索所有翻译服务'}).fill('OpenAI');
  assert((await all().locator('[data-service-value="openai"]').count())===1);
  await select('openai').click();await invariant('freeTranslation');
  await page.getByRole('button',{name:'设为默认',exact:true}).click();await invariant('openai');
  const popup=await helper.newPageWithoutForeground(context,30000);attach(popup);await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.waitForFunction(async()=>{const read=await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});const c=typeof read.value==='string'?JSON.parse(read.value):read.value;return c.service==='openai';});
  await popup.close();report.crossPageSync=true;report.cases.push('explicit-set-default-persists-across-extension-pages');
  await page.getByRole('searchbox',{name:'搜索所有翻译服务'}).fill('nonexistent-service-97531');
  await all().getByRole('status').waitFor();report.cases.push('global-search-and-empty-state');
  await seed({service:'freeTranslation',favoriteServices:['deepseek','custom:work','openai'],customOpenAIProviders:Array.from({length:20},(_,i)=>({id:i===0?'custom:work':`custom:test${i}`,name:i===0?'工作翻译接口':`长名称自定义翻译服务 ${i} · 内部模型接口`,endpoint:'http://localhost:11434/v1',models:['local-model']}))});
  await page.reload();await page.locator('[data-service-view="mine"]').waitFor();
  await browse();
  assert.equal(await all().locator('[data-service-section="custom"] [data-service-value]').count(),20);
  await customCategory().click();
  assert.equal(await all().locator('[data-service-section="custom"] [data-service-value]').count(),20);
  assert((await all().locator('[data-service-section="custom"] h4').textContent()).includes('自定义服务'));
  assert((await all().locator('[data-service-section="custom"] [data-service-value]').first().textContent()).includes('工作翻译接口'));
  report.cases.push('full-catalog-and-custom-category-include-all-custom-services');
  for(const width of [1440,1024,820,390]){
   await page.setViewportSize({width,height:1000});
   for(const view of ['all','custom','mine']){
    // “custom”是全部服务中的自定义分类，用于压测 20 个长名称服务的窄屏布局。
    await page.locator(`[data-service-view="${view==='custom'?'all':view}"]`).click();
    if(view==='custom')await customCategory().click();
    const metrics=await page.evaluate(()=>({filtersHeight:document.querySelector('.directory-filters').getBoundingClientRect().height,toolbarHeight:document.querySelector('.catalog-toolbar').getBoundingClientRect().height,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,height:innerHeight,overflow:[...document.querySelectorAll('.catalog-toolbar button,.library-favorite,.catalog-search,.directory-grid')].filter(n=>n.getClientRects().length).filter(n=>n.getBoundingClientRect().right>innerWidth+1||n.getBoundingClientRect().left<0).length}));
    if(width===1440){assert(metrics.toolbarHeight<90,JSON.stringify(metrics));if(view==='all')assert(metrics.filtersHeight<100,JSON.stringify(metrics));}
    assert(metrics.scrollWidth<=width+1,JSON.stringify(metrics));assert(metrics.scrollHeight<=metrics.height+1,JSON.stringify(metrics));assert.equal(metrics.overflow,0,JSON.stringify(metrics));
    report.cases.push({id:`layout-${width}-${view}`,metrics});
    if(width===390||width===1440)await shot(`04-stress-${width}-${view}`);
   }
  }
  await page.setViewportSize({width:1440,height:1000});
  await seed({theme:'dark'});await page.reload();await page.locator('[data-service-view="mine"]').waitFor();await shot('05-dark-mine');await browse();await shot('06-dark-all');
  await seed({uiLanguage:'en-US'});await page.reload();await page.locator('[data-service-view="all"]').click();
  assert.equal(await page.getByRole('button',{name:/All services/}).count(),1);await shot('07-english-all');
  assert.deepEqual(report.consoleErrors,[]);report.ok=true;save();
 } catch(e){report.error=e.stack;if(page)await page.screenshot({path:path.join(artifacts,'failure.png'),fullPage:true}).catch(()=>{});save();process.exitCode=1;}
 finally {if(session)await session.close();fs.rmSync(profileDir,{recursive:true,force:true});save();console.log(JSON.stringify(report,null,2));}
})();

'use strict';
/**
 * @file scripts/testing/run-drive-version-compat-ui-test.cjs
 * 文件职责：在隔离 Edge 中验证生产扩展对 Drive 版本信息缺失的兼容及只读恢复界面。
 * 主要内容：虚构身份、无 v3 ETag 的协议响应、v2 条件更新与冲突拒绝、差异预览、取消及中英文窄屏。
 * 模块边界：仅替换临时 profile 的网络和身份端口，不访问真实 Google 账号或日常浏览器。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
function arg(name, fallback) {const index=process.argv.indexOf(`--${name}`);return index<0?fallback:process.argv[index+1];}
const extensionDir=path.resolve(arg('extension-dir','.output/chrome-mv3'));
const artifactsDir=path.resolve(arg('artifacts-dir','/private/tmp/fluentread-drive-version-ui'));
const playwrightRoot=arg('playwright-root');
const helperPath=arg('focus-safe-helper');
if(!playwrightRoot || !helperPath) throw new Error('必须显式指定 Playwright 和 focus-safe helper');
const {chromium}=require(path.join(playwrightRoot,'playwright'));
const {launchFocusSafePersistentContext,newPageWithoutForeground,activateExtensionTabWithoutForeground}=require(helperPath);
fs.mkdirSync(artifactsDir,{recursive:true});
async function main() {
    const profileDir=fs.mkdtempSync(path.join(os.tmpdir(),'fluentread-drive-version-'));
    const report={ok:false,evidence:'production extension with synthetic identity and Drive responses; no real account',extensionDir,launchMode:null,focusPolicy:null,windowPlacement:null,cases:[],screenshots:[],consoleErrors:[]};
    let launched;
    const check=(condition,label)=>{if(!condition)throw new Error(label);report.cases.push(label);};
    try {
        launched=await launchFocusSafePersistentContext({chromium,profileDir,browserPath:'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',headless:false,background:true,displayTarget:'secondary',browserArgs:[`--disable-extensions-except=${extensionDir}`,`--load-extension=${extensionDir}`,'--no-first-run','--no-default-browser-check'],viewport:{width:1440,height:1000},timeout:30000});
        report.launchMode=launched.launchMode;report.focusPolicy=launched.focusPolicy;report.windowPlacement=launched.windowPlacement;
        const {context}=launched;
        const worker=context.serviceWorkers().find(w=>w.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker',{timeout:30000});
        const id=new URL(worker.url()).host;
        check(id==='djnlaiohfaaifbibleebjggkghlmcpcj','production build retains the official extension ID');
        await worker.evaluate(()=>{
            Object.defineProperty(navigator,'userAgent',{get:()=> 'Chrome/142.0.0.0 fixture'});
            const state=globalThis.__versionFixture={content:null,version:0,uploads:0,authorizations:0,clears:0,etag:true,rejectPut:false,calls:[]};
            chrome.identity.getAuthToken=async({interactive,scopes})=>{if(JSON.stringify(scopes)!==JSON.stringify(['https://www.googleapis.com/auth/drive.appdata']))throw new Error('unexpected OAuth scope');if(interactive)state.authorizations++;return{token:'fixture-token',grantedScopes:scopes};};
            chrome.identity.removeCachedAuthToken=async()=>undefined;
            chrome.identity.clearAllCachedAuthTokens=async()=>{state.clears++;};
            const original=globalThis.fetch.bind(globalThis);
            const metadata=()=>({id:'fixture-file',version:String(state.version),modifiedTime:'2026-10-04T00:00:00Z'});
            const v2=()=>({...metadata(),modifiedDate:'2026-10-04T00:00:00Z',...(state.etag?{etag:`"v${state.version}"`}:{})});
            const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
            globalThis.fetch=async(input,init={})=>{
                const url=new URL(String(input));if(url.hostname!=='www.googleapis.com')return original(input,init);
                state.calls.push({path:url.pathname,method:init.method??'GET',match:init.headers?.['If-Match']??null});
                if(url.pathname==='/drive/v3/about')return json({user:{permissionId:'fixture-account',emailAddress:'tester@fixture.invalid'}});
                if(url.pathname.startsWith('/upload/drive/')) {
                    const first=url.pathname==='/upload/drive/v3/files' && init.method==='POST' && !state.content;
                    const update=url.pathname==='/upload/drive/v2/files/fixture-file' && init.method==='PUT';
                    if(!first && !update)throw new Error('unexpected or unconditional Drive write');
                    if(update && (state.rejectPut || init.headers?.['If-Match']!==`"v${state.version}"`))return new Response(null,{status:412});
                    const body=String(init.body);const marker='Content-Type: application/json\r\n\r\n';const start=body.indexOf(marker)+marker.length;
                    const content=body.slice(start,body.indexOf('\r\n--',start));
                    if(JSON.parse(content).format!=='fluentread-drive-encrypted')throw new Error('plaintext write');
                    state.content=content;state.version++;state.uploads++;return json(first?metadata():v2());
                }
                if(url.pathname==='/drive/v3/files')return json({files:state.content?[metadata()]:[]});
                if(url.pathname==='/drive/v2/files/fixture-file')return json(v2());
                if(url.pathname==='/drive/v3/files/fixture-file')return url.searchParams.get('alt')==='media'?new Response(state.content):json(metadata());
                throw new Error('unexpected Drive endpoint');
            };
        });
        const page=await newPageWithoutForeground(context,30000);
        page.on('pageerror',e=>report.consoleErrors.push(e.message));
        page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(message.text());});
        await page.goto(`chrome-extension://${id}/options.html#settings-data`,{waitUntil:'domcontentloaded'});
        let sequence=0;
        async function savePatch(patch) {
            const result=await page.evaluate(async({patch,sequence})=>{
                const current=await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});
                const credentials=await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:credentials'});
                return chrome.runtime.sendMessage({type:'persistConfig',mode:'replace',config:{...current.value,...credentials.value,...patch},clientId:'fixture-drive-version',sequence});
            },{patch,sequence:++sequence});check(result.success===true,`production configuration persistence ${sequence}`);
        }
        async function navigate() {const button=page.locator('button[data-section="settings-data"]');if(await button.isVisible())await button.click();await page.locator('[data-testid="google-drive-sync-now"]').waitFor();}
        async function shot(name) {await page.waitForFunction(()=>!document.querySelector('.el-message'),null,{timeout:6000});const target=path.join(artifactsDir,name+'.png');await page.screenshot({path:target,animations:'disabled'});report.screenshots.push(target);}
        await savePatch({uiLanguage:'zh-CN',uiLanguageSetupCompleted:true,to:'fr'});await page.reload({waitUntil:'domcontentloaded'});await navigate();
        const card=page.locator('[data-testid="cloud-config-backup"]');const dialog=page.locator('.el-dialog');
        const sync=()=>page.locator('[data-testid="google-drive-sync-now"]').click();
        const confirm=async()=>{await page.locator('[data-testid="google-drive-confirm"]').click();await dialog.waitFor({state:'hidden'});};
        const cancel=async()=>{await dialog.locator('.drive-footer-actions .el-button').first().click();await dialog.waitFor({state:'hidden'});};
        async function chooseUpload() {const back=page.locator('[data-testid="google-drive-back"]');if(await back.isVisible())await back.click();await page.locator('[data-testid="google-drive-direction-upload"]').check();await page.locator('[data-testid="google-drive-continue"]').click();}
        check(await worker.evaluate(()=>__versionFixture.authorizations===0),'opening settings makes no authorization request');
        await sync();await dialog.waitFor();check(await worker.evaluate(()=>__versionFixture.uploads===0),'preview never writes');await confirm();
        check(await worker.evaluate(()=>__versionFixture.uploads===1 && __versionFixture.calls.some(c=>c.path==='/drive/v2/files/fixture-file')),'first save and readback work without v3 ETag headers');
        await savePatch({to:'de'});await sync();await dialog.waitFor();await chooseUpload();
        check((await dialog.innerText()).includes('目标语言'),'second-save review displays the changed setting');await shot('drive-v2-change-review');await confirm();
        check(await worker.evaluate(()=>__versionFixture.uploads===2 && __versionFixture.calls.some(c=>c.path==='/upload/drive/v2/files/fixture-file' && c.method==='PUT' && c.match==='"v1"')),'second save uses matching v2 ETag and conditional PUT');
        await sync();await dialog.waitFor();check((await dialog.innerText()).includes('配置已一致'),'repeated sync recognizes identical settings');await confirm();
        check(await worker.evaluate(()=>__versionFixture.uploads===2),'identical sync makes no upload');
        await savePatch({to:'es'});await worker.evaluate(()=>{__versionFixture.rejectPut=true;});await sync();await dialog.waitFor();await chooseUpload();await confirm();
        await card.locator('.el-alert--error').waitFor();check(await worker.evaluate(()=>__versionFixture.uploads===2 && __versionFixture.version===2),'412 conflict preserves the existing backup');
        await worker.evaluate(()=>{__versionFixture.rejectPut=false;__versionFixture.etag=false;});await sync();await dialog.waitFor();
        check(await page.locator('[data-testid="google-drive-restore-only"]').isVisible(),'missing ETag opens an explicit restore-only preview');
        check((await dialog.innerText()).includes('目标语言') && await page.locator('[data-testid="google-drive-confirm"]').isEnabled(),'differences and restore action remain available');
        await page.locator('[data-testid="google-drive-back"]').click();check(await page.locator('[data-testid="google-drive-direction-upload"]').isDisabled() && await page.locator('[data-testid="google-drive-direction-merge"]').count()===0,'unsupported saving and merging cannot be chosen');await shot('drive-restore-only-desktop');
        await cancel();check((await page.evaluate(()=>chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'}))).value.to==='es','cancel keeps device changes');
        await sync();await dialog.waitFor();await confirm();check((await page.evaluate(()=>chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'}))).value.to==='de','restore without ETag applies cloud configuration');
        check(await worker.evaluate(()=>__versionFixture.uploads===2),'read-only cancellation and restoration never write');
        await savePatch({to:'fr',uiLanguage:'en-US',uiLanguageSetupCompleted:true});await page.reload({waitUntil:'domcontentloaded'});await navigate();await page.setViewportSize({width:390,height:900});await activateExtensionTabWithoutForeground(context,page);await sync();await dialog.waitFor();
        check(!/[\u3400-\u9fff]/u.test(await dialog.locator('[data-testid="google-drive-restore-only"]').innerText()),'restore-only warning is English');
        check(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),'390px restore-only preview has no horizontal overflow');await shot('drive-restore-only-english-mobile');await cancel();
        check(await worker.evaluate(()=>__versionFixture.clears>=__versionFixture.authorizations),'completed, failed and cancelled transactions clear authorization');
        check(report.consoleErrors.length===0,'no unhandled production page errors');report.ok=true;
    } catch(error) {report.failure=error.message;throw error;}
    finally {if(launched)await launched.close();fs.writeFileSync(path.join(artifactsDir,'report.json'),JSON.stringify(report,null,2));fs.rmSync(profileDir,{recursive:true,force:true});}
    console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});

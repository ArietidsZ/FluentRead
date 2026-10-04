/** 公开章节 DOM 核对：显式 URL 子集、隔离后台 Edge，只记录页面已呈现的图片/画布与阅读结构。 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const arg = name => process.argv[process.argv.indexOf(`--${name}`) + 1];
for (const name of ['urls-file', 'artifacts-dir', 'playwright-root', 'focus-safe-helper']) {
  if (!process.argv.includes(`--${name}`)) throw new Error(`Provide --${name}; no implicit full-site scan`);
}
const urls = JSON.parse(fs.readFileSync(arg('urls-file'), 'utf8'));
const settleMs = Number(process.argv.includes('--settle-ms') ? arg('settle-ms') : 3500);
assert.ok(Number.isInteger(settleMs) && settleMs >= 0 && settleMs <= 30000, 'Settle time must be 0–30000 ms');
const artifacts = path.resolve(arg('artifacts-dir'));
const {chromium} = require(path.join(arg('playwright-root'), 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground} = require(arg('focus-safe-helper'));
const profile = fs.mkdtempSync('/private/tmp/fluentread-reader-inspection-');
const headlessResearch = process.argv.includes('--headless-research');
fs.mkdirSync(artifacts, {recursive:true});
const report = {scope: urls, pages: [], errors: []};
let launched, browserPid;
function focusGuard() {
  if (headlessResearch) return;
  const current = JSON.parse(execFileSync('/usr/bin/osascript', ['-l','JavaScript','-e', "ObjC.import('AppKit');const a=$.NSWorkspace.sharedWorkspace.frontmostApplication;JSON.stringify({pid:Number(a.processIdentifier),name:ObjC.unwrap(a.localizedName)});"], {encoding:'utf8'}));
  assert.ok(browserPid, 'Own isolated browser process is known');
  assert.notEqual(current.pid, browserPid, 'Isolated Edge must stay behind the user application');
  (report.focusChecks ??= []).push(current);
}
(async () => {
  try {
    launched = await launchFocusSafePersistentContext({chromium,profileDir:profile,
      browserPath:'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',headless:headlessResearch,background:true,
      browserArgs:['--no-first-run','--no-default-browser-check'],viewport:{width:1280,height:900}});
    report.launchMode = launched.launchMode; report.focusPolicy = launched.focusPolicy; report.windowPlacement = launched.windowPlacement;
    if (!headlessResearch) assert.equal(report.windowPlacement.browserFrontmost, false);
    report.purpose = headlessResearch ? 'read-only DOM research without extension; not extension runtime validation' : 'read-only visible DOM research without extension';
    const system = await launched.context.browser().newBrowserCDPSession();
    browserPid = (await system.send('SystemInfo.getProcessInfo')).processInfo.find(p=>p.type==='browser').id;
    await system.detach();focusGuard();
    for (const href of urls) {
      const page = await newPageWithoutForeground(launched.context);
      const result = {requestedUrl:href,pageErrors:[]};
      page.on('pageerror',error=>result.pageErrors.push({message:error.message,stack:error.stack||''}));
      try {
        const response = await page.goto(href,{waitUntil:'domcontentloaded',timeout:25000});
        await page.waitForTimeout(settleMs);result.settleMs=settleMs;
        const clickSelector=process.argv.includes('--before-inspect-click')?arg('before-inspect-click'):null;
        if(clickSelector){await page.locator(clickSelector).click({timeout:10000});result.readerAction={selector:clickSelector};await page.waitForTimeout(settleMs);}
        const pageKey=process.argv.includes('--before-inspect-key')?arg('before-inspect-key'):null;
        if(pageKey){
          const count=Math.min(4,Math.max(1,Number(process.argv.includes('--reader-key-count')?arg('reader-key-count'):1)));
          for(let n=0;n<count;n++)await page.keyboard.press(pageKey);
          result.readerKey=pageKey;result.readerKeyCount=count;
        }
        const readySelector=process.argv.includes('--ready-selector')?arg('ready-selector'):null;
        if(readySelector){
          result.readySelector=readySelector;
          result.readerReady=await page.waitForSelector(readySelector,{state:'visible',timeout:20000}).then(()=>true).catch(()=>false);
        }
        if(pageKey)await page.waitForTimeout(900);
        focusGuard();
        Object.assign(result, await page.evaluate(async () => {
          const ancestors = element => {
            const values = [];
            for (let parent=element;parent && values.length<5;parent=parent.parentElement) values.push({tag:parent.tagName,id:parent.id,className:typeof parent.className==='string'?parent.className:'',dataPage:parent.getAttribute('data-page')});
            return values;
          };
          const images = Array.from(document.images).filter(img=>img.width>=200 || img.naturalWidth>=300).map(img=>({
            source:img.currentSrc || img.src, width:img.width,height:img.height,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,
            rect: {x:img.getBoundingClientRect().x,y:img.getBoundingClientRect().y,width:img.getBoundingClientRect().width,height:img.getBoundingClientRect().height}, ancestors:ancestors(img)}));
          const backgrounds=[];
          for(const element of Array.from(document.querySelectorAll('div[id^="page-"]')).slice(0,12)) {
            const style=getComputedStyle(element),rect=element.getBoundingClientRect();
            const source=/^url\(["']?(blob:[^"')]+)["']?\)$/.exec(style.backgroundImage)?.[1];
            if(!source)continue;
            const details={id:element.id,source,backgroundSize:style.backgroundSize,backgroundPosition:style.backgroundPosition,
              backgroundRepeat:style.backgroundRepeat,backgroundOrigin:style.backgroundOrigin,rect:rect.toJSON(),ancestors:ancestors(element)};
            const image=new Image(),canvas=document.createElement('canvas');
            try {
              await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('displayed blob image timeout')),5000);
                image.onload=()=>{clearTimeout(timeout);resolve();};image.onerror=()=>{clearTimeout(timeout);reject(new Error('displayed blob image failed'));};image.src=source;});
              details.naturalWidth=image.naturalWidth;details.naturalHeight=image.naturalHeight;
              canvas.width=canvas.height=8;const context=canvas.getContext('2d');context.drawImage(image,0,0,8,8);
              details.readable=true;details.nonblank=context.getImageData(0,0,8,8).data.some(v=>v!==0);
            } catch(error) {details.readable=false;details.pixelError=error.name;}
            finally {image.onload=image.onerror=null;image.src='';canvas.width=canvas.height=0;}
            backgrounds.push(details);
          }
          return {url:location.href,title:document.title,images:images.slice(0,30),imageCount:images.length,backgrounds,
            canvases:Array.from(document.querySelectorAll('canvas')).map(c=>{
              const rect=c.getBoundingClientRect(),hit=document.elementFromPoint(Math.max(0,Math.min(innerWidth-1,rect.left+rect.width/2)),Math.max(0,Math.min(innerHeight-1,rect.top+rect.height/2)));
              let readable=false, nonblank=false, gridNonblank=false, pixelError='';
              try {const ctx=c.getContext('2d');if(ctx && c.width && c.height){
                const pixels=ctx.getImageData(0,0,Math.min(32,c.width),Math.min(32,c.height)).data;readable=true;nonblank=pixels.some(v=>v>0);
                // 透明页角不能证明整页为空；用与正文控制器一致的整数网格补充公开像素观察。
                for(let y=0;y<8;y++)for(let x=0;x<8;x++) {
                  const point=ctx.getImageData(Math.floor((x+.5)*c.width/8),Math.floor((y+.5)*c.height/8),1,1).data;
                  if(point.some(v=>v>0))gridNonblank=true;
                }
              }}
              catch(error){pixelError=error.name;}
              return {width:c.width,height:c.height,readable,nonblank,gridNonblank,pixelError,ancestors:ancestors(c),
                rect:rect.toJSON(),centerHit:hit?{tag:hit.tagName,id:hit.id,className:hit.className,containsCanvas:hit.contains(c)}:null,
                parentPosition:c.parentElement?getComputedStyle(c.parentElement).position:null};
            }),
            frames:Array.from(document.querySelectorAll('iframe')).map(f=>({src:f.src,id:f.id})),
            controls:Array.from(document.querySelectorAll('button,a')).filter(e=>/読む|読ん|続きを読む|read|viewer/i.test(e.textContent)).slice(0,8).map(e=>({tag:e.tagName,text:e.textContent.trim().slice(0,100),href:e.getAttribute('href')})),
            detectedRestriction:/Just a moment|Access Denied|Verify you are human/i.test(document.title)};
        }));
        result.status=response?.status();
        fs.writeFileSync(path.join(artifacts,`${report.pages.length}.html`),await page.content());
        if(process.argv.includes('--capture-page')) {
          result.screenshot=path.join(artifacts,`${report.pages.length}.png`);
          focusGuard();await page.screenshot({path:result.screenshot});
        }
      } catch(error) {result.error=error.message;}
      report.pages.push(result);
      fs.writeFileSync(path.join(artifacts,'reader-inspection.json'),JSON.stringify(report,null,2));
      console.log(JSON.stringify({url:href,status:result.status,images:result.imageCount,canvases:result.canvases?.length,error:result.error}));
      await page.close();
    }
  } catch(error) {report.errors.push(error.stack);process.exitCode=1;}
  finally {
    fs.writeFileSync(path.join(artifacts,'reader-inspection.json'),JSON.stringify(report,null,2));
    await launched?.close();fs.rmSync(profile,{recursive:true,force:true});
  }
})();

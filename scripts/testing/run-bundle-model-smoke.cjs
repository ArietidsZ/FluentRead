'use strict';
// 在自有临时扩展中验证实际 Paddle/LaMa 源码端口及正式 OPUS Worker，不触碰用户页面或日常 profile。
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'../..');
function arg(name,fallback){const i=process.argv.indexOf('--'+name);return i<0?fallback:process.argv[i+1];}
const source=path.resolve(arg('extension-dir',path.join(root,'.output/chrome-mv3')));
const artifacts=path.resolve(arg('artifacts-dir','/private/tmp/fluentread-bundle-model-smoke'));
const data=path.resolve(arg('manga-models-dir','/private/tmp/fluentread-manga-mirror-probe'));
const {chromium}=require(path.join(arg('playwright-root','/Users/thinkstu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'playwright'));
const {launchFocusSafePersistentContext,newPageWithoutForeground}=require(arg('focus-safe-helper','/Users/thinkstu/.codex/skills/fluentread-browser-translation-test/scripts/focus-safe-browser.cjs'));
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'fluentread-bundle-model-extension-'));
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'fluentread-bundle-model-profile-'));
const kinds=arg('kinds','paddle,opus').split(',');
const report={source,cases:[],errors:[],evidence:'Actual Paddle/LaMa source ports bundled with the shared ONNX alias, and the unchanged production OPUS Worker. Fixed offline Paddle/LaMa files are hash checked; OPUS downloads are pinned and SHA-256 checked. Controlled samples are not broad quality or mainland-network proof.'};
(async()=>{let session;try{
 fs.mkdirSync(artifacts,{recursive:true});fs.cpSync(source,fixture,{recursive:true});fs.mkdirSync(path.join(fixture,'probe-data'));
 if(kinds.includes('paddle'))for(const name of ['PP-OCRv6_small_det.onnx','PP-OCRv6_small_rec.onnx','ppocrv6_dict.txt','lama-manga-dynamic.onnx'])fs.copyFileSync(path.join(data,name),path.join(fixture,'probe-data',name));
 fs.writeFileSync(path.join(fixture,'model-probe.html'),'<!doctype html><title>FluentRead model size regression</title><h1>Model compatibility verification</h1>');
 const tf=createRequire(require.resolve('@huggingface/transformers-kokoro'));
 const ort=tf.resolve('onnxruntime-web/webgpu'),common=createRequire(ort).resolve('onnxruntime-common');
 await createRequire(require.resolve('vite'))('esbuild').build({stdin:{contents:`export {createBrowserMangaOcr} from './src/features/image-translation/services/mangaOcr'; export {createBrowserMangaInpainter} from './src/features/image-translation/services/mangaInpainting'; export {importMangaModel} from './src/features/image-translation/services/mangaOcrAssets'; export {getTranslationArtifacts,downloadTranslationArtifact} from './src/features/local-translation/offscreen/artifactStore'; export {resolveOpusTranslationRepository,LOCAL_TRANSLATION_MODEL_IDS} from './src/core/config/localTranslation';`,resolveDir:root},alias:{'@':root,'onnxruntime-web':path.join(path.dirname(ort),'ort.webgpu.min.mjs'),'onnxruntime-web/webgpu':path.join(path.dirname(ort),'ort.webgpu.min.mjs'),'onnxruntime-common':path.resolve(path.dirname(common),'../esm/index.js')},bundle:true,platform:'browser',format:'esm',outfile:path.join(fixture,'model-cache.mjs')});
 session=await launchFocusSafePersistentContext({chromium,profileDir:profile,browserPath:'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',headless:false,background:true,displayTarget:'secondary',viewport:{width:1100,height:800},browserArgs:['--no-first-run','--no-default-browser-check',`--disable-extensions-except=${fixture}`,`--load-extension=${fixture}`]});
 Object.assign(report,{launchMode:session.launchMode,focusPolicy:session.focusPolicy,windowPlacement:session.windowPlacement});
 const context=session.context,background=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:30000});
 const origin=background.url().match(/^chrome-extension:\/\/[^/]+/)[0];
 for(const backend of kinds.includes('paddle')?['webgpu','wasm']:[]){
  const page=await newPageWithoutForeground(context);await page.goto(origin+'/model-probe.html');page.on('pageerror',e=>report.errors.push(e.message));
  console.log(JSON.stringify({phase:'manga',backend}));
  const result=await page.evaluate(async backend=>{
   if(backend==='wasm')Object.defineProperty(navigator,'gpu',{value:undefined});
   const module=await import('./model-cache.mjs');
   for(const name of ['PP-OCRv6_small_det.onnx','PP-OCRv6_small_rec.onnx','ppocrv6_dict.txt','lama-manga-dynamic.onnx'])await module.importMangaModel(new File([await(await fetch('./probe-data/'+name)).blob()],name));
   const canvas=document.createElement('canvas');canvas.width=900;canvas.height=180;
   const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,900,180);context.font='bold 64px Arial';context.fillStyle='#000';context.fillText('Hello world',60,110);
   const started=performance.now(),ocr=await module.createBrowserMangaOcr();let recognized;
   try{recognized=await ocr.recognize(canvas.toDataURL(),{flatten:true,noCache:true,strategy:'per-box'});}finally{await ocr.destroy();}
   const ocrMs=performance.now()-started;
   const patch={image:new Float32Array(3*64*64).fill(0.5),mask:new Float32Array(64*64),width:64,height:64};patch.mask.fill(1,64*20,64*24);
   const inpaintStart=performance.now(),painter=await module.createBrowserMangaInpainter();let output;
   try{output=await painter.run(patch);}finally{await painter.release();}
   return {backend,ocrMs,text:recognized.results.map(row=>row.text).join(' '),inpaintMs:performance.now()-inpaintStart,outputLength:output.length,finite:output.every(Number.isFinite)};
  },backend);
  assert.match(result.text,/hello.*world/i);assert.equal(result.outputLength,3*64*64);assert.equal(result.finite,true);report.cases.push(result);console.log(JSON.stringify(result));await page.close();
 }
 if(kinds.includes('opus')){
 const page=await newPageWithoutForeground(context);await page.goto(origin+'/model-probe.html');
 console.log(JSON.stringify({phase:'opus-download'}));
 await page.evaluate(async()=>{const m=await import('./model-cache.mjs');const model=m.LOCAL_TRANSLATION_MODEL_IDS.opusZhEn,repo=m.resolveOpusTranslationRepository(model,'en','zh');for(const file of m.getTranslationArtifacts(model).filter(f=>f.repo===repo))await m.downloadTranslationArtifact(file,new AbortController().signal,()=>{});});
 const opus=await page.evaluate(async()=>{const worker=new Worker(new URL('./localTranslationWorker.js',location.href),{type:'module'});let id=0;function request(text){return new Promise((resolve,reject)=>{const requestId=++id,timer=setTimeout(()=>reject(new Error('OPUS timeout')),90000);worker.onerror=e=>{clearTimeout(timer);reject(new Error(e.message));};worker.onmessage=e=>{if(e.data.requestId===requestId){clearTimeout(timer);e.data.success?resolve(e.data):reject(new Error(e.data.error));}};worker.postMessage({requestId,type:'translate',model:'fluentread/opus-zh-en',text,sourceLanguage:'en',targetLanguage:'zh'});});}try{return [await request('Hello world.'),await request('This is a local translation test.')];}finally{worker.terminate();}});
 for(const value of opus)assert.match(value.result,/[\u3400-\u9fff]/u);report.cases.push({model:'opus-en-zh',outputs:opus});console.log(JSON.stringify(opus));
 }
 // 结束前再检查后台新页没有使浏览器成为前台，不用截图触发额外窗口行为。
 const last=await newPageWithoutForeground(context);await last.close();assert.deepEqual(report.errors,[]);report.ok=true;
}catch(error){report.ok=false;report.failure=error.stack;console.error(error);process.exitCode=1;}
finally{fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify(report,null,2));if(session)await session.close();fs.rmSync(profile,{recursive:true,force:true});fs.rmSync(fixture,{recursive:true,force:true});}})();

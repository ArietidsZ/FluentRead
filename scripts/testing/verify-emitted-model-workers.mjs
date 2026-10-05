/** Document/window-free checks of emitted Worker modules. Supports the repository's Node20 baseline. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import ts from 'typescript';
const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const entries=['localTranslationWorker.js','localTtsWorker.js','videoTranscriptionWorker.js'];
const sourceRoot=args.includes('--source-root')?path.resolve(value('--source-root')):path.resolve(fileURLToPath(new URL('../..',import.meta.url)));
if(!fs.existsSync(path.join(sourceRoot,'entrypoints')))throw new Error('Missing source entrypoints directory: '+sourceRoot);
if(fs.existsSync(path.join(sourceRoot,'entrypoints/qwenAsrWorker.ts')))entries.push('qwenAsrWorker.js');
function dependencies(file,root,includeDynamic=true,onlyDynamic=false){
    const code=fs.readFileSync(file,'utf8'),relative=[];
    const parsed=ts.createSourceFile(file,code,ts.ScriptTarget.Latest,false,ts.ScriptKind.JS);
    const visit=node=>{
        const module=!onlyDynamic&&(ts.isImportDeclaration(node)||ts.isExportDeclaration(node))?node.moduleSpecifier
            :includeDynamic&&ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword?node.arguments[0]:undefined;
        if(module&&ts.isStringLiteralLike(module)&&/^\..*\.m?js$/u.test(module.text))relative.push(module.text);
        ts.forEachChild(node,visit);
    };visit(parsed);
    return [...new Set(relative.map(item=>path.resolve(path.dirname(file),item)))].map(item=>{
        if(!item.startsWith(root+path.sep))throw new Error('Unexpected outside emitted dependency');return item;
    });
}
function staticHashes(entry,root){
    const seen=new Set(),records=[];
    const visit=file=>{if(seen.has(file))return;seen.add(file);if(!fs.existsSync(file)){records.push({path:path.relative(root,file),missing:true});return;}
        const bytes=fs.readFileSync(file);records.push({path:path.relative(root,file),bytes:bytes.length,sha256:digest(bytes)});
        dependencies(file,root).forEach(visit);
    };visit(entry);return records;
}
async function checkChild(){
    const savedProcess=process,originalEntry=path.resolve(value('--child')),originalRoot=path.dirname(originalEntry),inject=args.includes('--inject-failure');
    let entry=originalEntry,root=originalRoot,temporaryRoot;
    try{
        if(typeof document!=='undefined'||typeof window!=='undefined')throw new Error('Expected a document/window-free environment');
        if(!fs.existsSync(entry))throw new Error('Missing emitted entry: '+entry);
        const entryBytes=fs.readFileSync(entry),deferredOriginal=dependencies(entry,root,true,true)[0];
        if(!deferredOriginal)throw new Error('Missing real deferred chunk import in '+entry);
        const deferredPath='./'+path.relative(root,deferredOriginal);
        if(inject){
            temporaryRoot=root=fs.mkdtempSync(path.join(os.tmpdir(),'fluentread-worker-missing-chunk-'));
            const excluded=path.resolve(originalRoot,deferredPath),seen=new Set();
            const copy=file=>{if(file===excluded||seen.has(file))return;seen.add(file);
                const destination=path.join(root,path.relative(originalRoot,file));fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(file,destination);
                dependencies(file,originalRoot,false).forEach(copy);
            };copy(originalEntry);fs.writeFileSync(path.join(root,'package.json'),'{"type":"module"}');entry=path.join(root,path.basename(originalEntry));
        }
        const missingDependency=path.resolve(root,deferredPath),graph=staticHashes(entry,root),responses=[],events=new EventTarget();
        let queued=false,lateSent=false,fetches=0,cacheOpens=0,onmessage=null,finish;
        const done=new Promise(resolve=>{finish=resolve;});
        Object.defineProperty(globalThis,'navigator',{value:{userAgent:'Node document-free emitted Worker qualification',hardwareConcurrency:1},configurable:true});
        globalThis.location={href:pathToFileURL(entry).href};
        globalThis.fetch=async()=>{fetches++;throw new Error('Bootstrap must not fetch models or initialize WASM');};
        globalThis.caches={open:async()=>{cacheOpens++;throw new Error('Bootstrap must not open model caches');}};
        globalThis.addEventListener=(type,listener,options)=>{
            events.addEventListener(type,listener,options);
            if(type==='message'&&!queued){queued=true;for(const requestId of [1,2])events.dispatchEvent(new MessageEvent('message',{data:{requestId,type:'dispose'}}));}
        };
        globalThis.removeEventListener=(...parameters)=>events.removeEventListener(...parameters);
        globalThis.dispatchEvent=event=>events.dispatchEvent(event);
        Object.defineProperty(globalThis,'onmessage',{configurable:true,get:()=>onmessage,set:listener=>{
            if(onmessage)events.removeEventListener('message',onmessage);onmessage=listener;if(listener)events.addEventListener('message',listener);
        }});
        globalThis.self=new Proxy(globalThis,{get:(target,key)=>key==='constructor'?{name:'DedicatedWorkerGlobalScope'}:Reflect.get(target,key)});
        globalThis.postMessage=response=>{
            responses.push(response);
            if(responses.some(item=>item.requestId===1)&&responses.some(item=>item.requestId===2)&&!lateSent){lateSent=true;queueMicrotask(()=>events.dispatchEvent(new MessageEvent('message',{data:{requestId:3,type:'dispose'}})));}
            if(responses.some(item=>item.requestId===3))finish();
        };
        let error;const timer=setTimeout(()=>finish(),10_000);
        try{globalThis.process=undefined;await import(pathToFileURL(entry));await done;await new Promise(resolve=>setTimeout(resolve,0));}
        catch(reason){error=String(reason);}
        finally{globalThis.process=savedProcess;clearTimeout(timer);}
        const owned=JSON.stringify(responses.map(item=>item.requestId))==='[1,2,3]';
        const expected=inject?responses.every(item=>item.success===false&&item.error===responses[0]?.error&&item.error.includes('Cannot find module')&&item.error.includes(missingDependency)&&!/document is not defined|window is not defined/.test(item.error)):responses.every(item=>item.success===true);
        const passed=!error&&queued&&owned&&expected&&fetches===0&&cacheOpens===0&&typeof document==='undefined'&&typeof window==='undefined';
        return {kind:'emitted-worker-result',entry:path.basename(entry),mode:inject?'import-failure':'bootstrap',passed,queued,owned,fetches,cacheOpens,error,responses,originalEntry,failureFixtureRoot:temporaryRoot,entrySha256:digest(entryBytes),deferred:deferredPath,staticDependencyGraph:graph,limits:'Hashes describe static dependency graph, not a runtime load trace. Actual import/message execution uses Node EventTarget; no browser/CSP, GPU, model or WASM inference claim'};
    }finally{globalThis.process=savedProcess;if(temporaryRoot)fs.rmSync(temporaryRoot,{recursive:true,force:true});}
}
if(args.includes('--child')){
    let result;try{result=await checkChild();}catch(error){result={kind:'emitted-worker-result',passed:false,error:String(error)};}
    console.log(JSON.stringify(result));process.exit(result.passed?0:1);
}else{
    if(!args.includes('--extension-dir'))throw new Error('Usage: node verify-emitted-model-workers.mjs --extension-dir .output/chrome-mv3 [--source-root checkout] [--out /tmp/worker-bootstrap]');
    const root=path.resolve(value('--extension-dir')),out=args.includes('--out')?path.resolve(value('--out')):undefined;
    if(out)fs.mkdirSync(out,{recursive:true});const results=[];
    for(const entry of entries)for(const failure of [false,true]){
        const command=[fileURLToPath(import.meta.url),'--child',path.join(root,entry),...(failure?['--inject-failure']:[])];
        const child=spawnSync(process.execPath,command,{encoding:'utf8',timeout:20_000}),log=(child.stdout||'')+(child.stderr||'');
        const line=(child.stdout||'').split('\n').findLast(item=>item.startsWith('{"kind":"emitted-worker-result"'));
        const result=line?JSON.parse(line):{entry,mode:failure?'import-failure':'bootstrap',passed:false,error:String(child.error||'No result'),log};
        if(child.status!==0)result.passed=false;results.push(result);
        if(out)fs.writeFileSync(path.join(out,entry+(failure?'.import-failure.log':'.bootstrap.log')),log);
    }
    const report={extensionDir:root,passed:results.every(result=>result.passed),results};
    if(out)fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));process.exit(report.passed?0:1);
}

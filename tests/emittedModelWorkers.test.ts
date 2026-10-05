import {afterEach,describe,expect,it} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('../scripts/testing/verify-emitted-model-workers.mjs',import.meta.url));
const roots:string[]=[];
function fixture(mode='normal'){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'fluentread-verifier-fixture-'));roots.push(root);
    fs.writeFileSync(path.join(root,'package.json'),'{"type":"module"}');
    fs.writeFileSync(path.join(root,'entry.js'),`// import('../this-is-comment-only.js')\nconst pending=[];const collect=event=>pending.push(event);self.addEventListener('message',collect);\nimport('./chunk.js').then(({start})=>{start();self.removeEventListener('message',collect);for(const event of pending)self.dispatchEvent(new MessageEvent('message',{data:event.data}));}).catch(error=>{self.removeEventListener('message',collect);const fail=event=>self.postMessage({requestId:event.data.requestId,success:false,error:error.message});self.addEventListener('message',fail);pending.forEach(fail);});`);
    const response=mode==='duplicate'?`self.postMessage(result);self.postMessage(result);`:mode==='out-of-order'?`if(result.requestId===1){first=result;return;}self.postMessage(result);if(result.requestId===2)self.postMessage(first);`:`self.postMessage(result);`;
    const attempted=mode==='cache'?`await caches.open('model').catch(()=>{});`:mode==='fetch'?`await fetch('https://models.invalid').catch(()=>{});`:'';
    fs.writeFileSync(path.join(root,'chunk.js'),`${attempted}let first;export function start(){if(typeof document!=='undefined'||typeof window!=='undefined')throw new Error('Unexpected DOM shim');self.addEventListener('message',event=>{const result={requestId:event.data.requestId,success:true};${response}});}`);
    return root;
}
function run(entry:string,failure=false){
    const result=spawnSync(process.execPath,[script,'--child',entry,...failure?['--inject-failure']:[]],{encoding:'utf8',timeout:15000});
    const line=result.stdout.split('\n').find(line=>line.startsWith('{"kind":"emitted-worker-result"'));
    return {status:result.status,report:line?JSON.parse(line):{error:result.stderr}};
}
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
describe('emitted Worker verifier fixtures, not model qualification',()=>{
    it('executes real fixture chunks without DOM and preserves two queued replies followed by a later reply',()=>{
        const result=run(path.join(fixture(),'entry.js'));
        expect(result.status).toBe(0);expect(result.report).toMatchObject({passed:true,queued:true,owned:true,fetches:0,cacheOpens:0});
        expect(result.report.responses.map((item:any)=>item.requestId)).toEqual([1,2,3]);
        expect(result.report.staticDependencyGraph.map((item:any)=>item.path)).toEqual(['entry.js','chunk.js']);
    });
    it.each(['fetch','cache'])('rejects a swallowed %s access during bootstrap',mode=>{
        const result=run(path.join(fixture(mode),'entry.js'));
        expect(result.status).toBe(1);expect(result.report.owned).toBe(true);
        expect(result.report[mode==='fetch'?'fetches':'cacheOpens']).toBe(1);
    });
    it('rejects a missing entry instead of skipping it',()=>{
        const result=run(path.join(fixture(),'missing.js'));expect(result.status).toBe(1);expect(result.report.error).toContain('Missing emitted entry');
    });
    it('fails normal bootstrap for a missing chunk with the original import error',()=>{
        const root=fixture();fs.unlinkSync(path.join(root,'chunk.js'));const result=run(path.join(root,'entry.js'));
        expect(result.status).toBe(1);expect(result.report.owned).toBe(true);expect(result.report.responses[0].error).toContain('Cannot find module');
    });
    it.each(['duplicate','out-of-order'])('rejects %s response ownership',mode=>{
        const result=run(path.join(fixture(mode),'entry.js'));expect(result.status).toBe(1);expect(result.report.owned).toBe(false);
    });
    it('requires Qwen output exactly when the source checkout declares its entrypoint',()=>{
        const root=fixture(),entry=fs.readFileSync(path.join(root,'entry.js'));fs.mkdirSync(path.join(root,'entrypoints'));
        for(const name of ['localTranslationWorker.js','localTtsWorker.js','videoTranscriptionWorker.js'])fs.writeFileSync(path.join(root,name),entry);
        const command=[script,'--extension-dir',root,'--source-root',root];
        const baseline=spawnSync(process.execPath,command,{encoding:'utf8',timeout:20000});
        expect(baseline.status).toBe(0);expect(JSON.parse(baseline.stdout).results).toHaveLength(6);
        fs.writeFileSync(path.join(root,'entrypoints/qwenAsrWorker.ts'),'export {};');
        const declared=spawnSync(process.execPath,command,{encoding:'utf8',timeout:20000});
        expect(declared.status).toBe(1);const results=JSON.parse(declared.stdout).results;
        expect(results).toHaveLength(8);expect(results.slice(-2).every((item:any)=>item.error.includes('Missing emitted entry'))).toBe(true);
    },20000);
    it('checks failure ownership in an isolated byte copy and removes only that owned copy',()=>{
        const root=fixture(),entry=path.join(root,'entry.js'),before=fs.readFileSync(entry,'utf8');const result=run(entry,true);
        expect(result.status).toBe(0);expect(result.report).toMatchObject({passed:true,owned:true,mode:'import-failure'});
        expect(result.report.failureFixtureRoot).toBeTruthy();expect(fs.existsSync(result.report.failureFixtureRoot)).toBe(false);
        expect(fs.readFileSync(entry,'utf8')).toBe(before);expect(fs.existsSync(path.join(root,'chunk.js'))).toBe(true);
    });
});

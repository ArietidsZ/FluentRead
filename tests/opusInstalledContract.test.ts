import {describe,expect,it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
describe('installed Transformers4.2 metadata contract',()=>{
    it('rejects the generic factory main probe and keeps native component loads pinned without inference',()=>{
        const script=fileURLToPath(new URL('../scripts/testing/check-transformers-pinned-contract.mjs',import.meta.url));
        const child=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:15000});
        expect(child.status,child.stderr||child.stdout).toBe(0);
        const result=JSON.parse(child.stdout.trim().split('\n').at(-1)!);
        expect(result).toMatchObject({version:'4.2.0',factoryMain:true,autoTokenizerMain:true,pinned:true,modelArtifactRequested:true,noNetworkOrWasm:true});
        expect(result.factoryError).toContain('config.json');
        expect(result.requests.some((item:any)=>item.phase==='native-tokenizer'&&item.key.endsWith('/tokenizer.json'))).toBe(true);
    });
});

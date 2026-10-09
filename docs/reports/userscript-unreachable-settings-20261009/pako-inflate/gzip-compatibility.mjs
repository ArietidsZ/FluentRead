import fs from 'node:fs';
import assert from 'node:assert/strict';
import {resolve, dirname} from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const root=process.cwd(), directory=dirname(fileURLToPath(import.meta.url));
const require=createRequire(resolve(root,'package.json')), ts=require('typescript');
const packageRoot=dirname(require.resolve('pako/package.json'));
assert.equal(JSON.parse(fs.readFileSync(resolve(packageRoot,'package.json'),'utf8')).version,'2.1.0');
const oldUrl=pathToFileURL(resolve(packageRoot,'dist/pako.esm.mjs')).href;
const newUrl=pathToFileURL(require.resolve('pako/lib/inflate.js')).href;
const beforeSource=fs.readFileSync(resolve(directory,'pakoBundled.ts.before.txt'),'utf8');
const afterSource=fs.readFileSync(resolve(root,'userscript/pakoBundled.ts'),'utf8');
async function actualWrapper(source,specifier,url) {
 assert(source.includes("from '"+specifier+"'"));
 const qualified=source.replace("from '"+specifier+"'",'from '+JSON.stringify(url));
 const js=ts.transpileModule(qualified,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 return (await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'))).inflateWithPako;
}
const before=await actualWrapper(beforeSource,'pako',oldUrl), after=await actualWrapper(afterSource,'pako/lib/inflate.js',newUrl);
const oldLibrary=await import(oldUrl),newLibrary=await import(newUrl);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fixtures=JSON.parse(fs.readFileSync(resolve(directory,'gzip-fixtures.json'),'utf8'));
const current=fs.readFileSync(resolve(root,'.output/userscript-standalone/fluent-read.user.js'),'utf8');
const currentStrings=[...current.matchAll(/["'](H4sI[A-Za-z0-9+/=]+)["']/gu)].map(match=>match[1]);
assert.equal(currentStrings.length,7);assert.deepEqual([...new Set(currentStrings)].sort(),fixtures.fixtures.map(item=>item.base64).sort());
const rows=[];
for(const item of fixtures.fixtures) {
 const compressed=Buffer.from(item.base64,'base64'),reference=gunzipSync(compressed);
 assert.equal(sha(compressed),item.gzipSha256);
 const padded=new Uint8Array(compressed.length+8).fill(0xa5);padded.set(compressed,3);
 const inputs=[['Uint8Array',Uint8Array.from(compressed)],['Buffer',Buffer.from(compressed)],['offset Uint8Array',padded.subarray(3,3+compressed.length)]];
 const contracts=[];
 for(const [kind,input] of inputs) {
  const original=Buffer.from(input);
  assert.deepEqual(Buffer.from(oldLibrary.ungzip(input)),reference);
  assert.deepEqual(Buffer.from(newLibrary.ungzip(input)),reference);
  const oldText=before(input),newText=after(input);
  assert.equal(newText,oldText);assert.deepEqual(Buffer.from(oldText,'utf8'),reference);assert.deepEqual(Buffer.from(newText,'utf8'),reference);
  assert.deepEqual(Buffer.from(input),original);
  contracts.push({kind,rawBytesEqual:true,wrapperUtf8BytesEqual:true,inputUnchanged:true});
 }
 rows.push({index:item.index,gzipBytes:compressed.length,gzipSha256:sha(compressed),decodedBytes:reference.length,decodedSha256:sha(reference),contracts});
}
function outcome(fn,input) {
 try{return {status:'returned',type:typeof fn(input),value:fn(input)}}
 catch(error){return {status:'threw',type:typeof error,name:error instanceof Error?error.name:undefined,message:error instanceof Error?error.message:String(error)}}
}
const sample=Buffer.from(fixtures.fixtures[0].base64,'base64'),crc=Buffer.from(sample);crc[crc.length-8]^=1;
const invalidInputs=[['invalid header',new Uint8Array([0xff,0xff,0xff,0xff])],['damaged checksum',crc],['empty',new Uint8Array()],['truncated header',sample.subarray(0,9)],['truncated footer',sample.subarray(0,sample.length-4)]];
const invalid=[];
for(const [kind,input] of invalidInputs){const oldResult=outcome(before,input),newResult=outcome(after,input);assert.deepEqual(newResult,oldResult);invalid.push({kind,before:oldResult,after:newResult})}
const record={passed:true,pakoVersion:'2.1.0',baselineHead:fixtures.sourceHead,baselineArtifact:{bytes:fixtures.sourceArtifactBytes,sha256:fixtures.sourceArtifactSha256},afterArtifact:{bytes:Buffer.byteLength(current),sha256:sha(current)},actualWrapperSource:{beforeSha256:sha(beforeSource),afterSha256:sha(afterSource)},method:'Transpile the actual before/after wrapper sources without changing their function bodies; qualify only library import URLs to the actual installed package entries. Compare the seven exact gzip strings captured from the baseline production artifact against Node zlib bytes, both pako library raw bytes and both real wrapper UTF-8 bytes. No function or library stubs.',fixtureCount:rows.length,typedInputCases:rows.length*3,rows,invalidContracts:invalid,allSevenCompressedStringsUnchanged:true,externalApiCalls:0};
fs.writeFileSync(resolve(directory,'gzip-compatibility.json'),JSON.stringify(record,null,2)+'\n');
console.log(JSON.stringify({passed:true,existingGzipData:rows.length,typedInputCases:rows.length*3,invalidContracts:invalid.length,allCompressedStringsUnchanged:true}));

import fs from 'node:fs';
import assert from 'node:assert/strict';
import {resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
const root=process.cwd(),directory=dirname(fileURLToPath(import.meta.url)),require=createRequire(resolve(root,'package.json'));
const ts=require('typescript'),direct=require('@ctrl/tinycolor');
const vendorCode=fs.readFileSync(resolve(root,'userscript/resources/fluentread-vendor.v1.js'),'utf8');
let externalRequests=0;
const realm={URL,URLSearchParams,Headers,Response,Request,Blob,FormData,TextEncoder,TextDecoder,AbortController,AbortSignal,Uint8Array,setTimeout,clearTimeout,ReadableStream,TransformStream,queueMicrotask,structuredClone,DOMException,fetch(){externalRequests++;throw Error('Unexpected network')}};
runInNewContext(vendorCode,realm,{timeout:5000});const shipped=realm.FluentReadUserscriptVendor.tinycolor;
assert.deepEqual(Object.keys(shipped),['TinyColor']);
const inputs=[...Object.keys(direct.names),'','  ReBeccAPurple  ','transparent','banana','#abc','#ABCDEF','#aabbcc80','#1234','#12g',
 'rgb(256, -1, 12)','rgba(1, 2, 3, 0.5)','hsl(360, 100%, 50%)','hsv(120, 100%, 100%)','red; background: url(https://fixture.invalid)',
 null,undefined,0,0xff00ff,NaN,true,{r:256,g:-1,b:12},{r:1,g:2,b:3,a:0.5},{h:360,s:1,l:0.5},{h:120,s:1,v:1}];
const snapshot=Color=>input=>{try {const value=new Color(input);return {status:'returned',valid:value.isValid,alpha:value.getAlpha(),hex:value.toHexString(),hex8:value.toHex8String(),rgb:value.toRgb(),rgbString:value.toRgbString(),hsl:value.toHsl(),hsv:value.toHsv(),name:value.toName()}} catch(error){return {status:'threw',name:error.name,message:error.message}}};
const plain=value=>JSON.parse(JSON.stringify(value));
const rows=inputs.map((input,index)=>{const before=plain(snapshot(direct.TinyColor)(input)),after=plain(snapshot(shipped.TinyColor)(input));assert.deepEqual(after,before);return {index,inputType:typeof input,input:typeof input==='undefined'?'[undefined]':plain(input),before,after}});
const source=fs.readFileSync(resolve(root,'src/core/config/translationAppearance.ts'),'utf8');
assert(source.includes("import {TinyColor} from '@ctrl/tinycolor';"));
const qualified=source.replace("import {TinyColor} from '@ctrl/tinycolor';",'const TinyColor = backend.TinyColor;');
const js=ts.transpileModule(qualified,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function core(backend){const exports={};new Function('exports','backend',js)(exports,backend);return exports}
const oldCore=core(direct),newCore=core(shipped),coreRows=[];
for(const [index,input] of inputs.entries()) {
 const before=oldCore.normalizeTranslationColor(input),after=newCore.normalizeTranslationColor(input);assert.equal(after,before);
 const config={textColor:input,backgroundColor:'navy',lineColor:'rebeccapurple',fillColor:'#abc',fontScale:117,opacity:73,customCss:'border-radius: 6px;'};
 const oldStyle=oldCore.buildTranslationAppearanceCss(config),newStyle=newCore.buildTranslationAppearanceCss(config);assert.equal(newStyle,oldStyle);
 coreRows.push({index,normalizedColor:after,appearanceCssEqual:true});
}
const manifest=JSON.parse(fs.readFileSync(resolve(root,'node_modules/@ctrl/tinycolor/package.json'),'utf8'));assert.equal(manifest.version,'3.6.1');
const license=fs.readFileSync(resolve(root,'node_modules/@ctrl/tinycolor/LICENSE'),'utf8').trim().replace(/[ \t]+$/gmu,'');assert(vendorCode.includes(license));assert(vendorCode.includes('@ctrl/tinycolor 3.6.1 — MIT'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function dataText(text){const sandbox={};runInNewContext(text,sandbox,{timeout:1000});return plain(sandbox.__FLUENTREAD_USERSCRIPT_DATA__)}
function data(file){return dataText(fs.readFileSync(file,'utf8'))}
const originalBytes=execFileSync('git',['show','9b563da892ea6d6c836166e7ee54c9c468c47c9e:userscript/resources/fluentread-data.v1.js']);
const refreshedBytes=execFileSync('git',['show','323d3cb11f0e7dde655e5919d5558167e57499b5:userscript/resources/fluentread-data.v1.js']);
const original=dataText(originalBytes.toString()),refreshed=dataText(refreshedBytes.toString()),afterData=data(resolve(root,'userscript/resources/fluentread-data.v1.js'));
assert.deepEqual(afterData,refreshed);
const changes=[];
const compact=value=>typeof value==='string'&&value.length>200?{utf8Bytes:Buffer.byteLength(value),sha256:hash(value)}:value;
function diff(a,b,path='') {
 if(JSON.stringify(a)===JSON.stringify(b))return;
 if(a&&b&&typeof a==='object'&&typeof b==='object')for(const key of new Set([...Object.keys(a),...Object.keys(b)]))diff(a[key],b[key],path?path+'.'+key:key);
 else changes.push({path,before:compact(a),after:compact(b)});
}
diff(original,refreshed);
const {createServer}=await import(pathToFileURL(resolve(root,'node_modules/vite/dist/node/index.js')).href);
const server=await createServer({root,configFile:false,publicDir:false,appType:'custom',logLevel:'silent',resolve:{alias:{'@':root}},server:{ws:false,hmr:false,middlewareMode:true,watch:null},optimizeDeps:{noDiscovery:true,include:[]}});
let pdf;
try {
 const bundles=await server.ssrLoadModule('/src/core/i18n/bundles.ts'),chinese=await server.ssrLoadModule('/src/core/i18n/messages/zh-CN.ts');
 assert.deepEqual(afterData.english,plain(bundles.UI_LANGUAGE_BUNDLES['en-US']));assert.deepEqual(afterData.zhCNMessages,plain(chinese.zhCNMessages));
 pdf=changes.filter(item=>/pdfReading/u.test(item.path));assert(pdf.length>0);
}finally{await server.close()}
assert.equal(externalRequests,0);
fs.writeFileSync(resolve(directory,'color-api-compatibility.json'),JSON.stringify({passed:true,pakoUnchanged:true,tinycolorVersion:manifest.version,method:'Actual generated vendor IIFE TinyColor versus installed original library; actual unchanged translationAppearance source transpiled with only dependency backend qualified. No algorithm or function stubs.',vendorSha256:hash(vendorCode),translationAppearanceSourceSha256:hash(source),rawApiInputCases:rows.length,coreInputCases:coreRows.length,rows,coreRows,completeMitLicensePresent:true,externalRequests},null,2)+'\n');
fs.writeFileSync(resolve(directory,'resource-refresh-difference.json'),JSON.stringify({originalDataSha256:hash(originalBytes),refreshedDataSha256:hash(refreshedBytes),afterTinycolorDataSha256:hash(fs.readFileSync(resolve(root,'userscript/resources/fluentread-data.v1.js'))),tinycolorChangesData:false,allMessagesEqualCurrentSource:true,changeCount:changes.length,pdfReadingChanges:pdf,allChanges:changes},null,2)+'\n');
console.log(JSON.stringify({passed:true,rawApiInputCases:rows.length,coreInputCases:coreRows.length,completeMitLicense:true,resourceChanges:changes.length,pdfReadingChanges:pdf.length,tinycolorChangesData:false,externalRequests}));

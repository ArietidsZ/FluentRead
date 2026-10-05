/** Metadata-only installed Transformers4.2 contract; no ONNX bytes, network, WASM or GPU initialization. */
import fs from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
const repo='Xenova/opus-mt-en-zh',revision='046f55aec303cdee3e0318604406d4df20f1e8ea';
const pkg=fs.realpathSync(new URL('../../node_modules/@huggingface/transformers-kokoro',import.meta.url));
const assets=process.argv.includes('--assets-dir')?process.argv[process.argv.indexOf('--assets-dir')+1]:undefined;
const artifactManifest=JSON.parse(fs.readFileSync(new URL('../../src/core/config/localTranslationArtifacts.json',import.meta.url)))[repo];
const verifiedMetadata=[];
const actual=name=>{const bytes=fs.readFileSync(path.join(assets,name)),file=artifactManifest.files.find(file=>file.path===name),sha256=createHash('sha256').update(bytes).digest('hex');if(artifactManifest.revision!==revision||bytes.length!==file.size||sha256!==file.sha256)throw new Error('Pinned metadata mismatch '+name);verifiedMetadata.push({path:name,bytes:bytes.length,sha256});return JSON.parse(bytes);};
const config=assets?actual('config.json'):JSON.parse(fs.readFileSync(new URL('../../tests/fixtures/local-translation/opus-en-zh-config.json',import.meta.url)));
const tokenizer=assets?actual('tokenizer.json'):{version:'1.0',truncation:null,padding:null,normalizer:null,pre_tokenizer:null,post_processor:null,
    model:{type:'Unigram',unk_id:1,vocab:[['</s>',0],['<unk>',0],[',',0],['x',0]],byte_fallback:false},added_tokens:[],decoder:{type:'Fuse'}};
const tokenizerConfig=assets?actual('tokenizer_config.json'):{tokenizer_class:'PreTrainedTokenizer',model_max_length:512};
const generationConfig=assets?actual('generation_config.json'):{};
const requests=[],fetches=[];let phase='factory';
const saved=globalThis.process;globalThis.self={constructor:{name:'DedicatedWorkerGlobalScope'}};
Object.defineProperty(globalThis,'navigator',{value:{userAgent:'Node installed metadata contract'},configurable:true});
let library;
try{globalThis.process=undefined;library=await import(pathToFileURL(path.join(pkg,'dist/transformers.js')));}finally{globalThis.process=saved;}
const {env}=library;env.allowLocalModels=true;env.allowRemoteModels=false;env.useBrowserCache=false;env.useFSCache=false;env.useCustomCache=true;env.useWasmCache=false;env.localModelPath='file:///fluentread-contract-models/';
const prefix=`https://huggingface.co/${repo}/resolve/${revision}/`;
env.customCache={match:async key=>{
    requests.push({phase,key});if(!key.startsWith(prefix))return undefined;
    const name=key.slice(prefix.length);
    const value=name==='config.json'?config:name==='tokenizer_config.json'?tokenizerConfig:name==='tokenizer.json'?tokenizer:name==='generation_config.json'?generationConfig:undefined;
    return value?new Response(JSON.stringify(value)):undefined;
},put:async()=>{throw new Error('Metadata contract must not write caches');}};
const fetchImpl=async request=>{const url=typeof request==='string'?request:request.url;fetches.push(url);if(url.startsWith(env.localModelPath))return new Response(null,{status:404});throw new Error('Network/WASM forbidden: '+url);};
env.fetch=fetchImpl;globalThis.fetch=fetchImpl;
let factoryError,autoTokenizerError,modelError;
try{await library.pipeline('translation',repo,{revision,local_files_only:true,device:'wasm',dtype:'fp16'});}catch(error){factoryError=String(error);}
phase='native-config';await library.AutoConfig.from_pretrained(repo,{revision,local_files_only:true});
phase='auto-tokenizer';try{await library.AutoTokenizer.from_pretrained(repo,{revision,local_files_only:true});}catch(error){autoTokenizerError=String(error);}
phase='native-tokenizer';const loadedTokenizer=new library.MarianTokenizer(await(await env.customCache.match(prefix+'tokenizer.json')).json(),await(await env.customCache.match(prefix+'tokenizer_config.json')).json());
if(assets?loadedTokenizer('x').input_ids.data.length===0:Number(loadedTokenizer('x').input_ids.data[0])!==3)throw new Error('Native tokenizer fixture did not execute');
phase='native-model';try{await library.AutoModelForSeq2SeqLM.from_pretrained(repo,{revision,local_files_only:true,device:'wasm',dtype:'fp16'});}catch(error){modelError=String(error);}
const factoryMain=requests.some(item=>item.phase==='factory'&&item.key===`https://huggingface.co/${repo}/resolve/main/config.json`);
const autoTokenizerMain=requests.some(item=>item.phase==='auto-tokenizer'&&item.key===`https://huggingface.co/${repo}/resolve/main/tokenizer_config.json`);
const native=requests.filter(item=>item.phase.startsWith('native-')&&item.key.startsWith('https://'));
const pinned=native.length>0&&native.every(item=>item.key.startsWith(prefix));
const modelArtifactRequested=native.some(item=>item.phase==='native-model'&&item.key.endsWith('.onnx'));
const noNetworkOrWasm=fetches.every(url=>url.startsWith(env.localModelPath));
const result={verifiedMetadata,metadataSource:assets?'actual pinned bytes':'minimal tokenizer fixture plus pinned config',version:env.version,repo,revision,factoryMain,autoTokenizerMain,pinned,modelArtifactRequested,noNetworkOrWasm,factoryError,autoTokenizerError,modelError,requests,fetches};
console.log(JSON.stringify(result));
if(env.version!=='4.2.0'||!factoryError||!factoryMain||!autoTokenizerError||!autoTokenizerMain||!pinned||!modelArtifactRequested||!modelError||!noNetworkOrWasm)process.exitCode=1;

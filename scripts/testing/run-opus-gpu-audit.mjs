/** Offline qualification only: native Dawn bridge is supplied by the caller, never installed by this script. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const [assets, repo, source, target, device = 'webgpu', dtype = 'fp16', bridge] = process.argv.slice(2);
if (!assets || !repo || !source || !target || !['wasm', 'webgpu'].includes(device)) {
    throw new Error('Usage: node run-opus-gpu-audit.mjs ASSETS REPO SOURCE TARGET [webgpu|wasm] [fp16|q8] [absolute webgpu module]');
}
const emit = data => console.log(JSON.stringify(data));
const revision = JSON.parse(fs.readFileSync(path.join(assets, 'manifest.json')))[repo].revision;
let dispatches = 0, peakBytes = 0, liveBytes = 0;
if (device === 'webgpu') {
    if (!bridge) throw new Error('Provide the installed Dawn WebGPU module path');
    const {create, globals} = await import(pathToFileURL(bridge));
    Object.assign(globalThis, globals);
    const gpu = create(['backend=vulkan']);
    Object.defineProperty(globalThis, 'navigator', {value: {gpu, userAgent:'Node.js Dawn qualification harness'}, configurable: true});
    const adapter = await gpu.requestAdapter({powerPreference: 'high-performance'});
    if (!adapter) throw new Error('No adapter');
    emit({event:'adapter', info:adapter.info, features:Array.from(adapter.features), maxStorageBufferBindingSize:adapter.limits.maxStorageBufferBindingSize});
    if (dtype === 'fp16' && !adapter.features.has('shader-f16')) throw new Error('Missing shader-f16');
    // Dawn's iterable features need the standard setlike forEach for the stock ORT runtime.
    const prototype = Object.getPrototypeOf(adapter.features);
    if (!prototype.forEach) prototype.forEach = function(callback, context) { for (const value of this) callback.call(context, value, value, this); };
    for (const key of ['dispatchWorkgroups', 'dispatchWorkgroupsIndirect']) {
        const native = GPUComputePassEncoder.prototype[key];
        GPUComputePassEncoder.prototype[key] = function(...args) { dispatches++; return native.apply(this, args); };
    }
    const sizes = new WeakMap(), createBuffer = GPUDevice.prototype.createBuffer, destroy = GPUBuffer.prototype.destroy;
    GPUDevice.prototype.createBuffer = function(descriptor) {
        const buffer = createBuffer.call(this, descriptor); sizes.set(buffer, descriptor.size);
        liveBytes += descriptor.size; peakBytes = Math.max(peakBytes, liveBytes); return buffer;
    };
    GPUBuffer.prototype.destroy = function() { liveBytes -= sizes.get(this) || 0; sizes.delete(this); return destroy.call(this); };
}
// Select the unmodified browser distribution, then restore Node for ORT's local WASM loader.
const nodeProcess = globalThis.process;
const priorSelf = globalThis.self;
let transformers;
const packageName = process.env.OPUS_TRANSFORMERS === '4.2.0' ? 'transformers-kokoro' : 'transformers';
const packageRoot = fs.realpathSync(new URL(`../../node_modules/@huggingface/${packageName}`, import.meta.url));
const ortDist = path.resolve(packageRoot, '../../onnxruntime-web/dist');
try {
    globalThis.process = undefined;
    // Activate the library's real Worker session-serialization path, as in the extension.
    globalThis.self = {constructor:{name:'DedicatedWorkerGlobalScope'}};
    transformers = await import(pathToFileURL(path.join(packageRoot, 'dist/transformers.js')));
} finally { globalThis.process = nodeProcess; globalThis.self = priorSelf; }
const {env, pipeline} = transformers;
env.allowLocalModels = true; env.allowRemoteModels = false; env.useBrowserCache = false; env.useFSCache = false;
env.localModelPath = 'https://offline.invalid/'; env.useCustomCache = true;
env.customCache = {
    match: async key => {
        const url = typeof key === 'string' ? key : key.url;
        const prefix = env.localModelPath + repo + '/';
        if (!url.startsWith(prefix)) return undefined;
        const relative = url.slice(prefix.length);
        if (relative.includes('..')) throw new Error('Invalid asset path');
        const file = process.env.OPUS_GRAPH_DIR && relative.endsWith('.onnx')
            ? path.join(process.env.OPUS_GRAPH_DIR, path.basename(relative)) : path.join(assets, relative);
        if (!fs.existsSync(file)) return undefined;
        const bytes = fs.readFileSync(file);
        if (process.env.OPUS_UNK_FIX === '1' && repo === 'Xenova/opus-mt-en-jap' && relative === 'tokenizer.json') {
            const tokenizer = JSON.parse(bytes);
            if (tokenizer.model.unk_id !== 2 || tokenizer.model.vocab[1][0] !== '<unk>' || tokenizer.model.vocab[2][0] !== ',') throw new Error('Unexpected tokenizer, refuse diagnostic patch');
            tokenizer.model.unk_id = 1;
            return new Response(JSON.stringify(tokenizer));
        }
        return new Response(bytes);
    },
    put: async () => { throw new Error('Unexpected cache write'); },
};
globalThis.fetch = async url => { throw new Error(`Network forbidden during qualification: ${url}`); };
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.wasmPaths = ortDist + '/';
env.backends.onnx.logLevel = 'verbose';
let kernels = 0;
if (device === 'webgpu') env.backends.onnx.webgpu.profiling = {mode:'default', ondata:() => { kernels++; }};
emit({event:'runtime', versions:env.backends.onnx.versions, transformers:env.version, device, dtype});
if (process.env.OPUS_TOKENIZE_ONLY === '1') {
    const tokenizer = await transformers.AutoTokenizer.from_pretrained(repo,{local_files_only:true,revision});
    const fixtures = JSON.parse(fs.readFileSync(new URL('../../tests/fixtures/local-translation/opus-quality.json', import.meta.url)));
    for (const fixture of fixtures.filter(item => item.source === source && item.target === target)) {
        emit({id:fixture.id, ids:Array.from(tokenizer(fixture.text).input_ids.data, Number)});
    }
    process.exit(0);
}
const started = performance.now();
const translator = await pipeline('translation', repo, {device, dtype, revision, local_files_only:true, session_options:{
    graphOptimizationLevel:process.env.OPUS_OPTIMIZATION || 'all', logSeverityLevel:0, logVerbosityLevel:1, enableCpuMemArena:false, enableMemPattern:false, executionMode:'sequential',
    ...(process.env.OPUS_STRICT_GPU === '1' ? {extra:{session:{disable_cpu_ep_fallback:'1'}}} : {}),
}});
emit({event:'loaded', repo, revision, device, dtype, milliseconds:performance.now()-started, runtime:env.backends.onnx.versions});
if (process.env.OPUS_INIT_ONLY === '1') { await translator.dispose(); process.exit(0); }
for (const [name, session] of Object.entries(translator.model.sessions)) {
    const nativeRun = session.run.bind(session);
    let runs = 0;
    session.run = async (...args) => {
        const before = dispatches;
        const result = await nativeRun(...args);
        emit({event:'session-run', name, run:++runs, dispatches:dispatches-before,
            cached:args[0].use_cache_branch ? Boolean(args[0].use_cache_branch.data[0]) : undefined,
            inputs:Object.fromEntries(Object.entries(args[0]).map(([key,tensor])=>[key,{type:tensor.type,dims:tensor.dims}]))});
        return result;
    };
}
const fixtures = JSON.parse(fs.readFileSync(new URL('../../tests/fixtures/local-translation/opus-quality.json', import.meta.url)));
try {
    for (const fixture of fixtures.filter(item => item.source === source && item.target === target)) {
        const before = dispatches, start = performance.now();
        const result = await translator(fixture.text, {src_lang:source, tgt_lang:target, max_new_tokens:128, do_sample:false, ...(process.env.OPUS_REFERENCE_DECODING === '1' ? {num_beams:4} : {num_beams:1, no_repeat_ngram_size:4, repetition_penalty:1.1})});
        const text = result[0]?.translation_text || '';
        emit({event:'translation', ...fixture, input:fixture.text, text, nonempty:!!text.trim(), numbersPreserved:(fixture.numbers || []).every(number => text.includes(number)), milliseconds:performance.now()-start, dispatches:dispatches-before, kernels, peakBytes, processMaxRssKiB:process.resourceUsage().maxRSS});
    }
} finally { await translator.dispose(); }
emit({event:'disposed', liveBytes, peakBytes, dispatches, kernels});
process.exit(0);

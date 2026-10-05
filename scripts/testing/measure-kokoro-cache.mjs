import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root = process.cwd();
const require = createRequire(path.join(root, 'package.json'));
const {build} = createRequire(require.resolve('vite'))('esbuild');
const source = process.argv[2] ?? path.join(root, 'src/features/local-tts/offscreen/modelCache.ts');
const {outputFiles} = await build({entryPoints: [source], bundle: true, platform: 'node', format: 'esm', write: false,
    alias: {'@': root}, tsconfig: path.join(root, 'tsconfig.json'), logLevel: 'silent'});
const module = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'));
const NativeResponse = Response;
const sourceResponses = new WeakSet(), sourceBuffers = new WeakSet();
const metrics = {fetchArrayBufferCalls: 0, fetchArrayBufferBytes: 0, explicitSliceBytes: 0,
    responseBufferInputBytes: 0, maxExplicitHandoffBytes: 0};
let currentSourceBytes = 0;
const arrayBuffer = NativeResponse.prototype.arrayBuffer;
NativeResponse.prototype.arrayBuffer = async function () {
    const result = await arrayBuffer.call(this);
    if (sourceResponses.has(this)) {
        metrics.fetchArrayBufferCalls++; metrics.fetchArrayBufferBytes += result.byteLength;
        currentSourceBytes = result.byteLength; sourceBuffers.add(result);
    }
    return result;
};
const slice = ArrayBuffer.prototype.slice;
ArrayBuffer.prototype.slice = function (...args) {
    const result = slice.apply(this, args);
    if (sourceBuffers.has(this)) metrics.explicitSliceBytes += result.byteLength;
    return result;
};
globalThis.Response = class extends NativeResponse {
    constructor(body, init) {
        if (body instanceof ArrayBuffer) {
            metrics.responseBufferInputBytes += body.byteLength;
            metrics.maxExplicitHandoffBytes = Math.max(metrics.maxExplicitHandoffBytes, currentSourceBytes + body.byteLength);
        }
        super(body, init);
    }
};
const stores = new Map();
globalThis.caches = {async open(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    const entries = stores.get(name);
    return {
        async match(url) {const value = entries.get(url); return value && new NativeResponse(value.bytes, {headers: value.headers});},
        async put(url, response) {entries.set(url, {bytes: new Uint8Array(await response.arrayBuffer()), headers: new Headers(response.headers)});},
        async delete(url) {return entries.delete(url);},
    };
}};
globalThis.self = globalThis;
globalThis.fetch = async url => {
    const size = url.endsWith('/onnx/model.onnx') ? 1024 * 1024 : url.endsWith('.bin') ? 256 : 128;
    const value = createHash('sha256').update(url).digest()[0];
    let offset = 0;
    const response = new NativeResponse(new ReadableStream({pull(controller) {
        if (offset === size) {controller.close(); return;}
        const count = Math.min(16384, size - offset); offset += count;
        controller.enqueue(new Uint8Array(count).fill(value));
    }}));
    sourceResponses.add(response); return response;
};
await module.cacheLocalTtsModelFiles();
const models = stores.get('transformers-cache'), voices = stores.get('kokoro-voices');
const canonicalHashes = Object.fromEntries(module.LOCAL_TTS_MODEL_FILES.map(file => [file,
    createHash('sha256').update(models.get(module.getLocalTtsModelFileUrl(file)).bytes).digest('hex')]));
console.log(JSON.stringify({source, ...metrics, modelEntries: models.size,
    modelBytes: [...models.values()].reduce((sum, value) => sum + value.bytes.byteLength, 0),
    voiceEntries: voices.size, voiceBytes: [...voices.values()].reduce((sum, value) => sum + value.bytes.byteLength, 0),
    canonicalHashes}, null, 2));

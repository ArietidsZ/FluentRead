/**
 * @file src/features/local-translation/offscreen/translation.worker.ts
 *
 * 文件职责：在隔离 Worker 中运行轻量 OPUS 翻译和混元 Hy-MT2 翻译。
 * 主要内容：只读取已校验的离线模型；OPUS FP16/FP32 配置强制 WebGPU，原 Q8 保留 CPU；混元优先 WebGPU，CPU 限单线程；分句推理和重复保护约束资源与输出。
 * 模块边界：不下载模型、不读取页面配置，空闲释放、请求取消和最终超时由外层 Worker 生命周期控制。
 */
import {env, InterruptableStoppingCriteria, pipeline} from '@huggingface/transformers';
import {env as fp16Env, InterruptableStoppingCriteria as Fp16StoppingCriteria, MarianTokenizer as Fp16Tokenizer, AutoModelForSeq2SeqLM as Fp16Model, TranslationPipeline as Fp16Pipeline} from '@huggingface/transformers-kokoro';
import {Wllama} from '@wllama/wllama/esm/index.js';
import {
    getLocalTranslationModel, resolveOpusTranslationRepository,
    LOCAL_TRANSLATION_DTYPE, LOCAL_TRANSLATION_MODEL_REMOTE_HOST,
} from '@/src/core/config/localTranslation';
import {assertLocalTranslationOutput, hunyuanTranslationPrompt, splitLocalTranslationText} from '@/src/core/translation/localInference';
import {getTranslationArtifacts, matchTranslationArtifact, translationArtifactBlob} from './artifactStore';
import {supportsHunyuanTranslation} from '@/src/platform/browser/localTranslationSupport';
import {configureOnnxWasmBackend, withCompressedWasmBinary} from '@/src/shared/onnx/wasmBinary';

import {createIndexTranslator} from './indexEngine';
import {requireOpusGpu, opusGpuSessionOptions} from './opusGpu';
import type {LocalTranslationHints} from '@/src/core/translation/indexInference';

type Translator = ((text: string, options?: Record<string, unknown>) => Promise<unknown>) & {dispose?: () => Promise<void>};
interface WorkerRequest {
    requestId: number;
    type: 'translate' | 'dispose';
    model: string;
    text?: string;
    hints?: LocalTranslationHints;
    sourceLanguage?: string;
    targetLanguage?: string;
}
const MAX_INFERENCE_MS = 90_000;
let translator: Translator | undefined;
let translatorRepository = '';
let hunyuan: Wllama | undefined;
let index: Awaited<ReturnType<typeof createIndexTranslator>> | undefined;
let backend: 'wasm' | 'webgpu' = 'wasm';
let taskQueue = Promise.resolve();

function extensionUrl(path: string): string { return new URL(path, self.location.href).toString(); }

function configureEnvironment(runtimeEnv: typeof env | typeof fp16Env = env, fp16 = false): void {
    const wasmName = fp16 ? 'tts-ort-wasm-simd-threaded.asyncify' : 'ort-wasm-simd-threaded.jsep';
    // Transformers4 的 WASM缓存会生成 blob 模块 URL，违反 MV3 Worker CSP。
    if (fp16) fp16Env.useWasmCache = false;
    runtimeEnv.allowLocalModels = true;
    runtimeEnv.allowRemoteModels = false;
    runtimeEnv.localModelPath = extensionUrl('local-models/');
    runtimeEnv.useBrowserCache = false;
    runtimeEnv.useFSCache = false;
    runtimeEnv.useCustomCache = true;
    runtimeEnv.customCache = {
        match: async (request: string | Request) => {
            const key = typeof request === 'string' ? request : (request as Request).url;
            // Avoid even a local missing-file probe for optional tokenizer metadata.
            if (key.startsWith(runtimeEnv.localModelPath)) return undefined;
            return await matchTranslationArtifact(key)
                || await (await caches.open('transformers-cache')).match(key);
        },
        put: async () => { throw new Error('LOCAL_TRANSLATION_NOT_DOWNLOADED'); },
    };
    runtimeEnv.remoteHost = LOCAL_TRANSLATION_MODEL_REMOTE_HOST;
    runtimeEnv.remotePathTemplate = '{model}/resolve/{revision}/';
    if (runtimeEnv.backends.onnx.wasm) {
        runtimeEnv.backends.onnx.wasm.numThreads = 1;
        configureOnnxWasmBackend(runtimeEnv.backends.onnx.wasm, {
            mjs: extensionUrl(`fluent-read-ai/${wasmName}.mjs`),
            wasm: extensionUrl(`fluent-read-ai/${wasmName}.wasm`),
        });
    }
}

async function dispose(): Promise<void> {
    const currentIndex=index;index=undefined;
    await currentIndex?.dispose();
    await translator?.dispose?.();
    translator = undefined;
    translatorRepository = '';
    await hunyuan?.exit();
    hunyuan = undefined;
}

async function getTranslator(request: WorkerRequest): Promise<Translator> {
    const item = getLocalTranslationModel(request.model);
    const repository = item.engine === 'opus'
        ? resolveOpusTranslationRepository(request.model, request.sourceLanguage!, request.targetLanguage!) : request.model;
    const gpu = !!item.onnxDtype;
    const fp16 = item.onnxDtype === 'fp16';
    const cacheKey = `${repository}:${item.onnxDtype || 'q8'}`;
    if (translator && translatorRepository === cacheKey) return translator;
    await dispose();
    if (item.onnxDtype) await requireOpusGpu(item.onnxDtype);
    if (fp16) configureEnvironment(fp16Env, true);
    const artifacts = getTranslationArtifacts(request.model);
    const revision = artifacts.find((file) => file.repo === repository)?.revision || 'main';
    const options = {
        device: gpu ? 'webgpu' as const : 'wasm' as const,
        dtype: item.onnxDtype || LOCAL_TRANSLATION_DTYPE, revision, local_files_only: true,
        session_options: {enableCpuMemArena: false, enableMemPattern: false, executionMode: 'sequential' as const,
            ...(gpu ? opusGpuSessionOptions() : {})},
    };
    const create = async (): Promise<Translator> => {
        if (!fp16) return pipeline('translation', repository, options) as unknown as Promise<Translator>;
        // Transformers4.2 的通用 pipeline 注册表预检丢弃 revision，尝试读取 main/config.json。
        // 直接装配同一原生 Pipeline，所有组件均显式固定版本；不为 main 建立缓存别名。
        // AutoTokenizer 的文件存在性预检同样省略 revision，直接读取已校验的 tokenizer JSON。
        const readTokenizer = async (path: string) => {
            const file = artifacts.find(file => file.repo === repository && file.path === path);
            if (!file) throw new Error('LOCAL_TRANSLATION_INVALID_MODEL');
            return JSON.parse(await (await translationArtifactBlob(file)).text());
        };
        const tokenizer = new Fp16Tokenizer(await readTokenizer('tokenizer.json'), await readTokenizer('tokenizer_config.json'));
        const model = await Fp16Model.from_pretrained(repository, options);
        try { return new Fp16Pipeline({task: 'translation', model, tokenizer}) as unknown as Translator; }
        catch (error) { await model.dispose().catch(() => undefined); throw error; }
    };
    const wasm = (fp16 ? fp16Env : env).backends.onnx.wasm;
    const wasmPath = extensionUrl(fp16 ? 'fluent-read-ai/tts-ort-wasm-simd-threaded.asyncify.wasm' : 'fluent-read-ai/ort-wasm-simd-threaded.jsep.wasm');
    translator = await (wasm
        ? withCompressedWasmBinary(wasm, wasmPath, create)
        : create());
    translatorRepository = cacheKey;
    backend = gpu ? 'webgpu' : 'wasm';
    return translator;
}

async function getHunyuan(model: string): Promise<Wllama> {
    if (!supportsHunyuanTranslation()) throw new Error('LOCAL_TRANSLATION_BROWSER_UNSUPPORTED');
    if (hunyuan) return hunyuan;
    await dispose();
    const file = getTranslationArtifacts(model)[0];
    if (!file) throw new Error('LOCAL_TRANSLATION_INVALID_MODEL');
    const blob = await translationArtifactBlob(file);
    const makeEngine = () => {
        const engine = new Wllama({default: extensionUrl('fluent-read-ai/wllama.wasm')}, {
            suppressNativeLog: true,
            logger: {debug() {}, log() {}, warn() {}, error() {}},
        });
        engine.setCompat(null);
        return engine;
    };
    const supportsGpu = 'gpu' in navigator && 'Suspending' in WebAssembly;
    let engine = makeEngine();
    const load = (gpu: boolean) => engine.loadModel([blob], {
        n_ctx: 2048, n_batch: 128, n_ubatch: 64, n_threads: 1, n_parallel: 1,
        n_gpu_layers: gpu ? 99 : 0, warmup: false, jinja: true,
        cache_idle_slots: false, ctx_shift: false,
    });
    try {
        await load(supportsGpu);
        backend = supportsGpu ? 'webgpu' : 'wasm';
    } catch (error) {
        await engine.exit().catch(() => undefined);
        if (!supportsGpu) throw error;
        engine = makeEngine();
        try { await load(false); } catch (fallbackError) { await engine.exit().catch(() => undefined); throw fallbackError; }
        backend = 'wasm';
    }
    hunyuan = engine;
    return engine;
}

async function translate(request: WorkerRequest): Promise<string> {
    if (!request.text?.trim() || !request.sourceLanguage || !request.targetLanguage) throw new Error('LOCAL_TRANSLATION_INVALID_REQUEST');
    if(getLocalTranslationModel(request.model).engine==='index'){
        if(!index){await dispose();index=await createIndexTranslator(request.model,extensionUrl('fluent-read-ai/wllama.wasm'));}
        backend='webgpu';
        const abort=new AbortController();
        const timer=self.setTimeout(()=>abort.abort(),MAX_INFERENCE_MS);
        try{return await index.translate(request.text,request.targetLanguage,request.hints||{},abort.signal);}
        catch(error){index=undefined;throw error;}
        finally{self.clearTimeout(timer);}
    }
    const isHunyuan = getLocalTranslationModel(request.model).engine === 'hunyuan';
    const engine = isHunyuan ? await getHunyuan(request.model) : await getTranslator(request);
    const abort = new AbortController();
    const stop = getLocalTranslationModel(request.model).onnxDtype === 'fp16'
        ? new Fp16StoppingCriteria() : new InterruptableStoppingCriteria();
    const timer = self.setTimeout(() => { abort.abort(); stop.interrupt(); }, MAX_INFERENCE_MS);
    try {
        const chunks = splitLocalTranslationText(request.text);
        const results: string[] = [];
        for (const chunk of chunks) {
            if (!chunk.trim()) { results.push(chunk); continue; }
            let translated: string;
            if (isHunyuan) {
                const response = await (engine as Wllama).createChatCompletion({
                    messages: [{role: 'user', content: hunyuanTranslationPrompt(chunk.trim(), request.sourceLanguage, request.targetLanguage)}],
                    max_tokens: 768, temperature: 0.7, top_p: 0.6, top_k: 20,
                    penalty_repeat: 1.05, seed: 42, cache_prompt: false, abortSignal: abort.signal,
                });
                if (response.choices[0]?.finish_reason === 'length') throw new Error('LOCAL_TRANSLATION_OUTPUT_LIMIT');
                translated = response.choices[0]?.message.content || '';
            } else {
                const output = await (engine as Translator)(chunk.trim(), {
                    src_lang: request.sourceLanguage, tgt_lang: request.targetLanguage,
                    max_new_tokens: 512, do_sample: false, num_beams: 1,
                    no_repeat_ngram_size: 4, repetition_penalty: 1.1, stopping_criteria: stop,
                });
                const first = Array.isArray(output) ? output[0] : output;
                translated = (first as {translation_text?: string})?.translation_text || '';
            }
            if (abort.signal.aborted || stop.interrupted) throw new Error('LOCAL_TRANSLATION_TIMEOUT');
            assertLocalTranslationOutput(translated, chunk);
            results.push((chunk.match(/^\s*/u)?.[0] || '') + translated.trim() + (chunk.match(/\s*$/u)?.[0] || ''));
            await new Promise((resolve) => self.setTimeout(resolve, 0));
        }
        return results.join('');
    } finally {
        self.clearTimeout(timer);
    }
}

export function startLocalTranslationWorker(): void {
    configureEnvironment();
    self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
        const request = event.data;
        if (!request || typeof request.requestId !== 'number') return;
        const run = async () => {
            try {
                if (request.type === 'dispose') { await dispose(); self.postMessage({requestId: request.requestId, success: true}); return; }
                const started = performance.now();
                const result = await translate(request);
                self.postMessage({requestId: request.requestId, success: true, result, backend, elapsedMs: performance.now() - started});
            } catch (error) {
                self.postMessage({requestId: request.requestId, success: false, error: error instanceof Error ? error.message : 'LOCAL_TRANSLATION_FAILED'});
            }
        };
        taskQueue = taskQueue.then(run, run);
    });
}

/**
 * @file src/services/translation/visionProbe.ts
 * 文件职责：结合手动设置、有效探测缓存与内置规则决定当前模型识图能力，并复用共享翻译链路探测未知模型。
 * 主要内容：在规则和缓存前验证可信来源及明确测试目标，冻结配置与严格测试提示词，生成随机 PNG；原生缓存准备等待可独立取消且有界，不中止共享读取；缓存区分来源并串行提交，取消期间的迟到持久化恢复旧记录，只有匹配答案或明确图片输入拒绝落盘。
 * 模块边界：通过注入的翻译和存储端口执行副作用，不实现厂商协议、不读取页面图片、不改写用户配置或提示词。
 */
import {resolveAreaRecognitionRoute, resolveModelVisionCapability, supportsVisionTransport, type AreaRecognitionRouteInput} from '@/src/core/config/vision';
import {createVisionProbeIdentity, scopeVisionProbeConfig, assertVisionProbeTarget, matchesVisionProbeAnswer, normalizeVisionProbeRecords, VISION_PROBE_TIMEOUT_MS,
    type VisionProbeRecord, type VisionProbeResult} from '@/src/core/config/visionProbe';
import {createVisionProbeImage} from '@/src/core/translation/visionProbeImage';
import {attachTranslationImageInput, attachTranslationProviderConfig, attachTranslationRequestControl,
    createTranslationProviderConfigSnapshot, markTranslationRemainingBudget} from './requestSnapshot';
import type {TranslationConfigSource, TranslationRequestMessage} from './types';
import {NATIVE_PRIVATE_ROUTE_SUPPORTED, lockIncognitoRoute, resolveIncognitoRoute} from '@/src/core/config/incognitoRoute';
import {assertTranslationSourcePrivacy, attachTranslationSourcePrivacy, getTranslationSourcePrivacy, fullPageTranslationConfigKey} from './requestPrivacy';
import type {Config} from '@/src/core/config/model';
import {waitForTranslationRequestPreparation} from './requestRegistry';

export interface VisionProbeConfig extends TranslationConfigSource {modelVision?: Record<string, Record<string, boolean>>;}
export const VISION_PROBE_MESSAGE = 'fluentReadModelVisionProbe';
export const VISION_PROBE_CANCEL_MESSAGE = 'fluentReadModelVisionProbeCancel';
export interface VisionProbePersistence {load(): Promise<unknown>; save(records: VisionProbeRecord[]): Promise<void>;}
export interface VisionProbeOptions {force?: boolean; probeUnknown?: boolean; signal?: AbortSignal; timeoutMs?: number;}

/** 仅在进程内比较；凭据只进入既有摘要，计数和 UI 偏好不撤销模型任务。 */
export function visionProbeConfigKey(source: VisionProbeConfig, service: string, model: string): string {
    return JSON.stringify([fullPageTranslationConfigKey(source as Config), source.modelVision, createVisionProbeIdentity(source, service, model)]);
}

export function freezeVisionProbeConfig(source: VisionProbeConfig): VisionProbeConfig {
    return {...createTranslationProviderConfigSnapshot(source), modelVision: Object.fromEntries(
        Object.entries(source.modelVision ?? {}).map(([service, models]) => [service, {...models}]))};
}
/** 手动与自动共用原生准入；明确选择不允许 broker 静默换成另一个私密模型。 */
export function prepareVisionProbeSource(source: VisionProbeConfig, service: string, model: string): VisionProbeConfig {
    assertTranslationSourcePrivacy(source, source, source);
    const privacy = getTranslationSourcePrivacy(source);
    let frozen = freezeVisionProbeConfig(source);
    if (privacy === 'private') {
        const route = resolveIncognitoRoute(frozen);
        if (route) {
            assertVisionProbeTarget(route, service, model);
            frozen = lockIncognitoRoute(frozen, route);
        }
    }
    return privacy ? scopeVisionProbeConfig(frozen, privacy) : frozen;
}
/** 在任何等待前冻结圈选身份，未知模型先测试，失败传播到原事务且不改用 OCR。 */
export function prepareModelVisionRoute(source: VisionProbeConfig & AreaRecognitionRouteInput,
    resolve: (config: VisionProbeConfig, service: string, model: string, options: VisionProbeOptions) => Promise<VisionProbeResult>) {
    const frozen = {...freezeVisionProbeConfig(source), areaRecognitionMode: source.areaRecognitionMode,
        areaTranslationService: source.areaTranslationService};
    const route = resolveAreaRecognitionRoute(frozen);
    return async (options: VisionProbeOptions) => {
        if (frozen.areaRecognitionMode !== 'prefer-vision') return route;
        const result = await resolve(frozen, route.service, route.model, {...options, probeUnknown: true});
        return result.capability === 'supported' ? {mode: 'vision' as const}
            : {mode: 'ocr' as const, fallback: result.capability === 'unsupported' ? 'unsupported' as const : 'unknown' as const};
    };
}

export function createModelVisionProbe(deps: {
    translate(request: TranslationRequestMessage): Promise<string | string[]>;
    storage: VisionProbePersistence;
    now?: () => number;
    random?: () => Uint8Array;
}) {
    const now = deps.now ?? Date.now;
    let records: VisionProbeRecord[] = [];
    let loaded: Promise<void> | undefined;
    let writes = Promise.resolve();
    const active = new Map<string, {controller: AbortController; users: number; promise: Promise<VisionProbeResult>}>();
    const load = () => loaded ??= deps.storage.load().then(value => { records = normalizeVisionProbeRecords(value, now()); })
        .catch(error => { loaded = undefined; throw error; });
    const save = () => {
        const snapshot = normalizeVisionProbeRecords(records, now());
        const write = writes.catch(() => undefined).then(() => deps.storage.save(snapshot));
        writes = write;
        return write;
    };
    const saveNative = (change: (previous: VisionProbeRecord[]) => VisionProbeRecord[], signal: AbortSignal) => {
        const write = writes.catch(() => undefined).then(async () => {
            signal.throwIfAborted();
            const snapshot = normalizeVisionProbeRecords(change(records), now());
            await deps.storage.save(snapshot);
            if (signal.aborted) {await deps.storage.save(normalizeVisionProbeRecords(records, now())); signal.throwIfAborted();}
            records = snapshot;
        });
        writes = write;
        return write;
    };
    const cached = (identity: string): VisionProbeResult | undefined => {
        records = normalizeVisionProbeRecords(records, now());
        const record = records.find(item => item.identity === identity);
        return record ? {capability: record.capability, source: 'probe', checkedAt: record.checkedAt} : undefined;
    };
    async function resolve(source: VisionProbeConfig, service: string, model: string, options: VisionProbeOptions = {}): Promise<VisionProbeResult> {
        const frozen = NATIVE_PRIVATE_ROUTE_SUPPORTED ? prepareVisionProbeSource(source, service, model) : createTranslationProviderConfigSnapshot(source);
        const explicit = source.modelVision?.[service]?.[model];
        const identity = createVisionProbeIdentity(frozen, service, model);
        const rule = resolveModelVisionCapability(service, model, source.modelVision);
        if (!supportsVisionTransport(service, model)) return {capability: 'unsupported', source: 'rule'};
        if (!options.force && typeof explicit === 'boolean') return {capability: rule, source: 'override'};
        if (NATIVE_PRIVATE_ROUTE_SUPPORTED) {
            options.signal?.throwIfAborted();
            let timer: ReturnType<typeof setTimeout>;
            try {
                await waitForTranslationRequestPreparation(Promise.race([load(), new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new Error('识图检测超时，请重试')),
                        Math.min(VISION_PROBE_TIMEOUT_MS, Math.max(1, options.timeoutMs ?? VISION_PROBE_TIMEOUT_MS)));
                })]), options.signal);
            } finally {clearTimeout(timer!);}
        } else await load();
        options.signal?.throwIfAborted();
        if (!options.force) {
            const result = cached(identity);
            if (result) return result;
            if (rule !== 'unknown') return {capability: rule, source: 'rule'};
            if (!options.probeUnknown) return {capability: 'unknown', source: 'unknown'};
        }
        let entry = active.get(identity);
        if (!entry) {
            const controller = new AbortController();
            const promise = execute(frozen, service, model, identity, controller.signal);
            entry = {controller, users: 0, promise};
            active.set(identity, entry);
            void promise.finally(() => { if (active.get(identity)?.promise === promise) active.delete(identity); }).catch(() => undefined);
        }
        entry.users++;
        const current = entry;
        const budget = Math.min(VISION_PROBE_TIMEOUT_MS, Math.max(1, options.timeoutMs ?? VISION_PROBE_TIMEOUT_MS));
        let timer: ReturnType<typeof setTimeout>;
        let onAbort: () => void;
        const interrupted = new Promise<never>((_, reject) => {
            onAbort = () => reject(new DOMException('识图检测已取消', 'AbortError'));
            options.signal?.addEventListener('abort', onAbort, {once: true});
            timer = setTimeout(() => reject(new Error('识图检测超时，请重试')), budget);
        });
        try { return await Promise.race([current.promise, interrupted]); }
        finally {
            clearTimeout(timer!);
            options.signal?.removeEventListener('abort', onAbort!);
            if (--current.users === 0) { current.controller.abort(); if (active.get(identity) === current) active.delete(identity); }
        }
    }
    async function execute(source: TranslationConfigSource, service: string, model: string, identity: string, signal: AbortSignal): Promise<VisionProbeResult> {
        if (NATIVE_PRIVATE_ROUTE_SUPPORTED) await saveNative(previous => previous.filter(item => item.identity !== identity), signal);
        else {records = records.filter(item => item.identity !== identity); await save();}
        signal.throwIfAborted();
        const random = deps.random ? deps.random() : crypto.getRandomValues(new Uint8Array(3));
        const challenge = createVisionProbeImage(random);
        const prompt = 'Read the six hexadecimal characters visible in the image, from left to right. Reply with exactly those six characters, with no other text. If you cannot read the image, reply UNKNOWN. Do not guess.';
        const snapshot = createTranslationProviderConfigSnapshot({...source, translationMaxRetries: 0,
            system_role: {...source.system_role, [service]: 'You are an image transcription engine. Read only the supplied image.'},
            user_role: {...source.user_role, [service]: prompt},
        });
        const request = attachTranslationImageInput(attachTranslationProviderConfig(attachTranslationRequestControl(markTranslationRemainingBudget({
            origin: prompt, sourceLanguage: 'en', targetLanguage: 'zh-Hans', serviceOverride: service, modelOverride: model,
            thinkingOverride: false, enableAIContext: false, pageContext: '', context: '', glossaryIds: [], useCache: false,
            requestTimeoutMs: VISION_PROBE_TIMEOUT_MS,
        }), {signal, ownershipKey: `vision-probe:${identity}`}), snapshot), challenge.image);
        if (NATIVE_PRIVATE_ROUTE_SUPPORTED) {
            const privacy = getTranslationSourcePrivacy(source);
            if (privacy) Object.assign(request, attachTranslationSourcePrivacy({}, privacy));
        }
        let capability: VisionProbeResult['capability'];
        try {
            const text = await deps.translate(request);
            signal.throwIfAborted();
            capability = matchesVisionProbeAnswer(text, challenge.answer) ? 'supported' : 'unknown';
        } catch (error) {
            signal.throwIfAborted();
            if (!(error && typeof error === 'object' && (error as {imageInputUnsupported?: unknown}).imageInputUnsupported === true)) throw error;
            capability = 'unsupported';
        }
        if (capability === 'unknown') return {capability, source: 'unknown'};
        const checkedAt = now();
        if (NATIVE_PRIVATE_ROUTE_SUPPORTED) await saveNative(previous => [{identity, capability, checkedAt}, ...previous], signal);
        else {records = [{identity, capability, checkedAt}, ...records]; await save();}
        signal.throwIfAborted();
        return {capability, source: 'probe', checkedAt};
    }
    return {resolve};
}

/**
 * @file src/app/content/informationHighlight.ts
 * 文件职责：装配当前页面的信息高亮控制器，将扩展模型消息端口适配成可取消的纯文本评分函数。
 * 主要内容：持有激活实例、页面快照和请求身份，完整释放失效请求，配置更新与路由变化转交内容控制器；未激活页面始终返回关闭状态。
 * 模块边界：只通过 feature public 与纯数据 protocol 装配，不导入 Worker、模型或后台内部实现，不持久化按页开关，不接触宿主原文。
 */
import {installInformationHighlight, type InformationHighlightController} from '@/src/features/information-highlight/public';
import type {InformationHighlightResult, InformationHighlightState} from '@/src/features/information-highlight/protocol';
import {normalizeInformationHighlightPreferences, type InformationHighlightPreferences} from '@/src/core/config/informationHighlight';
import {readVisibleTranslationRoot} from '@/src/features/full-page-translation/content/public';
import type {ContentFeatureDefinition} from './featureRegistry';
export interface InformationHighlightContentRuntime {
    mount(signal: AbortSignal, isCurrent: () => boolean): void;
    unmount(): void;
    getState(): InformationHighlightState;
    setEnabled(enabled: boolean): InformationHighlightState;
    retry(): InformationHighlightState;
    updatePreferences(preferences: InformationHighlightPreferences): void;
    routeChanged(): void;
}
export interface InformationHighlightMessageState {
    isSiteDisabled(): boolean;
    isPageSuspended?(): boolean;
    informationHighlight?: Pick<InformationHighlightContentRuntime, 'getState' | 'setEnabled' | 'retry'>;
}
/** undefined 表示其他功能消息；false 表示本功能参数无效，不吞掉未知协议。 */
export function handleInformationHighlightMessage(payload: Record<string, unknown>, state: InformationHighlightMessageState,
    contextDisabled: boolean, sendResponse: (response: unknown) => void): boolean | undefined {
    if (!['GET_INFORMATION_HIGHLIGHT_STATE', 'SET_INFORMATION_HIGHLIGHT_ENABLED', 'RETRY_INFORMATION_HIGHLIGHT'].includes(payload.type as string)) return undefined;
    const feature = state.informationHighlight;
    if (!feature) {sendResponse({success: false, error: 'INFORMATION_HIGHLIGHT_PAGE_UNAVAILABLE'}); return true;}
    if (payload.type === 'SET_INFORMATION_HIGHLIGHT_ENABLED' && typeof payload.enabled !== 'boolean') return false;
    const restricted = contextDisabled || state.isSiteDisabled() || state.isPageSuspended?.();
    if (payload.type === 'GET_INFORMATION_HIGHLIGHT_STATE') sendResponse({success: true, state: feature.getState()});
    else if (restricted && payload.enabled !== false) sendResponse({success: false, state: feature.getState(), error: 'INFORMATION_HIGHLIGHT_PAGE_DISABLED'});
    else sendResponse({success: true, state: payload.type === 'RETRY_INFORMATION_HIGHLIGHT' ? feature.retry() : feature.setEnabled(payload.enabled === true)});
    return true;
}
export function createInformationHighlightScorePort(send: (message: {type: string; text?: string; requestId: string}) => Promise<unknown>) {
    const requestIdentity = () => {
        if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
        // HTTP 宿主页也有 getRandomValues；构造相同 RFC 4122 v4 格式以满足后台消息验证。
        const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
        const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    };
    return async function scoreLocal(text: string, signal: AbortSignal): Promise<InformationHighlightResult> {
        const requestId = requestIdentity();
        if (signal.aborted) throw new Error('INFORMATION_HIGHLIGHT_CANCELLED');
        let rejectAbort: (reason: Error) => void;
        const cancelled = new Promise<never>((_resolve, reject) => {rejectAbort = reject;});
        const abort = () => {
            void send({type: 'CANCEL_INFORMATION_HIGHLIGHT', requestId}).catch(() => undefined);
            rejectAbort(new Error('INFORMATION_HIGHLIGHT_CANCELLED'));
        };
        signal.addEventListener('abort', abort, {once: true});
        try {
            const reply = await Promise.race([send({type: 'SCORE_INFORMATION_HIGHLIGHT', text, requestId}), cancelled]);
            if (signal.aborted) throw new Error('INFORMATION_HIGHLIGHT_CANCELLED');
            const response = reply as {success?: boolean; result?: InformationHighlightResult; error?: string} | undefined;
            if (!response?.success || !response.result || !Array.isArray(response.result.spans) || typeof response.result.engine !== 'string') {
                throw new Error(response?.error || 'INFORMATION_HIGHLIGHT_SCORE_FAILED');
            }
            return response.result;
        } finally {signal.removeEventListener('abort', abort);}
    };
}
export function createInformationHighlightContentRuntime(ports: {
    document: Document;
    preferences: InformationHighlightPreferences;
    send(message: {type: string; text?: string; requestId: string}): Promise<unknown>;
    readTranslationRoot?(host: Element): ShadowRoot | undefined;
}): InformationHighlightContentRuntime {
    let controller: InformationHighlightController | undefined, preference = normalizeInformationHighlightPreferences(ports.preferences);
    const scoreLocal = createInformationHighlightScorePort(ports.send);
    const idle = (): InformationHighlightState => ({enabled: false, phase: 'idle', sessionId: '0', processedParagraphs: 0,
        queuedParagraphs: 0, highlightedSpans: 0, mode: preference.mode});
    function unmount(): void {controller?.dispose(); controller = undefined;}
    return {
        mount(signal, isCurrent) {
            if (signal.aborted || !isCurrent() || controller) return;
            const owner = installInformationHighlight(ports.document, preference, {scoreLocal, isCurrent, readTranslationRoot: ports.readTranslationRoot});
            controller = owner;
            signal.addEventListener('abort', () => {owner.dispose(); if (controller === owner) controller = undefined;}, {once: true});
        },
        unmount,
        getState: () => controller?.getState() ?? idle(),
        setEnabled: enabled => controller?.setEnabled(enabled) ?? idle(),
        retry: () => controller?.retry() ?? idle(),
        updatePreferences(next) {preference = normalizeInformationHighlightPreferences(next); controller?.updatePreferences(preference);},
        routeChanged() {controller?.setEnabled(false);},
    };
}
/** 页面组合根只注入配置和消息端口；正文/译文只读入口与注册表定义集中在此适配器。 */
export function createPageInformationHighlightRuntime(ports: {
    document: Document;
    config: {on: boolean; informationHighlight: InformationHighlightPreferences};
    send(message: {type: string; text?: string; requestId: string}): Promise<unknown>;
}): InformationHighlightContentRuntime & {feature: ContentFeatureDefinition} {
    const runtime = createInformationHighlightContentRuntime({document: ports.document, preferences: ports.config.informationHighlight,
        send: ports.send, readTranslationRoot: readVisibleTranslationRoot});
    return {...runtime, feature: {id: 'information-highlight', isEnabled: () => ports.config.on !== false,
        mount: activation => runtime.mount(activation.signal, activation.isCurrent), unmount: runtime.unmount}};
}

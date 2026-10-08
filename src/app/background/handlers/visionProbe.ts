/**
 * @file src/app/background/handlers/visionProbe.ts
 * 文件职责：为扩展设置页提供可取消的模型识图测试消息契约。
 * 主要内容：校验原生设置文档归属及三态，先登记再等待准备，冻结明确测试目标；复用文档请求注册表处理所属取消、断连和配置变更，油猴保留既有适配。
 * 模块边界：不接收图片、凭据、提示词或任意地址，不实现网络与存储，只有应用组合根可选择测试配置。
 */
import type {BackgroundMessageHandler} from '../messageRouter';
import {createImageOperationRegistry} from '@/src/features/image-translation/protocol';
import {createVisionProbeIdentity, type VisionProbeResult} from '@/src/core/config/visionProbe';
import type {VisionProbeConfig, VisionProbeOptions} from '@/src/services/translation/visionProbe';
import {VISION_PROBE_MESSAGE, VISION_PROBE_CANCEL_MESSAGE} from '@/src/services/translation/visionProbe';
import {freezeVisionProbeConfig, prepareVisionProbeSource, visionProbeConfigKey} from '@/src/services/translation/visionProbe';
import {NATIVE_PRIVATE_ROUTE_SUPPORTED} from '@/src/core/config/incognitoRoute';
import {resolveNativeSourcePrivacy, type IncognitoSourceRuntime} from '@/src/platform/browser/incognitoSource';
import {attachTranslationSourcePrivacy} from '@/src/services/translation/requestPrivacy';
import {captureTranslationRequestContext, createTranslationRequestRegistry, parseClientRequestId, waitForTranslationRequestPreparation,
    type TranslationRequestContext, type TranslationRequestRegistry} from '@/src/services/translation/requestRegistry';
export {VISION_PROBE_MESSAGE, VISION_PROBE_CANCEL_MESSAGE};
export interface VisionProbeContext extends TranslationRequestContext {}
export interface VisionProbeMessage {type: string; service?: unknown; model?: unknown; identity?: unknown; requestId?: unknown; clientRequestId?: unknown;}
export function createVisionProbeHandlers(deps: {
    ready: Promise<void>; getConfig(): VisionProbeConfig;
    isSettingsUrl(url: string): boolean;
    resolve(source: VisionProbeConfig, service: string, model: string, options: VisionProbeOptions): Promise<VisionProbeResult>;
    runtime?: IncognitoSourceRuntime; requestRegistry?: TranslationRequestRegistry;
    subscribeConfig?(listener: (source: VisionProbeConfig) => void): () => void;
}): BackgroundMessageHandler<VisionProbeContext, VisionProbeMessage>[] {
    const operations = createImageOperationRegistry('vision-probe');
    const registry = NATIVE_PRIVATE_ROUTE_SUPPORTED ? deps.requestRegistry ?? createTranslationRequestRegistry(true) : undefined;
    function assertSender(context: VisionProbeContext) {
        if (!deps.isSettingsUrl(context.sender?.url ?? '')) throw new Error('识图检测仅可从设置页执行');
        if (NATIVE_PRIVATE_ROUTE_SUPPORTED && (!deps.runtime?.id || context.sender?.id !== deps.runtime.id)) throw new Error('识图检测来源不属于当前扩展');
    }
    function nativeId(message: VisionProbeMessage) {
        const id = parseClientRequestId(message.requestId)!;
        if (message.clientRequestId !== undefined && message.clientRequestId !== id) throw new Error('识图检测请求编号不一致');
        return id;
    }
    return [{type: VISION_PROBE_MESSAGE, async handle(message, context) {
        assertSender(context);
        const input = message as typeof message & {service?: unknown; model?: unknown; identity?: unknown; requestId?: unknown};
        if (typeof input.service !== 'string' || !input.service.trim() || typeof input.model !== 'string' || !input.model.trim()) throw new Error('识图检测服务或模型无效');
        if (NATIVE_PRIVATE_ROUTE_SUPPORTED) {
            const captured = captureTranslationRequestContext(context), id = nativeId(message);
            return registry!.run(id, captured, async signal => {
                const timer = setTimeout(() => registry!.cancel(id, captured), 30_000);
                let stop: (() => void) | undefined;
                try {
                    await waitForTranslationRequestPreparation(deps.ready, signal);
                    const privacy = await waitForTranslationRequestPreparation(resolveNativeSourcePrivacy(captured.sender, deps.runtime!), signal);
                    const publicSource = freezeVisionProbeConfig(deps.getConfig());
                    const source = prepareVisionProbeSource(attachTranslationSourcePrivacy(publicSource, privacy), input.service as string, input.model as string);
                    // 公开 identity 只校验所选连接配置；缓存空间只能由后台原生来源派生。
                    if (input.identity !== createVisionProbeIdentity(publicSource, input.service as string, input.model as string)) throw new Error('服务配置已更改，请重新检测');
                    const key = visionProbeConfigKey(deps.getConfig(), input.service as string, input.model as string);
                    stop = deps.subscribeConfig?.(next => {if (visionProbeConfigKey(next, input.service as string, input.model as string) !== key) registry!.cancel(id, captured);});
                    signal.throwIfAborted();
                    const result = await deps.resolve(source, input.service as string, input.model as string, {force: true, signal, timeoutMs: 30_000});
                    signal.throwIfAborted();
                    return {success: true, ...result, service: input.service, model: input.model};
                } finally {clearTimeout(timer); stop?.();}
            });
        }
        await deps.ready;
        const source = freezeVisionProbeConfig(deps.getConfig());
        if (input.identity !== createVisionProbeIdentity(source, input.service, input.model)) throw new Error('服务配置已更改，请重新检测');
        const result = await operations.run({requestId: input.requestId, timeoutMs: 30_000}, options => deps.resolve(source, input.service as string, input.model as string,
            {force: true, signal: options.signal, timeoutMs: options.timeoutMs}));
        return {success: true, ...result};
    }}, {type: VISION_PROBE_CANCEL_MESSAGE, handle(message, context) {
        assertSender(context);
        if (NATIVE_PRIVATE_ROUTE_SUPPORTED) return registry!.cancel(nativeId(message), captureTranslationRequestContext(context));
        return operations.cancel((message as typeof message & {requestId?: unknown}).requestId);
    }}];
}

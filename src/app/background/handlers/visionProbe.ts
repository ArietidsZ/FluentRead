/**
 * @file src/app/background/handlers/visionProbe.ts
 * 文件职责：为扩展设置页提供可取消的模型识图测试消息契约。
 * 主要内容：限制真实设置页来源，验证服务、模型及配置版本，冻结请求快照，通过注入的探测端口执行；沿用图片操作注册表处理取消、重复编号和超时。
 * 模块边界：不接收图片、凭据、提示词或任意地址，不实现网络与存储，只有应用组合根可选择测试配置。
 */
import type {BackgroundMessageHandler} from '../messageRouter';
import {createImageOperationRegistry} from '@/src/features/image-translation/protocol';
import {createVisionProbeIdentity, type VisionProbeResult} from '@/src/core/config/visionProbe';
import type {VisionProbeConfig, VisionProbeOptions} from '@/src/services/translation/visionProbe';
import {VISION_PROBE_MESSAGE, VISION_PROBE_CANCEL_MESSAGE} from '@/src/services/translation/visionProbe';
import {freezeVisionProbeConfig} from '@/src/services/translation/visionProbe';
export {VISION_PROBE_MESSAGE, VISION_PROBE_CANCEL_MESSAGE};
export interface VisionProbeContext {sender?: {url?: string};}
export interface VisionProbeMessage {type: string; service?: unknown; model?: unknown; identity?: unknown; requestId?: unknown;}
export function createVisionProbeHandlers(deps: {
    ready: Promise<void>; getConfig(): VisionProbeConfig;
    isSettingsUrl(url: string): boolean;
    resolve(source: VisionProbeConfig, service: string, model: string, options: VisionProbeOptions): Promise<VisionProbeResult>;
}): BackgroundMessageHandler<VisionProbeContext, VisionProbeMessage>[] {
    const operations = createImageOperationRegistry('vision-probe');
    function assertSender(context: VisionProbeContext) {
        if (!deps.isSettingsUrl(context.sender?.url ?? '')) throw new Error('识图检测仅可从设置页执行');
    }
    return [{type: VISION_PROBE_MESSAGE, async handle(message, context) {
        assertSender(context);
        const input = message as typeof message & {service?: unknown; model?: unknown; identity?: unknown; requestId?: unknown};
        if (typeof input.service !== 'string' || !input.service.trim() || typeof input.model !== 'string' || !input.model.trim()) throw new Error('识图检测服务或模型无效');
        await deps.ready;
        const source = freezeVisionProbeConfig(deps.getConfig());
        if (input.identity !== createVisionProbeIdentity(source, input.service, input.model)) throw new Error('服务配置已更改，请重新检测');
        const result = await operations.run({requestId: input.requestId, timeoutMs: 30_000}, options => deps.resolve(source, input.service as string, input.model as string,
            {force: true, signal: options.signal, timeoutMs: options.timeoutMs}));
        return {success: true, ...result};
    }}, {type: VISION_PROBE_CANCEL_MESSAGE, handle(message, context) {
        assertSender(context);
        return operations.cancel((message as typeof message & {requestId?: unknown}).requestId);
    }}];
}

/**
 * @file src/core/config/visionProbe.ts
 * 文件职责：定义模型识图探测身份、缓存有效期与确定性结果校验。
 * 主要内容：绑定服务、模型、请求协议、既有凭据配置指纹及原生来源缓存空间，校验有界缓存记录；只接受严格匹配的图片答案或明确的图片输入拒绝。
 * 模块边界：纯策略，不保存原始密钥、图片、模型回答或错误正文，不发网络请求；运行和持久化由 services/platform 负责。
 */
import {createApiKeyCheckRevision, type ApiKeyCheckIdentitySource} from './apiKeyCheckIdentity';
import {sha256Hex} from '@/src/shared/function/sha256';
import {resolveModelVisionCapability, supportsVisionTransport, type ModelVisionCapability, type ModelVisionOverrides} from './vision';
import {NATIVE_PRIVATE_ROUTE_SUPPORTED, type IncognitoRouteConfig} from '@/src/core/config/incognitoRoute';

const PROBE_SCOPE = /* @__PURE__ */ Symbol('fluentread.vision-probe-scope');
/** 仅区分缓存空间，不授予后台执行权限；普通和油猴身份保持 v1 兼容。 */
export function scopeVisionProbeConfig<T extends object>(source: T, privacy: 'regular' | 'private' | 'unknown'): T {
    return {...source, [PROBE_SCOPE]: privacy};
}
/** 明确测试目标必须与已解析路由或后台回复一致；不把替换目标显示为原选择。 */
export function assertVisionProbeTarget(route: {service?: unknown; model?: unknown} | undefined, service: string, model: string): void {
    if (route && (route.service !== service || route.model !== model)) throw new Error('识图检测目标与指定服务或模型不一致，请选择同一目标后重新检测');
}

export const VISION_PROBE_TTL_MS = 7 * 86_400_000;
export const VISION_PROBE_TIMEOUT_MS = 30_000;
export interface VisionProbeRecord {identity: string; capability: 'supported' | 'unsupported'; checkedAt: number;}
export interface VisionProbeResult {capability: ModelVisionCapability; source: 'override' | 'rule' | 'probe' | 'unknown'; checkedAt?: number;}
export function createVisionProbeIdentity(source: ApiKeyCheckIdentitySource, service: string, model: string): string {
    if (NATIVE_PRIVATE_ROUTE_SUPPORTED) {
        const privacy = (source as {[PROBE_SCOPE]?: string})[PROBE_SCOPE];
        if (privacy === 'private' || privacy === 'unknown') {
            const route = source as ApiKeyCheckIdentitySource & IncognitoRouteConfig;
            return sha256Hex(JSON.stringify(['vision-probe-native-v2', privacy, route.incognitoService, route.incognitoModel,
                service, model, createApiKeyCheckRevision({...source, model: {[service]: model}, customModel: {[service]: model}}, service)]));
        }
    }
    return sha256Hex(JSON.stringify(['vision-probe-v1', service, model, createApiKeyCheckRevision(source, service)]));
}
export function normalizeVisionProbeRecords(value: unknown, now: number): VisionProbeRecord[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is VisionProbeRecord => Boolean(item && typeof item === 'object'
        && /^[a-f0-9]{64}$/u.test(item.identity) && ['supported', 'unsupported'].includes(item.capability)
        && Number.isSafeInteger(item.checkedAt) && item.checkedAt <= now && now - item.checkedAt < VISION_PROBE_TTL_MS))
        .sort((a, b) => b.checkedAt - a.checkedAt).slice(0, 100)
        .map(({identity, capability, checkedAt}) => ({identity, capability, checkedAt}));
}
export function matchesVisionProbeAnswer(value: unknown, answer: string): boolean {
    return typeof value === 'string' && value.trim().toUpperCase() === answer;
}
/** 设置界面与运行时使用相同的手动、缓存和规则优先级，未知状态不会伪装为测试成功。 */
export function resolveVisionCapabilityWithProbe(source: ApiKeyCheckIdentitySource & {modelVision?: ModelVisionOverrides},
    service: string, model: string, records: unknown, now: number): VisionProbeResult {
    const rule = resolveModelVisionCapability(service, model, source.modelVision);
    if (!supportsVisionTransport(service, model)) return {capability: 'unsupported', source: 'rule'};
    if (typeof source.modelVision?.[service]?.[model] === 'boolean') return {capability: rule, source: 'override'};
    const identity = createVisionProbeIdentity(source, service, model);
    const record = normalizeVisionProbeRecords(records, now).find(item => item.identity === identity);
    return record ? {capability: record.capability, source: 'probe', checkedAt: record.checkedAt}
        : {capability: rule, source: rule === 'unknown' ? 'unknown' : 'rule'};
}

/** 只匹配图片模态的明确拒绝；图片损坏、大小超限或一般 400 不能判为不支持。 */
export function isExplicitImageInputRejection(status: number | undefined, detail: string): boolean {
    return (status === 400 || status === 422) && /(?:does not support|do not support|doesn't support|cannot accept|not supported|unsupported|不支持)[^\n.]{0,100}(?:image(?:s|_url)?|vision|图片|图像)|(?:image(?:s|_url)?|vision|图片|图像)[^\n.]{0,100}(?:not supported|unsupported|不支持)/iu.test(detail)
        && !/(?:format|mime|size|resolution|encoding|格式|尺寸|大小|编码)/iu.test(detail);
}

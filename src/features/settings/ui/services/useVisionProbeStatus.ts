/**
 * @file src/features/settings/ui/services/useVisionProbeStatus.ts
 * 文件职责：为服务设置与圈选设置绑定同一个本地识图测试状态，避免界面与后台能力结论不一致。
 * 主要内容：按原生提示隔离缓存显示，未知或不匹配的私密目标不显示普通探测结论；订阅独立 WXT 缓存并防止旧读取覆盖通知，按过期时间刷新，卸载清理监听和计时器。
 * 模块边界：仅 Vue/storage 接线，不发模型请求或决定能力；优先级、身份及缓存有效性由 core 的纯策略提供。
 */
import {computed, onBeforeUnmount, ref, watch} from 'vue';
import {storage} from '@wxt-dev/storage';
import {resolveVisionCapabilityWithProbe, scopeVisionProbeConfig, VISION_PROBE_TTL_MS, type VisionProbeResult} from '@/src/core/config/visionProbe';
import {VISION_PROBE_STORAGE_KEY} from '@/src/platform/storage/visionProbeStorage';
import type {Config} from '@/src/core/config/model';
import browser from 'webextension-polyfill';
import {NATIVE_PRIVATE_ROUTE_SUPPORTED} from '@/src/core/config/incognitoRoute';
import {resolvePageTranslationRouteHint} from '@/src/services/translation/requestPrivacy';
export function useVisionProbeStatus(getConfig: () => Config, getService: () => string, getModel: () => string) {
    const records = ref<unknown>([]);
    const clock = ref(Date.now());
    let mounted = true, revision = 0;
    let timer: ReturnType<typeof setTimeout>;
    const result = computed<VisionProbeResult>(() => {
        if (NATIVE_PRIVATE_ROUTE_SUPPORTED) {
            const source = getConfig(), hint = browser.extension?.inIncognitoContext;
            try {
                const route = resolvePageTranslationRouteHint(source, hint);
                if (route && (route.service !== getService() || route.model !== getModel())) return {capability: 'unknown', source: 'unknown'};
            } catch {return {capability: 'unknown', source: 'unknown'};}
            return resolveVisionCapabilityWithProbe(scopeVisionProbeConfig(source, hint === true ? 'private' : hint === false ? 'regular' : 'unknown'), getService(), getModel(), records.value, clock.value);
        }
        return resolveVisionCapabilityWithProbe(getConfig(), getService(), getModel(), records.value, clock.value);
    });
    const stop = storage.watch(VISION_PROBE_STORAGE_KEY, value => { revision++; clock.value = Date.now(); records.value = value; });
    async function refresh() {
        const startedRevision = revision;
        const value = await storage.getItem(VISION_PROBE_STORAGE_KEY);
        if (mounted && revision === startedRevision) { clock.value = Date.now(); records.value = value; }
    }
    void refresh().catch(() => undefined);
    watch(() => result.value.checkedAt, checkedAt => {
        clearTimeout(timer);
        if (checkedAt !== undefined) timer = setTimeout(() => { clock.value = Date.now(); }, Math.max(1, checkedAt + VISION_PROBE_TTL_MS - Date.now()));
    });
    onBeforeUnmount(() => { mounted = false; clearTimeout(timer); stop(); });
    return {result, refresh};
}

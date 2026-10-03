/**
 * @file src/features/settings/ui/services/useVisionProbeStatus.ts
 * 文件职责：为服务设置与圈选设置绑定同一个本地识图测试状态，避免界面与后台能力结论不一致。
 * 主要内容：读取并订阅独立 WXT 本地缓存，防止初次读取覆盖后续通知；按过期时间刷新 Vue 状态，卸载时清理监听和定时器。
 * 模块边界：仅 Vue/storage 接线，不发模型请求或决定能力；优先级、身份及缓存有效性由 core 的纯策略提供。
 */
import {computed, onBeforeUnmount, ref, watch} from 'vue';
import {storage} from '@wxt-dev/storage';
import {resolveVisionCapabilityWithProbe, VISION_PROBE_TTL_MS} from '@/src/core/config/visionProbe';
import {VISION_PROBE_STORAGE_KEY} from '@/src/platform/storage/visionProbeStorage';
import type {Config} from '@/src/core/config/model';
export function useVisionProbeStatus(getConfig: () => Config, getService: () => string, getModel: () => string) {
    const records = ref<unknown>([]);
    const clock = ref(Date.now());
    let mounted = true, revision = 0;
    let timer: ReturnType<typeof setTimeout>;
    const result = computed(() => resolveVisionCapabilityWithProbe(getConfig(), getService(), getModel(), records.value, clock.value));
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

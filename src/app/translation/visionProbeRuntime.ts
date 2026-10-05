/**
 * @file src/app/translation/visionProbeRuntime.ts
 * 文件职责：把识图探测服务装配到现有共享翻译 broker 与独立本地存储。
 * 主要内容：提供扩展后台及 userscript 共用的单例，探测走真实 provider 的图片传输、密钥轮换、请求限流和取消；无痕探测仅使用独立内存记录并保持请求标记，不写普通存储或用量。
 * 模块边界：只做静态依赖接线，探测策略、随机图片和存储各自由 services/core/platform 拥有。
 */
import {attachPrivateTranslationContext} from '@/src/services/translation/privateContext';
import {createModelVisionProbe} from '@/src/services/translation/visionProbe';
import {visionProbeStorage} from '@/src/platform/storage/visionProbeStorage';
import {translateWithCache} from './runtime';
export const modelVisionProbe = createModelVisionProbe({translate: translateWithCache, storage: visionProbeStorage});

/** 无痕窗口不读取普通探测缓存，也不把模型活动写入持久存储。 */
export const privateModelVisionProbe = createModelVisionProbe({
    translate: request => translateWithCache(attachPrivateTranslationContext(request, true)),
    storage: {load: async () => [], save: async () => {}},
});

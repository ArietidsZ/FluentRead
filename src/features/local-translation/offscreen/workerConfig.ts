/**
 * @file src/features/local-translation/offscreen/workerConfig.ts
 *
 * 文件职责：为本地翻译 Worker 提供不依赖 Offscreen DOM 的运行时常量。
 * 主要内容：固定模型下载主机、版本和 q8 量化后缀，使 Worker 与缓存清单使用同一套远程身份。
 * 模块边界：只导出常量，不访问浏览器 API、存储或模型运行时。
 */
export {
    LOCAL_TRANSLATION_DTYPE,
    LOCAL_TRANSLATION_MODEL_REMOTE_HOST,
    LOCAL_TRANSLATION_MODEL_REVISION,
} from '@/src/core/config/localTranslation';

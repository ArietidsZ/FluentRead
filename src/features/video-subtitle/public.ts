/**
 * @file src/features/video-subtitle/public.ts
 * 文件职责：定义 YouTube 与 X 视频字幕的公共入口，提供内容页运行时挂载以及设置所需的本地模型与缓存契约；MAIN-world 桥由独立 app 入口直接装配。
 * 主要内容：导出支持页面判断、字幕挂载，以及 Tiny/Base 模型选项、缓存状态键、配置归一化函数和字幕缓存管理消息常量。
 * 模块边界：该 barrel 不执行自动挂载或模型下载，也不暴露内部 DOM 常量；应用层决定启停，桥、识别与 UI 各自管理资源清理。
 */
export {isSupportedVideoPage, mountVideoSubtitleTranslation} from './content/runtime';

export {VIDEO_LOCAL_TRANSCRIPTION_MODELS, VIDEO_LOCAL_TRANSCRIPTION_STATE_KEY, normalizeVideoLocalTranscriptionModels} from './transcription';

export type {VideoLocalTranscriptionModel} from './transcription';
export {
    VIDEO_AI_SUBTITLE_CACHE_CLEAR_MESSAGE,
    VIDEO_AI_SUBTITLE_CACHE_STATS_MESSAGE,
} from './transcriptionCache';

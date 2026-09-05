/**
 * @file src/features/video-subtitle/public.ts
 * 文件职责：定义 YouTube 与 X 视频字幕的公共入口，提供内容页运行时、MAIN-world 桥以及设置所需的本地模型契约。
 * 主要内容：导出站点判断、字幕挂载、YouTube 桥安装，以及 Tiny/Base 模型选项、缓存状态键和配置归一化函数。
 * 模块边界：该 barrel 不执行自动挂载或模型下载，也不暴露内部 DOM 常量；应用层决定启停，桥、识别与 UI 各自管理资源清理。
 */
export {isYouTubeVideoPage, isSupportedVideoPage, mountVideoSubtitleTranslation} from './content/runtime';
export {installYoutubeTimedTextBridge} from './content/youtubeTimedTextBridge';

export {VIDEO_LOCAL_TRANSCRIPTION_MODELS, VIDEO_LOCAL_TRANSCRIPTION_STATE_KEY, VIDEO_LOCAL_TRANSCRIPTION_STATE_MESSAGE, normalizeVideoLocalTranscriptionModel, normalizeVideoLocalTranscriptionModels} from './transcription';

export type {VideoLocalTranscriptionModel} from './transcription';
export {
  buildVideoAiSubtitleCacheIdentity,
  buildVideoAiSubtitleCacheKey,
  buildVideoAiSubtitleVideoKey,
  normalizeCompletedVideoAiSubtitleCues,
  VIDEO_AI_SUBTITLE_CACHE_CLEAR_MESSAGE,
  VIDEO_AI_SUBTITLE_CACHE_GET_MESSAGE,
  VIDEO_AI_SUBTITLE_CACHE_SET_MESSAGE,
  VIDEO_AI_SUBTITLE_CACHE_SCHEMA_FINGERPRINT,
  VIDEO_AI_SUBTITLE_CACHE_STATS_MESSAGE,
  type VideoAiSubtitleCacheRequest,
  type VideoAiSubtitleCacheSource,
} from './transcriptionCache';

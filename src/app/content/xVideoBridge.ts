/**
 * @file src/app/content/xVideoBridge.ts
 * 文件职责：组装 X 原生字幕网络桥与公共卸载生命周期。
 * 主要内容：把 X 资源识别策略注入共享 Fetch/XHR 桥，复用禁用、恢复和页面离开时的方法恢复。
 * 模块边界：不读取扩展配置、不翻译或解析字幕时间轴，只连接站点策略与浏览器适配器。
 */
import {installYoutubeTimedTextBridge} from '@/src/features/video-subtitle/content/youtubeTimedTextBridge';
import {isXSubtitleResourceUrl, createXSubtitleResourcePayload} from '@/src/features/video-subtitle/content/xVideoSubtitleData';
export const startXVideoBridgeApp = () => installYoutubeTimedTextBridge({
    matches: isXSubtitleResourceUrl,
    payload: createXSubtitleResourcePayload,
    replayLatest: true,
});

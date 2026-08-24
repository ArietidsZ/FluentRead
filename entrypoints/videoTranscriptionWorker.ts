import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

// WXT 会把顶层 unlisted script 单独输出为 videoTranscriptionWorker.js。
// 实际的 Whisper 管线仍然放在 offscreen/video-ai 目录，主 offscreen 页面
// 只通过 chrome.runtime.getURL() 启动这个独立 Worker。
import './offscreen/video-ai/transcription.worker';

export default defineUnlistedScript(() => undefined);

// 兼容 offscreen/main.ts 的旧入口；实际本地 Whisper 管线集中在 video-ai 目录。
export {
  prepareLocalVideoTranscriptionModel,
  transcribeLocalVideoAudio,
  cancelLocalVideoTranscription,
} from './video-ai/transcription';
export type {
  LocalVideoTranscriptionResult,
  LocalVideoTranscriptionSegment,
} from './video-ai/transcription';

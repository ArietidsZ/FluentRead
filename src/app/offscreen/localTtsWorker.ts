/**
 * @file src/app/offscreen/localTtsWorker.ts
 * 文件职责：作为本地 TTS Worker 的应用入口，转出 Kokoro Worker 启动函数。
 */
export {startLocalTtsWorker as startLocalTtsWorkerApp} from '@/src/features/local-tts/offscreen/tts.worker';

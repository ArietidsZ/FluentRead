/**
 * @file entrypoints/localTtsWorker.ts
 * 文件职责：声明本地 TTS Worker 的独立 WXT 产物。
 */
import {startLocalTtsWorkerApp} from '@/src/app/offscreen/localTtsWorker';

export default defineUnlistedScript(startLocalTtsWorkerApp);

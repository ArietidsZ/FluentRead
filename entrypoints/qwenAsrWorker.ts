/**
 * @file entrypoints/qwenAsrWorker.ts
 * 文件职责：声明独立 Qwen ASR 模型 Worker 的 WXT 构建入口。
 */
import {startQwenAsrWorkerApp} from '@/src/app/offscreen/qwenAsrWorker';
export default defineUnlistedScript(startQwenAsrWorkerApp);

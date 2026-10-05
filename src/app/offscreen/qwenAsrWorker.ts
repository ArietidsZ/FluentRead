/**
 * @file src/app/offscreen/qwenAsrWorker.ts
 * 文件职责：延迟装配独立 Qwen ASR Worker，保持新旧 ONNX 运行时隔离。
 * 主要内容：在模型代码加载前保存消息，加载后启动视频 feature 的 Qwen 协议。
 * 模块边界：只组装应用入口，不选择设备、模型或识别参数。
 */
import {startDeferredWorker} from './deferredWorker';
export function startQwenAsrWorkerApp():Promise<void>{
    return startDeferredWorker(async()=>{const {startQwenAsrWorker}=await import('@/src/features/video-subtitle/offscreen/qwen/worker');startQwenAsrWorker();});
}

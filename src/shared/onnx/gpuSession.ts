/**
 * @file src/shared/onnx/gpuSession.ts
 * 文件职责：为 GPU 本地模型提供显式 WebGPU 会话配置，不创建独立 CPU 回退会话。
 * 主要内容：只登记 WebGPU 执行器，默认关闭 ORT 隐式 CPU 节点回退；固定 Paddle 识别图、LaMa 图与 OPUS 图采用已测分区配置，该配置不强制逐节点白名单；记录被第三方识别器吞掉的推理异常。
 * 模块边界：不读取配置、不下载模型、不分配设备；硬件兼容性探测和会话生命周期由各模型运行时负责。
 */
import type {InferenceSession} from 'onnxruntime-web';

/** WASM 承载 ORT 调度；默认配置拒绝 CPU EP，命名配置保留固定图实测所需的形状分区。 */
export function gpuSessionOptions(profile: 'all-gpu' | 'paddle-recognition-shapes' | 'lama-shapes' | 'opus-shapes' = 'all-gpu'): InferenceSession.SessionOptions {
    return {
        executionProviders: ['webgpu'],
        graphOptimizationLevel: 'all',
        // ORT 1.23.2 的固定 PP-OCRv6 small 识别图有三个整数形状节点；
        // 实际 Conv/MatMul 等计算仍由 WebGPU 执行，不登记 WASM 模型后端。
        // OPUS 中文 FP16/ORT1.26 和日英 FP32/ORT1.22 各555个 CPU节点仅有形状、token ID重排与掩码控制；
        // 严格关闭 CPU EP 会拒绝这些元数据节点，不能作为该图的执行配置。
        ...(profile === 'all-gpu' ? {extra: {session: {disable_cpu_ep_fallback: '1'}}} : {}),
    };
}

/** Paddle 按框识别会把异常转成空文字；在整页返回前重新抛出，避免错误被报告为成功。 */
export function captureGpuSessionFailure(session: InferenceSession): () => void {
    const run = session.run.bind(session);
    let failed = false;
    let failure: unknown;
    session.run = (async (...args: Parameters<InferenceSession['run']>) => {
        if (failed) throw failure;
        try { return await run(...args); }
        catch (error) { failed = true; failure = error; throw error; }
    }) as InferenceSession['run'];
    return () => { if (failed) throw failure; };
}

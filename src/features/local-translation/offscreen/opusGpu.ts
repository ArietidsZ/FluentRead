/**
 * @file src/features/local-translation/offscreen/opusGpu.ts
 * 文件职责：限定 OPUS FP16/FP32 翻译为显式硬件 WebGPU 配置，拒绝 CPU 或软件适配器替代。
 * 主要内容：复用有界探测及共享 ORT 会话配置，在下载与加载前检查所需精度的 GPU 能力。
 * 模块边界：不持有设备、不下载权重、不修改原 Q8 路径；实际推理由既有翻译 Worker 执行。
 */
import {probeWebGpu} from '@/src/shared/onnx/webgpu';
import {gpuSessionOptions} from '@/src/shared/onnx/gpuSession';

export async function requireOpusGpu(dtype: 'fp16' | 'fp32'): Promise<void> {
    const gpu = await probeWebGpu();
    if (!gpu.available || (dtype === 'fp16' && !gpu.features?.includes('shader-f16'))) {
        throw new Error('LOCAL_TRANSLATION_GPU_UNAVAILABLE');
    }
}

export function opusGpuSessionOptions() {
    return gpuSessionOptions('opus-shapes');
}

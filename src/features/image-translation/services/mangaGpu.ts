/**
 * @file src/features/image-translation/services/mangaGpu.ts
 * 文件职责：为锁定 ONNX Runtime 1.23.2 的漫画模型检查硬件与运行接口兼容性。
 * 主要内容：GPU 后端需要 GPUDevice.adapterInfo；缺少接口的旧浏览器直接使用 CPU，通过后复用有超时和软件适配器过滤的硬件探测。
 * 模块边界：不创建模型或设备、不改变其他音频模型的兼容性要求；各漫画运行时负责初始化和推理失败回退。
 */
import {probeWebGpu,type WebGpuProbeResult} from '@/src/shared/onnx/webgpu';

export async function probeMangaGpu():Promise<WebGpuProbeResult> {
    const device=(globalThis as {GPUDevice?:{prototype:object}}).GPUDevice;
    if(!device||!('adapterInfo' in device.prototype))return {available:false,info:''};
    return probeWebGpu();
}

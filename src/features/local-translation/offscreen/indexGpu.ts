/**
 * @file src/features/local-translation/offscreen/indexGpu.ts
 * 文件职责：检查 Index GGUF 所需的硬件接口，拒绝隐式 CPU 模型替代。
 * 主要内容：复用有界硬件探测、memory64 与 JSPI 检查；让原生运行时决定张量放置，加载后同时核对请求层数和实际分配的非零 WebGPU 模型缓冲区。
 * 模块边界：不下载模型、不改变浏览器设置、不持有用户文本；日志只提取卸载数量，不保存完整日志。
 */
import {probeWebGpu} from '@/src/shared/onnx/webgpu';
import {supportsHunyuanTranslation} from '@/src/platform/browser/localTranslationSupport';
export async function requireIndexGpu():Promise<void> {
    if(!supportsHunyuanTranslation()||typeof (WebAssembly as typeof WebAssembly & {Suspending?:unknown}).Suspending !== 'function')throw new Error('LOCAL_TRANSLATION_BROWSER_UNSUPPORTED');
    const gpu=await probeWebGpu();
    if(!gpu.available || !gpu.features?.includes('shader-f16'))throw new Error('LOCAL_TRANSLATION_GPU_UNAVAILABLE');
}
export function createGpuOffloadProof() {
    let complete=false, gpuModelBuffer=false, failed=false;
    const observe=(...values:unknown[])=>{
        const line=values.filter(value=>typeof value==='string').join(' ');
        if(/ggml_webgpu: (?:Device lost|Device error|Failed to get)/i.test(line))failed=true;
        const allocation=/\bWebGPU\s+model buffer size\s*=\s*([0-9]+(?:\.[0-9]+)?)\s+MiB\b/i.exec(line);
        if(allocation && Number.isFinite(Number(allocation[1])) && Number(allocation[1])>0)gpuModelBuffer=true;
        const match=/offloaded\s+(\d+)\s*\/\s*(\d+)\s+layers?\s+to\s+GPU/i.exec(line);
        if(match)complete=Number(match[1])>0&&match[1]===match[2];
    };
    return {logger:{debug:observe,log:observe,warn:observe,error:observe},assert:()=>{if(!complete||!gpuModelBuffer||failed)throw new Error('LOCAL_TRANSLATION_GPU_UNVERIFIED');}};
}

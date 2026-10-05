import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({download:vi.fn(),read:vi.fn(),remove:vi.fn(),probe:vi.fn()}));
vi.mock('@/src/platform/storage/modelArtifacts',()=>({downloadModelArtifact:mocks.download,modelArtifactBlob:mocks.read,removeModelArtifact:mocks.remove}));
vi.mock('@/src/shared/onnx/webgpu',()=>({probeWebGpu:mocks.probe}));
import {cacheQwenAsrFiles,readQwenAsrFile,removeQwenAsrFiles} from '@/src/features/video-subtitle/offscreen/qwen/cache';
import {cacheVideoAiModelFiles,removeVideoAiModelFiles} from '@/src/features/video-subtitle/offscreen/modelCache';
beforeEach(()=>{vi.clearAllMocks();mocks.download.mockResolvedValue(undefined);mocks.remove.mockResolvedValue(undefined);});
describe('Qwen shared artifact cache routing',()=>{
    it('downloads only selected files sequentially and keeps abort/progress contract',async()=>{
        const signal=new AbortController().signal;
        await cacheQwenAsrFiles('q4',signal);expect(mocks.download).toHaveBeenCalledTimes(10);
        for(const [,actualSignal,progress] of mocks.download.mock.calls){expect(actualSignal).toBe(signal);expect(progress(1,false)).toBeUndefined();}
        expect(mocks.download.mock.calls.every(([file])=>!file.path.includes('q4f16')&&!file.path.includes('fp16'))).toBe(true);
        mocks.read.mockResolvedValue(new Blob(['verified']));expect(new TextDecoder().decode(await readQwenAsrFile('tokenizer.json'))).toBe('verified');
        await removeQwenAsrFiles();expect(mocks.remove).toHaveBeenCalledTimes(14);expect(new Set(mocks.remove.mock.calls.map(([file])=>file.path)).size).toBe(14);
    });
    it('integrates with existing model preparation and removal without Whisper URLs or CPU retries',async()=>{
        mocks.probe.mockResolvedValueOnce({available:false,info:''});await expect(cacheVideoAiModelFiles('qwen3-asr-0.6b')).rejects.toThrow('WebGPU');expect(mocks.download).not.toHaveBeenCalled();
        mocks.probe.mockResolvedValueOnce({available:true,info:'hardware',features:['shader-f16']});await cacheVideoAiModelFiles('qwen3-asr-0.6b');expect(mocks.download.mock.calls.some(([file])=>file.path==='encoder.fp16.onnx')).toBe(true);
        await removeVideoAiModelFiles('qwen3-asr-0.6b');expect(mocks.remove).toHaveBeenCalledTimes(14);
        mocks.probe.mockResolvedValueOnce({available:true,info:'hardware'});await cacheVideoAiModelFiles('qwen3-asr-0.6b');expect(mocks.download.mock.calls.some(([file])=>file.path==='encoder.onnx')).toBe(true);
    });
    it('keeps inference offline and turns missing or incomplete artifacts into a download instruction',async()=>{
        for(const error of [new Error('LOCAL_TRANSLATION_NOT_DOWNLOADED'),new Error('LOCAL_TRANSLATION_INTEGRITY')]){mocks.read.mockRejectedValueOnce(error);await expect(readQwenAsrFile('tokenizer.json')).rejects.toThrow('重新下载');}
        mocks.read.mockRejectedValueOnce('storage closed');await expect(readQwenAsrFile('tokenizer.json')).rejects.toBe('storage closed');
        mocks.read.mockRejectedValueOnce(new Error('storage denied'));await expect(readQwenAsrFile('tokenizer.json')).rejects.toThrow('storage denied');
        expect(mocks.download).not.toHaveBeenCalled();
    });

});

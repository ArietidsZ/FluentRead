import {beforeEach, describe, expect, it, vi} from 'vitest';
const probe = vi.hoisted(() => vi.fn());
vi.mock('@/src/shared/onnx/webgpu', () => ({probeWebGpu:probe}));
import {requireOpusGpu, opusGpuSessionOptions} from '@/src/features/local-translation/offscreen/opusGpu';
import {DEFAULT_LOCAL_TRANSLATION_MODEL, LOCAL_TRANSLATION_MODEL_IDS as ids, getLocalTranslationModel, resolveLocalTranslationLanguageCode, resolveOpusTranslationRepository, localTranslationErrorKey} from '@/src/core/config/localTranslation';
import {getTranslationArtifacts} from '@/src/features/local-translation/offscreen/artifactStore';
beforeEach(() => probe.mockReset());
describe('explicit OPUS FP16 profile', () => {
    it('retains defaults and all four original language routes with independent precision artifacts', () => {
        expect(DEFAULT_LOCAL_TRANSLATION_MODEL).toBe(ids.opusZhEn);
        for (const [cpu, gpu, pairs] of [
            [ids.opusZhEn, ids.opusZhEnGpu, [['en','zh'], ['zh','en']]],
            [ids.opusJaEn, ids.opusJaEnGpu, [['ja','en']]],
        ] as const) {
            const baseline = getTranslationArtifacts(cpu), candidate = getTranslationArtifacts(gpu);
            const fp16 = gpu === ids.opusZhEnGpu;
            expect(getLocalTranslationModel(gpu).onnxDtype).toBe(fp16 ? 'fp16' : 'fp32');
            expect(baseline.filter(file => file.path.endsWith('.onnx')).every(file => file.path.endsWith('_quantized.onnx'))).toBe(true);
            expect(candidate.filter(file => file.path.endsWith('.onnx')).every(file => fp16 ? file.path.endsWith('_fp16.onnx') : ['onnx/encoder_model.onnx','onnx/decoder_model_merged.onnx'].includes(file.path))).toBe(true);
            expect(candidate).toHaveLength(fp16 ? 14 : 7);
            expect(candidate.filter(file => !file.path.endsWith('.onnx'))).toEqual(baseline.filter(file => !file.path.endsWith('.onnx') && candidate.some(other => other.repo === file.repo)));
            for (const [source,target] of pairs) {
                expect(resolveOpusTranslationRepository(gpu,source,target)).toBe(resolveOpusTranslationRepository(cpu,source,target));
                expect(resolveLocalTranslationLanguageCode(gpu,source)).toBe(source);
                expect(resolveLocalTranslationLanguageCode(gpu,target)).toBe(target);
            }
        }
        expect(() => resolveLocalTranslationLanguageCode(ids.opusZhEnGpu,'ja')).toThrow('LANGUAGE_UNSUPPORTED');
        expect(() => resolveOpusTranslationRepository(ids.opusJaEnGpu,'ja','zh')).toThrow('LANGUAGE_UNSUPPORTED');
        expect(getTranslationArtifacts(ids.opusZhEn).reduce((sum,file) => sum+file.size,0)).toBe(238991573);
        expect(getTranslationArtifacts(ids.opusZhEnGpu).reduce((sum,file) => sum+file.size,0)).toBe(459599731);
        expect(getTranslationArtifacts(ids.opusJaEnGpu).reduce((sum,file) => sum+file.size,0)).toBe(434202464);
    });
    it.each([{available:false}, {available:true}, {available:true,features:[]}, {available:true,features:['timestamp-query']}])('rejects unavailable or non-f16 hardware %j', async result => {
        probe.mockResolvedValue(result);
        await expect(requireOpusGpu('fp16')).rejects.toThrow('GPU_UNAVAILABLE');
    });
    it('accepts hardware f16 and requests only the GPU provider, without a retry policy', async () => {
        probe.mockResolvedValue({available:true,features:['shader-f16']});
        await expect(requireOpusGpu('fp16')).resolves.toBeUndefined();
        probe.mockResolvedValue({available:true,features:[]});
        await expect(requireOpusGpu('fp32')).resolves.toBeUndefined();
        expect(() => resolveOpusTranslationRepository(ids.opusJaEnGpu,'en','ja')).toThrow('LANGUAGE_UNSUPPORTED');
        expect(opusGpuSessionOptions()).toEqual({executionProviders:['webgpu'],graphOptimizationLevel:'all'});
    });
});


describe('OPUS GPU failure presentation', () => {
    it('maps GPU failures without classifying unrelated errors as GPU failures', () => {
        expect(localTranslationErrorKey(new Error('LOCAL_TRANSLATION_GPU_UNAVAILABLE'))).toBe('settings.localTranslation.error.gpu');
        expect(localTranslationErrorKey(new Error('unrelated failure'))).toBe('settings.localTranslation.trialError');
    });
});

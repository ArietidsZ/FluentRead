import {describe,expect,it} from 'vitest';
import {qwenArtifact,qwenArtifacts,QWEN_PROMPT,selectQwenVariant} from '@/src/features/video-subtitle/offscreen/qwen/model';
import {normalizeVideoLocalTranscriptionModel,normalizeVideoLocalTranscriptionModels,VIDEO_LOCAL_TRANSCRIPTION_MODELS} from '@/src/features/video-subtitle/transcription';
import {buildVideoAiSubtitleCacheIdentity,buildVideoAiSubtitleCacheKey} from '@/src/features/video-subtitle/transcriptionCache';
import {Config,normalizeConfig} from '@/src/core/config/model';
describe('pinned Qwen ASR model selection',()=>{
    it('selects precision by actual shader support without selecting a CPU backend',()=>{
        expect(selectQwenVariant([])).toBe('q4');expect(selectQwenVariant(['shader-f16'])).toBe('q4f16');
        for(const variant of ['q4','q4f16'] as const){
            const files=qwenArtifacts(variant);expect(files).toHaveLength(10);expect(new Set(files.map(file=>file.path)).size).toBe(10);
            expect(files.every(file=>/^[a-f0-9]{64}$/.test(file.sha256)&&file.revision==='4a01b95fafe2c9e3af77e33c18bbb7de349c62f6'&&file.size>0)).toBe(true);
            expect(files.some(file=>file.path===QWEN_PROMPT.variants[variant].weights)).toBe(true);
            expect(files.some(file=>file.path===QWEN_PROMPT.variants[variant==='q4'?'q4f16':'q4'].weights)).toBe(false);
        }
        expect(qwenArtifacts('q4f16').reduce((n,file)=>n+file.size,0)).toBeLessThan(qwenArtifacts('q4').reduce((n,file)=>n+file.size,0));
    });
    it('only admits pinned filenames and preserves the public configuration option without changing old selections',()=>{
        expect(qwenArtifact('encoder.onnx').sha256).toMatch(/^[a-f0-9]{64}$/);expect(()=>qwenArtifact('../arbitrary')).toThrow('固定清单');
        expect(normalizeVideoLocalTranscriptionModel('qwen3-asr-0.6b')).toBe('qwen3-asr-0.6b');
        expect(normalizeVideoLocalTranscriptionModels(['tiny','qwen3-asr-0.6b','bad','qwen3-asr-0.6b'])).toEqual(['tiny','qwen3-asr-0.6b']);
        expect(VIDEO_LOCAL_TRANSCRIPTION_MODELS.find(item=>item.value==='qwen3-asr-0.6b')).toBeDefined();
        expect(normalizeConfig({...new Config(),videoLocalModel:'qwen3-asr-0.6b'}).videoLocalModel).toBe('qwen3-asr-0.6b');
    });
    it('keys Qwen transcripts by pinned export and window timing, preserving old model cache identities',()=>{
        const identity=buildVideoAiSubtitleCacheIdentity({source:{mediaId:'media'},model:'qwen3-asr-0.6b'})!;
        expect(buildVideoAiSubtitleCacheKey(identity)).toContain(qwenArtifact('encoder.onnx').revision+'-window-v1');
        expect(buildVideoAiSubtitleCacheKey({...identity,model:'tiny'})).toBe('video-ai-cues-v1|media:media|tiny|auto');
    });

});

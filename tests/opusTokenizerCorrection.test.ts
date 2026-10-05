import {beforeEach, describe, expect, it, vi} from 'vitest';
import {Tokenizer} from '@huggingface/tokenizers';
import {correctOpusUnknownId, OPUS_UNKNOWN_ID_CORRECTION as pin} from '@/src/core/translation/opusTokenizer';
const f=vi.hoisted(()=>({blob:vi.fn(), complete:vi.fn()}));
vi.mock('@/src/platform/storage/modelArtifacts',async(importOriginal)=>({
    ...await importOriginal<typeof import('@/src/platform/storage/modelArtifacts')>(),
    modelArtifactBlob:f.blob, artifactComplete:f.complete,
}));
import {artifactUrl,getTranslationArtifacts,matchTranslationArtifact} from '@/src/features/local-translation/offscreen/artifactStore';
import {LOCAL_TRANSLATION_MODEL_IDS as ids} from '@/src/core/config/localTranslation';
const fixture=()=>({version:'1.0',truncation:null,padding:null,normalizer:null,pre_tokenizer:null,post_processor:null,
    model:{type:'Unigram',unk_id:2,vocab:[['</s>',0],['<unk>',0],[',',0],['x',0]],byte_fallback:false},added_tokens:[],decoder:{type:'Fuse'}});
beforeEach(()=>{vi.clearAllMocks();f.complete.mockResolvedValue(true);});
describe('exact-revision OPUS unknown ID correction',()=>{
    it('maps unknown characters and digit strings to unknown, preserving real commas and known tokens',()=>{
        const original=fixture(), serialized=JSON.stringify(original);
        const before=new Tokenizer(original as any,{});
        const after=new Tokenizer(JSON.parse(correctOpusUnknownId(pin,serialized)),{});
        for(const value of ['0','2030','😀']){
            expect(before.encode(value).ids).toEqual([2]);
            expect(after.encode(value).ids).toEqual([1]);
        }
        expect(after.encode(',').ids).toEqual([2]);
        expect(after.encode('x').ids).toEqual([3]);
        expect(original.model.unk_id).toBe(2);
        expect(JSON.parse(serialized)).toEqual(original);
    });
    it.each(['repo','revision','path','sha256'] as const)('does not parse or modify a different %s',key=>{
        expect(correctOpusUnknownId({...pin,[key]:'different'},'not JSON')).toBe('not JSON');
    });
    it.each([
        null, {}, {model:{type:'BPE'}}, {model:{type:'Unigram',unk_id:1}},
        {model:{type:'Unigram',unk_id:2}}, {model:{type:'Unigram',unk_id:2,vocab:[['',0],['wrong',0]]}},
        {model:{type:'Unigram',unk_id:2,vocab:[['',0],['<unk>',0],['wrong',0]]}},
    ])('rejects unexpected pinned tokenizer structure %j',value=>{
        expect(()=>correctOpusUnknownId(pin,JSON.stringify(value))).toThrow('INTEGRITY');
    });
    it('serves only a runtime copy after verification and keeps original cached bytes untouched',async()=>{
        const file=getTranslationArtifacts(ids.opusJaEn).find(file=>file.repo===pin.repo&&file.path===pin.path)!;
        expect(file).toMatchObject(pin);
        const raw=JSON.stringify(fixture(),null,2), blob=new Blob([raw]); f.blob.mockResolvedValue(blob);
        const response=await matchTranslationArtifact(artifactUrl(file));
        expect((await response!.json()).model.unk_id).toBe(1);
        expect(response!.headers.get('Content-Length')).toBe(String(new Blob([correctOpusUnknownId(file,raw)]).size));
        expect(await blob.text()).toBe(raw);
        expect(f.complete).toHaveBeenCalledWith(file);
        f.complete.mockResolvedValue(false);
        await expect(matchTranslationArtifact(artifactUrl(file))).resolves.toBeUndefined();
        expect(f.blob).toHaveBeenCalledTimes(1);
    });
});

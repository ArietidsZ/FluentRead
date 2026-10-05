import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({construct:vi.fn(),call:vi.fn()}));
vi.mock('@huggingface/transformers',()=>({WhisperFeatureExtractor:class{constructor(config:unknown){mocks.construct(config);} _call=mocks.call;}}));
import {createQwenAudioFrontend} from '@/src/features/video-subtitle/offscreen/qwen/audio';
const filters=()=>({n_mels:128,n_freqs:201,data:Array.from({length:128},()=>Array(201).fill(0))});
beforeEach(()=>{vi.clearAllMocks();mocks.call.mockResolvedValue({input_features:{data:new Float32Array(256)}});});
describe('native Qwen log-Mel frontend configuration',()=>{
    it('uses pinned128-filter native frontend and true audio length instead of30second padding',async()=>{
        const filter=filters(),frontend=createQwenAudioFrontend(filter),audio=new Float32Array(401);
        expect(await frontend(audio)).toEqual({data:new Float32Array(256),frames:2});
        expect(mocks.construct).toHaveBeenCalledWith({n_fft:400,hop_length:160,feature_size:128,sampling_rate:16000,n_samples:480000,nb_max_frames:3000,mel_filters:filter.data});
        expect(mocks.call).toHaveBeenCalledWith(audio,{max_length:401});
    });
    it('rejects mismatched or nonfinite filters and invalid audio before native processing',async()=>{
        for(const filter of [{...filters(),n_mels:80},{...filters(),n_freqs:200},{...filters(),data:[]},{...filters(),data:Array.from({length:128},()=>[])},{...filters(),data:Array.from({length:128},()=>Array(201).fill(NaN))}])expect(()=>createQwenAudioFrontend(filter)).toThrow('滤波器无效');
        const frontend=createQwenAudioFrontend(filters());
        for(const audio of [new Float32Array(399),new Float32Array(480001),new Float32Array(400).fill(NaN)])await expect(frontend(audio)).rejects.toThrow('音频必须');
        expect(mocks.call).not.toHaveBeenCalled();
    });
});

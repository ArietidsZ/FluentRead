import {describe,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import filters from './fixtures/qwen-asr/mel-filters.json';
import reference from './fixtures/qwen-asr/audio-reference.json';
import {createQwenAudioFrontend} from '@/src/features/video-subtitle/offscreen/qwen/audio';
const f32=(base64:string)=>{const bytes=Buffer.from(base64,'base64');return new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));};
describe('Qwen native frontend vs independent NumPy FFT reference',()=>{
    it('uses the exact published filter coefficients',()=>{
        expect(createHash('sha256').update(readFileSync('tests/fixtures/qwen-asr/mel-filters.json')).digest('hex')).toBe(reference.filtersSha256);
    });
    it.each(reference.cases)('matches all128bins for $name without fixed30s padding',async fixture=>{
        const input=f32(fixture.audioF32Base64),expected=f32(fixture.melF32Base64);
        const actual=await createQwenAudioFrontend(filters)(input);
        expect(actual.frames).toBe(fixture.frames);expect(actual.data.length).toBe(expected.length);
        let maximum=0;for(let i=0;i<expected.length;i++)maximum=Math.max(maximum,Math.abs(expected[i]-actual.data[i]));
        expect(maximum).toBeLessThanOrEqual(reference.atol);expect(actual.data.every(Number.isFinite)).toBe(true);
    });
});

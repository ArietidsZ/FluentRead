import {describe,expect,it} from 'vitest';
import {floatToHalf,halfToFloat,qwenArgmax,qwenEmbeddingRow,qwenFloatData,qwenPromptEmbeddings,qwenTextTokens} from '@/src/features/video-subtitle/offscreen/qwen/tensors';
describe('Qwen tensor primitives',()=>{
    it.each([0,-0,1,-2,65504,0.5,2**-14,2**-24,Infinity,-Infinity])('round trips representable half %s',value=>expect(Object.is(halfToFloat(floatToHalf(value)),value)).toBe(true));
    it('handles subnormal rounding, infinity, NaN and overflow',()=>{
        expect(floatToHalf(1e-12)).toBe(0);expect(floatToHalf(2**-25)).toBe(0);expect(floatToHalf(1.00048828125)).toBe(0x3c00);
        expect(floatToHalf(70000)).toBe(0x7c00);expect(Number.isNaN(halfToFloat(floatToHalf(NaN)))).toBe(true);
    });
    it('only expands requested INT8 rows and preserves inserted audio and prefix/suffix order',()=>{
        const values=new Int8Array([1,2,3,4,-5,6]),scales=new Float32Array([.5,2,1]);
        expect(qwenEmbeddingRow(values,scales,2,1)).toEqual(new Float32Array([6,8]));
        expect(qwenPromptEmbeddings(values,scales,2,[0],new Float32Array([10,11,12,13]),[2])).toEqual(new Float32Array([.5,1,10,11,12,13,-5,6]));
        for(const id of [-1,3,0.5,NaN])expect(()=>qwenEmbeddingRow(values,scales,2,id)).toThrow('索引');
        expect(()=>qwenEmbeddingRow(values,scales,3,0)).toThrow('形状');
        expect(()=>qwenEmbeddingRow(values,new Float32Array([NaN,2,1]),2,0)).toThrow('索引');
        expect(()=>qwenPromptEmbeddings(values,scales,2,[],new Float32Array([1]),[])).toThrow('形状');
        expect(()=>qwenPromptEmbeddings(values,scales,2,[],new Float32Array([NaN,1]),[])).toThrow('形状');
    });
    it('chooses finite logits, preserves stable ties, and strips only the ASR prefix marker',()=>{
        const data=new Float32Array([-2,1,1,-Infinity]);expect(qwenArgmax(data)).toBe(1);
        expect(qwenFloatData(data,false)).toBe(data);expect(qwenFloatData(new Float32Array([1,2]),true)).toEqual(new Uint16Array([0x3c00,0x4000]));
        expect(qwenArgmax(new Uint16Array([0xbc00,0x3c00]))).toBe(1);
        expect(()=>qwenArgmax(new Float32Array([NaN]))).toThrow('无效');expect(()=>qwenArgmax(new Float32Array([Infinity]))).toThrow('无效');expect(()=>qwenArgmax(new Float32Array([-Infinity]))).toThrow('无效');
        expect(qwenTextTokens([1,2,4,5,6],4)).toEqual([5,6]);expect(qwenTextTokens([5,6],4)).toEqual([5,6]);
    });
});

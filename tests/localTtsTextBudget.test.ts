import {describe,expect,it} from 'vitest';
import {LOCAL_TTS_TOKEN_LIMIT,protectTtsTokenizer,splitTtsAtWordBoundaries,subdivideTtsChunk,TtsTokenBudgetError} from '@/src/features/local-tts/offscreen/textBudget';
describe('native phoneme token budget',()=>{
 it('disables native truncation, includes special tokens and preserves callable properties',()=>{
  const calls:any[]=[];const original=Object.assign(function(text:string,options:any){calls.push(options);return {input_ids:{dims:[1,text.length+2]}};},{model_max_length:512});const safe=protectTtsTokenizer(original);
  expect(safe.model_max_length).toBe(512);expect(safe('x'.repeat(510),{truncation:true}).input_ids.dims[1]).toBe(512);expect(calls[0].truncation).toBe(false);
  expect(()=>safe('x'.repeat(511),{})).toThrow(TtsTokenBudgetError);expect(LOCAL_TTS_TOKEN_LIMIT).toBe(512);
 });
 it('rejects a missing native tensor contract',()=>{expect(()=>protectTtsTokenizer(()=>({}))()).toThrow('分词结果无效');});
 it.each([NaN,-1,1.5])('rejects invalid native token count %s',count=>{expect(()=>protectTtsTokenizer(()=>({input_ids:{dims:[1,count]}}))()).toThrow('分词结果无效');});
 it('preserves CJK without spaces, punctuation, numbers and grapheme clusters across word boundaries',()=>{
  const text='中华人民共和国'.repeat(24)+'朗读结束请记住';const parts=splitTtsAtWordBoundaries(text,100);expect(parts.length).toBeGreaterThan(1);expect(parts.join('')).toBe(text);
  const mixed='Alice 👨‍👩‍👧‍👦 支付 12345678901234567890.12 元，结束。';const chunks=splitTtsAtWordBoundaries(mixed,6);expect(chunks.join('')).toBe(mixed);expect(chunks.some(x=>x.includes('👨‍👩‍👧‍👦'))).toBe(true);expect(chunks.some(x=>x.includes('12345678901234567890.12'))).toBe(true);
  for(const numeric of ['2026-10-04','2026年10月4日','12:30:59','-123,456.78元','第12'])expect(splitTtsAtWordBoundaries('日期'+numeric+'结束',3).some(part=>part.includes(numeric))).toBe(true);
  expect(splitTtsAtWordBoundaries('Qwen3 ASR',3)).toContain('Qwen3');
  expect(splitTtsAtWordBoundaries('')).toEqual([]);expect(splitTtsAtWordBoundaries('short')).toEqual(['short']);
 });
 it('subdivides a CJK overflow using the observed token expansion and never splits a numeric atom',()=>{
  const text='中华人民共和国'.repeat(25),error=new TtsTokenBudgetError(601),chunks=subdivideTtsChunk(text,error);expect(chunks.length).toBeGreaterThan(1);expect(chunks.join('')).toBe(text);expect(chunks.every(x=>x.length<text.length)).toBe(true);
  expect(()=>subdivideTtsChunk('12345678901234567890',new TtsTokenBudgetError(600))).toThrow(TtsTokenBudgetError);
  expect(()=>subdivideTtsChunk('',new TtsTokenBudgetError(600))).toThrow(TtsTokenBudgetError);
 });
});

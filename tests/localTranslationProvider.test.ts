import {beforeEach, describe, expect, it, vi} from 'vitest';
import {attachTranslationProviderConfig} from '@/src/services/translation/requestSnapshot';

const capabilities = vi.hoisted(() => ({extensionDom: true}));
const translate = vi.hoisted(() => vi.fn());

vi.mock('@/src/platform/browser/capabilities', () => ({browserCapabilities: capabilities}));
vi.mock('@/src/platform/offscreen/localTranslation', () => ({
  localTranslationOffscreenAdapter: {translate},
}));
vi.mock('@/src/services/config/store', () => ({
  config: {
    from: 'auto',
    to: 'zh-Hans',
    model: {localTranslation: 'Xenova/m2m100_418M'},
    customModel: {},
  },
}));

import localTranslation from '@/src/providers/translation/local-translation';
import {LOCAL_TRANSLATION_MODEL_IDS} from '@/src/core/config/localTranslation';

beforeEach(() => {
  capabilities.extensionDom = true;
  translate.mockReset();
  translate.mockResolvedValue('生活就像一盒巧克力。');
});

describe('local translation provider', () => {
  it('keeps the translation request local and forwards model, language and budget', async () => {
    const controller = new AbortController();
    await expect(localTranslation({
      origin: 'Life is like a box of chocolate.',
      sourceLanguage: 'en',
      targetLanguage: 'zh-Hans',
      abortSignal: controller.signal,
      requestTimeoutMs: 12_000,
    } as any)).resolves.toBe('生活就像一盒巧克力。');
    expect(translate).toHaveBeenCalledWith({
      model: LOCAL_TRANSLATION_MODEL_IDS.m2m100,
      text: 'Life is like a box of chocolate.',
      sourceLanguage: 'en',
      targetLanguage: 'zh-Hans',
    }, {signal: controller.signal, timeoutMs: 12_000});
  });

  it('rejects safely when extension-owned Offscreen is unavailable', async () => {
    capabilities.extensionDom = false;
    await expect(localTranslation({origin: 'Hello', sourceLanguage: 'en', targetLanguage: 'zh-Hans'} as any))
      .rejects.toThrow('不支持本地模型翻译');
    expect(translate).not.toHaveBeenCalled();
  });

  it.each(['auto', 'en'])('forwards detection context only for %s without changing input', async (sourceLanguage) => {
    await localTranslation({origin: 'Reduce Waste during Filament Change', sourceLanguage,
      sourceLanguageDetectionText: 'When switching between different filaments, the printer flushes the remaining material.',
      targetLanguage: 'zh-Hans'} as any);
    const request = translate.mock.calls[0][0];
    expect(request.text).toBe('Reduce Waste during Filament Change');
    if (sourceLanguage === 'auto') expect(request.sourceLanguageDetectionText).toContain('When switching');
    else expect(request).not.toHaveProperty('sourceLanguageDetectionText');
  });
});

describe('Index request hints',()=>{
  it.each([true,false])('respects context permission %s and preserves the source',async(enabled)=>{
    await localTranslation({origin:'材料',modelOverride:LOCAL_TRANSLATION_MODEL_IDS.index,sourceLanguage:'zh',targetLanguage:'en',pageContext:'reference',context:'unused fallback',enableAIContext:enabled} as any);
    expect(translate.mock.calls[0][0]).toMatchObject({model:LOCAL_TRANSLATION_MODEL_IDS.index,text:'材料',hints:{context:enabled?'reference':undefined,terms:[]}});
  });
});

describe('Index snapshot-owned context and glossary hints', () => {
  it.each([
    {saved: true, explicit: undefined, expectedContext: 'fallback reference'},
    {saved: false, explicit: undefined, expectedContext: undefined},
    {saved: true, explicit: false, expectedContext: undefined},
    {saved: false, explicit: true, expectedContext: 'fallback reference'},
  ])('uses saved permission $saved with explicit permission $explicit', async ({saved, explicit, expectedContext}) => {
    const origin = '材料 __FRTERM_mat__';
    const message = attachTranslationProviderConfig({
      origin, modelOverride: LOCAL_TRANSLATION_MODEL_IDS.index,
      sourceLanguage: 'zh', targetLanguage: 'en', pageContext: '', context: 'fallback reference',
      enableAIContext: explicit,
    }, {
      model: {}, customModel: {}, enableAIContext: saved,
      glossaryProtectedTokens: ['__FRTERM_mat__', '__FRTERM_unrelated__'],
    } as any);
    await localTranslation(message as any);
    expect(translate.mock.calls[0][0]).toMatchObject({
      text: origin,
      hints: {context: expectedContext, terms: [{source: '__FRTERM_mat__', target: '__FRTERM_mat__'}]},
    });
  });
});

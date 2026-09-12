import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
  DEFAULT_LOCAL_TRANSLATION_MODEL,
  LOCAL_TRANSLATION_MODEL_IDS,
  LOCAL_TRANSLATION_MODELS,
  normalizeLocalTranslationModel,
  normalizeLocalTranslationModels,
  resolveLocalTranslationLanguageCode,
} from '@/src/core/config/localTranslation';
import {
  LOCAL_TRANSLATION_MODEL_FILES,
  cacheLocalTranslationModelFiles,
  getLocalTranslationModelFileUrl,
  isLocalTranslationModelCached,
  removeLocalTranslationModelFiles,
} from '@/src/features/local-translation/offscreen/modelCache';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('local translation model catalog', () => {
  it('normalizes the built-in models and preserves only known downloaded entries', () => {
    expect(DEFAULT_LOCAL_TRANSLATION_MODEL).toBe(LOCAL_TRANSLATION_MODEL_IDS.opusZhEn);
    expect(normalizeLocalTranslationModel('missing')).toBe(DEFAULT_LOCAL_TRANSLATION_MODEL);
    expect(normalizeLocalTranslationModels([
      LOCAL_TRANSLATION_MODEL_IDS.nllb,
      'missing',
      LOCAL_TRANSLATION_MODEL_IDS.nllb,
    ])).toEqual([LOCAL_TRANSLATION_MODEL_IDS.nllb]);
    expect(LOCAL_TRANSLATION_MODELS.filter((item) => !item.legacy)).toHaveLength(3);
  });

  it('maps product language codes for M2M100 and NLLB and rejects unsupported pairs', () => {
    expect(resolveLocalTranslationLanguageCode(LOCAL_TRANSLATION_MODEL_IDS.m2m100, 'zh-Hans')).toBe('zh');
    expect(resolveLocalTranslationLanguageCode(LOCAL_TRANSLATION_MODEL_IDS.m2m100, 'en-US')).toBe('en');
    expect(resolveLocalTranslationLanguageCode(LOCAL_TRANSLATION_MODEL_IDS.nllb, 'zh-Hant')).toBe('zho_Hant');
    expect(resolveLocalTranslationLanguageCode(LOCAL_TRANSLATION_MODEL_IDS.nllb, 'ja')).toBe('jpn_Jpan');
    expect(resolveLocalTranslationLanguageCode(LOCAL_TRANSLATION_MODEL_IDS.m2m100, 'auto', 'This is a long enough English sentence for local language detection.')).toBe('en');
    expect(() => resolveLocalTranslationLanguageCode(LOCAL_TRANSLATION_MODEL_IDS.m2m100, 'auto')).toThrow('空文本');
    expect(() => resolveLocalTranslationLanguageCode(LOCAL_TRANSLATION_MODEL_IDS.nllb, 'xx')).toThrow('暂不支持');
  });
});

describe('local translation model cache', () => {
  const entries = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (url: string) => entries.get(url)),
    put: vi.fn(async (url: string, response: Response) => { entries.set(url, response); }),
    delete: vi.fn(async (url: string) => entries.delete(url)),
  };

  beforeEach(() => {
    entries.clear();
    vi.stubGlobal('caches', {open: vi.fn(async () => cache)});
    vi.stubGlobal('window', {setTimeout, clearTimeout});
    vi.stubGlobal('fetch', vi.fn(async () => new Response('model')));
  });

  it('uses the exact q8 manifests, caches only missing files, and reports complete state', async () => {
    expect(getLocalTranslationModelFileUrl(LOCAL_TRANSLATION_MODEL_IDS.m2m100, LOCAL_TRANSLATION_MODEL_FILES[0]))
      .toContain('Xenova/m2m100_418M/resolve/main/config.json');
    await cacheLocalTranslationModelFiles(LOCAL_TRANSLATION_MODEL_IDS.m2m100);
    expect(cache.put).toHaveBeenCalledTimes(LOCAL_TRANSLATION_MODEL_FILES.length);
    await cacheLocalTranslationModelFiles(LOCAL_TRANSLATION_MODEL_IDS.m2m100);
    expect(cache.put).toHaveBeenCalledTimes(LOCAL_TRANSLATION_MODEL_FILES.length);
    await expect(isLocalTranslationModelCached(LOCAL_TRANSLATION_MODEL_IDS.m2m100)).resolves.toBe(true);
  });

  it('removes only the selected model files', async () => {
    await cacheLocalTranslationModelFiles(LOCAL_TRANSLATION_MODEL_IDS.m2m100);
    await cacheLocalTranslationModelFiles(LOCAL_TRANSLATION_MODEL_IDS.nllb);
    await removeLocalTranslationModelFiles(LOCAL_TRANSLATION_MODEL_IDS.m2m100);
    await expect(isLocalTranslationModelCached(LOCAL_TRANSLATION_MODEL_IDS.m2m100)).resolves.toBe(false);
    await expect(isLocalTranslationModelCached(LOCAL_TRANSLATION_MODEL_IDS.nllb)).resolves.toBe(true);
  });

  it('turns a failed file response into a readable error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', {status: 503})));
    await expect(cacheLocalTranslationModelFiles(LOCAL_TRANSLATION_MODEL_IDS.m2m100)).rejects.toThrow('503');
  });
});

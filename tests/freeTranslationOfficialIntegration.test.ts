import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
const state = vi.hoisted(() => ({config: {} as Record<string, unknown>}));
vi.mock('@/src/services/config/store', () => ({config: state.config}));
import {Config} from '@/src/core/config/model';
import freeTranslation from '@/src/providers/translation/free-translation';
import deepL from '@/src/providers/translation/deepl';
import {setRuntimeFetch} from '@/src/platform/http/runtime';
import {attachTranslationProviderConfig, createTranslationProviderConfigSnapshot} from '@/src/services/translation/requestSnapshot';

const transport = vi.fn<typeof fetch>();
beforeEach(() => {
    Object.assign(state.config, new Config(), {service: 'freeTranslation', freeTranslationOrder: ['deepL'], token: {deepL: 'test-free:fx'}});
    transport.mockReset().mockResolvedValue(Response.json({translations: [{text: 'gift'}]}));
    setRuntimeFetch(transport);
});
afterEach(() => setRuntimeFetch());
const body = () => JSON.parse(String(transport.mock.calls[0][1]?.body));

describe('official provider integration with free fallback', () => {
    it('preserves explicit German source and context through the real DeepL fallback adapter', async () => {
        await expect(freeTranslation({origin: 'Gift', sourceLanguage: 'de', targetLanguage: 'en', context: 'German safety document'})).resolves.toBe('gift');
        expect(String(transport.mock.calls[0][0])).toBe('https://api-free.deepl.com/v2/translate');
        expect(body()).toMatchObject({source_lang: 'DE', target_lang: 'en', context: 'German safety document', text: ['Gift']});
        expect(transport.mock.calls[0][1]?.headers).toMatchObject({Authorization: 'DeepL-Auth-Key test-free:fx'});
    });

    it('omits source_lang for genuine auto detection rather than sending an unsupported AUTO language', async () => {
        await freeTranslation({origin: 'Hello', sourceLanguage: 'auto', targetLanguage: 'fr'});
        expect(body()).not.toHaveProperty('source_lang');
        expect(body().target_lang).toBe('fr');
    });

    it('uses frozen default languages and canonical source variants on a direct official call', async () => {
        const snapshot = createTranslationProviderConfigSnapshot(Object.assign(new Config(), {
            service: 'deepL', from: 'en-GB', to: 'zh-Hans', token: {deepL: 'snapshot-free:fx'},
        }));
        state.config.from = 'ja';
        state.config.to = 'ko';
        await deepL(attachTranslationProviderConfig({origin: 'Read this.'}, snapshot));
        expect(body()).toMatchObject({source_lang: 'EN', target_lang: 'zh'});
        expect(transport.mock.calls[0][1]?.headers).toMatchObject({Authorization: 'DeepL-Auth-Key snapshot-free:fx'});
    });
});

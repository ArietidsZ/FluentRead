import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => {
    const cacheStore = new Map<string, string>();
    const config = {
        service: 'mock',
        from: 'auto',
        to: 'zh-Hans',
        useCache: true,
        enableAIContext: false,
        model: {mock: 'mock-model', ai: 'ai-model'} as Record<string, string>,
        customModel: {} as Record<string, string>,
        proxy: {} as Record<string, string>,
        custom: '',
        deeplx: '',
        newApiUrl: '',
        minimaxBillingPlan: 'payg',
        minimaxRegion: 'cn',
        mimoBillingPlan: 'payg',
        mimoRegion: 'cn',
        azureOpenaiEndpoint: '',
        robot_id: {} as Record<string, string>,
        customBody: {} as Record<string, string>,
        system_role: {} as Record<string, string>,
        user_role: {} as Record<string, string>,
        deepseekApiType: 'auto',
        deepseekThinkingMode: 'disabled',
    };

    return {
        cacheStore,
        config,
        service: vi.fn(),
        getMissingCredentialMessage: vi.fn(() => null as string | null),
        buildTranslationCacheKey: vi.fn((identity: unknown) => JSON.stringify(identity)),
        cacheGet: vi.fn(async (key: string) => cacheStore.get(key) ?? null),
        cacheSet: vi.fn(async (key: string, value: string) => {
            cacheStore.set(key, value);
            return true;
        }),
        cacheClear: vi.fn(async () => {
            cacheStore.clear();
        }),
        cacheCleanup: vi.fn(async () => undefined),
    };
});

vi.mock('@/entrypoints/service/_service', () => ({
    _service: {
        mock: mocks.service,
        ai: mocks.service,
    },
}));

vi.mock('@/entrypoints/utils/config', () => ({
    config: mocks.config,
    configReady: Promise.resolve(),
}));

vi.mock('@/entrypoints/utils/constant', () => ({
    MINIMAX_ENDPOINTS: {
        payg: {cn: 'https://minimax.example', global: 'https://minimax.example'},
        'token-plan': {cn: 'https://minimax.example', global: 'https://minimax.example'},
    },
    getMimoEndpoint: () => 'https://mimo.example',
}));

vi.mock('@/entrypoints/utils/configValidation', () => ({
    getMissingCredentialMessage: mocks.getMissingCredentialMessage,
}));

vi.mock('@/entrypoints/utils/option', () => ({
    services: {minimax: 'minimax', mimo: 'mimo'},
    servicesType: {
        machine: new Set(['mock']),
        isAI: (service: string) => service === 'ai',
        isUseAIContext: (service: string) => service === 'ai',
    },
    resolveConfiguredModel: (selected?: string, custom?: string) => custom || selected || '',
}));

vi.mock('@/entrypoints/utils/template', () => ({
    buildPageSummaryPrompt: (pageContext: string) => `summarize:${pageContext}`,
    buildPageSummarySystemPrompt: () => 'summary-system',
}));

vi.mock('@/entrypoints/utils/translationCache', () => ({
    buildTranslationCacheKey: mocks.buildTranslationCacheKey,
    translationCache: {
        get: mocks.cacheGet,
        set: mocks.cacheSet,
        clear: mocks.cacheClear,
        cleanup: mocks.cacheCleanup,
    },
}));

vi.mock('@/entrypoints/utils/translationLanguage', () => ({
    getTranslationLanguages: (override?: {sourceLanguage?: string; targetLanguage?: string}) => ({
        sourceLanguage: override?.sourceLanguage || mocks.config.from,
        targetLanguage: override?.targetLanguage || mocks.config.to,
    }),
}));

import {
    cleanupTranslationCache,
    clearTranslationCache,
    translateWithCache,
} from '@/entrypoints/utils/translationBroker';

describe('translation broker', () => {
    beforeEach(async () => {
        await clearTranslationCache();
        vi.clearAllMocks();
        mocks.cacheStore.clear();
        mocks.config.service = 'mock';
        mocks.config.useCache = true;
        mocks.config.enableAIContext = false;
    });

    it('is directly callable and reuses a persisted single-translation result', async () => {
        mocks.service.mockResolvedValue('共享译文');

        await expect(translateWithCache({origin: 'Readable source'})).resolves.toBe('共享译文');
        await expect(translateWithCache({origin: 'Readable source'})).resolves.toBe('共享译文');

        expect(mocks.service).toHaveBeenCalledTimes(1);
        expect(mocks.cacheSet).toHaveBeenCalledTimes(1);
        expect(mocks.cacheGet).toHaveBeenCalledTimes(2);
    });

    it('deduplicates missing batch entries while preserving the requested order', async () => {
        mocks.service.mockImplementation(async (message: {origin: string[]}) => (
            message.origin.map((origin) => `${origin}-译文`)
        ));

        await expect(translateWithCache({
            origin: ['same', 'same', 'other'],
            sourceLanguage: 'en',
            targetLanguage: 'zh-Hans',
        })).resolves.toEqual(['same-译文', 'same-译文', 'other-译文']);

        expect(mocks.service).toHaveBeenCalledTimes(1);
        expect(mocks.service).toHaveBeenCalledWith(expect.objectContaining({
            origin: ['same', 'other'],
            sourceLanguage: 'en',
            targetLanguage: 'zh-Hans',
        }));
    });

    it('shares AI page summaries and clears both summary and persistent caches', async () => {
        mocks.config.service = 'ai';
        mocks.config.enableAIContext = true;
        mocks.service.mockImplementation(async (message: {summaryPrompt?: string}) => (
            message.summaryPrompt ? 'A short page summary' : '普通译文'
        ));

        const request = {
            origin: 'Readable source',
            pageContext: 'Readable article context',
            useCache: false,
        };
        await expect(translateWithCache(request)).resolves.toBe('普通译文');
        await expect(translateWithCache(request)).resolves.toBe('普通译文');

        expect(mocks.service.mock.calls.filter(([message]) => message.summaryPrompt)).toHaveLength(1);
        expect(mocks.service.mock.calls.filter(([message]) => !message.summaryPrompt)).toHaveLength(2);
        expect(mocks.service).toHaveBeenCalledWith(expect.objectContaining({
            pageContext: expect.stringContaining('A short page summary'),
        }));

        await clearTranslationCache();
        await expect(translateWithCache(request)).resolves.toBe('普通译文');

        expect(mocks.cacheClear).toHaveBeenCalledOnce();
        expect(mocks.service.mock.calls.filter(([message]) => message.summaryPrompt)).toHaveLength(2);
    });

    it('exposes cache maintenance without a browser alarm dependency', async () => {
        await cleanupTranslationCache();

        expect(mocks.cacheCleanup).toHaveBeenCalledOnce();
    });
});

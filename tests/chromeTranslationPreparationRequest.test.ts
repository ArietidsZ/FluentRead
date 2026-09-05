import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
const browserMock = vi.hoisted(() => ({storage: {onChanged: {addListener: vi.fn(), removeListener: vi.fn()}}}));
vi.mock('webextension-polyfill', () => ({default: browserMock}));
import {
    CHROME_TRANSLATION_PREPARATION_STORAGE_KEY,
    createChromeTranslationPreparationStore,
    isChromeTranslationPreparationRequest,
} from '@/src/platform/browser/chromeTranslationPreparationRequest';

function area() {
    const values: Record<string, unknown> = {};
    const listeners: Array<(changes: Record<string, {newValue?: unknown}>, areaName: string) => void> = [];
    return {
        values,
        get: vi.fn(async () => ({...values})),
        set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(values, items); }),
        remove: vi.fn(async (key: string) => { delete values[key]; }),
        listeners,
    };
}

describe('Chrome translation preparation request store', () => {
    beforeEach(() => vi.restoreAllMocks());
    afterEach(() => vi.unstubAllGlobals());

    it('validates concrete pairs and rejects auto, same language, aliases and malformed values', () => {
        expect(isChromeTranslationPreparationRequest({sourceLanguage: 'en', targetLanguage: 'zh'})).toBe(true);
        for (const value of [
            null,
            {sourceLanguage: 'auto', targetLanguage: 'zh'},
            {sourceLanguage: 'AUTO', targetLanguage: 'zh'},
            {sourceLanguage: 'en', targetLanguage: 'EN'},
            {sourceLanguage: 'zh-CN', targetLanguage: 'zh-Hans'},
            {sourceLanguage: 'zh-TW', targetLanguage: 'zh-Hant'},
            {sourceLanguage: 'en', targetLanguage: 'bad value'},
        ]) expect(isChromeTranslationPreparationRequest(value)).toBe(false);
    });

    it('stores one pair, reads it, and clears only a matching pair', async () => {
        const mocked = area();
        const store = createChromeTranslationPreparationStore(mocked);
        await store.set({sourceLanguage: 'en', targetLanguage: 'zh'});
        await expect(store.get()).resolves.toEqual({sourceLanguage: 'en', targetLanguage: 'zh'});
        await store.clear({sourceLanguage: 'ja', targetLanguage: 'zh'});
        expect(mocked.remove).not.toHaveBeenCalled();
        await store.clear({sourceLanguage: 'en', targetLanguage: 'zh'});
        expect(mocked.remove).toHaveBeenCalledWith(CHROME_TRANSLATION_PREPARATION_STORAGE_KEY);
        await expect(store.get()).resolves.toBeNull();
        await store.clear();
    });

    it('serializes set and matching clear so a newer pair survives', async () => {
        const mocked = area();
        let release!: () => void;
        mocked.get.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({...mocked.values}); }));
        const store = createChromeTranslationPreparationStore(mocked);
        mocked.values[CHROME_TRANSLATION_PREPARATION_STORAGE_KEY] = {sourceLanguage: 'en', targetLanguage: 'zh'};
        const clear = store.clear({sourceLanguage: 'en', targetLanguage: 'zh'});
        const set = store.set({sourceLanguage: 'ja', targetLanguage: 'zh'});
        await Promise.resolve();
        release();
        await Promise.all([clear, set]);
        expect(mocked.values[CHROME_TRANSLATION_PREPARATION_STORAGE_KEY]).toEqual({sourceLanguage: 'ja', targetLanguage: 'zh'});
    });

    it('falls back quietly when session storage is unavailable and subscribes to session changes', () => {
        const {addListener, removeListener} = browserMock.storage.onChanged;
        addListener.mockClear();
        removeListener.mockClear();
        const store = createChromeTranslationPreparationStore();
        const listener = vi.fn();
        const unsubscribe = store.subscribe(listener);
        expect(addListener).toHaveBeenCalledOnce();
        const handler = addListener.mock.calls[0]?.[0] as (changes: Record<string, {newValue?: unknown}>, area: string) => void;
        handler({[CHROME_TRANSLATION_PREPARATION_STORAGE_KEY]: {newValue: {sourceLanguage: 'en', targetLanguage: 'zh'}}}, 'local');
        expect(listener).not.toHaveBeenCalled();
        handler({[CHROME_TRANSLATION_PREPARATION_STORAGE_KEY]: {newValue: {sourceLanguage: 'en', targetLanguage: 'zh'}}}, 'session');
        expect(listener).toHaveBeenCalledWith({sourceLanguage: 'en', targetLanguage: 'zh'});
        unsubscribe();
        expect(removeListener).toHaveBeenCalledOnce();
    });

    it('quietly handles unavailable, malformed, and failing storage operations', async () => {
        const originalStorage = browserMock.storage;
        Object.defineProperty(browserMock, 'storage', {configurable: true, get: () => { throw new Error('storage blocked'); }});
        await expect(createChromeTranslationPreparationStore().get()).resolves.toBeNull();
        Object.defineProperty(browserMock, 'storage', {configurable: true, writable: true, value: originalStorage});
        const unavailable = createChromeTranslationPreparationStore();
        await expect(unavailable.get()).resolves.toBeNull();
        await expect(unavailable.set({sourceLanguage: 'en', targetLanguage: 'zh'})).resolves.toBeUndefined();
        await expect(unavailable.clear()).resolves.toBeUndefined();

        const mocked = area();
        mocked.get.mockRejectedValue(new Error('read failed'));
        mocked.set.mockRejectedValue(new Error('write failed'));
        mocked.remove.mockRejectedValue(new Error('remove failed'));
        const store = createChromeTranslationPreparationStore(mocked);
        await expect(store.get()).resolves.toBeNull();
        await expect(store.set({sourceLanguage: 'en', targetLanguage: 'zh'})).resolves.toBeUndefined();
        await expect(store.clear()).resolves.toBeUndefined();
        await expect(store.set({sourceLanguage: 'auto', targetLanguage: 'zh'})).resolves.toBeUndefined();
    });

    it('ignores unrelated and malformed storage change events', () => {
        const {addListener} = browserMock.storage.onChanged;
        addListener.mockClear();
        const store = createChromeTranslationPreparationStore();
        const listener = vi.fn();
        store.subscribe(listener);
        const handler = addListener.mock.calls[0]?.[0] as (changes: Record<string, {newValue?: unknown}>, area: string) => void;
        handler({}, 'session');
        handler({other: {newValue: 1}}, 'session');
        handler({[CHROME_TRANSLATION_PREPARATION_STORAGE_KEY]: {newValue: {sourceLanguage: 'auto', targetLanguage: 'zh'}}}, 'session');
        expect(listener).toHaveBeenCalledWith(null);
    });

    it('allows subscription to degrade when change events are unavailable', () => {
        const original = browserMock.storage;
        Object.defineProperty(browserMock, 'storage', {configurable: true, value: {}});
        expect(createChromeTranslationPreparationStore().subscribe(vi.fn())).toEqual(expect.any(Function));
        Object.defineProperty(browserMock, 'storage', {configurable: true, writable: true, value: original});
    });
});

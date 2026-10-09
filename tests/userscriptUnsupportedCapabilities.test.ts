import {describe, expect, it, vi} from 'vitest';
import {
    toggleMangaTranslation,
    openMangaEntry,
    isMangaReaderPage,
    isImageTranslatorNeeded,
    mountMangaEntry,
    unmountMangaEntry,
    subscribeMangaTranslation,
    isAreaTranslatorMounted,
    isSupportedVideoPage,
    mountAreaTranslator,
    mountImageTranslator,
    mountVideoSubtitleTranslation,
    unmountAreaTranslator,
    unmountImageTranslator,
} from '@/userscript/unsupportedCapabilities';

describe('userscript extension-only capability stubs', () => {
    it('never mounts area, image, or video runtimes', () => {
        expect(isAreaTranslatorMounted()).toBe(false);
        expect(mountAreaTranslator()).toBeUndefined();
        expect(mountImageTranslator()).toBeUndefined();
        expect(unmountAreaTranslator()).toBeUndefined();
        expect(unmountImageTranslator()).toBeUndefined();
        expect(mountVideoSubtitleTranslation()()).toBeUndefined();
        expect(isSupportedVideoPage()).toBe(false);
    });
});

 it('漫画入口保持不可用且初始状态不会误显示已开启', async () => {
    const statuses: unknown[] = [];
    const unsubscribe = subscribeMangaTranslation(status => statuses.push(status));
    expect(statuses).toEqual([{available: false, active: false, pending: false, errors: 0}]);
    expect(toggleMangaTranslation()).toBe(false);
    expect(openMangaEntry()).toBe(false);
    expect(isMangaReaderPage()).toBe(false);
    expect(isImageTranslatorNeeded()).toBe(false);
    await expect(mountMangaEntry()).resolves.toBeUndefined();
    expect(unmountMangaEntry()).toBeUndefined();
    expect(unsubscribe()).toBeUndefined();
 });

it('GF statistics adapters preserve generation and write results without opening IndexedDB', async () => {
    const open = vi.fn(() => {throw new Error('Statistics adapter must not open IndexedDB');});
    const deleteDatabase = vi.fn(() => {throw new Error('Statistics adapter must not delete IndexedDB');});
    vi.stubGlobal('indexedDB', {open, deleteDatabase});
    try {
        vi.resetModules();
        const {modelUsageRepository, translationStatsRepository} = await import('@/userscript/unsupportedCapabilities');
        expect(modelUsageRepository.captureGeneration()).toBe(0);
        await expect(modelUsageRepository.recordMany([], 0)).resolves.toBe(0);
        await expect(modelUsageRepository.recordMany([{serviceId: 'synthetic-local'}] as never, 11)).resolves.toBe(0);
        expect(translationStatsRepository.captureGeneration()).toBe(0);
        expect(translationStatsRepository.record({serviceId: 'synthetic-local'} as never, 11)).toBeUndefined();
        expect(translationStatsRepository.captureGeneration()).toBe(0);
        expect(open).not.toHaveBeenCalled();
        expect(deleteDatabase).not.toHaveBeenCalled();
    } finally {
        vi.unstubAllGlobals();
        vi.resetModules();
    }
});

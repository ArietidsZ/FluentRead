import {describe, expect, it} from 'vitest';
import {FREE_TRANSLATION_PROVIDERS} from '@/src/core/config/freeTranslation';
import {calculateFreeTranslationWeightSnapshot} from '@/src/services/translation/freeWeights';

type FreeProviderId = typeof FREE_TRANSLATION_PROVIDERS[number]['id'];
const enabledProviderIds: FreeProviderId[] = FREE_TRANSLATION_PROVIDERS.slice(0, 9).map(provider => provider.id);
const enabledProviderSet = new Set<string>(enabledProviderIds);
const entry = (providerId: string, snapshot: ReturnType<typeof calculateFreeTranslationWeightSnapshot>) => {
    const result = snapshot.entries.find(item => item.providerId === providerId);
    expect(result, providerId).toBeDefined();
    return result!;
};

describe('free translation weight snapshots', () => {
    it('normalizes enabled default weights to exactly 100%', () => {
        const snapshot = calculateFreeTranslationWeightSnapshot(enabledProviderIds, [], 1_000);
        const enabled = snapshot.entries.filter(item => enabledProviderSet.has(item.providerId));

        expect(snapshot.total).toBe(100);
        expect(enabled.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
        expect(entry('microsoft', snapshot)).toMatchObject({weight: 20.8, status: 'ready'});
        expect(entry('sogouFree', snapshot)).toMatchObject({weight: 0, status: 'disabled'});
        expect(entry('microsoft', snapshot).weight.toString()).toMatch(/^\d+\.\d$/u);
    });

    it('drops a failed service to zero during its cooldown and renormalizes the rest', () => {
        const now = 10_000;
        const snapshot = calculateFreeTranslationWeightSnapshot(enabledProviderIds, [{
            providerId: 'microsoft', retryAt: now + 1_000, failures: 1, category: 'request',
        }], now);
        const enabled = snapshot.entries.filter(item => enabledProviderSet.has(item.providerId));

        expect(snapshot.total).toBe(100);
        expect(entry('microsoft', snapshot)).toMatchObject({weight: 0, status: 'cooling', retryAt: now + 1_000});
        expect(enabled.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
        expect(entry('transmart', snapshot).weight).toBeGreaterThan(0);
    });

    it('gives a cooled service a lower recovering weight after the probe window', () => {
        const now = 20_000;
        const snapshot = calculateFreeTranslationWeightSnapshot(enabledProviderIds, [{
            providerId: 'microsoft', retryAt: 0, failures: 1, category: 'request',
            performance: {reliability: 0.75, latencyMs: 1_000, observedAt: now},
        }], now);

        expect(entry('microsoft', snapshot)).toMatchObject({status: 'recovering'});
        expect(entry('microsoft', snapshot).weight).toBeLessThan(20.8);
        expect(entry('transmart', snapshot).weight).toBeGreaterThan(entry('microsoft', snapshot).weight);
        expect(snapshot.entries.filter(item => enabledProviderSet.has(item.providerId)).reduce((sum, item) => sum + item.weight, 0)).toBe(100);
    });

    it('reports no allocation when every enabled service is cooling', () => {
        const now = 30_000;
        const health = enabledProviderIds.map(providerId => ({
            providerId, retryAt: now + 1_000, failures: 1, category: 'unavailable' as const,
        }));
        const snapshot = calculateFreeTranslationWeightSnapshot(enabledProviderIds, health, now);

        expect(snapshot.total).toBe(0);
        expect(snapshot.entries.filter(item => enabledProviderSet.has(item.providerId)).every(item => item.weight === 0 && item.status === 'cooling')).toBe(true);
    });
});

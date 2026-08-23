import { describe, expect, it, vi } from 'vitest';
import {
  clearLegacyPageTranslationCache,
  type LegacyPageStorage,
} from '@/entrypoints/utils/legacyPageCache';

function createStorage(entries: Record<string, string>): LegacyPageStorage & { snapshot: () => Record<string, string> } {
  const values = new Map(Object.entries(entries));
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    removeItem(key) { values.delete(key); },
    snapshot() { return Object.fromEntries(values); },
  };
}

describe('legacy page cache migration', () => {
  it('removes only FluentRead page-cache records and its timestamp marker', () => {
    const storage = createStorage({
      hostPreference: 'keep-me',
      flcache_service_model_text: '旧译文',
      flcache_reverse_translation: '旧原文',
      flLastSessionTimestamp: '1234',
    });

    expect(clearLegacyPageTranslationCache(storage)).toBe(2);
    expect(storage.snapshot()).toEqual({hostPreference: 'keep-me'});
  });

  it('does not call broad clear and fails closed when page storage is unavailable', () => {
    const broken = {
      get length() { throw new DOMException('blocked'); },
      key: vi.fn(),
      getItem: vi.fn(),
      removeItem: vi.fn(),
    } as unknown as LegacyPageStorage;

    expect(clearLegacyPageTranslationCache(broken)).toBe(0);
    expect(broken.removeItem).not.toHaveBeenCalled();
  });
});

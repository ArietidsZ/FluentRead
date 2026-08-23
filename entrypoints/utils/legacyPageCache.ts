const LEGACY_TRANSLATION_CACHE_PREFIX = 'flcache_';
const LEGACY_CACHE_TIMESTAMP_KEY = 'flLastSessionTimestamp';

export interface LegacyPageStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

/**
 * Remove page-origin cache records written by FluentRead versions predating
 * the background-owned IndexedDB cache. This migration deliberately touches
 * only the old FluentRead prefix and marker; host-page storage is preserved.
 */
export function clearLegacyPageTranslationCache(
  pageStorage: LegacyPageStorage = window.localStorage,
): number {
  try {
    const keysToDelete: string[] = [];
    for (let index = 0; index < pageStorage.length; index += 1) {
      const key = pageStorage.key(index);
      if (key?.startsWith(LEGACY_TRANSLATION_CACHE_PREFIX)) keysToDelete.push(key);
    }

    keysToDelete.forEach((key) => pageStorage.removeItem(key));
    if (keysToDelete.length > 0 || pageStorage.getItem(LEGACY_CACHE_TIMESTAMP_KEY) !== null) {
      pageStorage.removeItem(LEGACY_CACHE_TIMESTAMP_KEY);
    }
    return keysToDelete.length;
  } catch {
    // Storage can be disabled or throw for opaque/sandboxed origins. Migration
    // failure must not prevent the content script or translation from loading.
    return 0;
  }
}

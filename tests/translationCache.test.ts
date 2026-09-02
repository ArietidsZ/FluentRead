import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TRANSLATION_CACHE_MAX_BYTES,
  TRANSLATION_CACHE_MAX_ENTRIES,
  TRANSLATION_CACHE_MAX_ENTRY_BYTES,
  TRANSLATION_CACHE_MEMORY_ENTRIES,
  TRANSLATION_CACHE_TTL_MS,
  buildTranslationCacheKey,
  canonicalize,
  translationCache,
  translationCacheDb,
  type TranslationCacheRecord,
} from '@/src/services/translation/cache';

function record(
  key: string,
  overrides: Partial<TranslationCacheRecord> = {},
): TranslationCacheRecord {
  const createdAt = overrides.createdAt ?? 1_000;
  const translation = overrides.translation ?? `译文-${key}`;
  return {
    key,
    translation,
    createdAt,
    lastAccessedAt: overrides.lastAccessedAt ?? createdAt,
    expiresAt: overrides.expiresAt ?? createdAt + TRANSLATION_CACHE_TTL_MS,
    byteSize: overrides.byteSize ?? key.length + translation.length,
  };
}

async function resetCache(): Promise<void> {
  await translationCache.clear().catch(() => undefined);
  await translationCacheDb.entries.clear().catch(() => undefined);
}

describe('translation cache identity', () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await resetCache();
  });

  it('canonicalizes every supported primitive and structural type deterministically', () => {
    const symbol = Symbol('cache');
    const fn = function cacheIdentity() { return 'ignored'; };

    expect(canonicalize(null)).toBe('null');
    expect(canonicalize(undefined)).toBe('null');
    expect(canonicalize('a"b')).toBe(JSON.stringify('a"b'));
    expect(canonicalize(42)).toBe('42');
    expect(canonicalize(Number.NaN)).toBe('null');
    expect(canonicalize(true)).toBe('true');
    expect(canonicalize(10n)).toBe(JSON.stringify('10'));
    expect(canonicalize([1, undefined, 'x'])).toBe('[1,null,"x"]');
    expect(canonicalize({ b: 2, omitted: undefined, a: { z: false } }))
      .toBe('{"a":{"z":false},"b":2}');
    expect(canonicalize(symbol)).toBe(JSON.stringify(String(symbol)));
    expect(canonicalize(fn)).toBe(JSON.stringify(String(fn)));
  });

  it('uses an opaque versioned digest for every cache identity field', () => {
    const base = { sourceText: 'a_b', targetLanguage: 'zh-Hans', service: 'microsoft' };
    const key = buildTranslationCacheKey(base);

    expect(key).toMatch(/^v2:[0-9a-f]{64}$/);
    expect(buildTranslationCacheKey({ ...base, sourceText: 'a' })).not.toBe(key);
    expect(buildTranslationCacheKey({ ...base, targetLanguage: 'en' })).not.toBe(key);
    expect(buildTranslationCacheKey({ ...base, service: 'google' })).not.toBe(key);
  });

  it('falls back to UTF-16 byte estimation when TextEncoder is unavailable', async () => {
    vi.stubGlobal('TextEncoder', undefined);
    const translation = 'x'.repeat(Math.floor(TRANSLATION_CACHE_MAX_ENTRY_BYTES / 2));

    await expect(translationCache.set('fallback-byte-size', translation, 1_000)).resolves.toBe(false);
    await expect(translationCacheDb.entries.get('fallback-byte-size')).resolves.toBeUndefined();
  });
});

describe('translation cache persistence policy', () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await resetCache();
  });

  it('serves hot memory hits without touching IndexedDB and refreshes access order', async () => {
    await expect(translationCache.set('hot', '热译文', 1_000)).resolves.toBe(true);
    const getSpy = vi.spyOn(translationCacheDb.entries, 'get');

    await expect(translationCache.get('hot', 2_000)).resolves.toBe('热译文');

    expect(getSpy).not.toHaveBeenCalled();
  });

  it('loads cold IndexedDB hits promptly, touches last access time, and promotes them to memory', async () => {
    await translationCacheDb.entries.put(record('cold', { lastAccessedAt: 1_000 }));
    const actualUpdate = translationCacheDb.entries.update.bind(translationCacheDb.entries);
    let releaseTouch!: () => void;
    const touchGate = new Promise<void>((resolve) => {
      releaseTouch = resolve;
    });
    const updateSpy = vi.spyOn(translationCacheDb.entries, 'update').mockImplementationOnce((
      async (
        key: string | TranslationCacheRecord,
        changes: Parameters<typeof actualUpdate>[1],
      ) => {
        await touchGate;
        return actualUpdate(key, changes);
      }
    ) as never);

    await expect(translationCache.get('cold', 5_000)).resolves.toBe('译文-cold');
    expect(updateSpy).toHaveBeenCalledWith('cold', { lastAccessedAt: 5_000 });
    await expect(translationCacheDb.entries.get('cold')).resolves.toMatchObject({ lastAccessedAt: 1_000 });

    releaseTouch();
    await vi.waitFor(async () => {
      await expect(translationCacheDb.entries.get('cold')).resolves.toMatchObject({ lastAccessedAt: 5_000 });
    });

    const getSpy = vi.spyOn(translationCacheDb.entries, 'get');
    await expect(translationCache.get('cold', 6_000)).resolves.toBe('译文-cold');
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('serves and promotes a cold hit even when the asynchronous LRU touch fails', async () => {
    const failure = new Error('touch blocked');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await translationCacheDb.entries.put(record('cold-touch-failure'));
    vi.spyOn(translationCacheDb.entries, 'update').mockRejectedValueOnce(failure);

    await expect(translationCache.get('cold-touch-failure', 5_000)).resolves.toBe('译文-cold-touch-failure');
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith('[FluentRead] translation cache read failed:', failure);
    });
  });

  it('expires hot records by TTL and removes their persistent copy asynchronously', async () => {
    await translationCache.set('hot-expired', '旧译文', 1_000);

    await expect(translationCache.get('hot-expired', 1_000 + TRANSLATION_CACHE_TTL_MS)).resolves.toBeNull();
    await vi.waitFor(async () => {
      await expect(translationCacheDb.entries.get('hot-expired')).resolves.toBeUndefined();
    });
  });

  it('expires cold records by expiresAt even when createdAt is still fresh', async () => {
    await translationCacheDb.entries.put(record('cold-expired', {
      createdAt: 10_000,
      lastAccessedAt: 10_000,
      expiresAt: 10_100,
    }));

    await expect(translationCache.get('cold-expired', 10_101)).resolves.toBeNull();
    await expect(translationCacheDb.entries.get('cold-expired')).resolves.toBeUndefined();
  });

  it('returns null for missing cold entries', async () => {
    await expect(translationCache.get('missing', 1_000)).resolves.toBeNull();
  });

  it('evicts the oldest hot-memory entry while keeping its IndexedDB copy readable', async () => {
    for (let index = 0; index <= TRANSLATION_CACHE_MEMORY_ENTRIES; index += 1) {
      await translationCache.set(`memory-${index}`, `译文-${index}`, 1_000 + index);
    }

    const getSpy = vi.spyOn(translationCacheDb.entries, 'get');
    await expect(translationCache.get('memory-0', 5_000)).resolves.toBe('译文-0');

    expect(getSpy).toHaveBeenCalledWith('memory-0');
  });

  it('rejects empty and oversized entries before writing', async () => {
    await expect(translationCache.set('empty', '', 1_000)).resolves.toBe(false);
    await expect(translationCache.set('too-large', 'x'.repeat(TRANSLATION_CACHE_MAX_ENTRY_BYTES), 1_000))
      .resolves.toBe(false);
    await expect(translationCacheDb.entries.count()).resolves.toBe(0);
  });

  it('bounds persistent entries by LRU count', async () => {
    const existing = Array.from({ length: TRANSLATION_CACHE_MAX_ENTRIES }, (_, index) => (
      record(`entry-${index}`, {
        createdAt: 1_000 + index,
        lastAccessedAt: 1_000 + index,
      })
    ));
    await translationCacheDb.entries.bulkPut(existing);

    await expect(translationCache.set('entry-new', '新译文', 10_000)).resolves.toBe(true);

    await expect(translationCacheDb.entries.count()).resolves.toBe(TRANSLATION_CACHE_MAX_ENTRIES);
    await expect(translationCacheDb.entries.get('entry-0')).resolves.toBeUndefined();
    await expect(translationCacheDb.entries.get('entry-new')).resolves.toBeDefined();
  });

  it('bounds persistent entries by declared byte size', async () => {
    await translationCacheDb.entries.bulkPut([
      record('byte-old', { lastAccessedAt: 1_000, byteSize: TRANSLATION_CACHE_MAX_BYTES - 1 }),
      record('byte-mid', { lastAccessedAt: 2_000, byteSize: 10 }),
    ]);

    await expect(translationCache.set('byte-new', '新译文', 3_000)).resolves.toBe(true);

    await expect(translationCacheDb.entries.get('byte-old')).resolves.toBeUndefined();
    await expect(translationCacheDb.entries.get('byte-mid')).resolves.toBeDefined();
    await expect(translationCacheDb.entries.get('byte-new')).resolves.toBeDefined();
  });

  it('keeps translating when IndexedDB read or write fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(translationCacheDb.entries, 'get').mockRejectedValueOnce(new Error('blocked read'));

    await expect(translationCache.get('read-failure', 1_000)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith('[FluentRead] translation cache read failed:', expect.any(Error));

    vi.spyOn(translationCacheDb, 'transaction').mockRejectedValueOnce(new Error('quota'));
    await expect(translationCache.set('write-failure', '译文', 1_000)).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith('[FluentRead] translation cache write failed:', expect.any(Error));
  });

  it('cleanup removes expired records and stale memory entries', async () => {
    const now = 1_000 + TRANSLATION_CACHE_TTL_MS;
    await translationCache.set('memory-stale', '旧译文', 1_000);
    await translationCache.set('memory-live', '新译文', now);
    await translationCacheDb.entries.put(record('db-expires-at', { expiresAt: now }));
    await translationCacheDb.entries.put(record('db-created-at', {
      createdAt: 1_000,
      expiresAt: 1_000 + 7 * TRANSLATION_CACHE_TTL_MS,
    }));

    await translationCache.cleanup(now);

    await expect(translationCacheDb.entries.get('db-expires-at')).resolves.toBeUndefined();
    await expect(translationCacheDb.entries.get('db-created-at')).resolves.toBeUndefined();
    await expect(translationCache.get('memory-live', now + 1)).resolves.toBe('新译文');

    const getSpy = vi.spyOn(translationCacheDb.entries, 'get');
    await expect(translationCache.get('memory-stale', now + 1)).resolves.toBeNull();
    expect(getSpy).toHaveBeenCalledWith('memory-stale');
  });

  it('cleanup degrades when IndexedDB cleanup fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(translationCacheDb.entries, 'where').mockImplementationOnce(() => {
      throw new Error('cleanup blocked');
    });

    await expect(translationCache.cleanup(10_000)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[FluentRead] translation cache cleanup failed:', expect.any(Error));
  });

  it('clear removes memory and IndexedDB entries', async () => {
    await translationCache.set('clear-me', '译文', 1_000);

    await expect(translationCache.clear()).resolves.toBeUndefined();

    await expect(translationCache.get('clear-me', 2_000)).resolves.toBeNull();
    await expect(translationCacheDb.entries.count()).resolves.toBe(0);
  });

  it('clear invalidates a deferred cold read without repopulating memory or IndexedDB', async () => {
    const staleRecord = record('clear-cold-race', { lastAccessedAt: 1_000 });
    await translationCacheDb.entries.put(staleRecord);
    let resolveRead!: (value: TranslationCacheRecord) => void;
    const deferredRead = new Promise<TranslationCacheRecord>((resolve) => {
      resolveRead = resolve;
    });
    const getSpy = vi.spyOn(translationCacheDb.entries, 'get')
      .mockReturnValueOnce(deferredRead as never);

    const read = translationCache.get('clear-cold-race', 5_000);
    await vi.waitFor(() => {
      expect(getSpy).toHaveBeenCalledWith('clear-cold-race');
    });

    await translationCache.clear();
    resolveRead(staleRecord);

    await expect(read).resolves.toBeNull();
    await expect(translationCacheDb.entries.count()).resolves.toBe(0);
    await expect(translationCache.get('clear-cold-race', 6_000)).resolves.toBeNull();
    expect(getSpy).toHaveBeenCalledTimes(2);
  });

  it('clear invalidates a write that entered the old epoch before its transaction starts', async () => {
    let releaseTransaction!: () => void;
    const transactionGate = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });
    const transactionSpy = vi.spyOn(translationCacheDb, 'transaction').mockImplementationOnce((
      async (...args: unknown[]) => {
        await transactionGate;
        const scope = args.at(-1) as () => unknown;
        return scope();
      }
    ) as never);

    const staleWrite = translationCache.set('clear-write-race', '旧代译文', 5_000);
    await vi.waitFor(() => expect(transactionSpy).toHaveBeenCalledOnce());

    await translationCache.clear();
    releaseTransaction();

    await expect(staleWrite).resolves.toBe(false);
    await expect(translationCacheDb.entries.get('clear-write-race')).resolves.toBeUndefined();
    await expect(translationCache.get('clear-write-race', 6_000)).resolves.toBeNull();
  });

  it('clear rethrows IndexedDB failures after clearing memory', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(translationCacheDb.entries, 'clear').mockRejectedValueOnce(new Error('clear blocked'));

    await expect(translationCache.clear()).rejects.toThrow('clear blocked');
    expect(warn).toHaveBeenCalledWith('[FluentRead] translation cache clear failed:', expect.any(Error));
  });

  it('uses Date.now defaults for ordinary set and get calls', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(50_000);

    await expect(translationCache.set('default-now', '默认时间')).resolves.toBe(true);
    now.mockReturnValue(50_001);
    await expect(translationCache.get('default-now')).resolves.toBe('默认时间');
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('standalone userscript privacy boundaries', () => {
  const source = readFileSync(resolve(process.cwd(), 'userscripts.js'), 'utf8');

  it('keeps translation cache out of host-page Web Storage', () => {
    expect(source).not.toMatch(/\b(?:localStorage|sessionStorage)\b/);
    expect(source).toContain('GM_setValue(this.buildKey(origin), {value: result, createdAt})');
    expect(source).toContain("key.startsWith(TRANSLATION_CACHE_PREFIX)");
  });

  it('never clears storage outside FluentRead-owned GM keys', () => {
    expect(source).not.toMatch(/(?:localStorage|sessionStorage)\.clear\(\)/);
    expect(source).toContain('GM_deleteValue(key)');
    expect(source).toContain("key.startsWith(TRANSLATION_CACHE_PREFIX)");
  });

  it('uses a per-entry hard TTL instead of a sliding global timestamp', () => {
    expect(source).toContain('const TRANSLATION_CACHE_TTL_MS = 24 * 3600000');
    expect(source).toContain('now - record.createdAt > TRANSLATION_CACHE_TTL_MS');
    expect(source).toContain('translationCacheManager.clearExpired()');
    expect(source).toContain('GM_deleteValue(LEGACY_TRANSLATION_CACHE_TIMESTAMP_KEY)');
    expect(source).not.toContain('GM_setValue(TRANSLATION_CACHE_TIMESTAMP_KEY');
  });

  it('expires cached HTML by its original creation time', () => {
    const ttlDeclaration = source.match(/const TRANSLATION_CACHE_TTL_MS = 24 \* 3600000;/)?.[0];
    const readerDeclaration = source.match(
      /function readTranslationCacheRecord\(record, now = Date\.now\(\)\) \{[\s\S]*?\n\}/,
    )?.[0];
    expect(ttlDeclaration).toBeTruthy();
    expect(readerDeclaration).toBeTruthy();

    const readRecord = Function(
      `'use strict'; ${ttlDeclaration} ${readerDeclaration}; return readTranslationCacheRecord;`,
    )() as (record: unknown, now?: number) => string | null;
    const createdAt = 1_000_000;
    expect(readRecord({value: '<p>原文</p>', createdAt}, createdAt + 1)).toBe('<p>原文</p>');
    expect(readRecord({value: '<p>原文</p>', createdAt}, createdAt + 24 * 3600000 + 1)).toBeNull();
    expect(readRecord({value: '<p>原文</p>', createdAt: createdAt + 1}, createdAt)).toBeNull();
    expect(readRecord('<p>旧版无时间戳</p>', createdAt)).toBeNull();
  });

  it('keeps Gemini credentials out of URLs and response bodies out of errors', () => {
    expect(source).not.toContain('generateContent?key=');
    expect(source).toContain("'x-goog-api-key': token");
    expect(source).not.toMatch(/reject\((?:resp|response)\.responseText\)/);
    expect(source).not.toMatch(/reject\((?:resp|response)\.status\s*,\s*(?:resp|response)\.responseText\)/);
  });

  it('keeps language-detection text out of the request URL', () => {
    expect(source).not.toContain("langdetect?' + data.toString()");
    expect(source).toContain("url: 'https://fanyi.baidu.com/langdetect'");
    expect(source).toContain('data: data.toString()');
  });

  it('does not log credentials or raw response objects', () => {
    expect(source).not.toContain('console.log("API Key 格式错误：", apiKey)');
    expect(source).not.toMatch(/console\.(?:log|warn|error)\((?:resp|response|result)\)/);
    expect(source).not.toMatch(/^\s*console\.(?:log|debug|info|warn|error)\(/m);
    expect(source).not.toMatch(/=>\s*console\.(?:log|debug|info|warn|error)/);
  });

  it('sanitizes malformed JSON on every remaining userscript response path', () => {
    expect(source).toContain('function parseUserscriptJson(responseText)');
    expect(source).not.toContain('const jsn = JSON.parse(resp.responseText)');
    expect(source).not.toMatch(/JSON\.parse\(response\.responseText\)\.Data/);
    expect(source).toContain("reject(new Error('语言检测返回格式异常'))");
    expect(source.match(/parseUserscriptJson\((?:resp|response)\.responseText\)/g)?.length).toBe(3);
  });
});

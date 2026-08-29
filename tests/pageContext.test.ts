import { afterEach, describe, expect, it } from 'vitest';

import {getPageTranslationContext, resetPageTranslationContextCache} from '@/src/services/translation/context';

const originalDocument = globalThis.document;
const originalLocation = globalThis.location;

afterEach(() => {
    resetPageTranslationContextCache();
    Object.defineProperty(globalThis, 'document', {value: originalDocument, configurable: true});
    Object.defineProperty(globalThis, 'location', {value: originalLocation, configurable: true});
});

describe('getPageTranslationContext', () => {
    it('X/Grok 原生翻译启用后不复用已经捕获的帖子页面上下文', async () => {
        let xNativeTranslationEnabled = false;
        const clone = {
            innerText: 'timeline post must stay inside X',
            textContent: '',
            querySelectorAll: () => [],
        };
        Object.defineProperty(globalThis, 'location', {
            value: {href: 'https://x.com/home'},
            configurable: true,
        });
        Object.defineProperty(globalThis, 'document', {
            value: {
                title: 'X timeline',
                documentElement: {
                    hasAttribute: () => xNativeTranslationEnabled,
                },
                body: {cloneNode: () => clone},
                querySelector: () => null,
            },
            configurable: true,
        });

        expect(await getPageTranslationContext()).toContain('timeline post must stay inside X');
        xNativeTranslationEnabled = true;
        expect(await getPageTranslationContext()).toBe('');
    });

    it('捕获期间开启 X/Grok 原生翻译时丢弃尚未返回的旧页面上下文', async () => {
        let xNativeTranslationEnabled = false;
        const clone = {
            innerText: 'pending timeline post must not leave X',
            textContent: '',
            querySelectorAll: () => [],
        };
        Object.defineProperty(globalThis, 'location', {
            value: {href: 'https://x.com/search?q=translation'},
            configurable: true,
        });
        Object.defineProperty(globalThis, 'document', {
            value: {
                title: 'X search',
                documentElement: {
                    hasAttribute: () => xNativeTranslationEnabled,
                },
                body: {cloneNode: () => clone},
                querySelector: () => null,
            },
            configurable: true,
        });

        const pendingContext = getPageTranslationContext();
        xNativeTranslationEnabled = true;
        await expect(pendingContext).resolves.toBe('');
    });

    it('提取标题、描述和正文，并移除插件生成内容', async () => {
        const removed: string[] = [];
        const clone = {
            innerText: 'prefix context sentence target sentence suffix',
            textContent: '',
            querySelectorAll: (selector: string) => selector === '*'
                ? []
                : [{remove: () => removed.push('generated')}],
        };

        Object.defineProperty(globalThis, 'location', {
            value: {href: 'https://example.com/article'},
            configurable: true,
        });
        Object.defineProperty(globalThis, 'document', {
            value: {
                title: 'An article',
                body: {cloneNode: () => clone},
                querySelector: (selector: string) => selector === 'meta[name="description"]'
                    ? {getAttribute: () => 'A short description'}
                    : null,
            },
            configurable: true,
        });

        const context = await getPageTranslationContext();

        expect(context).toContain('Page title: An article');
        expect(context).toContain('Page description: A short description');
        expect(context).toContain('Readable page content (Markdown):\nprefix context sentence target sentence suffix');
        expect(removed).toEqual(['generated']);
    });

    it('限制上下文长度，避免正文无限扩大请求体', async () => {
        const longText = 'x'.repeat(10000);
        const clone = {
            innerText: longText,
            textContent: '',
            querySelectorAll: () => [],
        };

        Object.defineProperty(globalThis, 'location', {
            value: {href: 'https://example.com/long'},
            configurable: true,
        });
        Object.defineProperty(globalThis, 'document', {
            value: {
                title: '',
                body: {cloneNode: () => clone},
                querySelector: () => null,
            },
            configurable: true,
        });

        const context = await getPageTranslationContext();
        expect(context).toContain('Readable page content (Markdown):');
        expect(context.length).toBeLessThanOrEqual(4000);
        expect(context).toContain('x'.repeat(2000));
    });
});

import {createRequire} from 'node:module';
import {parseHTML} from 'linkedom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const require = createRequire(import.meta.url);
const {observeTranslationIdleInPage, waitForTranslationIdle} = require('../scripts/run-site-translation-test.cjs');
const selector = '.fluent-read-loading[data-fr-translation-owned="true"]';
const key = '__testTranslationIdle';

describe('long-page translation idle regression', () => {
  let document: Document;
  let window: Window;
  let now: number;
  const observe = () => observeTranslationIdleInPage({selector, key, stableMs: 12, stallTimeoutMs: 210, maximumDurationMs: 630});
  const addLoading = (id: string) => {
    const owner = document.createElement('p');
    owner.id = id;
    owner.innerHTML = `Original text ${id}<span class="fluent-read-loading" data-fr-translation-owned="true"></span>`;
    document.body.append(owner);
    return owner;
  };
  const complete = (owner: HTMLElement, translated = true) => {
    owner.querySelector(selector)?.remove();
    if (translated) {
      const result = document.createElement('span');
      result.className = 'fluent-read-bilingual-content';
      result.setAttribute('data-fr-translation-owned', 'true');
      result.textContent = '译文';
      owner.append(result);
    }
  };

  beforeEach(() => {
    ({document, window} = parseHTML('<html><body></body></html>') as unknown as {document: Document; window: Window});
    Reflect.deleteProperty(window, key);
    now = 0;
    vi.stubGlobal('document', document);
    vi.stubGlobal('window', window);
    vi.stubGlobal('performance', {now: () => now});
  });
  afterEach(() => vi.unstubAllGlobals());

  it('allows a long queue to keep completing beyond a single request budget', () => {
    let owner = addLoading('one');
    expect(observe()).toBe(false);
    for (const time of [100, 200, 300, 400]) {
      now = time;
      complete(owner);
      owner = addLoading(String(time));
      expect(observe()).toBe(false);
    }
    now = 450;
    complete(owner);
    expect(observe()).toBe(false);
    now = 461;
    expect(observe()).toBe(false);
    now = 462;
    expect(observe()).toBe(true);
  });

  it('recognizes completed unchanged text without requiring a new translation wrapper', () => {
    const first = addLoading('unchanged');
    observe();
    now = 200;
    complete(first, false);
    addLoading('next');
    expect(observe()).toBe(false);
    now = 300;
    expect(observe()).toBe(false);
    now = 410;
    expect(observe).toThrow('没有完成进展');
  });

  it('tracks distinct anonymous identical unchanged paragraphs as separate completed tasks', () => {
    let owner = addLoading('');
    observe();
    for (const time of [100, 200, 300, 400]) {
      now = time;
      complete(owner, false);
      owner = addLoading('');
      expect(observe()).toBe(false);
    }
    now = 450;
    complete(owner, false);
    expect(observe()).toBe(false);
    now = 462;
    expect(observe()).toBe(true);
  });

  it('does not count host nodes with a matching class as completed translations', () => {
    addLoading('stalled');
    observe();
    for (const time of [100, 200]) {
      now = time;
      document.body.insertAdjacentHTML('beforeend', '<span class="fluent-read-bilingual-content">Host content</span>');
      expect(observe()).toBe(false);
    }
    now = 210;
    expect(observe).toThrow('没有完成进展');
  });

  it('does not treat animation, spinner replacement, or a new queued owner as completion', () => {
    const owner = addLoading('stalled');
    observe();
    now = 100;
    const replacement = owner.querySelector(selector)!.cloneNode(true) as HTMLElement;
    owner.querySelector(selector)!.replaceWith(replacement);
    replacement.setAttribute('style', 'opacity: 0.5');
    owner.firstChild!.textContent = 'Changing source while still loading';
    addLoading('newly-started');
    expect(observe()).toBe(false);
    now = 210;
    expect(observe).toThrow('没有完成进展');
  });

  it('does not let repeated settlement of the same owner or wrapper count rebound renew the budget', () => {
    const stalled = addLoading('stalled');
    const repeated = addLoading('repeated');
    observe();
    now = 50;
    complete(repeated);
    observe();
    now = 100;
    repeated.querySelector('.fluent-read-bilingual-content')!.remove();
    repeated.insertAdjacentHTML('beforeend', '<span class="fluent-read-loading" data-fr-translation-owned="true"></span>');
    observe();
    now = 150;
    complete(repeated);
    expect(observe()).toBe(false);
    now = 260;
    expect(stalled.querySelector(selector)).not.toBeNull();
    expect(observe).toThrow('没有完成进展');
  });

  it('does not count a removed host subtree as a successfully completed task', () => {
    const owner = addLoading('removed');
    addLoading('stalled');
    observe();
    now = 200;
    owner.remove();
    expect(observe()).toBe(false);
    now = 210;
    expect(observe).toThrow('没有完成进展');
  });

  it('enforces an absolute phase limit even while distinct tasks keep completing', () => {
    let owner = addLoading('first');
    observe();
    for (const time of [100, 200, 300, 400, 500, 600]) {
      now = time;
      complete(owner);
      owner = addLoading(String(time));
      expect(observe()).toBe(false);
    }
    now = 630;
    complete(owner);
    expect(observe).toThrow('硬上限');
  });

  it('requires a continuous idle window after a new loading task interrupts apparent idle', () => {
    expect(observe()).toBe(false);
    now = 11;
    const owner = addLoading('late');
    expect(observe()).toBe(false);
    now = 20;
    complete(owner);
    expect(observe()).toBe(false);
    now = 31;
    expect(observe()).toBe(false);
    now = 32;
    expect(observe()).toBe(true);
  });

  it('cleans temporary state after success and refuses terminal retry controls', async () => {
    const page = {
      waitForFunction: async (predicate: (args: unknown) => boolean, args: unknown) => {
        expect(predicate(args)).toBe(false);
        now += 1200;
        expect(predicate(args)).toBe(true);
      },
      evaluate: async (fn: (args: unknown) => unknown, args: unknown) => fn(args),
    };
    await waitForTranslationIdle(page, 100, 'success', 2100);
    expect(Object.keys(window).filter((value) => value.startsWith('__fluentReadIdleSince'))).toEqual([]);
    document.body.innerHTML = '<p>Failed source<span class="fluent-read-retry-wrapper" data-fr-translation-owned="true"></span></p>';
    await expect(waitForTranslationIdle(page, 100, 'failure', 2100)).rejects.toThrow('终态翻译失败');
    expect(Object.keys(window).filter((value) => value.startsWith('__fluentReadIdleSince'))).toEqual([]);
  });

  it('cleans temporary state and reports the actual stuck owner after a stall', async () => {
    addLoading('stalled');
    const page = {
      waitForFunction: async (predicate: (args: unknown) => boolean, args: unknown) => {
        predicate(args);
        now = 2100;
        predicate(args);
      },
      evaluate: async (fn: (args: unknown) => unknown, args: unknown) => fn(args),
    };
    await expect(waitForTranslationIdle(page, 100, 'stalled', 2100)).rejects.toThrow('"ownerId":"stalled"');
    expect(Object.keys(window).filter((value) => value.startsWith('__fluentReadIdleSince'))).toEqual([]);
  });
});

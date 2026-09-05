import {describe, expect, it, vi} from 'vitest';
import {VideoTranslationCache} from '@/src/features/video-subtitle/content/translationCache';

describe('VideoTranslationCache', () => {
  it('规范化 key、合并请求、缓存结果并回退空译文为原文', async () => {
    const translate = vi.fn(async (text: string) => text === 'empty' ? '' : `译-${text}`);
    const cache = new VideoTranslationCache(translate);
    await expect(cache.request('  hello   world ')).resolves.toBe('译-hello world');
    await expect(cache.request('hello world')).resolves.toBe('译-hello world');
    await expect(cache.request('empty')).resolves.toBe('');
    expect(translate).toHaveBeenCalledTimes(2);
  });
  it('clear 后迟到结果不写回，失败进入退避', async () => {
    let resolve!: (value: string) => void;
    const cache = new VideoTranslationCache(() => new Promise<string>(r => { resolve = r; }));
    const old = cache.request('old'); await new Promise<void>(r => setTimeout(r, 0)); cache.clear(); resolve('late'); await expect(old).rejects.toBeTruthy();
    const failing = new VideoTranslationCache(async () => { throw new Error('failed'); });
    await expect(failing.request('fresh')).rejects.toThrow('failed');
    await expect(failing.request('fresh')).resolves.toBe('');
  });

  it('退避结束后重试同一 key 会累加失败次数', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const cache = new VideoTranslationCache(async () => { throw new Error('failed'); });
    await expect(cache.request('retry')).rejects.toThrow('failed');
    now.mockReturnValue(4_000);
    await expect(cache.request('retry')).rejects.toThrow('failed');
    await expect(cache.request('retry')).resolves.toBe('');
    now.mockRestore();
  });
  it('合并同 key 的在途请求，并允许当前请求提升预取优先级', async () => {
    let resolve!: (value: string) => void;
    const translate = vi.fn(() => new Promise<string>(r => { resolve = r; }));
    const cache = new VideoTranslationCache(translate);
    const first = cache.request('same', true);
    const second = cache.request(' same ');
    await new Promise<void>(r => setTimeout(r, 0));
    resolve('translated');
    await expect(Promise.all([first, second])).resolves.toEqual(['translated', 'translated']);
    expect(translate).toHaveBeenCalledOnce();
  });
  it('成功和失败缓存都限制在 160 条以内', async () => {
    const success = new VideoTranslationCache(async text => `ok-${text}`);
    for (let i = 0; i < 161; i += 1) await success.request(`success-${i}`);
    const fail = new VideoTranslationCache(async () => { throw new Error('no'); });
    for (let i = 0; i < 161; i += 1) await fail.request(`failure-${i}`).catch(() => undefined);
    await expect(fail.request('failure-0')).rejects.toThrow('no');
  });
  it('空 key 与非字符串 provider 结果按约定回退', async () => {
    const cache = new VideoTranslationCache(async () => 1 as unknown as string);
    await expect(cache.request('   ')).resolves.toBe('   ');
    await expect(cache.request('non-string')).resolves.toBe('non-string');
  });
});

import {describe, expect, it} from 'vitest';
import {VideoTranslationScheduler} from '@/src/features/video-subtitle/content/translationScheduler';

const tick = () => new Promise<void>(r => setTimeout(r, 0));
describe('VideoTranslationScheduler', () => {
  it('合并重复请求并提升 current lane 优先级', async () => {
    const calls: string[] = [];
    const scheduler = new VideoTranslationScheduler(async source => { calls.push(source); return source.toUpperCase(); });
    const a = scheduler.request('a', true); const b = scheduler.request('b', true); const a2 = scheduler.request('a');
    await expect(Promise.all([a, a2, b])).resolves.toEqual(['A', 'A', 'B']);
    expect(calls).toEqual(['a', 'b']);
  });
  it('clear 会 abort、拒绝旧 promise，并允许新一轮请求', async () => {
    let resolve!: (value: string) => void;
    const scheduler = new VideoTranslationScheduler((_s, signal) => new Promise<string>((r, reject) => { resolve = r; signal.addEventListener('abort', () => reject(new Error('aborted'))); }));
    const old = scheduler.request('old'); await tick(); scheduler.clear();
    await expect(old).rejects.toMatchObject({name: 'AbortError'});
    const next = scheduler.request('new');
    await tick();
    resolve('new-value');
    await tick();
    await expect(next).resolves.toBe('new-value');
  });
  it('预取最多占两路，第三路等待；已取消任务不会调用 translate', async () => {
    let calls = 0;
    const scheduler = new VideoTranslationScheduler(async () => { calls += 1; return 'ok'; });
    const waiting = [scheduler.request('a', true), scheduler.request('b', true), scheduler.request('c', true)];
    scheduler.clear();
    await Promise.allSettled(waiting);
    expect(calls).toBeLessThanOrEqual(2);
    const cancelled = scheduler.request('cancel');
    scheduler.clear();
    await expect(cancelled).rejects.toMatchObject({name: 'AbortError'});
  });
});

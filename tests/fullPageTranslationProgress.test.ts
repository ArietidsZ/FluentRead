import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  finishFullPageTranslationProgress,
  getFullPageTranslationProgress,
  hasActiveFullPageTranslationWork,
  shouldShowCompactFullPageTranslationStatus,
  startFullPageTranslationProgress,
  subscribeFullPageTranslationProgress,
  updateFullPageTranslationProgress,
} from '@/src/features/full-page-translation/progress';

afterEach(() => {
  const current = getFullPageTranslationProgress();
  if (current.active) finishFullPageTranslationProgress(current.sessionId);
});

describe('全文翻译进度', () => {
  it('仅把请求中或已排队任务视为需要展开面板的活动工作', () => {
    const offscreenOnly = {
      sessionId: 1,
      active: true,
      running: 0,
      remaining: 6,
      queued: 0,
      offscreen: 6,
    };
    expect(hasActiveFullPageTranslationWork(offscreenOnly)).toBe(false);
    expect(hasActiveFullPageTranslationWork({active: true, running: 1, queued: 0})).toBe(true);
    expect(hasActiveFullPageTranslationWork({active: true, running: 0, queued: 2})).toBe(true);
    expect(hasActiveFullPageTranslationWork({active: true, running: 0, queued: 0, modalPhase: 'waiting', deferred: 3})).toBe(true);
    expect(hasActiveFullPageTranslationWork({active: false, running: 3, queued: 4})).toBe(false);
    expect(hasActiveFullPageTranslationWork({active: true, running: Number.NaN, queued: -1})).toBe(false);

    expect(shouldShowCompactFullPageTranslationStatus(offscreenOnly, false)).toBe(true);
    expect(shouldShowCompactFullPageTranslationStatus(offscreenOnly, true)).toBe(false);
    expect(shouldShowCompactFullPageTranslationStatus({active: true, running: 1, queued: 0}, false)).toBe(false);
    expect(shouldShowCompactFullPageTranslationStatus({active: false, running: 0, queued: 0}, false)).toBe(false);
  });

  it('立即提供快照，并发布进行中、队列与离屏任务数量', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFullPageTranslationProgress(listener);
    const sessionId = startFullPageTranslationProgress();

    updateFullPageTranslationProgress(sessionId, {
      running: 3,
      queued: 4,
      offscreen: 7,
    });

    expect(listener).toHaveBeenLastCalledWith({
      sessionId,
      active: true,
      modalPhase: 'none',
      deferred: 0,
      running: 3,
      remaining: 11,
      queued: 4,
      offscreen: 7,
    });
    expect(getFullPageTranslationProgress()).toEqual(listener.mock.lastCall?.[0]);
    unsubscribe();
  });

  it('忽略旧会话的迟到更新和结束通知', () => {
    const staleSessionId = startFullPageTranslationProgress();
    const currentSessionId = startFullPageTranslationProgress();

    updateFullPageTranslationProgress(staleSessionId, {running: 99, queued: 99, offscreen: 99});
    finishFullPageTranslationProgress(staleSessionId);

    expect(getFullPageTranslationProgress()).toEqual({
      sessionId: currentSessionId,
      active: true,
      modalPhase: 'none',
      deferred: 0,
      running: 0,
      remaining: 0,
      queued: 0,
      offscreen: 0,
    });
  });

  it('结束当前会话时清零计数并通知订阅者', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFullPageTranslationProgress(listener);
    const sessionId = startFullPageTranslationProgress();
    updateFullPageTranslationProgress(sessionId, {running: 2, queued: 1, offscreen: 5});

    finishFullPageTranslationProgress(sessionId);

    expect(listener).toHaveBeenLastCalledWith({
      sessionId,
      active: false,
      modalPhase: 'none',
      deferred: 0,
      running: 0,
      remaining: 0,
      queued: 0,
      offscreen: 0,
    });
    unsubscribe();
  });

  it('规范化异常计数，并对相同快照去重', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFullPageTranslationProgress(listener);
    const sessionId = startFullPageTranslationProgress();
    listener.mockClear();

    updateFullPageTranslationProgress(sessionId, {running: 2.9, queued: -1, offscreen: Number.NaN});
    updateFullPageTranslationProgress(sessionId, {running: 2, queued: 0, offscreen: 0});

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({
      running: 2,
      remaining: 0,
      queued: 0,
      offscreen: 0,
    }));
    unsubscribe();
  });

  it('把弹窗阶段和被阻塞候选纳入剩余数量，并允许阶段切换', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFullPageTranslationProgress(listener);
    const sessionId = startFullPageTranslationProgress();
    listener.mockClear();

    updateFullPageTranslationProgress(sessionId, {
      modalPhase: 'translating',
      deferred: 4,
      running: 1,
      queued: 2,
      offscreen: 3,
    });
    expect(getFullPageTranslationProgress()).toMatchObject({
      modalPhase: 'translating',
      deferred: 4,
      running: 1,
      queued: 2,
      offscreen: 3,
      remaining: 9,
    });
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({modalPhase: 'translating', deferred: 4, remaining: 9}));

    updateFullPageTranslationProgress(sessionId, {
      modalPhase: 'waiting',
      deferred: 5,
      running: 0,
      queued: 0,
      offscreen: 3,
    });
    expect(getFullPageTranslationProgress()).toMatchObject({modalPhase: 'waiting', deferred: 5, remaining: 8});
    expect(hasActiveFullPageTranslationWork(getFullPageTranslationProgress())).toBe(true);
    unsubscribe();
  });

  it('新会话重置弹窗阶段与 deferred 状态，并拒绝旧会话字段', () => {
    const oldSessionId = startFullPageTranslationProgress();
    updateFullPageTranslationProgress(oldSessionId, {
      modalPhase: 'waiting', deferred: 7, running: 0, queued: 0, offscreen: 1,
    });
    const newSessionId = startFullPageTranslationProgress();
    updateFullPageTranslationProgress(oldSessionId, {
      modalPhase: 'translating', deferred: 99, running: 9, queued: 9, offscreen: 9,
    });
    expect(getFullPageTranslationProgress()).toEqual({
      sessionId: newSessionId,
      active: true,
      modalPhase: 'none',
      deferred: 0,
      running: 0,
      remaining: 0,
      queued: 0,
      offscreen: 0,
    });
  });

  it('隔离订阅者快照与异常，取消订阅后不再通知', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = vi.fn((snapshot: ReturnType<typeof getFullPageTranslationProgress>) => {
      snapshot.running = 999;
      throw new Error('listener failed');
    });
    const healthy = vi.fn();
    const unsubscribeBroken = subscribeFullPageTranslationProgress(broken);
    const unsubscribeHealthy = subscribeFullPageTranslationProgress(healthy);
    healthy.mockClear();

    const sessionId = startFullPageTranslationProgress();

    expect(healthy).toHaveBeenLastCalledWith(expect.objectContaining({sessionId, running: 0}));
    expect(consoleError).toHaveBeenCalledWith(
      '[FluentRead] 全文翻译进度订阅者执行失败',
      expect.any(Error),
    );

    unsubscribeBroken();
    unsubscribeHealthy();
    broken.mockClear();
    healthy.mockClear();
    updateFullPageTranslationProgress(sessionId, {running: 1, queued: 0, offscreen: 0});
    expect(broken).not.toHaveBeenCalled();
    expect(healthy).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('在未激活时忽略更新和结束', () => {
    const current = getFullPageTranslationProgress();
    if (current.active) finishFullPageTranslationProgress(current.sessionId);
    const before = getFullPageTranslationProgress();

    updateFullPageTranslationProgress(before.sessionId, {running: 1, queued: 2, offscreen: 3});
    finishFullPageTranslationProgress(before.sessionId);

    expect(getFullPageTranslationProgress()).toEqual(before);
  });
});

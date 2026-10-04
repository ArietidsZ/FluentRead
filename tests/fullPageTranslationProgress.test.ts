import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {compileScript, parse} from 'vue/compiler-sfc';
import ts from 'typescript';
import * as vue from 'vue';
import * as progressApi from '@/src/features/full-page-translation/progress';
import {createProgressPanelVisibility} from '@/src/features/full-page-translation/ui/progressPanelVisibility';

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
  vi.useRealTimers();
});

describe('全文翻译进度面板显隐稳定性', () => {
  function setup(floatingBallEnabled = true) {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const visibility = createProgressPanelVisibility(onChange);
    const progress = {
      sessionId: 1, active: true, modalPhase: 'none' as 'none' | 'translating' | 'waiting',
      deferred: 0, running: 1, remaining: 13, queued: 1, offscreen: 12,
    };
    const update = (patch: Partial<typeof progress> = {}, dismissed = false) => {
      Object.assign(progress, patch);
      visibility.update({...progress}, floatingBallEnabled, dismissed);
    };
    update();
    return {onChange, visibility, update};
  }

  it('缓存等短任务结束后不会迟到弹出面板', () => {
    const {onChange, visibility, update} = setup();
    vi.advanceTimersByTime(100);
    update({running: 0, queued: 0});
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    visibility.dispose();
  });

  it('计数持续变化也能按时显示，队列间隙不会导致反复显隐', () => {
    const {onChange, visibility, update} = setup();
    vi.advanceTimersByTime(100);
    update({running: 2, queued: 0});
    vi.advanceTimersByTime(80);
    expect(onChange.mock.calls).toEqual([['expanded']]);
    for (let index = 0; index < 10; index += 1) {
      update({running: 0, queued: 0});
      vi.advanceTimersByTime(100);
      update({running: 1});
      vi.advanceTimersByTime(100);
    }
    expect(onChange.mock.calls).toEqual([['expanded']]);
    update({running: 0});
    vi.advanceTimersByTime(300);
    update({offscreen: 11, remaining: 11});
    vi.advanceTimersByTime(299);
    expect(onChange.mock.calls).toEqual([['expanded']]);
    vi.advanceTimersByTime(1);
    expect(onChange.mock.calls).toEqual([['expanded'], ['hidden']]);
    visibility.dispose();
  });

  it('关闭悬浮球时只在连续空闲后退化为紧凑勾选，再次工作也不抖动', () => {
    const {onChange, visibility, update} = setup(false);
    vi.advanceTimersByTime(180);
    update({running: 0, queued: 0});
    vi.advanceTimersByTime(600);
    expect(onChange.mock.calls).toEqual([['expanded'], ['compact']]);
    update({running: 1});
    vi.advanceTimersByTime(100);
    update({running: 0});
    vi.advanceTimersByTime(1000);
    expect(onChange.mock.calls).toEqual([['expanded'], ['compact']]);
    update({running: 1});
    vi.advanceTimersByTime(180);
    expect(onChange).toHaveBeenLastCalledWith('expanded');
    visibility.dispose();
  });

  it.each([100, 200])('手动关闭在 %sms 时取消等待或立即隐藏，并保持本会话关闭', elapsed => {
    const {onChange, visibility, update} = setup();
    vi.advanceTimersByTime(elapsed);
    update({}, true);
    vi.advanceTimersByTime(1000);
    update({running: 3}, true);
    expect(onChange.mock.calls).toEqual(elapsed < 180 ? [] : [['expanded'], ['hidden']]);
    expect(vi.getTimerCount()).toBe(0);
    update({sessionId: 2}, false);
    vi.advanceTimersByTime(180);
    expect(onChange).toHaveBeenLastCalledWith('expanded');
    visibility.dispose();
  });

  it('恢复原文立即隐藏，不等待空闲计时器', () => {
    const {onChange, visibility, update} = setup();
    vi.advanceTimersByTime(180);
    update({running: 0, queued: 0});
    vi.advanceTimersByTime(100);
    update({active: false});
    expect(onChange.mock.calls).toEqual([['expanded'], ['hidden']]);
    expect(vi.getTimerCount()).toBe(0);
    visibility.dispose();
  });

  it('新会话不会继承旧会话的展开计时器', () => {
    const {onChange, visibility, update} = setup();
    vi.advanceTimersByTime(100);
    update({sessionId: 2});
    vi.advanceTimersByTime(80);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onChange).toHaveBeenLastCalledWith('expanded');
    update({sessionId: 3, running: 0, queued: 0});
    expect(onChange).toHaveBeenLastCalledWith('hidden');
    visibility.dispose();
  });

  it('原生弹窗等待提示立即出现，不被短任务过滤', () => {
    const {onChange, visibility, update} = setup();
    update({modalPhase: 'waiting', running: 0, queued: 0});
    expect(onChange.mock.calls).toEqual([['expanded']]);
    expect(vi.getTimerCount()).toBe(0);
    update({modalPhase: 'translating', running: 1});
    update({modalPhase: 'waiting', running: 0});
    expect(onChange.mock.calls).toEqual([['expanded']]);
    visibility.dispose();
  });

  it('设置变化取消或替换收起目标，卸载后不再发布', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const visibility = createProgressPanelVisibility(onChange);
    const progress = {sessionId: 1, active: true, modalPhase: 'none' as const,
      deferred: 0, running: 0, queued: 0, offscreen: 12, remaining: 12};
    visibility.update(progress, false, false);
    visibility.update(progress, true, false);
    visibility.update({...progress, running: 1}, true, false);
    vi.advanceTimersByTime(180);
    visibility.update(progress, true, false);
    vi.advanceTimersByTime(100);
    visibility.update(progress, false, false);
    vi.advanceTimersByTime(600);
    expect(onChange.mock.calls).toEqual([['compact'], ['hidden'], ['expanded'], ['compact']]);
    visibility.update({...progress, running: 1}, false, false);
    visibility.dispose();
    visibility.dispose();
    visibility.update({...progress, sessionId: 2}, false, false);
    vi.advanceTimersByTime(1000);
    expect(onChange).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('已排入事件队列的过期回调不能在关闭或卸载后重新显示', () => {
    const {onChange, visibility, update} = setup();
    const clearTimeout = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => {});
    update({}, true);
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();
    update({sessionId: 2}, false);
    visibility.dispose();
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();
    clearTimeout.mockRestore();
  });
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

describe('进度面板组件实时订阅与显隐', () => {
  const filename = 'src/features/full-page-translation/ui/TranslationProgressPanel.vue';
  const {descriptor} = parse(readFileSync(filename, 'utf8'), {filename});
  const compiled = ts.transpileModule(compileScript(descriptor, {id: 'progress-panel-test'}).content, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText;
  let scope: vue.EffectScope;
  let state: Record<string, any>;
  let unmount: (() => void)[];
  let publishConfig: (value: typeof config) => void;
  let config: {animations: boolean; theme: string; disableFloatingBall: boolean};

  beforeEach(() => {
    vi.useFakeTimers();
    config = {animations: true, theme: 'auto', disableFloatingBall: false};
    const mounted: (() => void)[] = [];
    unmount = [];
    vi.stubGlobal('window', {matchMedia: () => ({matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn()})});
    const exports: Record<string, any> = {};
    new Function('require', 'exports', compiled)((id: string) => {
      if (id === 'vue') return {...vue, onMounted: (fn: () => void) => mounted.push(fn), onBeforeUnmount: (fn: () => void) => unmount.push(fn)};
      if (id.endsWith('/progress')) return progressApi;
      if (id === './progressPanelVisibility') return {createProgressPanelVisibility};
      if (id.endsWith('/store')) return {config, subscribeConfig: (fn: typeof publishConfig) => {publishConfig = fn; return vi.fn();}};
      if (id.endsWith('/i18n')) return {useUiI18n: () => ({t: (key: string) => key})};
      throw new Error(`Unexpected import: ${id}`);
    }, exports);
    scope = vue.effectScope();
    state = scope.run(() => vue.proxyRefs(exports.default.setup({}, {expose: () => {}})))!;
    mounted.forEach(fn => fn());
  });

  afterEach(() => {
    unmount.forEach(fn => fn());
    scope.stop();
    vi.unstubAllGlobals();
  });

  it('组件不展示不足 180ms 的短任务', () => {
    const sessionId = startFullPageTranslationProgress();
    updateFullPageTranslationProgress(sessionId, {running: 1, queued: 0, offscreen: 12});
    vi.advanceTimersByTime(100);
    expect(state.isVisible).toBe(false);
    updateFullPageTranslationProgress(sessionId, {running: 0, queued: 0, offscreen: 12});
    vi.advanceTimersByTime(1000);
    expect(state.isVisible).toBe(false);
  });

  it('快速工作与离屏等待交替时保持展开，计数仍实时刷新', () => {
    const sessionId = startFullPageTranslationProgress();
    updateFullPageTranslationProgress(sessionId, {running: 1, queued: 0, offscreen: 12});
    vi.advanceTimersByTime(180);
    expect(state.isVisible).toBe(true);
    for (let index = 0; index < 10; index += 1) {
      updateFullPageTranslationProgress(sessionId, {running: 0, queued: 0, offscreen: 12 - index});
      expect(state.progress.running).toBe(0);
      expect(state.progress.remaining).toBe(12 - index);
      expect(state.isVisible).toBe(true);
      vi.advanceTimersByTime(100);
      updateFullPageTranslationProgress(sessionId, {running: 1, queued: 0, offscreen: 12 - index});
      expect(state.progress.running).toBe(1);
      expect(state.isVisible).toBe(true);
      vi.advanceTimersByTime(100);
    }
    updateFullPageTranslationProgress(sessionId, {running: 0, queued: 0, offscreen: 2});
    vi.advanceTimersByTime(600);
    expect(state.isVisible).toBe(false);
  });

  it('收起、恢复原文和再次翻译立即更新展示所有权', () => {
    const sessionId = startFullPageTranslationProgress();
    updateFullPageTranslationProgress(sessionId, {running: 1, queued: 0, offscreen: 12});
    vi.advanceTimersByTime(180);
    state.dismiss();
    expect(state.isVisible).toBe(false);
    updateFullPageTranslationProgress(sessionId, {running: 2, queued: 0, offscreen: 12});
    vi.advanceTimersByTime(1000);
    expect(state.isVisible).toBe(false);
    const nextSessionId = startFullPageTranslationProgress();
    updateFullPageTranslationProgress(nextSessionId, {running: 1, queued: 0, offscreen: 12});
    vi.advanceTimersByTime(180);
    expect(state.isVisible).toBe(true);
    finishFullPageTranslationProgress(nextSessionId);
    expect(state.isVisible).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('配置订阅保持紧凑状态契约，卸载取消显隐计时器', () => {
    const sessionId = startFullPageTranslationProgress();
    updateFullPageTranslationProgress(sessionId, {running: 1, queued: 0, offscreen: 12});
    vi.advanceTimersByTime(180);
    publishConfig({...config, disableFloatingBall: true});
    updateFullPageTranslationProgress(sessionId, {running: 0, queued: 0, offscreen: 12});
    expect(state.isCompact).toBe(false);
    vi.advanceTimersByTime(600);
    expect(state.isCompact).toBe(true);
    expect(state.isVisible).toBe(true);
    updateFullPageTranslationProgress(sessionId, {running: 1, queued: 0, offscreen: 12});
    unmount.forEach(fn => fn());
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(state.isCompact).toBe(true);
  });
});

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';

const mocks = vi.hoisted(() => ({
  config: {animations: true, service: 'deepseek'},
  showPageNotice: vi.fn(),
}));

vi.mock('@/src/services/config/store', () => ({config: mocks.config}));
vi.mock('@/src/core/config/catalog', () => ({
  options: {services: [{value: 'deepseek', label: 'DeepSeek'}]},
}));
vi.mock('@/src/features/page-notice/public', () => ({showPageNotice: mocks.showPageNotice}));

import {
  insertFailedTip,
  insertLoadingSpinner,
} from '@/src/features/full-page-translation/ui/translationIndicators';

const originalDocument = globalThis.document;
const originalWindow = globalThis.window;

function dispatchCancelableClick(target: Element): Event {
  const EventConstructor = (window as unknown as {Event: typeof Event}).Event;
  const event = new EventConstructor('click', {bubbles: true, cancelable: true});
  target.dispatchEvent(event);
  return event;
}

function dispatchActionKey(target: Element, key: 'Enter' | ' '): Event {
  const EventConstructor = (window as unknown as {Event: typeof Event}).Event;
  const event = new EventConstructor('keydown', {bubbles: true, cancelable: true});
  Object.defineProperty(event, 'key', {value: key});
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  const {document, window} = parseHTML('<html><body><p id="target">Source</p></body></html>');
  Object.defineProperty(globalThis, 'document', {value: document, configurable: true});
  Object.defineProperty(globalThis, 'window', {value: window, configurable: true});
  mocks.config.animations = true;
  mocks.config.service = 'deepseek';
  mocks.showPageNotice.mockReset();
});

afterEach(() => {
  Object.defineProperty(globalThis, 'document', {value: originalDocument, configurable: true});
  Object.defineProperty(globalThis, 'window', {value: originalWindow, configurable: true});
});

describe('全文翻译节点状态指示', () => {
  it('失败节点可查看经过归类的原因，并安全重试', () => {
    const target = document.getElementById('target')!;
    const retry = vi.fn();

    const wrapper = insertFailedTip(target, 'quota exceeded', retry);

    expect(target.classList.contains('fluent-read-failure')).toBe(true);
    expect(wrapper.getAttribute('data-fr-translation-owned')).toBe('true');
    expect(wrapper.querySelectorAll('svg')).toHaveLength(2);
    wrapper.querySelector<HTMLElement>('.fluent-read-reason')!.click();
    expect(mocks.showPageNotice).toHaveBeenCalledWith(
      '你的请求频率过高，被【DeepSeek】拒绝了，请稍后再试吧~',
      'error',
    );

    wrapper.querySelector<HTMLElement>('.fluent-read-retry')!.click();
    expect(retry).toHaveBeenCalledOnce();
    expect(wrapper.isConnected).toBe(false);
    expect(target.classList.contains('fluent-read-failure')).toBe(false);
  });

  it('链接翻译失败时，错误图标和控件空白处只显示提示而不触发原链接', () => {
    document.body.innerHTML = '<a id="target" href="https://example.com/destination">Source</a>';
    const target = document.getElementById('target')!;
    const hostLinkClick = vi.fn();
    target.addEventListener('click', hostLinkClick);

    const wrapper = insertFailedTip(target, 'quota exceeded', vi.fn());
    const reason = wrapper.querySelector<HTMLElement>('.fluent-read-reason')!;
    const reasonIcon = reason.querySelector('svg')!;

    const iconClick = dispatchCancelableClick(reasonIcon);
    const wrapperClick = dispatchCancelableClick(wrapper);

    expect(reason.getAttribute('role')).toBeNull();
    expect(reason.getAttribute('tabindex')).toBeNull();
    expect(iconClick.defaultPrevented).toBe(true);
    expect(wrapperClick.defaultPrevented).toBe(true);
    expect(hostLinkClick).not.toHaveBeenCalled();
    expect(mocks.showPageNotice).toHaveBeenCalledOnce();
  });

  it('链接翻译失败时，点击重试图标不会触发原链接', () => {
    document.body.innerHTML = '<a id="target" href="https://example.com/destination">Source</a>';
    const target = document.getElementById('target')!;
    const hostLinkClick = vi.fn();
    const retry = vi.fn();
    target.addEventListener('click', hostLinkClick);

    const wrapper = insertFailedTip(target, 'provider unavailable', retry);
    const retryAction = wrapper.querySelector<HTMLElement>('.fluent-read-retry')!;
    const retryIcon = retryAction.querySelector('svg')!;
    const iconClick = dispatchCancelableClick(retryIcon);

    expect(retryAction.getAttribute('role')).toBeNull();
    expect(retryAction.getAttribute('tabindex')).toBeNull();
    expect(iconClick.defaultPrevented).toBe(true);
    expect(hostLinkClick).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledOnce();
    expect(wrapper.isConnected).toBe(false);
  });

  it('交互宿主内不创建嵌套的可聚焦按钮语义', () => {
    document.body.innerHTML = '<button id="target" type="button">Source</button>';
    const target = document.getElementById('target')!;
    const hostButtonClick = vi.fn();
    target.addEventListener('click', hostButtonClick);

    const wrapper = insertFailedTip(target, 'provider unavailable', vi.fn());
    const reason = wrapper.querySelector<HTMLElement>('.fluent-read-reason')!;
    const click = dispatchCancelableClick(reason);

    expect(reason.getAttribute('role')).toBeNull();
    expect(reason.getAttribute('tabindex')).toBeNull();
    expect(click.defaultPrevented).toBe(true);
    expect(hostButtonClick).not.toHaveBeenCalled();
    expect(mocks.showPageNotice).toHaveBeenCalledOnce();
  });

  it('失败操作支持键盘，并让扩展上下文失效的重试保留刷新提示', () => {
    const target = document.getElementById('target')!;
    const retry = vi.fn();
    const wrapper = insertFailedTip(target, 'Extension context invalidated.', retry);
    const retryAction = wrapper.querySelector<HTMLElement>('.fluent-read-retry')!;
    const reasonAction = wrapper.querySelector<HTMLElement>('.fluent-read-reason')!;

    expect(retryAction.getAttribute('role')).toBe('button');
    expect(retryAction.getAttribute('tabindex')).toBe('0');
    expect(reasonAction.getAttribute('role')).toBe('button');
    expect(reasonAction.getAttribute('tabindex')).toBe('0');

    const retryKey = dispatchActionKey(retryAction, 'Enter');
    const reasonKey = dispatchActionKey(reasonAction, ' ');

    expect(retryKey.defaultPrevented).toBe(true);
    expect(reasonKey.defaultPrevented).toBe(true);
    expect(retry).not.toHaveBeenCalled();
    expect(wrapper.isConnected).toBe(true);
    expect(mocks.showPageNotice).toHaveBeenCalledTimes(2);
    expect(mocks.showPageNotice).toHaveBeenLastCalledWith(
      '扩展已更新或重新加载，请刷新当前页面后再试。',
      'error',
    );
  });

  it('加载指示区分缓存命中，并尊重动画配置', async () => {
    const target = document.getElementById('target')!;
    const cached = insertLoadingSpinner(target, true);
    await Promise.resolve();

    expect(cached.getAttribute('data-fr-translation-owned')).toBe('true');
    expect(cached.style.getPropertyValue('border-top')).toBe('3px solid green');
    expect(cached.classList.contains('static')).toBe(false);

    mocks.config.animations = false;
    const staticSpinner = insertLoadingSpinner(target);
    await Promise.resolve();
    expect(staticSpinner.style.getPropertyValue('border-top')).not.toBe('3px solid green');
    expect(staticSpinner.classList.contains('static')).toBe(true);
  });
});

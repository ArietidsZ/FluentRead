import {afterEach, describe, expect, it, vi} from 'vitest';
const mocks = vi.hoisted(() => ({create:vi.fn()}));
vi.mock('@/src/platform/shadow-ui/vue', () => ({createVueShadowUi:mocks.create}));
vi.mock('@/src/features/vocabulary/ui/SentenceActions.vue', () => ({default:{}}));
import {mountSentenceActions, unmountSentenceActions, isSentenceActionsMounted} from '@/src/features/vocabulary/content';
import type {ContentScriptContext} from 'wxt/utils/content-script-context';
const context = {} as ContentScriptContext;
afterEach(() => {unmountSentenceActions(); vi.clearAllMocks();});
describe('sentence actions mount ownership', () => {
  it('replaces a mounted surface and removes it on disable', async () => {
    const first = {remove:vi.fn()}; const second = {remove:vi.fn()};
    mocks.create.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    expect(isSentenceActionsMounted()).toBe(false);
    await mountSentenceActions(context); expect(isSentenceActionsMounted()).toBe(true);
    await mountSentenceActions(context); expect(first.remove).toHaveBeenCalledOnce();
    unmountSentenceActions(); expect(second.remove).toHaveBeenCalledOnce();
    expect(isSentenceActionsMounted()).toBe(false);
  });
  it('discards a late mount after the page was disabled', async () => {
    let resolve!: (surface:unknown) => void;
    mocks.create.mockImplementationOnce(() => new Promise(done => {resolve = done;}));
    const pending = mountSentenceActions(context); unmountSentenceActions();
    const late = {remove:vi.fn()}; resolve(late); await pending;
    expect(late.remove).toHaveBeenCalledOnce(); expect(isSentenceActionsMounted()).toBe(false);
  });
});

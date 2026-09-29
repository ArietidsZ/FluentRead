import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
const mocks = vi.hoisted(() => ({create: vi.fn(), read: vi.fn(), notice: vi.fn(), config: {on: true, uiLanguage: 'zh-CN'}}));
vi.mock('@/src/platform/shadow-ui', () => ({createVueShadowUi: mocks.create}));
vi.mock('@/src/features/full-page-translation/public', () => ({readBilingualExcerpt: mocks.read}));
vi.mock('@/src/features/page-notice/public', () => ({showPageNotice: mocks.notice}));
vi.mock('@/src/services/config/store', () => ({config: mocks.config}));
vi.mock('@/src/features/share-card/ui/ShareCardStudio.vue', () => ({default: {}}));
import {isShareCardMounted, mountShareCard, openShareCard, unmountShareCard} from '@/src/features/share-card/content/runtime';
import type {ContentScriptContext} from 'wxt/utils/content-script-context';
const ctx = {} as ContentScriptContext;
beforeEach(() => {
    vi.clearAllMocks(); mocks.config.on = true;
    vi.stubGlobal('document', new EventTarget()); vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('location', {href: 'https://example.com/private?secret=1'});
});
afterEach(() => {unmountShareCard(); vi.unstubAllGlobals();});
describe('分享卡片按需挂载所有权', () => {
    it('启动只注册监听，两个并发入口复用单个闭合 Shadow UI', async () => {
        const open = vi.fn(), remove = vi.fn(), setAnchor = vi.fn();
        mocks.create.mockResolvedValue({mounted: {instance: {open, setAnchor}}, remove});
        mountShareCard(ctx); mountShareCard(ctx); expect(mocks.create).not.toHaveBeenCalled();
        await Promise.all([openShareCard({original: 'first', translation: '第一'}), openShareCard({original: 'second', translation: '第二'})]);
        expect(mocks.create).toHaveBeenCalledOnce(); expect(mocks.create.mock.calls[0][1].mode).toBe('closed');
        expect(open).toHaveBeenLastCalledWith({original: 'second', translation: '第二', source: 'example.com'});
        unmountShareCard(); expect(remove).toHaveBeenCalledOnce(); expect(isShareCardMounted()).toBe(false);
    });
    it('异步挂载迟到时不能重建已停用 UI，重新启用可重新打开', async () => {
        let resolve!: (value: unknown) => void;
        mocks.create.mockReturnValueOnce(new Promise(r => {resolve = r;}));
        mountShareCard(ctx); const task = openShareCard({original: 'first', translation: '第一'});
        unmountShareCard(); mountShareCard(ctx);
        const staleOpen = vi.fn(), staleRemove = vi.fn();
        resolve({mounted: {instance: {open: staleOpen}}, remove: staleRemove}); await task;
        expect(staleRemove).toHaveBeenCalledOnce(); expect(staleOpen).not.toHaveBeenCalled();
        const open = vi.fn(); mocks.create.mockResolvedValue({mounted: {instance: {open, setAnchor: vi.fn()}}, remove: vi.fn()});
        await openShareCard({original: 'new', translation: '新'}); expect(open).toHaveBeenCalledOnce();
    });
    it('停用、空内容和创建失败不会留下可操作工作台', async () => {
        await openShareCard({original: 'first', translation: '第一'}); expect(mocks.create).not.toHaveBeenCalled();
        mountShareCard(ctx); await openShareCard({original: '', translation: '第一'}); expect(mocks.create).not.toHaveBeenCalled();
        mocks.config.on = false; await openShareCard({original: 'first', translation: '第一'}); expect(mocks.create).not.toHaveBeenCalled();
        mocks.config.on = true; mocks.create.mockRejectedValue(new Error('mount failed'));
        await openShareCard({original: 'first', translation: '第一'}); expect(mocks.notice).toHaveBeenCalledOnce();
    });
});

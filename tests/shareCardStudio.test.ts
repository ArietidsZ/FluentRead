import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {compileScript, parse} from 'vue/compiler-sfc';
import ts from 'typescript';
import {afterEach, describe, expect, it, vi} from 'vitest';
import * as preferences from '@/src/core/config/shareCard';
import * as core from '@/src/features/share-card/core';

const Vue = createRequire(import.meta.url)('vue') as typeof import('vue');
let app: import('vue').App | undefined;
afterEach(() => {app?.unmount(); vi.useRealTimers(); vi.unstubAllGlobals();});
function fixture() {
    vi.useFakeTimers();
    const click = vi.fn(), remove = vi.fn(), append = vi.fn();
    vi.stubGlobal('document', {createElement: () => ({click, remove})});
    vi.stubGlobal('URL', {createObjectURL: () => 'blob:preview', revokeObjectURL: vi.fn()});
    const copy = vi.fn().mockResolvedValue(undefined), share = vi.fn().mockResolvedValue('shared');
    const patch = vi.fn().mockResolvedValue(undefined);
    const render = vi.fn().mockResolvedValue({canvas: {setAttribute() {}}, blob: new Blob(['png'])});
    const modules: Record<string, any> = {
        vue: Vue, 'webextension-polyfill': {default: {runtime: {sendMessage: vi.fn()}}},
        '@/src/services/config/store': {config: {shareCard: preferences.normalizeShareCardPreferences()}, requestConfigPatch: patch},
        '@/src/core/config/shareCard': preferences,
        '@/src/ui/i18n': {useUiI18n: () => ({t: (key: string) => key, language: Vue.ref('zh-CN')})},
        '../core': core,
        '../render': {renderShareCard: render, ShareCardRenderError: class extends Error {}},
        '../export': {canCopyCardImage: () => true, canShareCardImage: () => true, copyCardImage: copy, shareCardImage: share, shareCardFilename: () => 'card.png'},
    };
    const filename = resolve('src/features/share-card/ui/ShareCardStudio.vue');
    const {descriptor} = parse(readFileSync(filename, 'utf8'), {filename});
    const js = ts.transpileModule(compileScript(descriptor, {id: 'card-studio'}).content, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext}}).outputText
        .replace(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/g, (_all, binding, id) => binding.startsWith('{') ? `const ${binding.replace(/\s+as\s+/g, ': ')} = modules[${JSON.stringify(id)}];` : `const ${binding} = modules[${JSON.stringify(id)}].default;`)
        .replace('export default', 'return');
    const component = new Function('modules', js)(modules); component.render = () => null;
    const renderer = Vue.createRenderer<any, any>({patchProp() {}, insert() {}, remove() {}, createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null});
    app = renderer.createApp(component); app.config.warnHandler = () => undefined;
    const state = (app.mount({}).$ as any).setupState;
    state.dialog = {open: false, showModal() {this.open = true;}, close() {this.open = false;}, append};
    state.canvasSlot = {replaceChildren() {}};
    const open = async () => {await state.open({original: 'Hello', translation: '你好', source: ''}); await vi.advanceTimersByTimeAsync(100);};
    return {state, copy, share, patch, render, click, remove, open};
}
describe('制作卡片操作反馈与生命周期', () => {
    it('保存反馈、重复保存重新通知、异常提示并释放下载节点', async () => {
        const f = fixture(); await f.open(); f.state.saveImage();
        expect(f.state.status).toBe('shareCard.saved'); expect(f.state.statusError).toBe(false);
        const sequence = f.state.feedbackSequence; f.state.saveImage(); expect(f.state.feedbackSequence).toBe(sequence + 1);
        f.click.mockImplementationOnce(() => {throw Error('blocked');}); f.state.saveImage();
        expect(f.state.status).toBe('shareCard.saveFailed'); expect(f.state.statusError).toBe(true); expect(f.remove).toHaveBeenCalledTimes(3);
    });
    it('复制忙碌防重入，切换设置不吞掉已复制图片的反馈', async () => {
        const f = fixture(); await f.open(); let resolve!: () => void;
        f.copy.mockReturnValueOnce(new Promise<void>(yes => {resolve = yes;}));
        const task = f.state.exportImage('copy'); expect(f.state.activeAction).toBe('copy'); expect(f.state.busy).toBe(true);
        await f.state.exportImage('copy'); f.state.saveImage(); expect(f.copy).toHaveBeenCalledOnce(); expect(f.click).not.toHaveBeenCalled();
        f.state.setPreference('theme', 'linen'); resolve(); await task; await vi.advanceTimersByTimeAsync(100);
        expect(f.state.status).toBe('shareCard.copied'); expect(f.state.busy).toBe(false);
        f.state.setPreference('fontSize', 'large'); expect(f.state.status).toBe('shareCard.copied');
    });
    it('复制和分享失败、分享取消、分享成功的反馈各自正确', async () => {
        const f = fixture(); await f.open(); f.copy.mockRejectedValueOnce(Error('denied'));
        await f.state.exportImage('copy'); expect(f.state.status).toBe('shareCard.copyFailed'); expect(f.state.statusError).toBe(true);
        f.share.mockRejectedValueOnce(Error('denied')); await f.state.exportImage('share'); expect(f.state.status).toBe('shareCard.shareFailed');
        f.share.mockResolvedValueOnce('cancelled'); await f.state.exportImage('share'); expect(f.state.status).toBe(''); expect(f.state.statusError).toBe(false);
        await f.state.exportImage('share'); expect(f.state.status).toBe('shareCard.shared');
    });
    it('关闭重开后旧复制结果不能提示，也不能解锁新操作', async () => {
        const f = fixture(); await f.open(); let old!: () => void, latest!: () => void;
        f.copy.mockReturnValueOnce(new Promise<void>(yes => {old = yes;})); const stale = f.state.exportImage('copy');
        f.state.close(); await f.open(); f.copy.mockReturnValueOnce(new Promise<void>(yes => {latest = yes;})); const current = f.state.exportImage('copy');
        old(); await stale; expect(f.state.status).toBe(''); expect(f.state.busy).toBe(true);
        latest(); await current; expect(f.state.status).toBe('shareCard.copied');
        f.state.close(); expect(f.state.status).toBe(''); expect(f.state.activeAction).toBe('');
    });
    it('外观保存失败提示不会从旧窗口泄漏到重新打开的窗口', async () => {
        const f = fixture(); await f.open(); f.patch.mockRejectedValueOnce(Error('offline'));
        f.state.setPreference('showSource', false); await vi.advanceTimersByTimeAsync(100);
        expect(f.state.status).toBe('shareCard.preferenceFailed');
        let reject!: (reason: Error) => void; f.patch.mockReturnValueOnce(new Promise((_yes, no) => {reject = no;}));
        f.state.setPreference('showBrand', false); await Vue.nextTick(); f.state.close(); await f.open();
        reject(Error('late')); await Vue.nextTick(); await Vue.nextTick(); expect(f.state.status).toBe('');
    });
    it('已打开时新摘录替换旧摘录，旧操作不锁住新卡片', async () => {
        const f = fixture(); await f.open(); let resolve!: () => void;
        f.copy.mockReturnValueOnce(new Promise<void>(yes => {resolve = yes;})); const old = f.state.exportImage('copy');
        await f.open(); expect(f.state.busy).toBe(false); expect(f.state.activeAction).toBe('');
        resolve(); await old; expect(f.state.status).toBe('');
        await f.state.exportImage('copy'); expect(f.state.status).toBe('shareCard.copied');
    });
});

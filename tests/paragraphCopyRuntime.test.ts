import {parseHTML} from 'linkedom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const harness = vi.hoisted(() => ({
    config: {} as Record<string, unknown>,
    notices: [] as {message: string; tone: string}[],
    resolveCandidate: vi.fn(),
}));

vi.mock('@/src/services/config/store', () => ({config: harness.config}));
vi.mock('@/src/features/page-notice/public', () => ({
    showPageNotice: (message: string, tone: string) => {
        harness.notices.push({message, tone});
        return {} as HTMLElement;
    },
}));
vi.mock('@/src/core/translation/public', () => ({
    resolveTranslationCandidateAtPoint: harness.resolveCandidate,
}));

import {mountParagraphCopyContentFeature} from '@/src/features/paragraph-copy/content';

const PAGE = `<p id="para">Hello world<span class="fluent-read-bilingual-content" data-fr-translation-owned="true">你好世界</span></p>
<input id="field" />
<my-widget id="widget"></my-widget>
<button id="button">Go</button>`;

interface Harness {
    keydown: (event?: Record<string, unknown>) => Promise<void>;
    pointerTo: (x: number, y: number) => void;
    document: Document;
    clipboard: {writeText: ReturnType<typeof vi.fn>};
    execCommand: ReturnType<typeof vi.fn>;
    focus: (element: unknown) => void;
}

let controller: AbortController;

function mount(options: {hit?: unknown; clipboardFails?: boolean; withoutClipboard?: boolean} = {}): Harness {
    const {window, document} = parseHTML(`<html><body>${PAGE}</body></html>`);
    const listeners = new Map<string, ((event: any) => void)[]>();
    const documentTarget = document as unknown as Document & Record<string, unknown>;
    documentTarget.addEventListener = ((type: string, listener: (event: any) => void) => {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    }) as Document['addEventListener'];
    let focused: unknown = document.body;
    Object.defineProperty(document, 'activeElement', {configurable: true, get: () => focused});
    const hit = 'hit' in options ? options.hit : document.getElementById('para');
    documentTarget.elementFromPoint = vi.fn(() => hit) as unknown as Document['elementFromPoint'];
    // linkedom 的 textarea 没有 select()，真实浏览器中由原生实现提供。
    const createElement = document.createElement.bind(document);
    documentTarget.createElement = ((tag: string) => {
        const element = createElement(tag) as HTMLTextAreaElement;
        if (typeof element.select !== 'function') element.select = vi.fn();
        return element;
    }) as Document['createElement'];
    const selection = {
        rangeCount: 1,
        getRangeAt: vi.fn(() => 'range'),
        removeAllRanges: vi.fn(),
        addRange: vi.fn(),
    };
    documentTarget.getSelection = vi.fn(() => selection) as unknown as Document['getSelection'];
    const execCommand = vi.fn(() => true);
    documentTarget.execCommand = execCommand;

    const clipboard = {
        writeText: vi.fn(async () => {
            if (options.clipboardFails) throw new Error('denied');
        }),
    };
    vi.stubGlobal('document', document);
    vi.stubGlobal('window', window);
    vi.stubGlobal('navigator', options.withoutClipboard ? {} : {clipboard});

    controller = new AbortController();
    mountParagraphCopyContentFeature({isSiteDisabled: () => harness.config.siteDisabled === true}, controller.signal);

    const emit = (type: string, event: Record<string, unknown>) => {
        for (const listener of listeners.get(type) ?? []) listener(event);
    };
    return {
        document,
        clipboard,
        execCommand,
        focus: (element) => {focused = element;},
        pointerTo: (x, y) => emit('pointermove', {clientX: x, clientY: y}),
        keydown: async (event = {}) => {
            emit('keydown', {
                isTrusted: true,
                repeat: false,
                key: 'c',
                code: 'KeyC',
                altKey: true,
                ctrlKey: false,
                metaKey: false,
                shiftKey: false,
                composedPath: () => [],
                preventDefault: vi.fn(),
                stopPropagation: vi.fn(),
                ...event,
            });
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        },
    };
}

beforeEach(() => {
    harness.notices.length = 0;
    harness.resolveCandidate.mockReset();
    harness.resolveCandidate.mockReturnValue(null);
    for (const key of Object.keys(harness.config)) delete harness.config[key];
    Object.assign(harness.config, {
        on: true,
        paragraphCopyEnabled: true,
        paragraphCopyHotkey: 'Alt+C',
        customParagraphCopyHotkey: '',
        paragraphCopyContent: 'auto',
        translationScope: 'content',
        translationBeforeOriginal: false,
        uiLanguage: 'zh-CN',
        siteDisabled: false,
    });
});

afterEach(() => {
    controller?.abort();
    vi.unstubAllGlobals();
});

describe('段落复制快捷键手势', () => {
    it('复制悬停段落的原文和译文，并按语言给出提示', async () => {
        const page = mount();
        page.pointerTo(120, 240);
        await page.keydown();

        expect(page.clipboard.writeText).toHaveBeenCalledWith('Hello world\n你好世界');
        expect(harness.notices).toEqual([{message: '已复制原文和译文（16 字）', tone: 'success'}]);
    });

    it('优先使用翻译候选定位段落，没有候选时回退到最近的块级祖先', async () => {
        const page = mount();
        harness.resolveCandidate.mockReturnValue({element: page.document.getElementById('para')});
        page.pointerTo(10, 20);
        await page.keydown();

        expect(harness.resolveCandidate).toHaveBeenCalledWith(10, 20, 'content');
        expect(page.document.elementFromPoint).not.toHaveBeenCalled();
        expect(page.clipboard.writeText).toHaveBeenCalledTimes(1);
    });

    it('尚未移动鼠标时提示先指向段落', async () => {
        const page = mount();
        await page.keydown();

        expect(page.clipboard.writeText).not.toHaveBeenCalled();
        expect(harness.notices).toEqual([{message: '先把鼠标移到段落上，再按复制快捷键', tone: 'error'}]);
    });

    it('鼠标位置没有文字时给出可操作的提示', async () => {
        const page = mount({hit: null});
        page.pointerTo(5, 5);
        await page.keydown();

        expect(harness.notices).toEqual([{message: '鼠标所在位置没有可复制的文字', tone: 'error'}]);
    });

    it('只复制译文时，未翻译段落回退原文并说明原因', async () => {
        harness.config.paragraphCopyContent = 'translation';
        const page = mount();
        const paragraph = page.document.getElementById('para')!;
        paragraph.querySelector('.fluent-read-bilingual-content')!.remove();
        page.pointerTo(5, 5);
        await page.keydown();

        expect(page.clipboard.writeText).toHaveBeenCalledWith('Hello world');
        expect(harness.notices).toEqual([{message: '该段落尚未翻译，已复制原文（11 字）', tone: 'success'}]);
    });

    it('未配置的按键、禁用站点、关闭开关和自动重复都不触发复制', async () => {
        const page = mount();
        page.pointerTo(5, 5);

        await page.keydown({altKey: false});
        await page.keydown({repeat: true});
        await page.keydown({isTrusted: false});
        harness.config.siteDisabled = true;
        await page.keydown();
        harness.config.siteDisabled = false;
        harness.config.on = false;
        await page.keydown();
        harness.config.on = true;
        harness.config.paragraphCopyEnabled = false;
        await page.keydown();

        expect(page.clipboard.writeText).not.toHaveBeenCalled();
        expect(harness.notices).toEqual([]);
    });

    it('正在输入时放行按键，焦点无法读取的宿主同样保守处理', async () => {
        const page = mount();
        page.pointerTo(5, 5);

        await page.keydown({composedPath: () => [page.document.getElementById('field')]});
        page.focus(page.document.getElementById('widget'));
        await page.keydown();
        page.focus(page.document.getElementById('field'));
        await page.keydown();

        expect(page.clipboard.writeText).not.toHaveBeenCalled();

        // 普通按钮、带 tabindex 的容器和 body 不算输入场景。
        page.focus(page.document.getElementById('button'));
        await page.keydown();
        expect(page.clipboard.writeText).toHaveBeenCalledTimes(1);
    });

    it('可编辑区域、ARIA 输入角色与无法识别的事件目标都按输入场景处理', async () => {
        const page = mount();
        page.pointerTo(5, 5);
        const editable = page.document.createElement('div');
        editable.setAttribute('contenteditable', 'true');
        page.document.body.appendChild(editable);
        const searchBox = page.document.createElement('div');
        searchBox.setAttribute('role', 'searchbox');
        page.document.body.appendChild(searchBox);

        const insideEditable = page.document.createElement('span');
        editable.appendChild(insideEditable);

        await page.keydown({composedPath: () => [editable]});
        await page.keydown({composedPath: () => [insideEditable]});
        await page.keydown({composedPath: () => [searchBox]});
        await page.keydown({composedPath: () => [{isContentEditable: true, getAttribute: () => null, closest: () => null, tagName: 'DIV'}]});
        expect(page.clipboard.writeText).not.toHaveBeenCalled();

        // window 之类没有 getAttribute 的事件目标不算输入控件。
        await page.keydown({composedPath: () => [{}, null]});
        expect(page.clipboard.writeText).toHaveBeenCalledTimes(1);
    });

    it('带 tabindex 的容器只是普通焦点，不吞掉复制快捷键', async () => {
        const page = mount();
        const container = page.document.createElement('div');
        container.setAttribute('tabindex', '0');
        page.document.body.appendChild(container);
        page.focus(container);
        page.pointerTo(5, 5);
        await page.keydown();

        expect(page.clipboard.writeText).toHaveBeenCalledTimes(1);
    });

    it('可读取的 ShadowRoot 内聚焦输入框时同样放行', async () => {
        const page = mount();
        const host = page.document.getElementById('widget')!;
        const input = page.document.getElementById('field');
        Object.defineProperty(host, 'shadowRoot', {configurable: true, value: {activeElement: input}});
        page.focus(host);
        page.pointerTo(5, 5);
        await page.keydown();

        expect(page.clipboard.writeText).not.toHaveBeenCalled();
    });

    it('没有 Clipboard API 时回退到 execCommand，并还原用户原有选区', async () => {
        const page = mount({withoutClipboard: true});
        page.pointerTo(5, 5);
        await page.keydown();

        expect(page.execCommand).toHaveBeenCalledWith('copy');
        expect(page.document.getSelection).toHaveBeenCalled();
        expect(harness.notices[0]?.tone).toBe('success');
        expect(page.document.querySelectorAll('textarea')).toHaveLength(0);
    });

    it('Clipboard API 被拒绝且回退失败时提示手动复制', async () => {
        const page = mount({clipboardFails: true});
        page.execCommand.mockReturnValue(false);
        page.pointerTo(5, 5);
        await page.keydown();

        expect(page.execCommand).toHaveBeenCalled();
        expect(harness.notices).toEqual([{message: '复制失败，请选中文字后手动复制', tone: 'error'}]);
    });

    it('execCommand 抛错或不存在时也只提示失败', async () => {
        const thrown = mount({withoutClipboard: true});
        thrown.execCommand.mockImplementation(() => {throw new Error('blocked');});
        thrown.pointerTo(5, 5);
        await thrown.keydown();
        expect(harness.notices).toEqual([{message: '复制失败，请选中文字后手动复制', tone: 'error'}]);

        controller.abort();
        harness.notices.length = 0;
        const missing = mount({withoutClipboard: true});
        (missing.document as unknown as Record<string, unknown>).execCommand = undefined;
        missing.pointerTo(5, 5);
        await missing.keydown();
        expect(harness.notices).toEqual([{message: '复制失败，请选中文字后手动复制', tone: 'error'}]);
    });

    it('没有选区时回退复制也不会尝试还原选区', async () => {
        const page = mount({withoutClipboard: true});
        (page.document.getSelection as ReturnType<typeof vi.fn>).mockReturnValue(null);
        page.pointerTo(5, 5);
        await page.keydown();

        expect(page.execCommand).toHaveBeenCalledWith('copy');
        expect(harness.notices[0]?.tone).toBe('success');
    });
});

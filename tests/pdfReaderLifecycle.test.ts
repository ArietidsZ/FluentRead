import {parseHTML} from 'linkedom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createRenderer, h, markRaw, nextTick, ref} from 'vue';
import PdfReader from '@/src/features/document-translation/ui/PdfReader.vue';
import type {ParsedDocument, PdfDocumentPage} from '@/src/features/document-translation/core/document';
import {createPdfReaderRenderPort, PDF_READER_MAX_CANVAS_EDGE, PDF_READER_MAX_PAGE_PIXELS, PDF_READER_MAX_RESIDENT_PAGES, pdfReaderCanvasSize, pdfReaderPageHasTranslation, pdfReaderPageKey, pdfReaderPageWindow, PdfReaderScheduler, type PdfReaderPageState, type PdfReaderRenderedPage, type PdfReaderSettings} from '@/src/features/document-translation/ui/pdfReader';
import {acquirePdfDocument, releasePdfDocument} from '@/src/features/document-translation/ui/pdfPreview';

const ports = vi.hoisted(() => ({getDocument: vi.fn(), textLayers: [] as any[], textPending: undefined as any}));
vi.mock('@/src/ui/i18n', () => ({useUiI18n: () => ({t: (key: string, params?: {page?: number}) => params?.page ? `${key}:${params.page}` : key})}));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({GlobalWorkerOptions: {}, getDocument: ports.getDocument, TextLayer: class {
    container: HTMLElement;
    viewport: any;
    textContentSource: any;
    textContentItemsStr = ['Original PDF words'];
    cancel = vi.fn();
    constructor(options: any) {this.container = options.container; this.viewport = options.viewport; this.textContentSource = options.textContentSource; ports.textLayers.push(this);}
    render() {const span = this.container.ownerDocument.createElement('span'); span.textContent = 'Original PDF words'; this.container.append(span); return ports.textPending?.promise ?? Promise.resolve();}
}}));

const deferred = <T,>() => {let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
const pageModel = (pageNumber: number, width = 612, height = 792): PdfDocumentPage => ({pageNumber, width, height, segmentIndexes: [pageNumber - 1], blocks: [{segmentIndex: pageNumber - 1, x: 50, y: 70, width: 200, height: 40, fontSize: 12, lineHeight: 14, lineCount: 2, fontFamily: 'sans', fontWeight: 400, textAlign: 'left'}]});
const documentModel = (pages = 1): ParsedDocument => ({fileName: 'fixture.pdf', format: 'pdf', label: 'PDF', parts: [], segments: Array.from({length: pages}, (_, index) => ({id: index, source: `Source ${index + 1}`})), binary: {kind: 'pdf', bytes: new TextEncoder().encode(`%PDF-reader-${Math.random()}`), pages: Array.from({length: pages}, (_, index) => pageModel(index + 1))}});
const output = (): PdfReaderRenderedPage => ({dispose: vi.fn()});
const settings = (key = 'source', scale = 1, mode: PdfReaderSettings['mode'] = 'source', translations: readonly string[] = []): PdfReaderSettings => ({key, scale, mode, translations});
const settle = async () => {for (let index = 0; index < 8; index += 1) await Promise.resolve();};
let win: EventTarget & {location: {origin: string}; devicePixelRatio: number};
let pdfPage: any;
let destroy: ReturnType<typeof vi.fn>;
let canvases: any[];
let models: ParsedDocument[];
let selection: any;
let frames: Map<number, FrameRequestCallback>;
let resizeCallback: ResizeObserverCallback | undefined;
let disconnect: ReturnType<typeof vi.fn>;
let mountedApp: any;

beforeEach(() => {
    ports.getDocument.mockReset(); ports.textLayers = []; ports.textPending = undefined;
    models = []; canvases = []; selection = undefined; frames = new Map(); resizeCallback = undefined; mountedApp = undefined;
    const {document} = parseHTML('<html><body></body></html>');
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const element = markRaw(createElement(tag));
        if (tag !== 'canvas') return element;
        const context: any = {drawImage: vi.fn(), fillRect: vi.fn(), measureText: vi.fn((value: string) => ({width: value.length * 8})), fillText: vi.fn(), save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => ({data: new Uint8ClampedArray(width * height * 4).fill(255)}))};
        context.canvas = element;
        Object.assign(element, {width: 0, height: 0, getContext: () => context, toBlob: vi.fn()});
        canvases.push(element); return element;
    });
    let nextFrame = 1;
    win = Object.assign(new EventTarget(), {location: {origin: 'chrome-extension://fixture'}, devicePixelRatio: 3, getSelection: () => selection, requestAnimationFrame: (callback: FrameRequestCallback) => {const id = nextFrame++; frames.set(id, callback); return id;}, cancelAnimationFrame: (id: number) => {frames.delete(id);}});
    disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {constructor(callback: ResizeObserverCallback) {resizeCallback = callback;} observe = vi.fn(); disconnect = disconnect;});
    vi.stubGlobal('document', document); vi.stubGlobal('window', win);
    pdfPage = {getViewport: vi.fn(({scale}: {scale: number}) => ({width: 612 * scale, height: 792 * scale, scale, transform: [scale, 0, 0, -scale, 0, 792 * scale]})), cleanup: vi.fn(), streamTextContent: vi.fn(() => ({fixture: 'text stream'})), render: vi.fn(() => ({promise: Promise.resolve(), cancel: vi.fn()}))};
    destroy = vi.fn(async () => {});
    ports.getDocument.mockImplementation(() => ({promise: Promise.resolve({getPage: vi.fn(async () => pdfPage)}), destroy}));
});
afterEach(async () => {mountedApp?.unmount(); ports.textPending?.resolve(); win.dispatchEvent(new Event('pagehide')); models.forEach(model => {if (model.binary?.kind === 'pdf') releasePdfDocument(model.binary.bytes);}); await vi.dynamicImportSettled(); vi.restoreAllMocks(); vi.unstubAllGlobals();});
const model = (count = 1) => {const value = documentModel(count); models.push(value); return value;};

describe('PDF reader visible page scheduling and memory bounds', () => {
    it('prioritizes visible pages and caps nearby work in first, middle, and last positions', () => {
        expect(pdfReaderPageWindow(120, 50, [49, 50, 51])).toEqual([50, 49, 51, 52, 48]);
        expect(pdfReaderPageWindow(120, 0)).toEqual([0, 1, 2, 3, 4]);
        expect(pdfReaderPageWindow(120, 119)).toEqual([119, 118, 117, 116, 115]);
        expect(pdfReaderPageWindow(0, 0)).toEqual([]);
        expect(pdfReaderPageWindow(2, 100, [-1, 100, 0, 0])).toEqual([0, 1]);
        expect(pdfReaderPageWindow(120, 50, [40, 41, 42, 43, 44, 45, 46])).toHaveLength(PDF_READER_MAX_RESIDENT_PAGES);
    });

    it('bounds pixels and edges for high DPI, bilingual, poster, and extremely long pages', () => {
        for (const [width, height, ratio, count] of [[612, 792, 3, 1], [918, 1188, 4, 2], [50000, 50000, 2, 2], [20, 2000000, 2, 1], [NaN, Infinity, NaN, 1]]) {
            const size = pdfReaderCanvasSize(width, height, ratio, count);
            expect(size.width).toBeGreaterThan(0); expect(size.height).toBeGreaterThan(0);
            expect(size.width).toBeLessThanOrEqual(PDF_READER_MAX_CANVAS_EDGE);
            expect(size.height).toBeLessThanOrEqual(PDF_READER_MAX_CANVAS_EDGE);
            expect(size.width * size.height * count).toBeLessThanOrEqual(PDF_READER_MAX_PAGE_PIXELS);
        }
    });

    it('invalidates only the page containing a changed translation and ignores source-mode edits', () => {
        const first = pageModel(1); const second = pageModel(2); const doc = model(2);
        expect(pdfReaderPageKey(second, 1, 'bilingual', ['old', 'second'])).toBe(pdfReaderPageKey(second, 1, 'bilingual', ['new', 'second']));
        expect(pdfReaderPageKey(first, 1, 'bilingual', ['old'])).not.toBe(pdfReaderPageKey(first, 1, 'bilingual', ['new']));
        expect(pdfReaderPageKey(first, 1, 'source', ['old'])).toBe(pdfReaderPageKey(first, 1, 'source', ['new']));
        expect(pdfReaderPageHasTranslation(doc, first, ['Source 1'])).toBe(false);
        expect(pdfReaderPageHasTranslation(doc, first, [''])).toBe(false);
        expect(pdfReaderPageHasTranslation(doc, first, ['译文'])).toBe(true);
        expect(pdfReaderPageHasTranslation({...doc, segments: []}, first, ['译文'])).toBe(true);
        expect(pdfReaderPageKey(first, 1, 'bilingual', [])).toBe(JSON.stringify([1, 'bilingual', ['']]));
    });

    it('preempts obsolete work on a far jump, releases stale late output, and keeps two renders concurrent', async () => {
        const jobs: Array<{page: number; pending: ReturnType<typeof deferred<PdfReaderRenderedPage>>; signal: AbortSignal}> = [];
        const port = {dispose: vi.fn(), render: vi.fn((page: PdfDocumentPage, _options: unknown, signal: AbortSignal) => {const pending = deferred<PdfReaderRenderedPage>(); jobs.push({page: page.pageNumber, pending, signal}); return pending.promise;})};
        const changes = new Map<number, PdfReaderPageState>();
        const scheduler = new PdfReaderScheduler(Array.from({length: 120}, (_, index) => pageModel(index + 1)), port, (page, state) => {if (state) changes.set(page, state); else changes.delete(page);});
        scheduler.update([0, 1, 2, 3, 4, 5], () => settings());
        expect(jobs.map(job => job.page)).toEqual([1, 2]);
        scheduler.update([90, 91, 89, 92, 88], () => settings());
        expect(jobs.every(job => job.signal.aborted)).toBe(true);
        const late = output(); jobs[0].pending.resolve(late); jobs[1].pending.reject(new Error('cancelled')); await settle();
        expect(late.dispose).toHaveBeenCalledOnce();
        expect(jobs.slice(2).map(job => job.page)).toEqual([91, 92]);
        expect(changes.size).toBe(2);
        const first = output(); const second = output(); jobs[2].pending.resolve(first); jobs[3].pending.resolve(second); await settle();
        expect(jobs.slice(4).map(job => job.page)).toEqual([90, 93]);
        scheduler.dispose(); scheduler.dispose();
        expect(first.dispose).toHaveBeenCalledOnce(); expect(second.dispose).toHaveBeenCalledOnce();
        expect(port.dispose).toHaveBeenCalledOnce();
        const last = output(); jobs[4].pending.resolve(last); jobs[5].pending.resolve(output()); await settle();
        expect(last.dispose).toHaveBeenCalledOnce(); expect(changes.size).toBe(0); expect(jobs).toHaveLength(6);
    });

    it('evicts old zoom output, retries individual failures, and prevents unrelated ready pages rerendering', async () => {
        const outputs: PdfReaderRenderedPage[] = [];
        const render = vi.fn(async (page: PdfDocumentPage) => {if (page.pageNumber === 1 && render.mock.calls.length === 1) throw new Error('recoverable'); const value = output(); outputs.push(value); return value;});
        const states = new Map<number, PdfReaderPageState>();
        const scheduler = new PdfReaderScheduler([pageModel(1), pageModel(2)], {render, dispose: vi.fn()}, (page, state) => {if (state) states.set(page, state); else states.delete(page);});
        scheduler.update([0, 1], index => settings(`page-${index}`)); await settle();
        expect(states.get(1)).toEqual({status: 'error', message: 'recoverable'});
        scheduler.update([0, 1], index => settings(`page-${index}`)); await settle(); expect(render).toHaveBeenCalledTimes(2);
        scheduler.retry(0); await settle(); expect(render).toHaveBeenCalledTimes(3); expect(states.get(1)?.status).toBe('ready');
        scheduler.update([0, 1], index => settings(index === 0 ? 'changed' : 'page-1')); await settle();
        expect(render).toHaveBeenCalledTimes(4); expect(outputs[1].dispose).toHaveBeenCalledOnce(); expect(outputs[0].dispose).not.toHaveBeenCalled();
        scheduler.update([0, 1], index => settings(`zoom-${index}`, 1.5)); await settle(); expect(render).toHaveBeenCalledTimes(6);
        scheduler.dispose(); scheduler.update([0], () => settings()); scheduler.retry(0); expect(render).toHaveBeenCalledTimes(6);
    });
});

describe('PDF reader actual PDF.js resource adapter', () => {
    it.each([90, 180, 270])('preserves the %i degree page viewport in the source Canvas and official TextLayer', async rotation => {
        pdfPage.getViewport.mockImplementation(({scale}: {scale: number}) => ({width: (rotation === 180 ? 612 : 792) * scale, height: (rotation === 180 ? 792 : 612) * scale, scale, rotation}));
        const reader = createPdfReaderRenderPort(model());
        const result = await reader.render(pageModel(1), settings('rotated', 1.25), new AbortController().signal);
        expect(pdfPage.render.mock.calls[0][0].viewport.rotation).toBe(rotation);
        expect(ports.textLayers[0].viewport).toBe(pdfPage.render.mock.calls[0][0].viewport);
        expect(result.sourceCanvas?.style.width).toBe(`${ports.textLayers[0].viewport.width}px`);
        expect(result.sourceCanvas?.style.height).toBe(`${ports.textLayers[0].viewport.height}px`);
        result.dispose(); reader.dispose();
    });

    it('renders a direct source Canvas with the official streamed TextLayer and never encodes PNG', async () => {
        const doc = model(); const reader = createPdfReaderRenderPort(doc);
        const result = await reader.render(pageModel(1), settings(), new AbortController().signal);
        expect(result.sourceText?.textContent).toBe('Original PDF words');
        expect(result.sourceText?.getAttribute('data-fluentread-pdf-text')).toBe('');
        expect(result.sourceText?.style.getPropertyValue('--scale-factor')).toBe('1');
        expect(ports.textLayers[0].textContentSource).toEqual({fixture: 'text stream'});
        expect(ports.textLayers[0].viewport.scale).toBe(1);
        expect(pdfPage.render.mock.calls[0][0].transform).toEqual([2, 0, 0, 2, 0, 0]);
        expect(canvases[0].toBlob).not.toHaveBeenCalled();
        expect(pdfPage.cleanup).toHaveBeenCalledOnce();
        result.dispose(); result.dispose(); reader.dispose(); reader.dispose();
        expect(canvases[0]).toMatchObject({width: 0, height: 0}); expect(ports.textLayers[0].cancel).toHaveBeenCalledOnce(); expect(destroy).toHaveBeenCalledOnce();
        await expect(reader.render(pageModel(1), settings(), new AbortController().signal)).rejects.toMatchObject({name: 'AbortError'});
    });

    it('shares a file lease across page cancellation and preserves a second active reader', async () => {
        const doc = model(); const other = acquirePdfDocument(doc.binary!.bytes);
        const reader = createPdfReaderRenderPort(doc); const pending = deferred<void>();
        pdfPage.render.mockImplementationOnce(() => ({promise: pending.promise, cancel: vi.fn()}));
        const controller = new AbortController(); const work = reader.render(pageModel(1), settings(), controller.signal); void work.catch(() => undefined);
        await vi.waitFor(() => expect(canvases).toHaveLength(1)); controller.abort(new Error('page changed'));
        await expect(work).rejects.toThrow('page changed');
        expect(canvases[0]).toMatchObject({width: 0, height: 0}); expect(destroy).not.toHaveBeenCalled();
        expect(ports.textLayers[0].cancel).toHaveBeenCalledOnce(); pending.resolve();
        const result = await reader.render(pageModel(1), settings(), new AbortController().signal); result.dispose();
        expect(ports.getDocument).toHaveBeenCalledOnce(); reader.dispose(); expect(destroy).not.toHaveBeenCalled(); other.release(); expect(destroy).toHaveBeenCalledOnce();
    });

    it('releases pending page/text work on close and cleans late pages without allocating stale pixels', async () => {
        const doc = model(); const pagePending = deferred<any>();
        const getPage = vi.fn(() => pagePending.promise);
        ports.getDocument.mockReturnValueOnce({promise: Promise.resolve({getPage}), destroy});
        const reader = createPdfReaderRenderPort(doc); const work = reader.render(pageModel(1), settings(), new AbortController().signal); void work.catch(() => undefined);
        await vi.waitFor(() => expect(getPage).toHaveBeenCalledOnce()); reader.dispose(); await expect(work).rejects.toMatchObject({name: 'AbortError'});
        const cleanup = vi.fn(); pagePending.resolve({cleanup}); await settle(); expect(cleanup).toHaveBeenCalledOnce(); expect(canvases).toHaveLength(0);
        const next = createPdfReaderRenderPort(doc); ports.textPending = deferred<void>();
        const textWork = next.render(pageModel(1), settings(), new AbortController().signal); void textWork.catch(() => undefined);
        await vi.waitFor(() => expect(ports.textLayers).toHaveLength(1)); next.dispose(); await expect(textWork).rejects.toMatchObject({name: 'AbortError'});
        expect(ports.textLayers[0].cancel).toHaveBeenCalledOnce(); expect(canvases[0]).toMatchObject({width: 0, height: 0}); ports.textPending.resolve();
    });

    it('retries failed document loads and canvas initialization, with bounded bilingual and translated canvases', async () => {
        const doc = model(); const reader = createPdfReaderRenderPort(doc);
        ports.getDocument.mockReturnValueOnce({promise: Promise.reject(new Error('loading failed')), destroy});
        await expect(reader.render(pageModel(1), settings(), new AbortController().signal)).rejects.toThrow('loading failed');
        const bilingual = await reader.render(pageModel(1), settings('bilingual', 1.5, 'bilingual', ['译文']), new AbortController().signal);
        expect(bilingual.sourceCanvas).toBeTruthy(); expect(bilingual.translatedCanvas).toBeTruthy(); expect(bilingual.sourceText).toBeTruthy();
        expect((bilingual.sourceCanvas!.width * bilingual.sourceCanvas!.height) + (bilingual.translatedCanvas!.width * bilingual.translatedCanvas!.height)).toBeLessThanOrEqual(PDF_READER_MAX_PAGE_PIXELS);
        expect(bilingual.translatedCanvas!.getContext('2d')!.drawImage).toHaveBeenCalledWith(bilingual.sourceCanvas, 0, 0);
        bilingual.dispose();
        const translated = await reader.render(pageModel(1), settings('translated', 1.5, 'translated', ['译文']), new AbortController().signal);
        expect(translated.sourceCanvas).toBeUndefined(); expect(translated.sourceText).toBeUndefined(); expect(translated.translatedCanvas).toBeTruthy();
        const fallback = await reader.render(pageModel(1), settings('fallback', 1, 'translated', ['Source 1']), new AbortController().signal);
        expect(fallback.sourceCanvas).toBeTruthy(); expect(fallback.sourceText).toBeTruthy(); expect(fallback.translatedCanvas).toBeUndefined();
        translated.dispose(); fallback.dispose(); reader.dispose(); expect(canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true);
        expect(() => createPdfReaderRenderPort({...doc, binary: undefined})).toThrow('PDF 文档状态无效');
    });

    it('rejects preaborted and synchronous page cancellation, then reacquires an externally released file on retry', async () => {
        const doc = model(); const reader = createPdfReaderRenderPort(doc);
        const alreadyAborted = new AbortController(); alreadyAborted.abort('before render');
        await expect(reader.render(pageModel(1), settings(), alreadyAborted.signal)).rejects.toBe('before render');
        expect(ports.getDocument).not.toHaveBeenCalled();
        const controller = new AbortController();
        ports.getDocument.mockReturnValueOnce({promise: Promise.resolve({getPage: () => {controller.abort('synchronous page cancellation'); return Promise.resolve(pdfPage);}}), destroy});
        await expect(reader.render(pageModel(1), settings(), controller.signal)).rejects.toBe('synchronous page cancellation');
        await settle(); expect(pdfPage.cleanup).toHaveBeenCalledOnce();
        releasePdfDocument(doc.binary!.bytes);
        const result = await reader.render(pageModel(1), settings(), new AbortController().signal);
        expect(ports.getDocument).toHaveBeenCalledTimes(2); result.dispose(); reader.dispose();
        const neverUsed = createPdfReaderRenderPort(doc); neverUsed.dispose();
    });

    it('releases source and translated Canvas allocation failures and avoids painting unchanged blocks', async () => {
        const create = vi.mocked(document.createElement).getMockImplementation()!;
        let failAt = 1;
        vi.mocked(document.createElement).mockImplementation((tag: string) => {const element = create(tag); if (tag === 'canvas' && canvases.length === failAt) Object.assign(element, {getContext: () => null}); return element;});
        const doc = model(); const reader = createPdfReaderRenderPort(doc);
        await expect(reader.render(pageModel(1), settings(), new AbortController().signal)).rejects.toThrow('Canvas 初始化失败');
        expect(canvases[0]).toMatchObject({width: 0, height: 0});
        failAt = 3;
        await expect(reader.render(pageModel(1), settings('bilingual', 1, 'bilingual', ['译文']), new AbortController().signal)).rejects.toThrow('Canvas 初始化失败');
        expect(canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true);
        failAt = -1;
        const page = {...pageModel(1), segmentIndexes: [0, 1, 2], blocks: []};
        const multi = await reader.render(page, settings('multiple', 1, 'bilingual', ['译文', '', 'third']), new AbortController().signal);
        multi.dispose(); reader.dispose();
        const messages: PdfReaderPageState[] = [];
        const scheduler = new PdfReaderScheduler([pageModel(1)], {render: async () => {throw 'string failure';}, dispose: vi.fn()}, (_page, state) => {if (state) messages.push(state);});
        scheduler.update([0, 9], () => settings()); await settle(); expect(messages.at(-1)).toEqual({status: 'error', message: 'string failure'}); scheduler.dispose();
    });

    it('releases a completed page if cleanup fails, so a rejected result cannot retain pixels or text', async () => {
        const reader = createPdfReaderRenderPort(model());
        pdfPage.cleanup.mockImplementationOnce(() => {throw new Error('cleanup failed');});
        await expect(reader.render(pageModel(1), settings(), new AbortController().signal)).rejects.toThrow('cleanup failed');
        expect(canvases[0]).toMatchObject({width: 0, height: 0}); expect(ports.textLayers[0].container.textContent).toBe('');
        reader.dispose();
    });
});

function mountReader(value: ParsedDocument, mode = 'source' as PdfReaderSettings['mode'], translations: readonly string[] = []) {
    const currentDocument = ref(value); const currentMode = ref(mode); const currentTranslations = ref(translations);
    const renderer = createRenderer<any, any>({
        createElement: tag => document.createElement(tag), createText: value => document.createTextNode(value), createComment: value => document.createComment(value),
        setText: (node, value) => {node.nodeValue = value;}, setElementText: (node, value) => {node.textContent = value;},
        parentNode: node => node.parentNode, nextSibling: node => node.nextSibling,
        insert: (node, parent, anchor) => parent.insertBefore(node, anchor || null), remove: node => node.remove(),
        patchProp: (element, key, previous, value) => {
            if (key.startsWith('on')) {if (key.includes(':')) return; const name = key.slice(2).replace(/(?:Once|Passive|Capture)+$/, '').toLowerCase(); if (previous) element.removeEventListener(name, previous); if (value) element.addEventListener(name, value);}
            else if (key === 'style') {for (const [name, entry] of Object.entries(value || {})) element.style.setProperty(name, String(entry));}
            else if (key === 'value') element.value = value;
            else if (value == null || value === false) element.removeAttribute(key);
            else element.setAttribute(key, String(value));
        },
    });
    const root = document.createElement('div'); document.body.append(root);
    mountedApp = renderer.createApp({setup: () => () => h(PdfReader, {document: currentDocument.value, translations: currentTranslations.value, mode: currentMode.value, sourceUrl: 'https://arxiv.org/pdf/1706.03762'})});
    mountedApp.mount(root);
    const state = mountedApp._instance.subTree.component.setupState;
    const viewport = root.querySelector('[data-pdf-scroll]') as HTMLElement;
    Object.defineProperties(viewport, {clientWidth: {value: 920, writable: true}, clientHeight: {value: 600, writable: true}});
    return {root, viewport, state, currentDocument, currentMode, currentTranslations};
}
async function componentFlush(): Promise<void> {for (let index = 0; index < 12; index += 1) {await nextTick(); await Promise.resolve();}}
function flushFrames(): void {const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0));}

describe('PDF reader actual Vue component reading interaction', () => {
    it('preserves a page-number draft across queued scrolling, then resumes the visible counter after commit', async () => {
        const {root, viewport, state} = mountReader(model(120)); await componentFlush();
        const input = root.querySelector('.pdf-page-navigation input') as HTMLInputElement;
        const event = (name: string, key?: string) => {const value = new document.defaultView!.Event(name); if (key) Object.assign(value, {key}); input.dispatchEvent(value);};
        state.jumpTo(60); state.jumpTo(120); await componentFlush();
        event('focus'); input.value = '1'; event('input');
        viewport.dispatchEvent(new document.defaultView!.Event('scroll')); flushFrames(); await componentFlush();
        expect(state.currentPage).toBe(120); expect(input.value).toBe('1');
        event('keydown', 'Enter'); await componentFlush();
        expect(state.currentPage).toBe(1); expect(input.value).toBe('1'); expect(viewport.scrollTop).toBe(16);
        viewport.scrollTop = state.layouts[59].top; viewport.dispatchEvent(new document.defaultView!.Event('scroll')); flushFrames(); await componentFlush();
        expect(state.currentPage).toBe(60); expect(input.value).toBe('60');
        for (const [draft, commit, expected] of [['0', 'change', 1], ['999', 'blur', 120], ['not-a-page', 'keydown', 120]] as const) {
            input.value = draft; event('input'); event(commit, commit === 'keydown' ? 'Enter' : undefined); await componentFlush();
            expect(state.currentPage).toBe(expected); expect(input.value).toBe(String(expected));
        }
    });

    it('recovers a failed page through its retry button and handles native page and zoom controls without losing a drag origin', async () => {
        const getPage = vi.fn(async () => pdfPage).mockRejectedValueOnce(new Error('temporary page failure'));
        ports.getDocument.mockReturnValueOnce({promise: Promise.resolve({getPage}), destroy});
        const {root, state} = mountReader(model(10));
        await vi.waitFor(() => expect(root.querySelector('.pdf-page-error')).toBeTruthy());
        expect(root.querySelector('.pdf-page-error')!.textContent).toContain('temporary page failure');
        root.querySelector('.pdf-page-error button')!.dispatchEvent(new document.defaultView!.Event('click'));
        await vi.waitFor(() => expect(root.querySelector('[data-pdf-page-number="1"] span')).toBeTruthy());
        const buttons = root.querySelectorAll('.pdf-page-navigation button');
        buttons[1].dispatchEvent(new document.defaultView!.Event('click')); await componentFlush(); expect(state.currentPage).toBe(2);
        buttons[0].dispatchEvent(new document.defaultView!.Event('click')); await componentFlush(); expect(state.currentPage).toBe(1);
        const input = root.querySelector('.pdf-page-navigation input') as HTMLInputElement;
        input.value = '3'; input.dispatchEvent(new document.defaultView!.Event('input')); input.dispatchEvent(new document.defaultView!.Event('change'));
        await componentFlush(); expect(state.currentPage).toBe(3);
        const select = root.querySelector('.pdf-zoom-control select') as HTMLSelectElement;
        Array.from(select.options).find(option => option.value === '1.25')!.selected = true; select.dispatchEvent(new document.defaultView!.Event('change'));
        await componentFlush(); expect(state.zoom).toBe('1.25'); expect(state.currentPage).toBe(3);
        state.jumpTo(1); await componentFlush(); await vi.waitFor(() => expect(root.querySelector('[data-pdf-page-number="1"] span')).toBeTruthy());
        const span = root.querySelector('[data-pdf-page-number="1"] span')!;
        span.dispatchEvent(new document.defaultView!.Event('pointerdown', {bubbles: true}));
        state.jumpTo(8); await componentFlush(); expect(root.querySelector('[data-pdf-page-number="1"]')).toBeTruthy();
        document.body.dispatchEvent(new document.defaultView!.Event('pointerup', {bubbles: true})); flushFrames(); await componentFlush(); expect(root.querySelector('[data-pdf-page-number="1"]')).toBeNull();
        document.body.dispatchEvent(new document.defaultView!.Event('pointerdown', {bubbles: true}));
        root.querySelector('.pdf-page-row-heading')!.dispatchEvent(new document.defaultView!.Event('pointerdown', {bubbles: true}));
        const heading = root.querySelector('.pdf-page-row-heading')!;
        selection = {rangeCount: 1, isCollapsed: false, getRangeAt: () => ({startContainer: heading, endContainer: heading})};
        document.dispatchEvent(new document.defaultView!.Event('selectionchange')); flushFrames();
        selection = {rangeCount: 1, isCollapsed: true}; document.dispatchEvent(new document.defaultView!.Event('selectionchange')); flushFrames();
    });

    it('keeps page 60 and its position through fit, 100%, 150%, resize, and translated mode while mounting at most five page shells', async () => {
        const {root, viewport, state, currentMode, currentTranslations} = mountReader(model(120));
        await vi.waitFor(() => expect([...state.states.values()]).toEqual(Array.from({length: 5}, () => expect.objectContaining({status: 'ready'}))));
        expect(root.getAttribute('data-document-reader')).toBeNull();
        expect(root.querySelector('[data-fluentread-pdf-title]')!.getAttribute('data-fluentread-pdf-source-url')).toBe('https://arxiv.org/pdf/1706.03762');
        state.jumpTo(60); await componentFlush();
        expect(state.currentPage).toBe(60); expect(root.querySelector('.pdf-page-row[data-page-number="60"]')).toBeTruthy();
        const before = viewport.scrollTop;
        state.zoom = '1'; await componentFlush(); expect(state.currentPage).toBe(60); expect(viewport.scrollTop).toBeLessThan(before);
        state.zoom = '1.5'; await componentFlush(); expect(state.currentPage).toBe(60);
        state.zoom = 'fit'; await componentFlush();
        Object.assign(viewport, {clientWidth: 500}); resizeCallback!([], {} as ResizeObserver); await componentFlush(); expect(state.currentPage).toBe(60);
        currentTranslations.value = Array.from({length: 120}, () => '译文'); currentMode.value = 'bilingual'; await componentFlush(); expect(state.currentPage).toBe(60);
        expect(root.querySelectorAll('.pdf-page-row').length).toBeLessThanOrEqual(5);
        await vi.waitFor(() => {
            const originalReady = canvases.filter(canvas => canvas.width > 0);
            expect(originalReady.reduce((sum, canvas) => sum + canvas.width * canvas.height, 0), JSON.stringify(originalReady.map(canvas => ({width: canvas.width, height: canvas.height, page: canvas.closest('.pdf-page-row')?.getAttribute('data-page-number')})))).toBeLessThanOrEqual(PDF_READER_MAX_PAGE_PIXELS * 5);
        });
        currentMode.value = 'translated'; await componentFlush(); expect(state.currentPage).toBe(60); expect(root.querySelectorAll('.pdf-page-column:not(.translated)')).toHaveLength(0);
        state.pageInput = 1000; state.commitPageInput(); await componentFlush(); expect(state.currentPage).toBe(120);
        state.jumpTo(NaN); expect(state.currentPage).toBe(120);
        state.jumpTo(-50); await componentFlush(); expect(state.currentPage).toBe(1);
    });

    it('pins native and card selections across scrolling but prioritizes a far jump even when five pages are selected', async () => {
        const {root, state} = mountReader(model(120));
        await vi.waitFor(() => expect(root.querySelector('[data-pdf-page-number="5"] span')).toBeTruthy());
        const first = root.querySelector('[data-pdf-page-number="1"] span')!.firstChild!;
        const second = root.querySelector('[data-pdf-page-number="2"] span')!.firstChild!;
        const fifth = root.querySelector('[data-pdf-page-number="5"] span')!.firstChild!;
        const range = {startContainer: first, endContainer: second};
        selection = {rangeCount: 1, isCollapsed: false, getRangeAt: () => range};
        document.dispatchEvent(new document.defaultView!.Event('selectionchange')); flushFrames();
        state.jumpTo(60); await componentFlush(); expect(root.querySelector('[data-pdf-page-number="1"]')).toBeTruthy(); expect(root.querySelector('[data-pdf-page-number="2"]')).toBeTruthy();
        document.body.dispatchEvent(new document.defaultView!.CustomEvent('fluentread-pdf-selection-range-change', {detail: {range}})); flushFrames();
        selection = undefined; document.dispatchEvent(new document.defaultView!.Event('selectionchange')); flushFrames();
        state.jumpTo(80); await componentFlush(); expect(root.querySelector('[data-pdf-page-number="1"]')).toBeTruthy();
        document.body.dispatchEvent(new document.defaultView!.CustomEvent('fluentread-pdf-selection-range-change', {detail: {range: {startContainer: first, endContainer: fifth}}})); flushFrames();
        state.jumpTo(120); await componentFlush(); expect(root.querySelector('.pdf-page-row[data-page-number="120"]')).toBeTruthy(); expect(state.residentIndexes.length).toBe(5);
        document.body.dispatchEvent(new document.defaultView!.CustomEvent('fluentread-pdf-selection-range-change', {detail: {range: null}})); flushFrames();
        await componentFlush(); expect(root.querySelector('[data-pdf-page-number="1"]')).toBeNull();
    });

    it('renders every visible short page before old selection pins when several pages fit in the viewport', async () => {
        const doc = model(120);
        if (doc.binary?.kind === 'pdf') doc.binary.pages = doc.binary.pages.map(page => ({...page, width: 100, height: 100}));
        pdfPage.getViewport.mockImplementation(({scale}: {scale: number}) => ({width: 100 * scale, height: 100 * scale, scale}));
        const {root, state} = mountReader(doc);
        await vi.waitFor(() => expect(root.querySelector('[data-pdf-page-number="4"] span')).toBeTruthy());
        const range = {startContainer: root.querySelector('[data-pdf-page-number="1"] span')!.firstChild!, endContainer: root.querySelector('[data-pdf-page-number="4"] span')!.firstChild!};
        document.body.dispatchEvent(new document.defaultView!.CustomEvent('fluentread-pdf-selection-range-change', {detail: {range}})); flushFrames();
        state.jumpTo(50); await componentFlush();
        expect(state.residentIndexes.slice(0, 3)).toEqual([49, 50, 51]);
        for (const page of [50, 51, 52]) await vi.waitFor(() => expect(root.querySelector(`.pdf-page-row[data-page-number="${page}"][data-render-state="ready"]`)).toBeTruthy());
        expect(root.querySelectorAll('.pdf-page-row')).toHaveLength(5);
    });

    it('handles keyboard page navigation, live document replacement, retry, and releases listeners, frame, observer and canvases on unmount', async () => {
        const {root, viewport, state, currentDocument} = mountReader(model(10)); await componentFlush();
        const key = (value: string, target: EventTarget = viewport, ctrlKey = false) => {const event = {key: value, target, altKey: false, ctrlKey, metaKey: false, preventDefault: vi.fn()}; state.handleViewportKey(event); return event;};
        key('PageDown'); await componentFlush(); expect(state.currentPage).toBe(2); key('PageUp'); await componentFlush(); expect(state.currentPage).toBe(1); key('End'); await componentFlush(); expect(state.currentPage).toBe(10); key('Home'); await componentFlush(); expect(state.currentPage).toBe(1);
        expect(key('Home', root).preventDefault).not.toHaveBeenCalled(); expect(key('Home', viewport, true).preventDefault).not.toHaveBeenCalled(); expect(key('ArrowDown').preventDefault).not.toHaveBeenCalled();
        const priorIdentity = root.querySelector('[data-fluentread-pdf-document-id]')!.getAttribute('data-fluentread-pdf-document-id');
        currentDocument.value = model(2); await componentFlush(); expect(state.currentPage).toBe(1); expect(root.querySelector('[data-fluentread-pdf-document-id]')!.getAttribute('data-fluentread-pdf-document-id')).not.toBe(priorIdentity);
        state.scheduleViewport(); state.scheduleViewport(); expect(frames.size).toBe(1);
        mountedApp.unmount(); mountedApp = undefined; flushFrames(); await componentFlush();
        expect(disconnect).toHaveBeenCalledOnce(); expect(canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true);
        document.dispatchEvent(new document.defaultView!.Event('selectionchange')); expect(frames.size).toBe(0);
    });
});

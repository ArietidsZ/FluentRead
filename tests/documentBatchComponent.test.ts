import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {compileScript, parse} from 'vue/compiler-sfc';
import ts from 'typescript';
import * as vue from 'vue';
import {Config} from '@/src/core/config/model';
import * as catalog from '@/src/core/config/catalog';
import * as documentCore from '@/src/features/document-translation/core/document';
import * as presentation from '@/src/features/document-translation/ui/presentation';
import {createDocumentFileLoadGuard} from '@/src/features/document-translation/services/translation';

// 编译真实页面 setup，注入可控解析/翻译边界；可见控件与下载文件另由真实浏览器套件验证。
const require = createRequire(import.meta.url);
const filename = 'src/app/document-translation/DocumentApp.vue';
const {descriptor} = parse(readFileSync(filename, 'utf8'), {filename});
const compiled = ts.transpileModule(compileScript(descriptor, {id: 'document-batch-test'}).content, {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true},
}).outputText;
let state: Record<string, any>;
let scope: vue.EffectScope;
let parseFile: ReturnType<typeof vi.fn>;
let translate: ReturnType<typeof vi.fn>;
let unload: (() => void)[];
const file = (name: string, text = name) => ({name, size: text.length, text: async () => text}) as File;
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {resolve = done;});
  return {promise, resolve};
};

beforeEach(async () => {
  unload = [];
  vi.stubGlobal('window', {matchMedia: () => ({matches: false}), removeEventListener: () => {}, setTimeout});
  parseFile = vi.fn(async (input: File) => documentCore.parseDocument(input.name, await input.text()));
  translate = vi.fn(async (segments, options) => {
    for (const segment of segments) if (!options.initialTranslations[segment.id]) {
      options.onSegment({id: segment.id, translation: `translated ${segment.source}`});
    }
  });
  const api = {...catalog, ...documentCore, ...presentation, Config, createDocumentFileLoadGuard,
    parseDocumentFile: parseFile, translateDocumentSegments: translate,
    buildGlossaryRevision: () => '', runtimeConfig: new Config(), configReady: Promise.resolve(),
    subscribeConfig: () => () => {}, requestConfigPatch: vi.fn().mockResolvedValue(undefined),
    getMissingCredentialMessage: () => '', getTranslationServiceUnavailableMessage: () => '',
    getCustomOpenAIProvider: () => undefined, filterAvailableTranslationServices: (items: unknown) => items,
    withCustomOpenAIServiceOptions: (items: unknown) => items,
    useUiI18n: () => ({language: vue.ref('zh-CN'), t: (key: string) => key, translateLegacy: (text: string) => text}),
  };
  const exports: Record<string, any> = {};
  new Function('require', 'exports', compiled)((id: string) => {
    if (id === 'vue') return {...vue, onMounted: () => {}, onUnmounted: (fn: () => void) => unload.push(fn)};
    if (id === '@/src/app/document-translation') return api;
    if (id === 'webextension-polyfill') return {runtime: {sendMessage: vi.fn()}};
    if (id.startsWith('element-plus') || id.endsWith('.css') || id.endsWith('.vue')) return {};
    return require(id);
  }, exports);
  scope = vue.effectScope();
  state = scope.run(() => vue.proxyRefs(exports.default.setup({}, {expose: () => {}})))!;
  await vue.nextTick();
});

afterEach(() => {
  unload.forEach(fn => fn());
  scope?.stop();
  vi.unstubAllGlobals();
});

describe('document batch page lifecycle', () => {
  it('imports every valid file and preserves per-file parsing failures and duplicate names', async () => {
    await state.loadFiles([file('same.txt', 'First.'), file('bad.json', '{'), file('same.txt', 'Second.')]);
    expect(state.documentQueue).toHaveLength(3);
    expect(state.documentQueue[1].error).toBeTruthy();
    expect(new Set(state.documentQueue.map((item: any) => item.id)).size).toBe(3);
    expect(state.parsedDocument.segments[0].source).toBe('First.');
    state.selectDocument(state.documentQueue[2]);
    expect(state.parsedDocument.segments[0].source).toBe('Second.');
  });

  it('continues after a translation failure and retries only unfinished files', async () => {
    await state.loadFiles([file('a.txt'), file('b.txt'), file('c.txt')]);
    translate.mockRejectedValueOnce(new Error('service failed'));
    await state.startBatch();
    expect(state.batchCompletedCount).toBe(2);
    expect(state.documentQueue[0].state).toBe('failed');
    expect(translate).toHaveBeenCalledTimes(3);
    await state.startBatch();
    expect(state.batchCompletedCount).toBe(3);
    expect(translate).toHaveBeenCalledTimes(4);
  });

  it('pauses the queue, rejects late segments, and resumes from committed translations', async () => {
    await state.loadFiles([file('a.txt', 'First.\n\nSecond.'), file('b.txt')]);
    const pending = deferred<void>();
    let firstOptions: any;
    translate.mockImplementationOnce(async (_segments, options) => {
      firstOptions = options;
      options.onSegment({id: 0, translation: 'keep this'});
      await pending.promise;
      options.onSegment({id: 1, translation: 'late result'});
    });
    const batch = state.startBatch();
    state.pauseTranslation();
    pending.resolve();
    await batch;
    expect(firstOptions.signal.aborted).toBe(true);
    expect(translate).toHaveBeenCalledTimes(1);
    expect(state.translatedSegments).toEqual(['keep this']);
    await state.startBatch();
    expect(translate.mock.calls[1][1].initialTranslations).toEqual(['keep this']);
    expect(state.batchCompletedCount).toBe(2);
    state.selectDocument(state.documentQueue[0]);
    expect(state.translatedSegments[0]).toBe('keep this');
  });

  it('keeps manual corrections isolated across documents and protects removal', async () => {
    await state.loadFiles([file('a.txt'), file('b.txt')]);
    state.editSegment(0, 'manual correction');
    state.selectDocument(state.documentQueue[1]);
    expect(state.translatedSegments).toEqual([]);
    expect(state.hasUnsavedWork).toBe(true);
    state.selectDocument(state.documentQueue[0]);
    expect(state.translatedSegments).toEqual(['manual correction']);
    state.confirmDialog = {showModal: vi.fn(), close: vi.fn()};
    state.removeDocument(state.documentQueue[0]);
    expect(state.confirmDialog.showModal).toHaveBeenCalledOnce();
    expect(state.documentQueue).toHaveLength(2);
    state.confirmAction();
    expect(state.documentQueue).toHaveLength(1);
    expect(state.parsedDocument.fileName).toBe('b.txt');
  });

  it('does not erase partially translated work after settings change', async () => {
    await state.loadFiles([file('a.txt', 'First.\n\nSecond.')]);
    state.taskFingerprint = state.currentFingerprint;
    state.editSegment(0, 'reviewed text');
    state.config.to = 'ja';
    await state.startBatch();
    expect(translate).not.toHaveBeenCalled();
    expect(state.translatedSegments).toEqual(['reviewed text']);
    expect(state.batchNotice).toBe('document.batch.settingsChanged');
  });

  it('stops between files when an external setting changes', async () => {
    await state.loadFiles([file('a.txt'), file('b.txt')]);
    const pending = deferred<void>();
    translate.mockImplementationOnce(async (_segments, options) => {
      await pending.promise;
      options.onSegment({id: 0, translation: 'first language'});
    });
    const batch = state.startBatch();
    state.config.to = 'ja';
    pending.resolve();
    await batch;
    expect(translate).toHaveBeenCalledOnce();
    expect(state.batchRunning).toBe(false);
    expect(state.batchNotice).toBe('document.batch.externalSettings');
  });

  it('invalidates pending parsing on page reset without importing later files', async () => {
    const pending = deferred<documentCore.ParsedDocument>();
    parseFile.mockReturnValueOnce(pending.promise);
    const importing = state.loadFiles([file('a.txt'), file('b.txt')]);
    state.resetDocument();
    pending.resolve(documentCore.parseDocument('a.txt', 'Late file.'));
    await importing;
    expect(state.documentQueue).toEqual([]);
    expect(state.parsedDocument).toBeNull();
    expect(parseFile).toHaveBeenCalledOnce();
    expect(state.openingFile).toBe(false);
  });
});

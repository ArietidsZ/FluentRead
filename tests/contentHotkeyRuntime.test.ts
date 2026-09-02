import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
    config: {
        on: true,
        floatingBallHotkey: 'Alt+T',
        customFloatingBallHotkey: '',
        selectionTranslatorTrigger: 'direct',
        selectionTranslatorMode: 'bilingual',
        disableSelectionTranslator: false,
        customSelectionTranslatorHotkey: '',
        to: 'zh',
    },
    autoTranslateEnglishPage: vi.fn(),
    isFullPageTranslationActive: vi.fn(),
    restoreOriginalContent: vi.fn(),
    toggleFloatingBallTranslation: vi.fn(),
    matchesConfiguredHotkey: vi.fn(() => false),
    shouldClaimConfiguredHotkey: vi.fn((
        _event: KeyboardEvent,
        _configured: string,
        _custom: string,
        hasCandidate?: () => boolean,
    ) => hasCandidate?.() ?? false),
    getSelection: vi.fn<() => Selection | null>(() => null),
}));

vi.mock('@/src/services/config/store', () => ({config: mocks.config}));
vi.mock('@/src/core/hotkey', () => ({
    matchesConfiguredHotkey: mocks.matchesConfiguredHotkey,
    shouldClaimConfiguredHotkey: mocks.shouldClaimConfiguredHotkey,
}));
vi.mock('@/src/app/content/features', () => ({
    autoTranslateEnglishPage: mocks.autoTranslateEnglishPage,
    isFullPageTranslationActive: mocks.isFullPageTranslationActive,
    isSameLanguage: vi.fn(() => false),
    normalizeSelectionText: vi.fn((value: string) => value),
    restoreOriginalContent: mocks.restoreOriginalContent,
    shouldIgnoreSelection: vi.fn(() => false),
    toggleFloatingBallTranslation: mocks.toggleFloatingBallTranslation,
}));

type Listener = (event: Record<string, unknown>) => void;

function createDocumentStub() {
    const listeners = new Map<string, Listener[]>();
    return {
        document: {
            addEventListener: vi.fn((type: string, listener: Listener) => {
                const current = listeners.get(type) ?? [];
                current.push(listener);
                listeners.set(type, current);
            }),
            getElementById: vi.fn(() => null),
        },
        listeners,
    };
}

function keyboardEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        isTrusted: true,
        repeat: false,
        key: 't',
        code: 'KeyT',
        ctrlKey: false,
        altKey: true,
        shiftKey: false,
        metaKey: false,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        ...overrides,
    };
}

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    Object.assign(mocks.config, {
        on: true,
        floatingBallHotkey: 'Alt+T',
        customFloatingBallHotkey: '',
        selectionTranslatorTrigger: 'direct',
        selectionTranslatorMode: 'bilingual',
        disableSelectionTranslator: false,
        customSelectionTranslatorHotkey: '',
        to: 'zh',
    });
    mocks.isFullPageTranslationActive.mockReturnValue(false);
    mocks.toggleFloatingBallTranslation.mockReturnValue(true);
    mocks.getSelection.mockReturnValue(null);

    const {document, listeners} = createDocumentStub();
    vi.stubGlobal('document', document);
    vi.stubGlobal('window', {
        getSelection: mocks.getSelection,
        addEventListener: vi.fn(),
    });
    vi.stubGlobal('navigator', {platform: 'MacIntel'});
    vi.stubGlobal('process', {env: {NODE_ENV: 'test'}});
    Object.defineProperty(document, '__listeners', {value: listeners});
});

function visibleSelection(text: string): Selection {
    const rect = {width: 160, height: 24};
    const range = {
        getClientRects: () => [rect],
        getBoundingClientRect: () => rect,
    };
    return {
        rangeCount: 1,
        isCollapsed: false,
        toString: () => text,
        getRangeAt: () => range,
    } as unknown as Selection;
}

describe('全文翻译快捷键状态联动', () => {
    it('悬浮球存在时仍以全文会话真值切换，而不是驱动悬浮球局部状态', async () => {
        const {createContentHotkeyRuntime} = await import('@/src/app/content/hotkeyRuntime');
        const runtime = createContentHotkeyRuntime(() => false);
        runtime.installFloatingBallHotkey(new AbortController().signal);

        const listeners = (document as typeof document & {__listeners: Map<string, Listener[]>}).__listeners;
        const keydown = listeners.get('keydown')?.[0];
        const keyup = listeners.get('keyup')?.[0];
        expect(keydown).toBeTypeOf('function');
        expect(keyup).toBeTypeOf('function');

        keydown!(keyboardEvent({key: 'Alt', code: 'AltLeft'}));
        keydown!(keyboardEvent());
        expect(mocks.autoTranslateEnglishPage).toHaveBeenCalledOnce();
        expect(mocks.toggleFloatingBallTranslation).not.toHaveBeenCalled();

        keyup!(keyboardEvent({key: 't', code: 'KeyT', altKey: false}));
        keyup!(keyboardEvent({key: 'Alt', code: 'AltLeft', altKey: false}));
        mocks.isFullPageTranslationActive.mockReturnValue(true);

        keydown!(keyboardEvent({key: 'Alt', code: 'AltLeft'}));
        keydown!(keyboardEvent());
        expect(mocks.restoreOriginalContent).toHaveBeenCalledOnce();
        expect(mocks.toggleFloatingBallTranslation).not.toHaveBeenCalled();
    });
});

describe('划词翻译快捷键语言预检', () => {
    it.each([
        'Hallo Welt.',
        'Bonjour le monde.',
    ])('短拉丁文本 %s 不会被猜成英语，仍保留划词快捷键', async (text) => {
        mocks.config.selectionTranslatorTrigger = 'Control';
        mocks.config.to = 'en';
        mocks.getSelection.mockReturnValue(visibleSelection(text));
        const {createContentHotkeyRuntime} = await import('@/src/app/content/hotkeyRuntime');
        const runtime = createContentHotkeyRuntime(() => false);
        const event = keyboardEvent({key: 'Control', code: 'ControlLeft', ctrlKey: true, altKey: false});

        expect(runtime.hasActiveSelectionTranslationCandidate()).toBe(true);
        expect(runtime.shouldReserveSelectionShortcut(event as unknown as KeyboardEvent)).toBe(true);
    });

    it('明确日文与日语目标相同时不占用划词快捷键', async () => {
        mocks.config.selectionTranslatorTrigger = 'Control';
        mocks.config.to = 'ja';
        mocks.getSelection.mockReturnValue(visibleSelection('今日は良い天気です。'));
        const {createContentHotkeyRuntime} = await import('@/src/app/content/hotkeyRuntime');
        const runtime = createContentHotkeyRuntime(() => false);
        const event = keyboardEvent({key: 'Control', code: 'ControlLeft', ctrlKey: true, altKey: false});

        expect(runtime.hasActiveSelectionTranslationCandidate()).toBe(false);
        expect(runtime.shouldReserveSelectionShortcut(event as unknown as KeyboardEvent)).toBe(false);
    });
});

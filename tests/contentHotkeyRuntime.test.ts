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
    shouldClaimConfiguredHotkey: vi.fn(() => false),
}));

vi.mock('@/src/services/config/store', () => ({config: mocks.config}));
vi.mock('@/src/core/language/detect', () => ({detectlang: vi.fn(() => 'en')}));
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

    const {document, listeners} = createDocumentStub();
    vi.stubGlobal('document', document);
    vi.stubGlobal('window', {
        getSelection: vi.fn(() => null),
        addEventListener: vi.fn(),
    });
    vi.stubGlobal('navigator', {platform: 'MacIntel'});
    vi.stubGlobal('process', {env: {NODE_ENV: 'test'}});
    Object.defineProperty(document, '__listeners', {value: listeners});
});

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

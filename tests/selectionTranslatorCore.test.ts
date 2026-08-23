import { describe, expect, it, vi } from 'vitest';
import {
    canUseBundledDictionaryFallback,
    calculateSelectionPopupPosition,
    chooseSelectionRect,
    getSelectionPresentationDelayRemaining,
    isSameLanguage,
    isSelectionExcludedTagName,
    normalizeSelectionText,
    normalizeSpeechLanguage,
    reconcileSelectionPresentation,
    resolveSelectionDictionaryFallback,
    resolveSelectionVocabularyAnswer,
    summarizeSelectionContext,
} from '@/entrypoints/utils/selectionTranslatorCore';
import { buildEdgeTtsSsml, edgeTtsVoiceCandidatesForLanguage, edgeTtsVoiceForLanguage, synthesizeEdgeTts } from '@/entrypoints/utils/edgeTts';
import { matchesConfiguredHotkey, matchesModifierOnlyHotkey, resolveConfiguredHotkey, shouldClaimConfiguredHotkey } from '@/entrypoints/utils/hotkey';
import { normalizeSelectionTtsVoiceOrder } from '@/entrypoints/utils/selectionTtsConfig';

describe('selection translator core geometry', () => {
    const rects = [
        { top: 100, right: 300, bottom: 124, left: 80, width: 220, height: 24 },
        { top: 124, right: 180, bottom: 148, left: 80, width: 100, height: 24 },
    ];

    it('anchors a forward multi-line selection at its visual end', () => {
        expect(chooseSelectionRect(rects, true)).toEqual(rects[1]);
        expect(chooseSelectionRect(rects, false)).toEqual(rects[0]);
    });

    it('keeps the popup above the selection when there is room', () => {
        expect(calculateSelectionPopupPosition({ ...rects[0], top: 300, bottom: 324 }, { width: 360, height: 160 }, { width: 1200, height: 800 })).toEqual({
            left: 80,
            top: 130,
            placement: 'top',
        });
    });

    it('flips below and clamps to the viewport near the top edge', () => {
        expect(calculateSelectionPopupPosition({ top: 20, right: 30, bottom: 42, left: 4, width: 26, height: 22 }, { width: 360, height: 160 }, { width: 390, height: 300 })).toEqual({
            left: 12,
            top: 52,
            placement: 'bottom',
        });
    });
});

describe('selection translator presentation stability', () => {
    it('keeps a live delay change anchored to the original selection time', () => {
        expect(getSelectionPresentationDelayRemaining(300, 1_000, 1_120)).toBe(180);
        expect(getSelectionPresentationDelayRemaining(100, 1_000, 1_120)).toBe(0);
        expect(getSelectionPresentationDelayRemaining(300, 1_000, 900)).toBe(300);
    });

    it('preserves an explicitly opened tooltip across unrelated config refreshes', () => {
        const openTooltip = {showIndicator: false, showTooltip: true};
        expect(reconcileSelectionPresentation(openTooltip, 'shortcut', false)).toBe(openTooltip);
        expect(reconcileSelectionPresentation(openTooltip, 'icon', false)).toBe(openTooltip);
        expect(reconcileSelectionPresentation(openTooltip, 'dot', false)).toBe(openTooltip);
    });

    it('updates presentation only when the configured trigger actually changes', () => {
        const openTooltip = {showIndicator: false, showTooltip: true};
        expect(reconcileSelectionPresentation(openTooltip, 'direct', true)).toEqual({showIndicator: false, showTooltip: true});
        expect(reconcileSelectionPresentation(openTooltip, 'icon', true)).toEqual({showIndicator: true, showTooltip: false});
        expect(reconcileSelectionPresentation(openTooltip, 'dot', true)).toEqual({showIndicator: true, showTooltip: false});
        expect(reconcileSelectionPresentation(openTooltip, 'shortcut', true)).toEqual({showIndicator: false, showTooltip: false});
    });
});

describe('selection translator text and speech language normalization', () => {
    it('matches detected languages with configured language families', () => {
        expect(isSameLanguage('zh-Hans', 'zh-Hant')).toBe(true);
        expect(isSameLanguage('eng', 'en')).toBe(true);
        expect(isSameLanguage('ja', 'en')).toBe(false);
        expect(isSameLanguage('und', 'en')).toBe(false);
        expect(isSameLanguage('en', 'auto')).toBe(false);
    });

    it('normalizes browser whitespace without changing words', () => {
        expect(normalizeSelectionText('  hello\u00a0  world\n   again  ')).toBe('hello world\nagain');
    });

    it('keeps a bounded context centered on the selected word', () => {
        const context = summarizeSelectionContext(`Before ${'a'.repeat(80)} common ${'b'.repeat(80)} after`, 'common', 64);
        expect(context).toHaveLength(64);
        expect(context).toContain('common');
        expect(context.startsWith('…')).toBe(true);
        expect(context.endsWith('…')).toBe(true);
        expect(summarizeSelectionContext('  A   common\nexample. ', 'common')).toBe('A common example.');
        const repeated = `common FIRST ${'x'.repeat(650)} common SECOND`;
        const lastCommon = repeated.lastIndexOf('common');
        const aroundLast = summarizeSelectionContext(repeated, 'common', 80, lastCommon);
        expect(aroundLast).toContain('SECOND');
        expect(aroundLast).not.toContain('FIRST');
    });

    it('only exposes answers completed for the current selection request', () => {
        const current = {text: 'common', targetLanguage: 'zh-Hans', generation: 3};
        const translated = {...current, answer: '常见的'};
        const dictionary = {...current, answer: 'occurring often'};
        expect(resolveSelectionVocabularyAnswer(current, translated, dictionary)).toBe('常见的');
        expect(resolveSelectionVocabularyAnswer(current, {...translated, text: 'current'}, dictionary)).toBe('occurring often');
        expect(resolveSelectionVocabularyAnswer(current, {...translated, targetLanguage: 'ja'}, null)).toBe('');
        expect(resolveSelectionVocabularyAnswer(current, {...translated, generation: 2}, null)).toBe('');
    });

    it('only uses bundled ECDICT auxiliary text for Simplified Chinese targets', () => {
        expect(canUseBundledDictionaryFallback('zh-Hans')).toBe(true);
        expect(canUseBundledDictionaryFallback('ZH_cn')).toBe(true);
        expect(canUseBundledDictionaryFallback('zh-Hant')).toBe(false);
        expect(canUseBundledDictionaryFallback('ja')).toBe(false);
        expect(resolveSelectionDictionaryFallback('zh-Hans', [undefined, '', ' 常见 ', '共同'])).toBe('常见；共同');
        expect(resolveSelectionDictionaryFallback('ja', ['常见'])).toBe('');
    });

    it('classifies atomic and interactive elements as non-text selections', () => {
        for (const tagName of ['img', 'svg', 'video', 'canvas', 'button', 'input', 'textarea', 'select', 'code', 'pre']) {
            expect(isSelectionExcludedTagName(tagName)).toBe(true);
        }
        expect(isSelectionExcludedTagName('p')).toBe(false);
        expect(isSelectionExcludedTagName('span')).toBe(false);
    });

    it('maps translation language codes to browser speech language codes', () => {
        expect(normalizeSpeechLanguage('zh-Hans')).toBe('zh-CN');
        expect(normalizeSpeechLanguage('en')).toBe('en-US');
        expect(normalizeSpeechLanguage('auto', 'zh-CN')).toBe('zh-CN');
        expect(normalizeSpeechLanguage('invalid value')).toBe('en-US');
    });

    it('uses stable Edge TTS voices instead of the first system voice', () => {
        expect(edgeTtsVoiceForLanguage('en-US')).toBe('en-US-AvaMultilingualNeural');
        expect(edgeTtsVoiceForLanguage('en')).toBe('en-US-AvaMultilingualNeural');
        expect(edgeTtsVoiceForLanguage('zh-Hans')).toBe('zh-CN-XiaoxiaoMultilingualNeural');
    });

    it('keeps valid configured voices first and falls back through the same language', () => {
        expect(normalizeSelectionTtsVoiceOrder([
            'en-US-JennyNeural',
            'not-a-voice',
            'en-US-JennyNeural',
            'zh-CN-XiaoyiNeural',
        ])).toEqual(['en-US-JennyNeural', 'zh-CN-XiaoyiNeural']);
        expect(edgeTtsVoiceCandidatesForLanguage('en-US', [
            'en-GB-SoniaNeural',
            'en-US-JennyNeural',
            'zh-CN-XiaoyiNeural',
        ])).toEqual([
            'en-US-JennyNeural',
            'en-US-AvaMultilingualNeural',
            'en-US-AriaNeural',
            'en-US-GuyNeural',
        ]);
    });

    it('does not expose malformed Edge TTS endpoint JSON in errors', async () => {
        const originalFetch = globalThis.fetch;
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => {
                throw new SyntaxError('Unexpected token S in SENSITIVE_TTS_RESPONSE_SENTINEL');
            },
        });
        vi.stubGlobal('fetch', fetchMock);

        try {
            const error = await synthesizeEdgeTts('hello', 'en-US').catch(cause => cause);

            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toBe('Edge TTS endpoint returned invalid JSON');
            expect((error as Error).message).not.toContain('SENSITIVE_TTS_RESPONSE_SENTINEL');
        } finally {
            vi.stubGlobal('fetch', originalFetch);
        }
    });

    it('continues to the next voice when Edge TTS rejects the first synthesis', async () => {
        const originalFetch = globalThis.fetch;
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ t: 'test-token', r: 'eastus' }) })
            .mockResolvedValueOnce({ ok: false, status: 503 })
            .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
        vi.stubGlobal('fetch', fetchMock);

        try {
            const result = await synthesizeEdgeTts('hello', 'en-US', ['en-US-JennyNeural', 'en-US-AvaMultilingualNeural']);
            expect(result.voice).toBe('en-US-AvaMultilingualNeural');
            expect(fetchMock).toHaveBeenCalledTimes(3);
            expect(String(fetchMock.mock.calls[1]?.[0])).toContain('.tts.speech.microsoft.com');
            expect(fetchMock.mock.calls[1]?.[1]?.body).toContain('en-US-JennyNeural');
            expect(fetchMock.mock.calls[2]?.[1]?.body).toContain('en-US-AvaMultilingualNeural');
        } finally {
            vi.stubGlobal('fetch', originalFetch);
        }
    });

    it('escapes selection text before putting it into SSML', () => {
        const ssml = buildEdgeTtsSsml('A < B & C', 'en-US-AvaMultilingualNeural');
        expect(ssml).toContain('A &lt; B &amp; C');
        expect(ssml).not.toContain('A < B & C');
    });

    it('resolves preset and custom selection shortcuts consistently', () => {
        expect(resolveConfiguredHotkey('Control', 'Ctrl+Shift+Y')).toBe('Control');
        expect(resolveConfiguredHotkey('custom', ' Ctrl+Shift+Y ')).toBe('Ctrl+Shift+Y');
        expect(resolveConfiguredHotkey('none', 'Ctrl+Shift+Y')).toBe('none');
        expect(resolveConfiguredHotkey('custom', ' ')).toBe('');

        const modifierCases = [
            ['Control', {key: 'Control', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false}],
            ['Alt', {key: 'Alt', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false}],
            ['Shift', {key: 'Shift', ctrlKey: false, altKey: false, shiftKey: true, metaKey: false}],
        ] as const;
        for (const [hotkey, event] of modifierCases) {
            expect(matchesModifierOnlyHotkey(event, hotkey)).toBe(true);
            expect(matchesConfiguredHotkey(event as KeyboardEvent, hotkey)).toBe(true);
        }

        const controlWithExtraModifier = {key: 'Control', ctrlKey: true, altKey: true, shiftKey: false, metaKey: false} as KeyboardEvent;
        expect(matchesConfiguredHotkey(controlWithExtraModifier, 'Control')).toBe(false);
        expect(matchesConfiguredHotkey(controlWithExtraModifier, 'none')).toBe(false);
    });

    it('matches custom selection combinations without accepting extra modifiers', () => {
        const shortcut = {key: 'y', code: 'KeyY', ctrlKey: true, altKey: false, shiftKey: true, metaKey: false} as KeyboardEvent;
        const extraModifier = {...shortcut, altKey: true} as KeyboardEvent;
        expect(matchesConfiguredHotkey(shortcut, 'custom', 'Ctrl+Shift+Y')).toBe(true);
        expect(matchesConfiguredHotkey(extraModifier, 'custom', 'Ctrl+Shift+Y')).toBe(false);
        expect(matchesConfiguredHotkey(shortcut, 'none', 'Ctrl+Shift+Y')).toBe(false);
    });

    it('does not inspect selection geometry for unrelated keyboard input', () => {
        const hasCandidate = vi.fn(() => true);
        const unrelated = {key: 'x', code: 'KeyX', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false} as KeyboardEvent;
        const control = {key: 'Control', code: 'ControlLeft', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false} as KeyboardEvent;

        expect(shouldClaimConfiguredHotkey(unrelated, 'Control', '', hasCandidate)).toBe(false);
        expect(hasCandidate).not.toHaveBeenCalled();
        expect(shouldClaimConfiguredHotkey(control, 'Control', '', hasCandidate)).toBe(true);
        expect(hasCandidate).toHaveBeenCalledTimes(1);
    });
});

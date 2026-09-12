import {describe, expect, it, vi} from 'vitest';

import {
    LOCAL_TTS_MODE_OPTIONS,
    localTtsLanguageFamily,
    localTtsVoiceForLanguage,
    normalizeLocalTtsMode,
    normalizeLocalTtsVoice,
} from '@/src/core/config/localTts';
import {Config, normalizeConfig} from '@/src/core/config/model';
import {prepareConfigForExport, prepareConfigForImport} from '@/src/core/config/transfer';
import {
    LocalTtsLanguageUnsupportedError,
    LocalTtsModelNotDownloadedError,
    localTtsErrorCode,
} from '@/src/features/local-tts/protocol';
import {
    getLocalTtsModelFileUrl,
    getLocalTtsModelLoaderUrl,
} from '@/src/features/local-tts/offscreen/modelCache';
import {createSelectionTtsSynthesizer} from '@/src/features/selection-translation/background/selectionTtsSynthesis';
import type {SelectionTtsAudio} from '@/src/features/selection-translation/background/ttsHandler';
import type {LocalTtsAudio} from '@/src/features/local-tts/protocol';

function onlineAudio(): SelectionTtsAudio {
    return {audio: new Uint8Array([1]).buffer, contentType: 'audio/mpeg', voice: 'edge-voice'};
}

function localAudio(): LocalTtsAudio {
    return {audio: new Uint8Array([2]).buffer, contentType: 'audio/wav', voice: 'zf_001', backend: 'wasm'};
}

function subject(mode: string, overrides: Partial<Parameters<typeof createSelectionTtsSynthesizer>[0]> = {}) {
    const synthesizeOnline = vi.fn(async () => onlineAudio());
    const synthesizeLocal = vi.fn(async () => localAudio());
    const synthesize = createSelectionTtsSynthesizer({
        getMode: () => mode,
        getLocalVoice: () => 'auto',
        getOnlineVoices: () => ['edge-voice'],
        synthesizeOnline,
        synthesizeLocal,
        ...overrides,
    });
    return {synthesize, synthesizeLocal, synthesizeOnline};
}

describe('local TTS configuration', () => {
    it('normalizes strategy and voice values without overwriting valid settings', () => {
        expect(LOCAL_TTS_MODE_OPTIONS.map((item) => item.value)).toEqual([
            'online-first', 'local-first', 'online-only', 'local-only',
        ]);
        expect(normalizeLocalTtsMode('local-first')).toBe('local-first');
        expect(normalizeLocalTtsMode('bad')).toBe('online-first');
        expect(normalizeLocalTtsVoice('zf_001')).toBe('zf_001');
        expect(normalizeLocalTtsVoice('bad')).toBe('auto');
        expect(localTtsLanguageFamily('cmn')).toBe('zh');
        expect(localTtsLanguageFamily('en-GB')).toBe('en');
        expect(localTtsLanguageFamily('fr-FR')).toBeNull();
        expect(localTtsVoiceForLanguage('zh-CN', 'af_maple')).toBe('zf_001');
        expect(localTtsVoiceForLanguage('en-US', 'bf_vale')).toBe('bf_vale');
        expect(new Config().selectionTtsMode).toBe('online-first');
        expect(new Config().selectionTtsLocalVoice).toBe('auto');
        expect(normalizeConfig({selectionTtsMode: 'local-only', selectionTtsLocalVoice: 'zf_001'})).toMatchObject({
            selectionTtsMode: 'local-only',
            selectionTtsLocalVoice: 'zf_001',
        });
    });

    it('keeps the pinned download URL and the Transformers.js main cache alias distinct', () => {
        const pinned = getLocalTtsModelFileUrl('onnx/model_q4f16.onnx');
        const loader = getLocalTtsModelLoaderUrl('onnx/model_q4f16.onnx');
        expect(pinned).toContain('/resolve/6cc0f0d2ebe369a68b0df87c2b65c1af8c0ac3e3/');
        expect(loader).toContain('/resolve/main/');
        expect(loader).not.toBe(pinned);
    });

    it('round-trips the user TTS choice while legacy backups keep the online-first default', () => {
        const source = normalizeConfig({
            ...new Config(),
            selectionTtsMode: 'local-only',
            selectionTtsLocalVoice: 'zf_001',
        });
        const exported = prepareConfigForExport(source);
        expect(exported).toMatchObject({selectionTtsMode: 'local-only', selectionTtsLocalVoice: 'zf_001'});
        expect(prepareConfigForImport(exported, new Config())).toMatchObject({
            selectionTtsMode: 'local-only',
            selectionTtsLocalVoice: 'zf_001',
        });

        const {selectionTtsMode: _mode, selectionTtsLocalVoice: _voice, ...legacyBackup} = exported;
        expect(prepareConfigForImport(legacyBackup, new Config())).toMatchObject({
            selectionTtsMode: 'online-first',
            selectionTtsLocalVoice: 'auto',
        });
        expect(JSON.stringify(exported)).not.toContain('onnx');
    });
});

describe('selection TTS source policy', () => {
    it('online-first does not initialize local speech when online succeeds', async () => {
        const state = subject('online-first');
        await expect(state.synthesize('hello', 'en-US', [], undefined)).resolves.toEqual(onlineAudio());
        expect(state.synthesizeOnline).toHaveBeenCalledOnce();
        expect(state.synthesizeLocal).not.toHaveBeenCalled();
    });

    it('online-first falls back to local speech after an online failure', async () => {
        const state = subject('online-first', {
            synthesizeOnline: vi.fn(async () => { throw new Error('network down'); }),
        });
        await expect(state.synthesize('你好', 'zh-CN', [], undefined)).resolves.toMatchObject({contentType: 'audio/wav', voice: 'zf_001'});
        expect(state.synthesizeLocal).toHaveBeenCalledOnce();
    });

    it('online-first reports an actionable missing-model error and never downloads automatically', async () => {
        const state = subject('online-first', {
            synthesizeOnline: vi.fn(async () => { throw new Error('network down'); }),
            synthesizeLocal: vi.fn(async () => { throw new LocalTtsModelNotDownloadedError(); }),
        });
        await expect(state.synthesize('你好', 'zh-CN', [], undefined)).rejects.toMatchObject({
            code: 'local-tts-model-not-downloaded',
        });
    });

    it('local-first uses local speech and falls online only when local is unavailable', async () => {
        const first = subject('local-first');
        await expect(first.synthesize('你好', 'zh-CN', [], undefined)).resolves.toMatchObject({contentType: 'audio/wav'});
        expect(first.synthesizeOnline).not.toHaveBeenCalled();

        const fallback = subject('local-first', {
            synthesizeLocal: vi.fn(async () => { throw new LocalTtsModelNotDownloadedError(); }),
        });
        await expect(fallback.synthesize('hello', 'en-US', [], undefined)).resolves.toEqual(onlineAudio());
        expect(fallback.synthesizeOnline).toHaveBeenCalledOnce();
    });

    it('only-online and only-local modes remain strict', async () => {
        const online = subject('online-only');
        await expect(online.synthesize('hello', 'en-US', [], undefined)).resolves.toEqual(onlineAudio());
        expect(online.synthesizeLocal).not.toHaveBeenCalled();

        const local = subject('local-only');
        await expect(local.synthesize('你好', 'zh-CN', [], undefined)).resolves.toMatchObject({contentType: 'audio/wav'});
        expect(local.synthesizeOnline).not.toHaveBeenCalled();
    });

    it('local-first treats unsupported local languages as an online fallback', async () => {
        const state = subject('local-first', {
            synthesizeLocal: vi.fn(async () => { throw new LocalTtsLanguageUnsupportedError('fr-FR'); }),
        });
        await expect(state.synthesize('bonjour', 'fr-FR', [], undefined)).resolves.toEqual(onlineAudio());
        expect(state.synthesizeOnline).toHaveBeenCalledOnce();
    });

    // 回归：本地错误经 Offscreen 消息返回后只剩普通 Error + code，instanceof 判断会失效。
    it.each([
        ['local-tts-model-not-downloaded'],
        ['local-tts-language-unsupported'],
    ])('local-first 把跨消息边界的 %s 视为本地不可用，直接交给在线结果或在线错误', async (code) => {
        const remoteError = () => Object.assign(new Error('offscreen said no'), {code});
        const fallback = subject('local-first', {synthesizeLocal: vi.fn(async () => { throw remoteError(); })});
        await expect(fallback.synthesize('hello', 'en-US', [], undefined)).resolves.toEqual(onlineAudio());

        const onlineFailure = new Error('network down');
        const bothUnavailable = subject('local-first', {
            synthesizeLocal: vi.fn(async () => { throw remoteError(); }),
            synthesizeOnline: vi.fn(async () => { throw onlineFailure; }),
        });
        await expect(bothUnavailable.synthesize('hello', 'en-US', [], undefined)).rejects.toBe(onlineFailure);
    });

    it('local-first 在真实本地合成失败后尝试在线，并在两者都失败时同时给出原因', async () => {
        const state = subject('local-first', {
            synthesizeLocal: vi.fn(async () => { throw new Error('worker crashed'); }),
            synthesizeOnline: vi.fn(async () => { throw 'offline'; }),
        });
        await expect(state.synthesize('你好', 'zh-CN', [], undefined)).rejects.toThrow('本地 TTS 和在线 TTS 均失败：worker crashed；offline');
    });

    it('错误码读取只接受字符串 code', () => {
        expect(localTtsErrorCode(new LocalTtsModelNotDownloadedError())).toBe('local-tts-model-not-downloaded');
        expect(localTtsErrorCode(Object.assign(new Error('x'), {code: 7}))).toBeUndefined();
        expect(localTtsErrorCode(null)).toBeUndefined();
        expect(localTtsErrorCode('local-tts-model-not-downloaded')).toBeUndefined();
    });
});

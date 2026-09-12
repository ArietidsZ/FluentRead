/**
 * @file src/features/selection-translation/background/selectionTtsSynthesis.ts
 * 文件职责：按照用户选择编排在线 TTS、本地 Kokoro TTS 和最终回退。
 * 主要内容：实现在线优先、本地优先、仅在线、仅本地四种策略，并保留现有 Edge 音色顺序。
 * 模块边界：只决定合成来源，不播放音频；播放和停止仍由 selectionTts handler 与 Offscreen 负责。
 */

import type {SelectionTtsAudio} from './ttsHandler';
import {
    normalizeLocalTtsMode,
    type LocalTtsMode,
} from '@/src/core/config/localTts';
import {
    LocalTtsLanguageUnsupportedError,
    LocalTtsModelNotDownloadedError,
    type LocalTtsAudio,
} from '@/src/features/local-tts/offscreen/tts';

export interface SelectionTtsSynthesisDependencies {
    readonly getMode: () => unknown;
    readonly getLocalVoice: () => unknown;
    readonly getOnlineVoices: () => unknown;
    readonly synthesizeOnline: (
        text: string,
        language: string,
        preferredVoices: unknown,
        signal?: AbortSignal,
    ) => Promise<SelectionTtsAudio>;
    readonly synthesizeLocal: (
        text: string,
        language: string,
        voice: string,
        signal?: AbortSignal,
    ) => Promise<LocalTtsAudio>;
}

export interface SelectionTtsSynthesisError extends Error {
    readonly code?: string;
}

function errorCode(error: unknown): string | undefined {
    return error && typeof error === 'object' && typeof (error as {code?: unknown}).code === 'string'
        ? (error as {code: string}).code
        : undefined;
}

function localAudio(audio: LocalTtsAudio): SelectionTtsAudio {
    return {
        audio: audio.audio,
        contentType: audio.contentType,
        voice: audio.voice,
    };
}

function modeAllowsLocal(mode: LocalTtsMode): boolean {
    return mode === 'online-first' || mode === 'local-first' || mode === 'local-only';
}

function localUnavailableMessage(error: unknown): string {
    if (errorCode(error) === 'local-tts-model-not-downloaded') {
        return '本地 TTS 模型尚未下载，请先在设置中的朗读与语音里下载模型';
    }
    return error instanceof Error ? error.message : String(error);
}

/** 创建可注入的策略合成器，便于单元测试所有来源和回退顺序。 */
export function createSelectionTtsSynthesizer(
    dependencies: SelectionTtsSynthesisDependencies,
) {
    return async function synthesizeSelectionTts(
        text: string,
        language: string,
        _preferredVoices: unknown,
        signal?: AbortSignal,
    ): Promise<SelectionTtsAudio> {
        const mode = normalizeLocalTtsMode(dependencies.getMode());
        const online = () => dependencies.synthesizeOnline(text, language, dependencies.getOnlineVoices(), signal);
        const local = async () => localAudio(await dependencies.synthesizeLocal(
            text,
            language,
            String(dependencies.getLocalVoice() || 'auto'),
            signal,
        ));

        if (mode === 'online-only') return online();
        if (mode === 'local-only') return local();

        if (mode === 'local-first') {
            try {
                return await local();
            } catch (localError) {
                if (localError instanceof LocalTtsLanguageUnsupportedError
                    || localError instanceof LocalTtsModelNotDownloadedError) {
                    return online();
                }
                try {
                    return await online();
                } catch (onlineError) {
                    throw new Error(`本地 TTS 和在线 TTS 均失败：${localUnavailableMessage(localError)}；${onlineError instanceof Error ? onlineError.message : String(onlineError)}`);
                }
            }
        }

        // 默认在线优先。在线失败后才尝试本地，且本地没有模型时不自动下载。
        try {
            return await online();
        } catch (onlineError) {
            if (!modeAllowsLocal(mode)) throw onlineError;
            try {
                return await local();
            } catch (localError) {
                if (errorCode(localError) === 'local-tts-model-not-downloaded') {
                    const error = new LocalTtsModelNotDownloadedError();
                    error.message = `在线 TTS 失败；${error.message}`;
                    throw error;
                }
                if (errorCode(localError) === 'local-tts-language-unsupported') throw onlineError;
                throw new Error(`在线 TTS 和本地 TTS 均失败：${onlineError instanceof Error ? onlineError.message : String(onlineError)}；${localUnavailableMessage(localError)}`);
            }
        }
    };
}

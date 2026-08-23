/**
 * Chrome Translation API Offscreen 文档
 * 在 offscreen 环境中处理 Chrome Translation API 调用
 */

import { downloadImageOcrLanguages, recognizeImage } from './imageOcr';
import { translateAreaInOffscreen, translateImageInOffscreen } from './imageTranslation';

// 语言代码映射
const languageMap: { [key: string]: string } = {
    'zh-Hans': 'zh',
    'zh-Hant': 'zh-TW',
    'en': 'en',
    'ja': 'ja',
    'ko': 'ko',
    'fr': 'fr',
    'de': 'de',
    'es': 'es',
    'ru': 'ru',
    'it': 'it',
    'pt': 'pt',
    'ar': 'ar',
    'hi': 'hi',
    'th': 'th',
    'vi': 'vi',
    'nl': 'nl',
    'pl': 'pl',
    'tr': 'tr'
};

// 检查是否支持 Chrome Translation API
function isChromeTranslationSupported(): boolean {
    // 检查新的 API
    if ('translation' in self && 'createTranslator' in (self as any).translation) {
        return true;
    }
    
    // 检查旧的 API
    if ('Translator' in self && 'LanguageDetector' in self) {
        return true;
    }
    
    return false;
}

// 检测文本语言
async function detectLanguage(text: string): Promise<string> {
    try {
        // 尝试使用新的 API
        if ('translation' in self && 'createDetector' in (self as any).translation) {
            const detector = await (self as any).translation.createDetector();
            const results = await detector.detect(text);
            const detected = results.length > 0 ? results[0].detectedLanguage : 'en';
            return detected;
        }
        
        // 尝试使用旧的 API
        if ('LanguageDetector' in self) {
            const detector = await (self as any).LanguageDetector.create();
            const results = await detector.detect(text);
            const detected = results.length > 0 ? results[0].detectedLanguage : 'en';
            return detected;
        }
    } catch {}
    
    // 回退到简单检测
    const chineseRegex = /[\u4e00-\u9fff]/;
    const japaneseRegex = /[\u3040-\u309f\u30a0-\u30ff]/;
    const koreanRegex = /[\uac00-\ud7af]/;
    
    if (chineseRegex.test(text)) {
        return 'zh';
    } else if (japaneseRegex.test(text)) {
        return 'ja';
    } else if (koreanRegex.test(text)) {
        return 'ko';
    } else {
        return 'en';
    }
}

// 执行翻译
async function performTranslation(text: string, fromLang: string, toLang: string): Promise<string> {
    try {
        let translator;
        
        // 尝试使用新的 API
        if ('translation' in self && 'createTranslator' in (self as any).translation) {
            translator = await (self as any).translation.createTranslator({
                sourceLanguage: fromLang,
                targetLanguage: toLang
            });
        }
        // 尝试使用旧的 API
        else if ('Translator' in self) {
            translator = await (self as any).Translator.create({
                sourceLanguage: fromLang,
                targetLanguage: toLang
            });
        } else {
            throw new Error('没有可用的翻译 API');
        }

        let translatedText = '';
        
        // 检查是否支持流式翻译
        if (translator.translateStreaming) {
            const stream = translator.translateStreaming(text);
            for await (const chunk of stream) {
                translatedText += chunk;
            }
        } else if (translator.translate) {
            translatedText = await translator.translate(text);
        } else {
            throw new Error('翻译器不支持翻译方法');
        }

        return translatedText;
        
    } catch (error) {
        throw error;
    }
}

// 处理翻译请求
async function handleTranslationRequest(data: any): Promise<string> {
    const { text, from, to } = data;
    
    if (!text || typeof text !== 'string' || text.trim() === '') {
        return ""
    }

    // 检查是否支持 Chrome Translation API
    if (!isChromeTranslationSupported()) {
        throw new Error('当前浏览器不支持 Chrome Translation API，请确保使用 Google Chrome 浏览器 v138 stable 或更高版本。');
    }

    // 声明变量以便在 catch 块中使用
    let detectedLang = from;
    let fromLang = from;
    let toLang = to;
    
    try {
        // 检测源语言
        if (from === 'auto') {
            detectedLang = await detectLanguage(text);
        }
        
        // 映射语言代码 - 确保使用 Chrome API 支持的格式
        fromLang = languageMap[detectedLang] || detectedLang;
        toLang = languageMap[to] || to;

        // 如果源语言和目标语言相同，不需要翻译
        if (fromLang === toLang) {
            return text;
        }

        // 执行翻译
        return await performTranslation(text, fromLang, toLang);

    } catch (error) {
        // 提供更友好的错误信息
        if (error instanceof Error) {
            if (error.message.includes('not available') || error.message.includes('not ready')) {
                throw new Error('Chrome Translation API 暂时不可用。可能需要下载语言模型，请稍后重试。');
            } else if (error.message.includes('language') || error.message.includes('not supported')) {
                throw new Error(`不支持的语言组合：${fromLang} -> ${toLang}。请尝试其他语言对或检查浏览器版本。`);
            } else if (error.message.includes('model')) {
                throw new Error('翻译模型未就绪，请稍后重试或检查网络连接。');
            }
        }
        
        throw new Error(`翻译失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
}

interface SelectionTtsPlaybackMessage {
    audioBase64?: string;
    contentType?: string;
    sourceUrl?: string;
    tabId: number;
    requestId: number;
}

let selectionAudio: HTMLAudioElement | null = null;
let selectionAudioUrl = '';
let selectionAudioRequestId: number | null = null;

function decodeAudioBase64(audioBase64: string): Uint8Array {
    const binary = atob(audioBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

function releaseSelectionAudio(audio: HTMLAudioElement | null = selectionAudio): void {
    if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
    }
    if (selectionAudioUrl) URL.revokeObjectURL(selectionAudioUrl);
    selectionAudio = null;
    selectionAudioUrl = '';
    selectionAudioRequestId = null;
}

function notifySelectionAudioState(message: SelectionTtsPlaybackMessage, state: 'ended' | 'stopped' | 'error', error?: unknown): void {
    void chrome.runtime.sendMessage({
        type: 'selectionTtsPlaybackState',
        tabId: message.tabId,
        requestId: message.requestId,
        state,
        error: error instanceof Error ? error.message : error ? String(error) : undefined,
    }).catch(() => undefined);
}

function stopSelectionAudio(notify = true): void {
    if (!selectionAudio || selectionAudioRequestId === null) return;
    const activeMessage: SelectionTtsPlaybackMessage = {
        tabId: Number(selectionAudio.dataset.fluentReadTabId),
        requestId: selectionAudioRequestId,
    };
    releaseSelectionAudio();
    if (notify && Number.isInteger(activeMessage.tabId)) notifySelectionAudioState(activeMessage, 'stopped');
}

async function playSelectionAudio(message: SelectionTtsPlaybackMessage): Promise<void> {
    stopSelectionAudio();
    if (!Number.isInteger(message.tabId) || !Number.isInteger(message.requestId)) throw new Error('TTS 播放上下文无效');
    if (!message.sourceUrl && !message.audioBase64) throw new Error('TTS 音频数据为空');

    const nextAudio = new Audio();
    nextAudio.preload = 'auto';
    nextAudio.dataset.fluentReadTabId = String(message.tabId);
    if (message.sourceUrl) {
        nextAudio.src = message.sourceUrl;
    } else {
        selectionAudioUrl = URL.createObjectURL(new Blob([decodeAudioBase64(message.audioBase64!)], {
            type: message.contentType || 'audio/mpeg',
        }));
        nextAudio.src = selectionAudioUrl;
    }

    selectionAudio = nextAudio;
    selectionAudioRequestId = message.requestId;
    nextAudio.onended = () => {
        if (selectionAudio !== nextAudio) return;
        releaseSelectionAudio(nextAudio);
        notifySelectionAudioState(message, 'ended');
    };
    nextAudio.onerror = () => {
        if (selectionAudio !== nextAudio) return;
        releaseSelectionAudio(nextAudio);
        notifySelectionAudioState(message, 'error', new Error('扩展音频解码或播放失败'));
    };

    try {
        await nextAudio.play();
    } catch (error) {
        if (selectionAudio === nextAudio) releaseSelectionAudio(nextAudio);
        notifySelectionAudioState(message, 'error', error);
        throw error;
    }
}

// 监听来自 background script 的消息
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'PLAY_SELECTION_TTS' && message.target === 'offscreen') {
        playSelectionAudio(message)
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({
                success: false,
                error: error instanceof Error ? error.message : String(error),
            }));
        return true;
    }

    if (message.type === 'STOP_SELECTION_TTS' && message.target === 'offscreen') {
        const requestId = typeof message.requestId === 'number' ? message.requestId : undefined;
        if (requestId === undefined || selectionAudioRequestId === requestId) stopSelectionAudio();
        sendResponse({ success: true });
        return true;
    }
    
    if (message.type === 'CHROME_TRANSLATE_OFFSCREEN') {
        handleTranslationRequest(message.data)
            .then(result => {
                sendResponse({ success: true, result });
            })
            .catch(error => {
                sendResponse({ success: false, error: error.message });
            });
        
        return true; // 保持消息通道开放以支持异步响应
    }

    if (message.type === 'FLUENT_READ_IMAGE_OCR_OFFSCREEN') {
        recognizeImage(message.image, message.sourceLanguage)
            .then(lines => sendResponse({ success: true, lines }))
            .catch(error => {
                sendResponse({
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                });
            });

        return true;
    }

    if (message.type === 'FLUENT_READ_IMAGE_TRANSLATE_OFFSCREEN') {
        translateImageInOffscreen(message.image, message.sourceLanguage, message.title || '')
            .then(result => sendResponse({ success: true, ...result }))
            .catch(error => {
                sendResponse({
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                });
            });

        return true;
    }

    if (message.type === 'FLUENT_READ_AREA_TRANSLATE_OFFSCREEN') {
        translateAreaInOffscreen(message.image, message.sourceLanguage, message.title || '', message.selection)
            .then(result => sendResponse({ success: true, ...result }))
            .catch(error => {
                sendResponse({
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                });
            });

        return true;
    }

    if (message.type === 'FLUENT_READ_IMAGE_OCR_DOWNLOAD_OFFSCREEN') {
        downloadImageOcrLanguages(message.languages || [])
            .then(() => sendResponse({ success: true }))
            .catch(error => {
                sendResponse({
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                });
            });

        return true;
    }
    
    return false;
});

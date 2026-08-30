/**
 * @file src/features/image-translation/content/runtime.ts
 * 文件职责：实现网页图片翻译的悬浮按钮与译图覆盖层生命周期，针对可见且尺寸足够的图片读取源数据、请求翻译、定位结果并支持恢复。
 * 主要内容：维护每张 HTMLImageElement 的请求阶段和 Abort/timeout 所有权，处理 pointerover/out、滚动缩放和 DOM 移除，解析 object-fit 后的实际图像区域并绘制返回位图。
 * 模块边界：本运行时优先读取页面允许 Canvas 访问的图片像素；跨域污染时只把图片 URL 交给 Offscreen 读取，OCR、译图运算及语言包管理位于对应 background/services 模块。
 */
import { config } from '@/src/services/config/store';
import {
    fetchImageInExtension,
    translateImageInExtension,
} from '@/src/features/image-translation/services/client';
import type { OcrLine } from '@/src/features/image-translation/core';

const IMAGE_TRANSLATION_OVERLAY = 'fluent-read-image-translation-overlay';
const IMAGE_TRANSLATION_ROOT = 'fluent-read-image-translation-root';
const IMAGE_TRANSLATION_BUTTON = 'fluent-read-image-translation-button';
const MIN_IMAGE_WIDTH = 80;
const MIN_IMAGE_HEIGHT = 40;
const IMAGE_READ_TIMEOUT_MS = 15_000;
const IMAGE_OCR_TIMEOUT_MS = 90_000;
const IMAGE_TRANSLATION_TIMEOUT_MS = 90_000;

type ImageTranslationPhase = 'idle' | 'loading' | 'translated' | 'error';

interface ImageTranslationState {
    image: HTMLImageElement;
    overlay: HTMLDivElement;
    canvas: HTMLCanvasElement;
    button: HTMLButtonElement;
    phase: ImageTranslationPhase;
    abortController: AbortController | null;
    hovered: boolean;
    hoverTimer: number | null;
    errorResetTimer: number | null;
    resizeObserver: ResizeObserver | null;
    imageLoadHandler: (() => void) | null;
    lines: Array<OcrLine & { backgroundColor: string }>;
    translatedImage: HTMLImageElement | null;
}

let mounted = false;
let removeListeners: (() => void) | null = null;
let imageOverlayHost: HTMLDivElement | null = null;
let imageOverlayContainer: HTMLDivElement | null = null;
let layoutObserver: MutationObserver | null = null;
let positionFrame: number | null = null;
const states = new WeakMap<HTMLImageElement, ImageTranslationState>();
const activeStates = new Set<ImageTranslationState>();

function ensureImageOverlayRoot(): HTMLDivElement {
    if (imageOverlayContainer) return imageOverlayContainer;

    const host = document.createElement('div');
    host.id = IMAGE_TRANSLATION_ROOT;
    host.setAttribute('data-fluent-read-ui', 'image-translation');
    host.style.cssText = [
        'all: initial !important',
        'position: fixed !important',
        'inset: 0 !important',
        'width: 100vw !important',
        'height: 100vh !important',
        'pointer-events: none !important',
        'z-index: 2147483646 !important',
    ].join(';');
    // Canvas 可能包含页面允许读取的图片像素，不向页面脚本暴露控件或译图。
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 2147483646; }
      .${IMAGE_TRANSLATION_OVERLAY} { position: fixed !important; overflow: hidden !important; pointer-events: none !important; box-sizing: border-box !important; }
      .${IMAGE_TRANSLATION_OVERLAY} canvas { position: absolute !important; inset: 0 !important; display: none; width: 100%; height: 100%; pointer-events: none; }
      .${IMAGE_TRANSLATION_BUTTON} {
        position: absolute !important; left: 8px !important; bottom: 8px !important; z-index: 1 !important;
        width: 26px !important; height: 26px !important; padding: 0 !important;
        border: 1px solid rgba(255,255,255,.7) !important; border-radius: 999px !important;
        background: rgba(20,20,20,.68) !important; color: rgba(255,255,255,.95) !important;
        box-shadow: 0 1px 5px rgba(0,0,0,.28) !important; cursor: pointer !important;
        font: 14px/24px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif !important;
        opacity: .78 !important; pointer-events: auto !important;
        transition: opacity .15s ease, transform .15s ease, background .15s ease !important;
      }
      .${IMAGE_TRANSLATION_BUTTON}:hover, .${IMAGE_TRANSLATION_BUTTON}:focus-visible { background: rgba(20,20,20,.9) !important; opacity: 1 !important; outline: none !important; transform: scale(1.06); }
      .${IMAGE_TRANSLATION_BUTTON}[data-phase="loading"] { animation: fluent-read-image-translation-pulse 1.1s ease-in-out infinite; }
      .${IMAGE_TRANSLATION_BUTTON}[data-phase="error"] { background: rgba(185,28,28,.88) !important; }
      @keyframes fluent-read-image-translation-pulse { 0%,100% { opacity:.52; } 50% { opacity:1; } }
    `;
    const container = document.createElement('div');
    shadow.append(style, container);
    document.documentElement.appendChild(host);
    imageOverlayHost = host;
    imageOverlayContainer = container;
    return container;
}

function removeImageOverlayRoot(): void {
    imageOverlayHost?.remove();
    imageOverlayHost = null;
    imageOverlayContainer = null;
}

function createImageAbortError(): Error {
    const error = new Error('图片翻译已取消');
    error.name = 'AbortError';
    return error;
}

function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
    signal?: AbortSignal,
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
            window.clearTimeout(timer);
            signal?.removeEventListener('abort', handleAbort);
        };
        const finish = (callback: () => void) => {
            if (settled) return;
            settled = true;
            cleanup();
            callback();
        };
        const handleAbort = () => finish(() => reject(createImageAbortError()));
        const timer = window.setTimeout(() => finish(() => reject(new Error(message))), timeoutMs);

        if (signal?.aborted) {
            handleAbort();
            return;
        }
        signal?.addEventListener('abort', handleAbort, {once: true});
        void promise.then(
            value => finish(() => resolve(value)),
            error => finish(() => reject(error)),
        );
    });
}

function clearHoverTimer(state: ImageTranslationState): void {
    if (state.hoverTimer !== null) {
        window.clearTimeout(state.hoverTimer);
        state.hoverTimer = null;
    }
}

function clearErrorResetTimer(state: ImageTranslationState): void {
    if (state.errorResetTimer !== null) {
        window.clearTimeout(state.errorResetTimer);
        state.errorResetTimer = null;
    }
}

function scheduleIdleStateRemoval(state: ImageTranslationState): void {
    clearHoverTimer(state);
    if (state.phase !== 'idle' || state.hovered) return;
    state.hoverTimer = window.setTimeout(() => {
        state.hoverTimer = null;
        if (state.phase === 'idle' && !state.hovered) removeState(state);
    }, 180);
}

function setStateHovered(state: ImageTranslationState, hovered: boolean): void {
    state.hovered = hovered;
    if (hovered) clearHoverTimer(state);
    else scheduleIdleStateRemoval(state);
}

function removeState(state: ImageTranslationState): void {
    // 先中止请求并断开所有观察器/监听器，再删除 DOM 与索引，避免失效回调复活状态。
    clearHoverTimer(state);
    clearErrorResetTimer(state);
    state.abortController?.abort();
    state.resizeObserver?.disconnect();
    if (state.imageLoadHandler) state.image.removeEventListener('load', state.imageLoadHandler);
    state.overlay.remove();
    activeStates.delete(state);
    if (states.get(state.image) === state) states.delete(state.image);
}

function updateOverlayPosition(state: ImageTranslationState): void {
    if (!state.image.isConnected) {
        removeState(state);
        return;
    }

    const rect = state.image.getBoundingClientRect();
    const visible = rect.width >= MIN_IMAGE_WIDTH && rect.height >= MIN_IMAGE_HEIGHT;
    state.overlay.style.display = visible ? 'block' : 'none';
    if (!visible) return;

    state.overlay.style.left = `${rect.left}px`;
    state.overlay.style.top = `${rect.top}px`;
    state.overlay.style.width = `${rect.width}px`;
    state.overlay.style.height = `${rect.height}px`;
    if (state.phase === 'translated') renderTranslatedBitmap(state, rect.width, rect.height);
}

function createState(image: HTMLImageElement): ImageTranslationState {
    const overlayContainer = ensureImageOverlayRoot();
    const overlay = document.createElement('div');
    overlay.className = IMAGE_TRANSLATION_OVERLAY;
    overlay.dataset.fluentReadImageTranslation = 'true';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = IMAGE_TRANSLATION_BUTTON;
    button.textContent = '文';
    button.title = '翻译图片';
    button.setAttribute('aria-label', '翻译图片');
    button.addEventListener('pointerenter', event => event.stopPropagation());
    button.addEventListener('pointerdown', event => {
        if (!event.isTrusted) return;
        event.preventDefault();
        event.stopPropagation();
    });
    button.addEventListener('click', event => {
        // 只有可信用户手势能触发翻译或恢复，宿主页派发的合成事件直接忽略。
        if (!event.isTrusted) return;
        event.preventDefault();
        event.stopPropagation();
        const state = states.get(image);
        if (!state) return;
        if (state.phase === 'translated' || state.phase === 'loading') {
            restoreImageTranslation(state);
        } else {
            void translateImage(state);
        }
    });

    const canvas = document.createElement('canvas');
    canvas.className = 'fluent-read-image-translation-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    overlay.append(canvas, button);
    overlayContainer.appendChild(overlay);

    const state: ImageTranslationState = {
        image,
        overlay,
        canvas,
        button,
        phase: 'idle',
        abortController: null,
        hovered: true,
        hoverTimer: null,
        errorResetTimer: null,
        resizeObserver: null,
        imageLoadHandler: null,
        lines: [],
        translatedImage: null,
    };
    state.imageLoadHandler = () => updateOverlayPosition(state);
    state.resizeObserver = typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => updateOverlayPosition(state));
    state.resizeObserver?.observe(image);
    image.addEventListener('load', state.imageLoadHandler);
    states.set(image, state);
    activeStates.add(state);
    overlay.addEventListener('pointerenter', () => {
        const current = states.get(image);
        if (current) setStateHovered(current, true);
    });
    overlay.addEventListener('pointerleave', () => {
        const current = states.get(image);
        if (current) setStateHovered(current, false);
    });
    updateOverlayPosition(state);
    return state;
}

function getState(image: HTMLImageElement): ImageTranslationState {
    return states.get(image) || createState(image);
}

function showImageButton(image: HTMLImageElement): void {
    if (!mounted || !config.on || image.closest(`[${IMAGE_TRANSLATION_OVERLAY}]`) || image.closest('video')) return;
    const state = getState(image);
    setStateHovered(state, true);
    updateOverlayPosition(state);
}

function hideImageButton(image: HTMLImageElement): void {
    const state = states.get(image);
    if (!state) return;
    setStateHovered(state, false);
}

export async function getImageData(
    image: HTMLImageElement,
    options: {readonly signal?: AbortSignal; readonly timeoutMs?: number} = {},
): Promise<string> {
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height) throw new Error('图片尚未加载完成');

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器不支持图片读取');

    try {
        context.drawImage(image, 0, 0, width, height);
        // drawImage 本身不会暴露跨域污染，读取像素才能确定 canvas 是否可交给 OCR。
        context.getImageData(0, 0, 1, 1);
        return canvas.toDataURL('image/png');
    } catch {
        const source = image.currentSrc || image.src;
        if (!source) throw new Error('图片地址不可用');
        // 页面 Canvas 被 CORS 污染时，改由 Offscreen 在扩展权限边界内读取；
        // Offscreen 只接受受控的 X/Twitter 媒体域，不把任意网页 URL 交给特权网络层。
        return fetchImageInExtension(source, options);
    }
}

async function waitForImageReady(image: HTMLImageElement, signal?: AbortSignal): Promise<void> {
    if (image.naturalWidth > 0 && image.naturalHeight > 0) return;
    if (image.complete) throw new Error('图片尚未加载完成');

    await new Promise<void>((resolve, reject) => {
        const onLoad = () => {
            cleanup();
            if (image.naturalWidth > 0 && image.naturalHeight > 0) resolve();
            else reject(new Error('图片尚未加载完成'));
        };
        const onError = () => {
            cleanup();
            reject(new Error('图片加载失败'));
        };
        const onAbort = () => {
            cleanup();
            reject(createImageAbortError());
        };
        const cleanup = () => {
            image.removeEventListener('load', onLoad);
            image.removeEventListener('error', onError);
            signal?.removeEventListener('abort', onAbort);
        };
        if (signal?.aborted) {
            onAbort();
            return;
        }
        image.addEventListener('load', onLoad, { once: true });
        image.addEventListener('error', onError, { once: true });
        signal?.addEventListener('abort', onAbort, {once: true});
    });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const source = new Image();
        source.onload = () => resolve(source);
        source.onerror = () => reject(new Error('图片数据无法解码'));
        source.src = dataUrl;
    });
}

interface RenderedImageRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

function getRenderedImageRect(image: HTMLImageElement, renderedWidth: number, renderedHeight: number): RenderedImageRect {
    const imageWidth = image.naturalWidth;
    const imageHeight = image.naturalHeight;
    const style = getComputedStyle(image);
    const objectFit = style.objectFit || 'fill';
    let width = renderedWidth;
    let height = renderedHeight;

    if (objectFit === 'contain' || objectFit === 'scale-down') {
        const scale = Math.min(renderedWidth / imageWidth, renderedHeight / imageHeight);
        const downScale = objectFit === 'scale-down' ? Math.min(1, scale) : scale;
        width = imageWidth * downScale;
        height = imageHeight * downScale;
    } else if (objectFit === 'cover') {
        const scale = Math.max(renderedWidth / imageWidth, renderedHeight / imageHeight);
        width = imageWidth * scale;
        height = imageHeight * scale;
    }

    const [positionX = '50%', positionY = '50%'] = style.objectPosition.split(/\s+/);
    const resolvePosition = (value: string, available: number): number => {
        if (value.endsWith('%')) return available * Number.parseFloat(value) / 100;
        if (value.endsWith('px')) return Number.parseFloat(value);
        if (value === 'left' || value === 'top') return 0;
        if (value === 'right' || value === 'bottom') return available;
        return available / 2;
    };
    return {
        left: resolvePosition(positionX, renderedWidth - width),
        top: resolvePosition(positionY, renderedHeight - height),
        width,
        height,
    };
}

function renderTranslatedBitmap(state: ImageTranslationState, renderedWidth: number, renderedHeight: number): void {
    if (!state.image.naturalWidth || !state.image.naturalHeight || !state.translatedImage) return;

    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    state.canvas.style.display = 'block';
    state.canvas.width = Math.max(1, Math.round(renderedWidth * pixelRatio));
    state.canvas.height = Math.max(1, Math.round(renderedHeight * pixelRatio));
    state.canvas.style.width = `${renderedWidth}px`;
    state.canvas.style.height = `${renderedHeight}px`;
    const context = state.canvas.getContext('2d');
    if (!context) return;
    const imageRect = getRenderedImageRect(state.image, renderedWidth, renderedHeight);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, renderedWidth, renderedHeight);
    context.drawImage(state.translatedImage, imageRect.left, imageRect.top, imageRect.width, imageRect.height);
}

function setButtonState(state: ImageTranslationState, phase: ImageTranslationPhase, message: string): void {
    const userMessage = message;
    state.phase = phase;
    state.button.textContent = phase === 'translated' ? '↶' : phase === 'error' ? '!' : '文';
    state.button.title = userMessage;
    state.button.setAttribute('aria-label', userMessage);
    state.button.dataset.phase = phase;
}

function restoreImageTranslation(state: ImageTranslationState): void {
    clearErrorResetTimer(state);
    state.abortController?.abort();
    state.abortController = null;
    state.lines = [];
    state.translatedImage = null;
    state.canvas.width = 0;
    state.canvas.height = 0;
    state.canvas.style.display = 'none';
    setButtonState(state, 'idle', '翻译图片');
    updateOverlayPosition(state);
    scheduleIdleStateRemoval(state);
}

async function translateImage(state: ImageTranslationState): Promise<void> {
    if (state.phase === 'loading') return;
    if (!state.image.isConnected) return;

    clearErrorResetTimer(state);
    const controller = new AbortController();
    state.abortController = controller;
    setButtonState(state, 'loading', '正在识别图片文字');
    try {
        await withTimeout(
            waitForImageReady(state.image, controller.signal),
            IMAGE_READ_TIMEOUT_MS,
            '图片加载超时',
            controller.signal,
        );
        const imageData = await withTimeout(
            getImageData(state.image, {signal: controller.signal, timeoutMs: IMAGE_READ_TIMEOUT_MS}),
            IMAGE_READ_TIMEOUT_MS,
            '图片读取超时',
            controller.signal,
        );
        if (controller.signal.aborted) return;
        const result = await translateImageInExtension(imageData, config.from, document.title, {
            signal: controller.signal,
            timeoutMs: IMAGE_OCR_TIMEOUT_MS + IMAGE_TRANSLATION_TIMEOUT_MS,
        });
        if (controller.signal.aborted) return;
        const translatedImage = await loadImage(result.image);
        if (controller.signal.aborted || state.abortController !== controller) return;
        state.translatedImage = translatedImage;
        state.lines = result.lines;
        setButtonState(state, 'translated', '恢复原图');
        updateOverlayPosition(state);
    } catch (error) {
        if (controller.signal.aborted) return;
        controller.abort();
        const message = error instanceof Error ? error.message : String(error);
        setButtonState(state, 'error', `图片翻译失败：${message}`);
        clearErrorResetTimer(state);
        const errorResetTimer = window.setTimeout(() => {
            if (state.errorResetTimer !== errorResetTimer) return;
            state.errorResetTimer = null;
            if (state.phase === 'error' && states.get(state.image) === state) {
                setButtonState(state, 'idle', '翻译图片');
                scheduleIdleStateRemoval(state);
            }
        }, 3000);
        state.errorResetTimer = errorResetTimer;
        console.warn('[FluentRead] 图片翻译失败:', error);
    } finally {
        if (state.abortController === controller) state.abortController = null;
    }
}

function handlePointerOver(event: PointerEvent): void {
    if (!event.isTrusted) return;
    if (event.pointerType === 'touch') return;
    const image = event.target instanceof HTMLImageElement ? event.target : null;
    if (image) showImageButton(image);
}

function handlePointerOut(event: PointerEvent): void {
    if (!event.isTrusted) return;
    const image = event.target instanceof HTMLImageElement ? event.target : null;
    if (image && event.relatedTarget instanceof Node && image.contains(event.relatedTarget)) return;
    if (image) hideImageButton(image);
}

function scheduleViewportChange(): void {
    if (positionFrame !== null) return;
    positionFrame = window.requestAnimationFrame(() => {
        positionFrame = null;
        activeStates.forEach(updateOverlayPosition);
    });
}

export function mountImageTranslator(): void {
    if (mounted) return;
    mounted = true;
    document.addEventListener('pointerover', handlePointerOver, true);
    document.addEventListener('pointerout', handlePointerOut, true);
    window.addEventListener('scroll', scheduleViewportChange, true);
    window.addEventListener('resize', scheduleViewportChange);
    layoutObserver = new MutationObserver(scheduleViewportChange);
    layoutObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'style'],
        childList: true,
        subtree: true,
    });
    removeListeners = () => {
        document.removeEventListener('pointerover', handlePointerOver, true);
        document.removeEventListener('pointerout', handlePointerOut, true);
        window.removeEventListener('scroll', scheduleViewportChange, true);
        window.removeEventListener('resize', scheduleViewportChange);
        layoutObserver?.disconnect();
        layoutObserver = null;
        if (positionFrame !== null) {
            window.cancelAnimationFrame(positionFrame);
            positionFrame = null;
        }
    };
}

export function unmountImageTranslator(): void {
    if (!mounted) return;
    mounted = false;
    removeListeners?.();
    removeListeners = null;
    Array.from(activeStates).forEach(removeState);
    removeImageOverlayRoot();
}

/**
 * @file src/features/video-subtitle/content/ui.ts
 *
 * 文件职责：封装视频字幕 content UI 的界面语言转换与可访问名称刷新，避免 YouTube 播放器运行时承载重复的文案拼装。
 * 主要内容：提供视频菜单文本节点创建、旧文案本地化、按钮/菜单/字幕面板 aria 文案同步和语言值归一化。
 * 模块边界：本文件只处理已由视频 feature 拥有的 DOM 与文本，不读取配置、不发起请求、不控制字幕翻译生命周期。
 */

import {
    normalizeUiLanguage,
    translate,
    translateLegacyText,
    type TranslationParams,
    type UiLanguage,
} from '@/src/core/i18n';

export type {UiLanguage} from '@/src/core/i18n';

export function getVideoUiLanguage(value: unknown): UiLanguage {
    return normalizeUiLanguage(value);
}

export function translateVideoUi(
    key: string,
    language: UiLanguage,
    params?: TranslationParams,
): string {
    return translate(key, language, params);
}

export function localizeVideoUiText(source: string, language: UiLanguage): string {
    return translateLegacyText(source, language);
}

export function createVideoUiTextElement<K extends keyof HTMLElementTagNameMap>(
    tagName: K,
    className: string,
    source: string,
    language: UiLanguage,
): HTMLElementTagNameMap[K] {
    const element = document.createElement(tagName);
    element.className = className;
    element.textContent = localizeVideoUiText(source, language);
    element.dataset.i18nSource = source;
    return element;
}

export function refreshVideoUiText(root: HTMLElement, language: UiLanguage): void {
    root.querySelectorAll<HTMLElement>('[data-i18n-source]').forEach((element) => {
        const source = element.dataset.i18nSource;
        if (source !== undefined) element.textContent = localizeVideoUiText(source, language);
    });
}

export function refreshVideoUiAccessibility(
    menu: HTMLElement,
    button: HTMLElement,
    document: Document,
    language: UiLanguage,
    status: string,
): void {
    menu.setAttribute('aria-label', translateVideoUi('video.menuAriaLabel', language));
    menu.querySelector<HTMLElement>('[role="radiogroup"]')?.setAttribute('aria-label', translateVideoUi('video.displayMode', language));
    const buttonLabel = translateVideoUi('video.buttonAriaLabel', language, {status});
    button.setAttribute('aria-label', buttonLabel);
    button.title = buttonLabel;
    document.getElementById('fluent-read-video-subtitle-panel')?.setAttribute('aria-label', translateVideoUi('video.panelAriaLabel', language));
    document.getElementById('fluent-read-video-subtitle')?.setAttribute('aria-label', translateVideoUi('video.translationOverlayAriaLabel', language));
    document.getElementById('fluent-read-video-subtitle-original')?.setAttribute('aria-label', translateVideoUi('video.originalOverlayAriaLabel', language));
}

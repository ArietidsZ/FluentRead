/**
 * @file src/features/video-subtitle/content/playerMenu.ts
 * 文件职责：组装播放器字幕菜单，将常用显示控制、本地生成和下载操作分组呈现。
 * 主要内容：创建带可访问名称的按钮、开关和分段选择器；渲染 AI 生成的空闲、处理中、完成及错误状态。
 * 模块边界：只操作 FluentRead 自己的菜单节点，不读取存储、不发起识别或绑定全局事件；运行时负责配置、请求与清理。
 */
import type {VideoSubtitleDisplayMode} from '@/src/core/config/model';
import {
    createTextElement, createVideoUiTextElement, markVideoUi, translateVideoUi,
    VIDEO_DISPLAY_MODE_LABELS, VIDEO_TRANSLATION_MENU_ID, type UiLanguage,
} from './ui';
import type {VideoAiFullCapturePhase, VideoAiFullCaptureProgress} from './video-ai/fullCapture';

function createItem(action: string, label: string, language: UiLanguage): HTMLButtonElement {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'fluent-read-video-menu-item';
    item.dataset.action = action;
    item.setAttribute('role', ['toggle-translation', 'toggle-visible', 'toggle-ai-subtitle'].includes(action) ? 'menuitemcheckbox' : 'menuitem');
    const check = createTextElement('span', 'fluent-read-video-menu-check', '');
    check.dataset.check = 'true';
    check.setAttribute('aria-hidden', 'true');
    const state = createTextElement('span', 'fluent-read-video-menu-value', '');
    state.dataset.state = 'true';
    item.append(createVideoUiTextElement('span', 'fluent-read-video-menu-label', label, language), state, check);
    return item;
}

/** 菜单始终由同一组节点更新，避免进度变化时丢失焦点与键盘状态。 */
export function createVideoPlayerMenu(language: UiLanguage, withLocalGeneration: boolean): HTMLElement {
    const menu = document.createElement('div');
    menu.id = VIDEO_TRANSLATION_MENU_ID;
    menu.className = 'fluent-read-video-subtitle-menu fluent-read-video-ui notranslate';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', translateVideoUi('video.menuAriaLabel', language));
    markVideoUi(menu);

    const title = createTextElement('div', 'fluent-read-video-menu-title', '');
    title.appendChild(createVideoUiTextElement('span', 'fluent-read-video-menu-brand', '流畅阅读', language));
    const settings = createItem('open-settings', '打开视频翻译设置', language);
    settings.classList.add('fluent-read-video-menu-settings');
    const service = createTextElement('span', 'fluent-read-video-menu-service', '');
    service.dataset.serviceLabel = 'true';
    const gear = createTextElement('span', 'fluent-read-video-menu-gear', '⚙');
    gear.setAttribute('aria-hidden', 'true');
    settings.append(service, gear);
    title.appendChild(settings);
    menu.appendChild(title);

    const translation = createItem('toggle-translation', '字幕翻译', language);
    translation.classList.add('fluent-read-video-menu-primary-action', 'fluent-read-video-menu-switch');
    const visibility = createItem('toggle-visible', '显示字幕', language);
    visibility.classList.add('fluent-read-video-menu-switch');
    menu.append(translation, visibility);
    const modeGroup = createTextElement('div', 'fluent-read-video-menu-mode-group', '');
    modeGroup.setAttribute('role', 'radiogroup');
    modeGroup.setAttribute('aria-label', translateVideoUi('video.displayMode', language));
    (Object.keys(VIDEO_DISPLAY_MODE_LABELS) as VideoSubtitleDisplayMode[]).forEach((mode) => {
        const item = createVideoUiTextElement('button', 'fluent-read-video-menu-mode', VIDEO_DISPLAY_MODE_LABELS[mode], language);
        item.type = 'button';
        item.dataset.mode = mode;
        item.setAttribute('role', 'menuitemradio');
        modeGroup.appendChild(item);
    });
    menu.appendChild(modeGroup);

    if (withLocalGeneration) {
        const group = createTextElement('div', 'fluent-read-video-menu-ai-group', '');
        const generate = createItem('toggle-ai-subtitle', '生成 AI 字幕', language);
        generate.querySelector('[data-check]')!.remove();
        generate.setAttribute('aria-live', 'polite');
        group.appendChild(generate);
        menu.appendChild(group);
    }

    const downloads = createTextElement('div', 'fluent-read-video-menu-downloads', '');
    for (const [action, label] of [['download-subtitles', '下载原文字幕'], ['download-translated-subtitles', '下载译文字幕']]) {
        const item = createItem(action, label, language);
        item.querySelector('[data-check]')!.remove();
        item.setAttribute('aria-live', 'polite');
        item.setAttribute('aria-atomic', 'true');
        downloads.appendChild(item);
    }
    menu.appendChild(downloads);
    return menu;
}

export interface VideoAiMenuState {
    available: boolean;
    checking: boolean;
    active: boolean;
    running: boolean;
    requested: boolean;
    fullActive: boolean;
    phase: VideoAiFullCapturePhase;
    progress: VideoAiFullCaptureProgress;
    error: string;
}

export function renderVideoAiMenu(menu: HTMLElement, state: VideoAiMenuState, language: UiLanguage): void {
    const button = menu.querySelector<HTMLButtonElement>('[data-action="toggle-ai-subtitle"]');
    if (!button) return;
    const ready = state.fullActive && state.phase === 'ready';
    const processing = state.active && !ready;
    const label = !state.available
        ? translateVideoUi('video.aiUnavailable', language)
        : state.checking
            ? translateVideoUi('video.aiCheckingModel', language)
            : ready
                ? translateVideoUi('video.aiDisable', language)
                : processing
                    ? translateVideoUi('video.aiStop', language)
                    : state.error
                        ? translateVideoUi('video.aiRetry', language)
                        : translateVideoUi('video.aiGenerate', language);
    let detail = '';
    if (state.fullActive) {
        if (state.phase === 'capturing') detail = translateVideoUi('video.aiReadingAudio', language);
        else if (state.phase === 'transcribing') detail = translateVideoUi('video.aiTranscribing', language, {percent: Math.round(state.progress.progress * 100)});
        else if (state.phase === 'translating') detail = translateVideoUi('video.aiTranslating', language, {percent: Math.round(state.progress.progress * 100)});
        else if (ready) detail = translateVideoUi('video.aiReady', language);
        else detail = translateVideoUi('video.aiPreparing', language);
    } else if (state.running) detail = translateVideoUi('video.aiGenerating', language);
    else if (state.requested) detail = translateVideoUi('video.aiWaitingForPlayback', language);
    else if (state.error) detail = state.error;
    button.disabled = !state.available || state.checking;
    button.setAttribute('aria-checked', String(state.active));
    button.dataset.processing = String(processing || state.checking);
    button.dataset.error = String(Boolean(state.error));
    const labelElement = button.querySelector<HTMLElement>('.fluent-read-video-menu-label')!;
    labelElement.removeAttribute('data-i18n-source');
    labelElement.textContent = label;
    button.querySelector<HTMLElement>('[data-state]')!.textContent = detail;
    button.title = state.error;
}

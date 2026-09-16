/**
 * @file src/features/video-subtitle/content/playerMenu.ts
 * 文件职责：组装播放器字幕菜单，以紧凑行呈现显示方式、字幕时间、本地 AI 字幕与下载操作，并在同一弹层内提供模型下载确认。
 * 主要内容：创建带可访问名称的四段显示方式、单行校时步进器、单行 AI 状态与进度、下载按钮和模型选择卡片；按播放器尺寸在单列与矮行布局间切换。
 * 模块边界：只操作 FluentRead 自己的菜单节点，不读取存储、不发起识别或绑定全局事件；运行时负责配置、请求与清理。
 */
import type {VideoSubtitleDisplayMode} from '@/src/core/config/model';
import {
    createTextElement, markVideoUi, translateVideoUi, localizeVideoUiText,
    VIDEO_TRANSLATION_MENU_ID, type UiLanguage,
} from './ui';
import type {VideoAiFullCapturePhase, VideoAiFullCaptureProgress} from './video-ai/fullCapture';
import type {VideoLocalTranscriptionModel} from '@/src/features/video-subtitle/transcription';

/** 菜单里的“关闭”与三种显示方式同属一个选择：用户只需回答“现在看哪种字幕”。 */
export type VideoMenuMode = VideoSubtitleDisplayMode | 'off';
export const VIDEO_MENU_MODES: readonly VideoMenuMode[] = ['bilingual', 'translation-only', 'original-only', 'off'];
const VIDEO_MENU_MODE_KEYS: Record<VideoMenuMode, string> = {
    bilingual: 'video.modeBilingual',
    'translation-only': 'video.modeTranslation',
    'original-only': 'video.modeOriginal',
    off: 'video.modeOff',
};

/** 菜单底边与播放器底边的距离，需与样式中的 bottom 保持一致。 */
const MENU_BOTTOM_OFFSET_PX = 40;
const MENU_TOP_GAP_PX = 8;
/** 矮行布局至少需要这么宽；更窄时各组会自动换行，仍比单列矮。 */
const WIDE_LAYOUT_MIN_PLAYER_WIDTH_PX = 300;
/** 单列菜单高度超过播放器可用高度的这一比例时，改用更矮的双列，留出画面上半部分。 */
const STACK_LAYOUT_MAX_HEIGHT_RATIO = .8;

type IconName = 'settings' | 'minus' | 'plus' | 'reset' | 'sparkle' | 'download' | 'close';
const ICON_PATHS: Record<IconName, string[]> = {
    settings: ['M4 7h9', 'M17 7h3', 'M4 17h3', 'M11 17h9', 'M15 5v4', 'M9 15v4'],
    minus: ['M6 12h12'],
    plus: ['M12 6v12', 'M6 12h12'],
    reset: ['M4 12a8 8 0 1 0 2.4-5.7', 'M4 4.5V9h4.5'],
    sparkle: ['M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9-1.9 5.1-1.9-5.1L5 10.5l5.1-1.9z', 'M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z'],
    download: ['M12 4v10.5', 'M7.5 10.5 12 15l4.5-4.5', 'M5 19.5h14'],
    close: ['M7 7l10 10', 'M17 7 7 17'],
};

// YouTube 启用 Trusted Types，图标只能逐个创建节点，不能写入 innerHTML。
function createIcon(name: IconName): SVGSVGElement {
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(namespace, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', `fluent-read-video-menu-icon fluent-read-video-menu-icon-${name}`);
    for (const d of ICON_PATHS[name]) {
        const path = document.createElementNS(namespace, 'path');
        path.setAttribute('d', d);
        svg.appendChild(path);
    }
    return svg;
}

/** 带 data-i18n-key 的节点会在界面语言变化时由 refreshVideoUiText 重新填充。 */
function keyedText<K extends keyof HTMLElementTagNameMap>(
    tagName: K, className: string, key: string, language: UiLanguage, params?: Record<string, string | number>,
): HTMLElementTagNameMap[K] {
    const element = document.createElement(tagName);
    element.className = className;
    element.dataset.i18nKey = key;
    if (params) element.dataset.i18nParams = JSON.stringify(params);
    element.textContent = translateVideoUi(key, language, params);
    return element;
}

function createButton(className: string, attributes: Record<string, string>): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    for (const [name, value] of Object.entries(attributes)) button.setAttribute(name, value);
    return button;
}

function setAccessibleName(element: HTMLElement, label: string): void {
    element.setAttribute('aria-label', label);
    element.title = label;
}

function createHeader(language: UiLanguage): HTMLElement {
    const title = createTextElement('div', 'fluent-read-video-menu-title', '');
    title.appendChild(createTextElement('span', 'fluent-read-video-menu-brand', localizeVideoUiText('流畅阅读', language)));
    const settings = createButton('fluent-read-video-menu-item fluent-read-video-menu-settings', {
        'data-action': 'open-settings', role: 'menuitem',
    });
    settings.dataset.i18nAriaKey = 'video.openSettings';
    setAccessibleName(settings, translateVideoUi('video.openSettings', language));
    const service = createTextElement('span', 'fluent-read-video-menu-service', '');
    service.dataset.serviceLabel = 'true';
    settings.append(service, createIcon('settings'));
    title.appendChild(settings);
    return title;
}

function createModeGroup(language: UiLanguage): HTMLElement {
    const group = createTextElement('div', 'fluent-read-video-menu-mode-group', '');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', translateVideoUi('video.displayMode', language));
    for (const mode of VIDEO_MENU_MODES) {
        const item = keyedText('button', 'fluent-read-video-menu-mode', VIDEO_MENU_MODE_KEYS[mode], language);
        item.type = 'button';
        item.dataset.mode = mode;
        item.setAttribute('role', 'menuitemradio');
        item.setAttribute('aria-checked', 'false');
        if (mode === 'off') {
            item.dataset.i18nTitleKey = 'video.modeOffHint';
            item.title = translateVideoUi('video.modeOffHint', language);
        }
        group.appendChild(item);
    }
    return group;
}

function createTimingRow(language: UiLanguage): HTMLElement {
    const timing = createTextElement('div', 'fluent-read-video-menu-row fluent-read-video-menu-timing', '');
    timing.dataset.timingRow = 'true';
    timing.appendChild(keyedText('span', 'fluent-read-video-menu-row-label', 'video.timingShort', language));
    const controls = createTextElement('div', 'fluent-read-video-menu-timing-controls', '');
    const stepper = (action: string, icon: IconName) => {
        const button = createButton('fluent-read-video-menu-step', {'data-action': action, role: 'menuitem'});
        button.appendChild(createIcon(icon));
        return button;
    };
    const value = createTextElement('output', 'fluent-read-video-menu-timing-value', '0.0 s');
    value.dataset.subtitleOffset = 'true';
    value.setAttribute('aria-live', 'polite');
    const reset = stepper('reset-subtitle-timing', 'reset');
    reset.classList.add('fluent-read-video-menu-step-reset');
    // 重置按钮只在有偏移时出现，放在最左侧，出现或消失时不移动连续点击中的步进按钮。
    controls.append(reset, stepper('subtitle-earlier', 'minus'), value, stepper('subtitle-later', 'plus'));
    timing.appendChild(controls);
    return timing;
}

function createAiGroup(language: UiLanguage): HTMLElement {
    const group = createTextElement('div', 'fluent-read-video-menu-ai-group', '');
    const button = createButton('fluent-read-video-menu-item fluent-read-video-menu-ai', {
        'data-action': 'toggle-ai-subtitle', role: 'menuitemcheckbox', 'aria-checked': 'false', 'aria-live': 'polite',
    });
    const label = keyedText('span', 'fluent-read-video-menu-label', 'video.aiGenerate', language);
    const state = createTextElement('span', 'fluent-read-video-menu-value', '');
    state.dataset.state = 'true';
    const progress = createTextElement('span', 'fluent-read-video-menu-progress', '');
    progress.setAttribute('aria-hidden', 'true');
    button.append(createIcon('sparkle'), label, state, progress);
    group.appendChild(button);
    return group;
}

function createDownloadActions(language: UiLanguage): HTMLElement {
    const actions = createTextElement('div', 'fluent-read-video-menu-downloads', '');
    for (const [action, key, ariaKey] of [
        ['download-subtitles', 'video.downloadOriginalShort', 'video.downloadOriginal'],
        ['download-translated-subtitles', 'video.downloadTranslatedShort', 'video.downloadTranslated'],
    ]) {
        const button = createButton('fluent-read-video-menu-item fluent-read-video-menu-download', {'data-action': action, role: 'menuitem'});
        button.dataset.i18nAriaKey = ariaKey;
        setAccessibleName(button, translateVideoUi(ariaKey, language));
        button.append(createIcon('download'), keyedText('span', 'fluent-read-video-menu-label', key, language));
        actions.appendChild(button);
    }
    return actions;
}

function createDownloadStatus(): HTMLElement {
    const status = createTextElement('p', 'fluent-read-video-menu-download-status', '');
    status.dataset.downloadStatus = 'true';
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    return status;
}

/** 菜单始终由同一组节点更新，避免进度变化时丢失焦点与键盘状态。 */
export function createVideoPlayerMenu(language: UiLanguage, withLocalGeneration: boolean): HTMLElement {
    const menu = document.createElement('div');
    menu.id = VIDEO_TRANSLATION_MENU_ID;
    menu.className = 'fluent-read-video-subtitle-menu fluent-read-video-ui notranslate';
    menu.hidden = true;
    menu.dataset.layout = 'stack';
    menu.dataset.view = 'main';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', translateVideoUi('video.menuAriaLabel', language));
    markVideoUi(menu);

    // 显示设置与操作各成一组：单列时逐行排列，矮播放器的双列布局中每组压成一行。
    const display = createTextElement('div', 'fluent-read-video-menu-section fluent-read-video-menu-display', '');
    display.append(createModeGroup(language), createTimingRow(language));
    const actions = createTextElement('div', 'fluent-read-video-menu-section fluent-read-video-menu-actions', '');
    if (withLocalGeneration) actions.appendChild(createAiGroup(language));
    actions.append(createDownloadActions(language), createDownloadStatus());
    const main = createTextElement('div', 'fluent-read-video-menu-main', '');
    main.append(createHeader(language), display, actions);
    menu.appendChild(main);
    if (withLocalGeneration) menu.appendChild(createModelPrompt(language));
    return menu;
}

/** “关闭”由总开关或隐藏字幕决定；三种显示方式只在字幕实际可见时高亮。 */
export function renderVideoMenuMode(menu: HTMLElement, selected: VideoMenuMode, disabled: boolean, disabledReason: string): void {
    menu.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((item) => {
        item.setAttribute('aria-checked', String(item.dataset.mode === selected));
        item.disabled = disabled;
    });
    const group = menu.querySelector<HTMLElement>('.fluent-read-video-menu-mode-group');
    if (group) group.title = disabled ? disabledReason : '';
}

/** 持久配置更新时复用按钮；无时间轴且无偏移时整行收起，仍允许清除已有偏移。 */
export function renderVideoSubtitleTiming(menu: HTMLElement, offsetMs: number, available: boolean, language: UiLanguage): void {
    const row = menu.querySelector<HTMLElement>('[data-timing-row]')!;
    row.hidden = !available && offsetMs === 0;
    row.title = available ? '' : localizeVideoUiText('当前字幕暂不支持时间调整', language);
    const value = menu.querySelector<HTMLOutputElement>('[data-subtitle-offset]')!;
    value.textContent = `${offsetMs > 0 ? '+' : ''}${(offsetMs / 1000).toFixed(1)} s`;
    value.setAttribute('aria-label', localizeVideoUiText('字幕时间偏移', language));
    const earlier = menu.querySelector<HTMLButtonElement>('[data-action="subtitle-earlier"]')!;
    const later = menu.querySelector<HTMLButtonElement>('[data-action="subtitle-later"]')!;
    const reset = menu.querySelector<HTMLButtonElement>('[data-action="reset-subtitle-timing"]')!;
    earlier.disabled = !available || offsetMs <= -10_000;
    later.disabled = !available || offsetMs >= 10_000;
    reset.disabled = offsetMs === 0;
    setAccessibleName(earlier, localizeVideoUiText('提前 0.5 秒', language));
    setAccessibleName(later, localizeVideoUiText('延后 0.5 秒', language));
    setAccessibleName(reset, localizeVideoUiText('重置字幕时间', language));
}

export interface VideoAiMenuState {
    available: boolean;
    checking: boolean;
    downloading?: boolean;
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
    const downloading = state.downloading === true;
    const processing = state.active && !ready;
    const labelKey = !state.available ? 'video.aiUnavailable'
        : downloading ? 'video.aiDownloadingModel'
            : state.checking ? 'video.aiCheckingModel'
                : ready ? 'video.aiDisable'
                    : processing ? 'video.aiStop'
                        : state.error ? 'video.aiRetry'
                            : 'video.aiGenerate';
    let detail = '';
    let percent: number | undefined;
    if (state.fullActive) {
        if (state.phase === 'capturing') detail = translateVideoUi('video.aiReadingAudio', language);
        else if (state.phase === 'transcribing' || state.phase === 'translating') {
            percent = Math.round(state.progress.progress * 100);
            detail = translateVideoUi(state.phase === 'transcribing' ? 'video.aiTranscribing' : 'video.aiTranslating', language, {percent});
        } else if (ready) detail = translateVideoUi('video.aiReady', language);
        else detail = translateVideoUi('video.aiPreparing', language);
    } else if (state.running) detail = translateVideoUi('video.aiGenerating', language);
    else if (state.requested) detail = translateVideoUi('video.aiWaitingForPlayback', language);
    else if (state.error && !downloading) detail = state.error;
    button.disabled = !state.available || state.checking || downloading;
    button.setAttribute('aria-checked', String(state.active));
    button.dataset.processing = String(processing || state.checking || downloading);
    button.dataset.error = String(Boolean(state.error) && !downloading);
    button.dataset.ready = String(ready);
    // 确定进度显示为进度条；读取音频、下载模型等无法估算的阶段使用循环动画。
    button.dataset.progress = percent === undefined ? (processing || downloading ? 'indeterminate' : 'none') : 'determinate';
    button.style.setProperty('--fluent-read-video-ai-progress', `${percent ?? 0}%`);
    const labelElement = button.querySelector<HTMLElement>('.fluent-read-video-menu-label')!;
    labelElement.dataset.i18nKey = labelKey;
    labelElement.textContent = translateVideoUi(labelKey, language);
    button.querySelector<HTMLElement>('[data-state]')!.textContent = detail;
    button.title = state.error && !downloading ? state.error : '';
}

const downloadStatusVersions = new WeakMap<HTMLElement, number>();

/**
 * 两个下载共用一行状态。每次写入都会作废之前安排的清理，避免较早完成的下载
 * 在延迟后清掉另一次下载刚写入的反馈。
 */
export function setVideoMenuDownloadStatus(menu: HTMLElement, text: string, clearAfterMs?: number): void {
    const version = (downloadStatusVersions.get(menu) ?? 0) + 1;
    downloadStatusVersions.set(menu, version);
    menu.querySelector<HTMLElement>('[data-download-status]')!.textContent = text;
    syncVideoPlayerMenuLayout(menu);
    if (clearAfterMs === undefined) return;
    setTimeout(() => {
        if (downloadStatusVersions.get(menu) === version) setVideoMenuDownloadStatus(menu, '');
    }, clearAfterMs);
}

export interface VideoModelPromptOption {
    readonly value: VideoLocalTranscriptionModel;
    readonly downloadSizeMb: number;
}

export interface VideoModelPromptState {
    readonly options: readonly VideoModelPromptOption[];
    readonly downloaded: readonly VideoLocalTranscriptionModel[];
    readonly recommended: VideoLocalTranscriptionModel;
    readonly selected: VideoLocalTranscriptionModel;
}

const MODEL_NAME_KEYS: Record<VideoLocalTranscriptionModel, [name: string, hint: string]> = {
    tiny: ['video.modelTinyName', 'video.modelTinyHint'],
    base: ['video.modelBaseName', 'video.modelBaseHint'],
};

function createModelPrompt(language: UiLanguage): HTMLElement {
    const prompt = createTextElement('section', 'fluent-read-video-model-prompt', '');
    prompt.dataset.modelPrompt = 'true';
    prompt.hidden = true;
    prompt.setAttribute('role', 'group');
    prompt.setAttribute('aria-labelledby', 'fluent-read-video-model-prompt-title');
    const head = createTextElement('div', 'fluent-read-video-model-prompt-head', '');
    const title = keyedText('span', 'fluent-read-video-model-prompt-title', 'video.modelPromptTitle', language);
    title.id = 'fluent-read-video-model-prompt-title';
    const close = createButton('fluent-read-video-menu-step', {'data-action': 'model-prompt-cancel', role: 'menuitem'});
    close.dataset.i18nAriaKey = 'video.modelPromptCancel';
    setAccessibleName(close, translateVideoUi('video.modelPromptCancel', language));
    close.appendChild(createIcon('close'));
    head.append(createIcon('sparkle'), title, close);
    const description = keyedText('p', 'fluent-read-video-model-prompt-description', 'video.modelPromptDescription', language);
    const options = createTextElement('div', 'fluent-read-video-model-options', '');
    options.dataset.modelOptions = 'true';
    options.setAttribute('role', 'radiogroup');
    options.setAttribute('aria-labelledby', 'fluent-read-video-model-prompt-title');
    const actions = createTextElement('div', 'fluent-read-video-model-prompt-actions', '');
    const cancel = keyedText('button', 'fluent-read-video-model-prompt-cancel', 'video.modelPromptCancel', language);
    cancel.type = 'button';
    cancel.dataset.action = 'model-prompt-cancel';
    cancel.setAttribute('role', 'menuitem');
    const confirm = keyedText('button', 'fluent-read-video-model-prompt-confirm', 'video.modelPromptDownload', language);
    confirm.type = 'button';
    confirm.dataset.action = 'model-prompt-confirm';
    confirm.setAttribute('role', 'menuitem');
    actions.append(cancel, confirm);
    prompt.append(head, description, options, actions);
    return prompt;
}

function renderModelOption(option: VideoModelPromptOption, state: VideoModelPromptState, language: UiLanguage): HTMLButtonElement {
    const button = createButton('fluent-read-video-model-option', {role: 'menuitemradio'});
    button.dataset.modelChoice = option.value;
    const [nameKey, hintKey] = MODEL_NAME_KEYS[option.value];
    const radio = createTextElement('span', 'fluent-read-video-model-option-radio', '');
    radio.setAttribute('aria-hidden', 'true');
    const name = createTextElement('span', 'fluent-read-video-model-option-name', '');
    name.appendChild(keyedText('span', '', nameKey, language));
    if (option.value === state.recommended) {
        name.appendChild(keyedText('span', 'fluent-read-video-model-option-badge', 'video.modelRecommended', language));
    }
    const downloaded = state.downloaded.includes(option.value);
    const size = downloaded
        ? keyedText('span', 'fluent-read-video-model-option-size is-downloaded', 'video.modelDownloaded', language)
        : keyedText('span', 'fluent-read-video-model-option-size', 'video.modelSize', language, {size: option.downloadSizeMb});
    button.append(radio, name, size, keyedText('span', 'fluent-read-video-model-option-hint', hintKey, language));
    return button;
}

/** 在同一弹层内切换到模型确认视图；传入 null 回到主菜单。 */
export function renderVideoModelPrompt(menu: HTMLElement, state: VideoModelPromptState | null, language: UiLanguage): void {
    const prompt = menu.querySelector<HTMLElement>('[data-model-prompt]');
    if (!prompt) return;
    const main = menu.querySelector<HTMLElement>('.fluent-read-video-menu-main')!;
    if (!state) {
        prompt.hidden = true;
        main.hidden = false;
        menu.dataset.view = 'main';
        return;
    }
    // 菜单状态每秒都会刷新；选项只在内容变化时重建，切换选择时原地更新，避免移除正在聚焦的按钮。
    const options = prompt.querySelector<HTMLElement>('[data-model-options]')!;
    const optionsKey = JSON.stringify([language, state.recommended, state.downloaded, state.options]);
    if (options.dataset.renderKey !== optionsKey) {
        options.dataset.renderKey = optionsKey;
        options.replaceChildren(...state.options.map(option => renderModelOption(option, state, language)));
    }
    options.querySelectorAll<HTMLElement>('[data-model-choice]').forEach((option) => {
        option.setAttribute('aria-checked', String(option.dataset.modelChoice === state.selected));
    });
    const confirm = prompt.querySelector<HTMLButtonElement>('[data-action="model-prompt-confirm"]')!;
    const confirmKey = state.downloaded.includes(state.selected) ? 'video.modelPromptStart' : 'video.modelPromptDownload';
    confirm.dataset.i18nKey = confirmKey;
    confirm.textContent = translateVideoUi(confirmKey, language);
    prompt.dataset.selectedModel = state.selected;
    main.hidden = true;
    prompt.hidden = false;
    menu.dataset.view = 'model-prompt';
}

export function readVideoModelPromptSelection(menu: HTMLElement): VideoLocalTranscriptionModel | null {
    const selected = menu.querySelector<HTMLElement>('[data-model-prompt]')?.dataset.selectedModel;
    return selected === 'tiny' || selected === 'base' ? selected : null;
}

export function isVideoModelPromptOpen(menu: HTMLElement): boolean {
    return menu.dataset.view === 'model-prompt';
}

/**
 * 菜单挂在播放器内，只能按播放器实际尺寸选择布局。矮而宽的播放器（手机横屏视频、
 * 小窗口）改为双列，避免单列菜单遮住整个画面还需要滚动；其余情况保持单列。
 */
export function syncVideoPlayerMenuLayout(menu: HTMLElement): void {
    const player = menu.parentElement;
    if (menu.hidden || !player) return;
    // 使用布局尺寸而非变换后的外接矩形，与菜单自身的 CSS 像素保持同一坐标系。
    const width = player.clientWidth;
    const height = player.clientHeight;
    if (!width || !height) return;
    // 下载反馈只短暂出现，不参与布局判断，避免文字出现和消失时菜单来回切换形状。
    menu.dataset.layout = 'stack';
    menu.dataset.measuring = 'true';
    const needed = menu.scrollHeight;
    delete menu.dataset.measuring;
    const available = height - MENU_BOTTOM_OFFSET_PX - MENU_TOP_GAP_PX;
    menu.dataset.layout = needed > available * STACK_LAYOUT_MAX_HEIGHT_RATIO && width >= WIDE_LAYOUT_MIN_PLAYER_WIDTH_PX ? 'wide' : 'stack';
}

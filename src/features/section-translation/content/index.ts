/**
 * @file src/features/section-translation/content/index.ts
 * 文件职责：把局部翻译接入网页运行时：监听可选的进入快捷键、为 Popup 等扩展消息提供进入选择模式的入口，并在用户点选区域后调用全文翻译引擎翻译或恢复该区域，用页内通知说明无法完成的情况。
 * 主要内容：导出 mountSectionTranslationContentFeature 与 startSectionTranslationPicker；记录最近指针位置以便快捷键进入时立即高亮，过滤输入场景、站点停用与总开关，组装选择模式的盘点、文案与退出快捷键，按区域结果给出“无可翻译文字/已是目标语言/部分失败”提示，并在 AbortSignal 结束时退出选择模式。
 * 模块边界：本模块只做入口编排与结果提示，不绘制高亮、不实现区域判定，也不直接操作译文 DOM；选择界面归 ./picker，区域翻译与恢复归全文翻译 feature 的公开接口，按键口径归 core/config/sectionTranslation。
 */
import {matchesSectionTranslationHotkey} from '@/src/core/config/sectionTranslation';
import {normalizeUiLanguage, translate} from '@/src/core/i18n';
import {
    inspectTranslationSection,
    toggleTranslationSection,
    type TranslationSectionResult,
} from '@/src/features/full-page-translation/public';
import {showPageNotice} from '@/src/features/page-notice/public';
import {config} from '@/src/services/config/store';
import {isEditingInPage} from '@/src/shared/dom/editingTarget';
import {isSectionPickerActive, startSectionPicker, stopSectionPicker, type SectionPickerPoint} from './picker';

export interface SectionTranslationContentOptions {
    isSiteDisabled: () => boolean;
}

/** 当前挂载实例的进入函数；未挂载（总开关关闭、站点停用或页面未激活）时为 null。 */
let activeStarter: (() => boolean) | null = null;

function text(key: string, params?: Readonly<Record<string, string | number>>): string {
    return translate(key, normalizeUiLanguage(config.uiLanguage), params);
}

/** 只在需要用户知道的情况下提示：翻译成功或恢复原文本身就在页面上可见，不再额外弹出通知。 */
function reportSectionResult(result: TranslationSectionResult): void {
    if (result.action === 'empty') {
        showPageNotice(text('sectionTranslation.notice.empty'), 'error');
    } else if (result.action === 'settled') {
        showPageNotice(text('sectionTranslation.notice.sameLanguage'), 'success');
    } else if (result.action === 'translated' && result.failed > 0) {
        showPageNotice(text('sectionTranslation.notice.failed', {count: result.failed}), 'error');
    } else if (result.action === 'translated' && result.translated === 0 && result.unchanged > 0) {
        showPageNotice(text('sectionTranslation.notice.sameLanguage'), 'success');
    }
}

async function translatePickedSection(element: Element): Promise<void> {
    reportSectionResult(await toggleTranslationSection(element));
}

/** 供 Popup 等扩展消息进入选择模式；返回 false 表示当前页面没有可用的局部翻译运行时。 */
export function startSectionTranslationPicker(): boolean {
    return activeStarter?.() === true;
}

/**
 * 挂载局部翻译入口。指针位置只做被动记录；快捷键默认关闭，开启后才会拦截对应组合键。
 * 选择模式是一次性的：点选、Esc、右键或页面隐藏都会退出，signal 结束时也会立即退出。
 */
export function mountSectionTranslationContentFeature(
    options: SectionTranslationContentOptions,
    signal: AbortSignal,
): void {
    let pointer: SectionPickerPoint | null = null;
    const matchesConfiguredHotkey = (event: KeyboardEvent): boolean => config.sectionTranslationHotkeyEnabled === true
        && matchesSectionTranslationHotkey(event, config.sectionTranslationHotkey, config.customSectionTranslationHotkey);

    const start = (): boolean => {
        if (signal.aborted || options.isSiteDisabled() || config.on !== true) return false;
        return startSectionPicker({
            initialPoint: pointer,
            inspect: (element) => inspectTranslationSection(element),
            onPick: (element) => void translatePickedSection(element),
            text,
            isExitHotkey: matchesConfiguredHotkey,
            isEditing: isEditingInPage,
        });
    };

    document.addEventListener('pointermove', (event) => {
        if (!event.isTrusted) return;
        pointer = {x: event.clientX, y: event.clientY};
    }, {capture: true, passive: true, signal});

    document.addEventListener('keydown', (event) => {
        if (!event.isTrusted) return;
        if (event.repeat || !matchesConfiguredHotkey(event) || isSectionPickerActive()) return;
        if (options.isSiteDisabled() || config.on !== true || isEditingInPage(event)) return;
        event.preventDefault();
        event.stopPropagation();
        start();
    }, {capture: true, signal});

    activeStarter = start;
    signal.addEventListener('abort', () => {
        if (activeStarter === start) activeStarter = null;
        stopSectionPicker();
    }, {once: true});
}

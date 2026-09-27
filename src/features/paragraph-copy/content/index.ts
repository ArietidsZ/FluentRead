/**
 * @file src/features/paragraph-copy/content/index.ts
 * 文件职责：在宿主页面监听段落复制快捷键，把鼠标当前所指的段落文字按配置口径写入剪贴板，并用页内通知说明复制结果。
 * 主要内容：记录最近一次指针位置，借助 shared/dom 过滤输入场景并检查站点停用状态，按候选或最近块级祖先定位段落，组合原文/译文/双语文本，先用 Clipboard API 再回退 execCommand，并在 AbortSignal 结束时移除监听。
 * 模块边界：本模块只处理手势、取词与剪贴板写入，不解析快捷键字符串、不发起翻译、不渲染设置界面；按键口径归 core/config/paragraphCopy，段落文本组合归 features/paragraph-copy/core，通知外观归 page-notice。
 */
import {config} from '@/src/services/config/store';
import {normalizeUiLanguage, translate} from '@/src/core/i18n';
import {
    matchesParagraphCopyHotkey,
    normalizeParagraphCopyContentMode,
} from '@/src/core/config/paragraphCopy';
import {resolveTranslationCandidateAtPoint} from '@/src/core/translation/public';
import {showPageNotice} from '@/src/features/page-notice/public';
import {isEditingInPage} from '@/src/shared/dom/editingTarget';
import {composeParagraphCopyText, findCopyableBlock, readParagraphTexts} from '../core';

export interface ParagraphCopyContentOptions {
    isSiteDisabled: () => boolean;
}

/** http 页面没有 Clipboard API，快捷键仍是可信手势，因此保留 execCommand 回退。 */
function copyWithExecCommand(text: string): boolean {
    if (typeof document.execCommand !== 'function') return false;
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('data-fluent-read-ui', 'paragraph-copy');
    textarea.setAttribute('aria-hidden', 'true');
    textarea.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(textarea);
    const selection = document.getSelection();
    const preserved = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    textarea.select();
    let copied = false;
    try {
        copied = document.execCommand('copy');
    } catch {
        copied = false;
    }
    textarea.remove();
    if (preserved && selection) {
        selection.removeAllRanges();
        selection.addRange(preserved);
    }
    return copied;
}

async function writeClipboardText(text: string): Promise<boolean> {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // 权限被拒或页面失焦时继续尝试同步回退。
    }
    return copyWithExecCommand(text);
}

function notice(key: string, tone: 'success' | 'error', params?: Record<string, string | number>): void {
    showPageNotice(translate(key, normalizeUiLanguage(config.uiLanguage), params), tone);
}

/**
 * 挂载段落复制手势。指针位置由 pointermove 记录，快捷键按下时才解析段落，
 * 因此不会在浏览过程中持续做 DOM 查询。
 */
export function mountParagraphCopyContentFeature(
    options: ParagraphCopyContentOptions,
    signal: AbortSignal,
): void {
    let pointerX = Number.NaN;
    let pointerY = Number.NaN;

    document.addEventListener('pointermove', (event) => {
        pointerX = event.clientX;
        pointerY = event.clientY;
    }, {capture: true, passive: true, signal});

    const resolveParagraph = (): Element | null => {
        const candidate = resolveTranslationCandidateAtPoint(pointerX, pointerY, config.translationScope);
        if (candidate) return candidate.element;
        return findCopyableBlock(document.elementFromPoint(pointerX, pointerY));
    };

    const copyParagraphAtPointer = async (): Promise<void> => {
        if (!Number.isFinite(pointerX) || !Number.isFinite(pointerY)) {
            notice('paragraphCopy.notice.noPointer', 'error');
            return;
        }
        const paragraph = resolveParagraph();
        const payload = paragraph
            ? composeParagraphCopyText(
                readParagraphTexts(paragraph),
                normalizeParagraphCopyContentMode(config.paragraphCopyContent),
                config.translationBeforeOriginal === true,
            )
            : null;
        if (!payload) {
            notice('paragraphCopy.notice.empty', 'error');
            return;
        }
        if (!await writeClipboardText(payload.text)) {
            notice('paragraphCopy.notice.failed', 'error');
            return;
        }
        const key = payload.missingTranslation
            ? 'paragraphCopy.notice.copiedWithoutTranslation'
            : `paragraphCopy.notice.copied${payload.kind.charAt(0).toUpperCase()}${payload.kind.slice(1)}`;
        notice(key, 'success', {count: payload.text.length});
    };

    document.addEventListener('keydown', (event) => {
        if (!event.isTrusted || event.repeat) return;
        if (options.isSiteDisabled() || config.on !== true || config.paragraphCopyEnabled !== true) return;
        if (!matchesParagraphCopyHotkey(event, config.paragraphCopyHotkey, config.customParagraphCopyHotkey)) return;
        if (isEditingInPage(event)) return;
        event.preventDefault();
        event.stopPropagation();
        void copyParagraphAtPointer();
    }, {capture: true, signal});
}

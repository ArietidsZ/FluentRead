/**
 * @file src/app/background/contextMenuUi.ts
 *
 * 文件职责：提供后台右键菜单所需的界面语言适配，隔离菜单标题资源与 browser.contextMenus 生命周期。
 * 主要内容：归一化共享配置中的界面语言，并根据当前页面是否已翻译或被禁用返回对应的本地化标题。
 * 模块边界：本文件只负责纯标题转换，不读取存储、不操作标签页，也不决定菜单是否创建；菜单生命周期由 contextMenuRuntime 负责。
 */

import {
    normalizeUiLanguage,
    translate,
    type UiLanguage,
} from '@/src/core/i18n';

export function resolveContextMenuLanguage(value: unknown): UiLanguage {
    return normalizeUiLanguage(value);
}

export function getContextMenuTitle(
    isTranslated: boolean,
    isSiteDisabled: boolean,
    language: UiLanguage,
): string {
    return translate(
        isSiteDisabled
            ? 'contextMenu.disabled'
            : isTranslated
                ? 'contextMenu.restore'
                : 'contextMenu.translate',
        language,
    );
}

/**
 * @file src/app/background/contextMenuUi.ts
 *
 * 文件职责：提供后台右键菜单所需的界面语言适配，隔离菜单标题资源与 browser.contextMenus 生命周期。
 * 主要内容：归一化共享配置中的界面语言，结合站点规则生成普通全文与全部节点菜单的本地化标题、固定 ID 和可用状态。
 * 模块边界：本文件只负责纯菜单展示转换，不读取存储、不操作标签页，也不决定菜单是否创建；菜单生命周期由 contextMenuRuntime 负责。
 */

import {CONTEXT_MENU_IDS} from '@/src/core/config/constants';
import {getFullPageContextMenuPresentation} from '@/src/features/site-rules/domain';
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
    allNodes = false,
): string {
    return translate(
        allNodes
            ? 'contextMenu.allNodes'
            : isSiteDisabled
                ? 'contextMenu.disabled'
                : isTranslated
                    ? 'contextMenu.restore'
                    : 'contextMenu.translate',
        language,
    );
}

/** 两种入口共享站点禁用策略；全部节点入口始终保持补扫含义。 */
export function getContextMenuItems(
    isTranslated: boolean,
    isSiteDisabled: boolean,
    language: UiLanguage,
) {
    return Object.values(CONTEXT_MENU_IDS).map((id) => {
        const allNodes = id === CONTEXT_MENU_IDS.TRANSLATE_ALL_NODES;
        return {
            id,
            ...getFullPageContextMenuPresentation(isTranslated, isSiteDisabled, allNodes),
            title: getContextMenuTitle(isTranslated, isSiteDisabled, language, allNodes),
        };
    });
}

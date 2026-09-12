/**
 * @file src/core/context-menu/presentation.ts
 * 文件职责：把右键菜单的状态描述渲染成用户读得懂的本地化标题，让每一项都说清“对什么做什么、译成哪种语言”。
 * 主要内容：按动作与状态挑选文案，截取目标语言的主名称，并按显示偏好依次追加目标语言、快捷键和一级直达项的品牌前缀。 可核对的公开符号包括 ContextMenuTitleContext、getContextMenuTargetLanguage、renderContextMenuTitle。
 * 模块边界：本文件只做纯文案拼装，不读取存储、不操作标签页，也不决定菜单是否创建；结构与可见性由 domain.ts 推导，菜单生命周期由 app/background 负责。
 */

import type {
    ContextMenuActionId,
    ContextMenuItemPresentation,
    ContextMenuTitleState,
} from './domain';
import {getMultilingualTargetLanguageLabel} from '@/src/core/config/catalog';
import {translate, type UiLanguage} from '@/src/core/i18n';

export interface ContextMenuTitleContext {
    readonly language: UiLanguage;
    /** 目标语言名，例如“简体中文”；为空时不展示语言。 */
    readonly targetLanguage: string;
    /** 全文翻译快捷键的显示名；为空时不展示快捷键。 */
    readonly shortcut: string;
}

const TRANSLATE_ACTION_KEYS: Readonly<Record<ContextMenuActionId, string>> = {
    translateSelection: 'contextMenu.translateSelection',
    translatePage: 'contextMenu.translatePage',
    translateArea: 'contextMenu.translateArea',
    translateImage: 'contextMenu.translateImage',
    toggleSite: 'contextMenu.disableSite',
};

const STATE_KEYS: Readonly<Record<Exclude<ContextMenuTitleState, 'group' | 'translate'>, string>> = {
    siteDisabled: 'contextMenu.groupDisabled',
    restore: 'contextMenu.restorePage',
    disableSite: 'contextMenu.disableSite',
    enableSite: 'contextMenu.enableSite',
};

/** 菜单宽度有限：只保留语言主名，去掉目录里用于辨认的其他语言别名。 */
export function getContextMenuTargetLanguage(value: unknown, language: UiLanguage): string {
    if (typeof value !== 'string' || !value.trim()) return '';
    return getMultilingualTargetLanguageLabel(value, value, language).split('/')[0].trim();
}

function baseTitle(presentation: ContextMenuItemPresentation, language: UiLanguage, targetLanguage: string): string {
    const {state, withTargetLanguage} = presentation.title;
    if (state === 'group') {
        return withTargetLanguage && targetLanguage
            ? translate('contextMenu.group', language, {language: targetLanguage})
            : translate('contextMenu.groupPlain', language);
    }
    if (state !== 'translate') return translate(STATE_KEYS[state], language);
    return translate(TRANSLATE_ACTION_KEYS[presentation.action ?? 'translatePage'], language);
}

/**
 * 渲染单个菜单项标题。
 *
 * 分组标题已写明译入语言，子项只保留动作与快捷键；一级直达项则补上品牌前缀，避免在长菜单里认不出是哪个扩展。
 */
export function renderContextMenuTitle(
    presentation: ContextMenuItemPresentation,
    context: ContextMenuTitleContext,
): string {
    const {language, targetLanguage, shortcut} = context;
    const {role, state, withTargetLanguage, withShortcut} = presentation.title;
    let title = baseTitle(presentation, language, targetLanguage);
    if (state !== 'group' && withTargetLanguage && targetLanguage) {
        title = translate('contextMenu.withLanguage', language, {title, language: targetLanguage});
    }
    if (withShortcut && shortcut) {
        title = translate('contextMenu.withShortcut', language, {title, shortcut});
    }
    return role === 'standalone' ? translate('contextMenu.standalone', language, {title}) : title;
}

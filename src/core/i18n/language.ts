/**
 * @file src/core/i18n/language.ts
 *
 * 文件职责：提供不依赖具体文案资源的界面语言领域规则。
 * 主要内容：声明默认语言、可选语言列表和存储值归一化，让配置模型可以复用语言
 * 契约而不把整套 UI 文案打进后台或纯配置 bundle。
 * 模块边界：这里只处理语言标识；资源查找和文本翻译由 i18n/index.ts 负责。
 */

import type {UiLanguage} from './types';

export type {UiLanguage} from './types';

export const DEFAULT_UI_LANGUAGE: UiLanguage = 'zh-CN';

export const UI_LANGUAGE_OPTIONS = [
    {value: 'zh-CN', labelKey: 'language.zhCN'},
    {value: 'en-US', labelKey: 'language.enUS'},
    {value: 'es-ES', labelKey: 'language.esES'},
] as const satisfies ReadonlyArray<{value: UiLanguage; labelKey: string}>;

export function normalizeUiLanguage(value: unknown): UiLanguage {
    if (value === 'en-US') return 'en-US';
    if (value === 'es-ES') return 'es-ES';
    return DEFAULT_UI_LANGUAGE;
}

/** 将浏览器 locale 映射到当前支持的界面语言；未支持的语言回退到中文。 */
export function resolveUiLanguageFromLocale(value: unknown): UiLanguage {
    if (typeof value !== 'string') return DEFAULT_UI_LANGUAGE;
    const locale = value.trim().toLowerCase().replace(/_/gu, '-');
    if (locale === 'en' || locale.startsWith('en-')) return 'en-US';
    if (locale === 'es' || locale.startsWith('es-')) return 'es-ES';
    if (locale === 'zh' || locale.startsWith('zh-')) return 'zh-CN';
    return DEFAULT_UI_LANGUAGE;
}

export function getUiLanguageLabel(language: UiLanguage): string {
    if (language === 'en-US') return 'English';
    if (language === 'es-ES') return 'Español';
    return '中文';
}

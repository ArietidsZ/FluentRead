/**
 * @file src/core/config/informationHighlight.ts
 * 文件职责：定义信息高亮的持久阅读偏好及安全归一化规则，供配置、页面绘制和设置界面共用。
 * 主要内容：保存当前页开关快捷键和是否在所有网页与文档中自动开启，区分轻量关键词与本地语言模型意外度，提供三档密度、六套柔和配色、三档颜色浓度及渐层、底色和细线绘制方式；缺失或非法导入回退到独立默认值，开关只接受明确的 true，快捷键规范化为稳定写法并可单独停用，空字符串表示没有设置组合键。
 * 模块边界：纯数据规则，不读取网页、不下载模型；页内会话由信息高亮 feature 管理。
 */
import {canonicalizeHotkey} from '@/src/core/hotkey';

export type InformationHighlightMode = 'keywords' | 'surprisal-local';
export type InformationHighlightDensity = 'low' | 'medium' | 'high';
export type InformationHighlightColor = 'rose' | 'amber' | 'mint' | 'blue' | 'violet' | 'slate';
export type InformationHighlightStyle = 'heatmap' | 'background' | 'underline';
export type InformationHighlightIntensity = 'soft' | 'standard' | 'strong';

export interface InformationHighlightPreferences {
    enabled: boolean;
    hotkey: string;
    hotkeyEnabled: boolean;
    mode: InformationHighlightMode;
    density: InformationHighlightDensity;
    color: InformationHighlightColor;
    style: InformationHighlightStyle;
    intensity: InformationHighlightIntensity;
}

export const DEFAULT_INFORMATION_HIGHLIGHT_PREFERENCES: Readonly<InformationHighlightPreferences> = Object.freeze({
    enabled: false, hotkey: 'Alt+H', hotkeyEnabled: true, mode: 'keywords', density: 'medium', color: 'rose', style: 'heatmap', intensity: 'standard',
});

const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T => allowed.includes(value as T) ? value as T : allowed[0];

export function normalizeInformationHighlightPreferences(value: unknown): InformationHighlightPreferences {
    const record = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
    const hotkey = record.hotkey;
    // 每个列表的首项是缺失或非法值的回退。
    return {
        enabled: record.enabled === true,
        hotkey: hotkey === '' ? '' : (typeof hotkey === 'string' && canonicalizeHotkey(hotkey)) || 'Alt+H',
        hotkeyEnabled: record.hotkeyEnabled !== false,
        mode: oneOf(record.mode, ['keywords', 'surprisal-local']),
        density: oneOf(record.density, ['medium', 'low', 'high']),
        color: oneOf(record.color, ['rose', 'amber', 'mint', 'blue', 'violet', 'slate']),
        style: oneOf(record.style, ['heatmap', 'background', 'underline']),
        intensity: oneOf(record.intensity, ['standard', 'soft', 'strong']),
    };
}

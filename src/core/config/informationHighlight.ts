/**
 * @file src/core/config/informationHighlight.ts
 * 文件职责：定义信息高亮的持久阅读偏好及安全归一化规则，供配置、页面绘制和设置界面共用。
 * 主要内容：区分轻量关键词与本地语言模型意外度，提供三档密度、柔和配色和两种原生绘制方式；缺失或非法导入回退到独立默认值。
 * 模块边界：纯数据规则，不读取网页、不下载模型、不存储当前标签页的开启状态；页内会话由信息高亮 feature 管理。
 */
export type InformationHighlightMode = 'keywords' | 'surprisal-local';
export type InformationHighlightDensity = 'low' | 'medium' | 'high';
export type InformationHighlightColor = 'amber' | 'mint' | 'blue';
export type InformationHighlightStyle = 'background' | 'underline';

export interface InformationHighlightPreferences {
    mode: InformationHighlightMode;
    density: InformationHighlightDensity;
    color: InformationHighlightColor;
    style: InformationHighlightStyle;
}

export const DEFAULT_INFORMATION_HIGHLIGHT_PREFERENCES: Readonly<InformationHighlightPreferences> = Object.freeze({
    mode: 'keywords', density: 'medium', color: 'amber', style: 'background',
});

export function normalizeInformationHighlightPreferences(value: unknown): InformationHighlightPreferences {
    const record = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
    return {
        mode: record.mode === 'surprisal-local' ? 'surprisal-local' : 'keywords',
        density: record.density === 'low' || record.density === 'high' ? record.density : 'medium',
        color: record.color === 'mint' || record.color === 'blue' ? record.color : 'amber',
        style: record.style === 'underline' ? 'underline' : 'background',
    };
}

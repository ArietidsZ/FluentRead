/**
 * @file src/core/config/sentenceHighlight.ts
 * 文件职责：定义双语逐句高亮的可选外观与旧配置回退规则。
 * 主要内容：提供柔和玫瑰、薄荷清风、晴空蓝和细线聚焦八种预设，统一设置页、配置迁移与网页高亮的样式标识。
 * 模块边界：仅提供纯数据和归一化，不读写配置、不访问 DOM；绘制声明由共享 CSS 维护。
 */
export const SENTENCE_HIGHLIGHT_STYLES = [
  {value: 'rose', label: '柔和玫瑰', labelKey: 'sentenceHighlight.rose'},
  {value: 'mint', label: '薄荷清风', labelKey: 'sentenceHighlight.mint'},
  {value: 'sky', label: '晴空蓝', labelKey: 'sentenceHighlight.sky'},
  {value: 'underline', label: '细线聚焦', labelKey: 'sentenceHighlight.underline'},
  {value: 'amber', label: '暖光琥珀', labelKey: 'sentenceHighlight.amber'},
  {value: 'lavender', label: '雾紫柔光', labelKey: 'sentenceHighlight.lavender'},
  {value: 'slate', label: '石墨轻衬', labelKey: 'sentenceHighlight.slate'},
  {value: 'dotted', label: '点线引导', labelKey: 'sentenceHighlight.dotted'},
] as const
export type SentenceHighlightStyle = typeof SENTENCE_HIGHLIGHT_STYLES[number]['value']
export const DEFAULT_SENTENCE_HIGHLIGHT_STYLE: SentenceHighlightStyle = 'rose'
export function normalizeSentenceHighlightStyle(value: unknown): SentenceHighlightStyle {
  return SENTENCE_HIGHLIGHT_STYLES.find(style => style.value === value)?.value ?? DEFAULT_SENTENCE_HIGHLIGHT_STYLE
}

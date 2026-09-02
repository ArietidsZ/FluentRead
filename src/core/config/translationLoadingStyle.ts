/**
 * @file src/core/config/translationLoadingStyle.ts
 * 文件职责：定义网页段落翻译加载指示器的可选视觉样式、默认值与配置归一化规则。
 * 主要内容：维护低干扰默认样式和多种趣味预设的稳定标识、用户可见说明，并拒绝存储或导入中的未知值。
 * 模块边界：本文件只描述纯配置与展示元数据，不创建 DOM、不运行动画，也不读写浏览器存储。
 */

export const translationLoadingStyleOptions = [
  {
    value: 'minimal',
    label: '简洁',
    description: '低存在感的轻柔呼吸点，适合长时间阅读。',
    labelKey: 'settings.advanced.translationLoadingStyle.minimal.label',
    descriptionKey: 'settings.advanced.translationLoadingStyle.minimal.description',
  },
  {
    value: 'ring',
    label: '柔和圆环',
    description: '保留熟悉的旋转反馈，颜色和尺寸更克制。',
    labelKey: 'settings.advanced.translationLoadingStyle.ring.label',
    descriptionKey: 'settings.advanced.translationLoadingStyle.ring.description',
  },
  {
    value: 'dots',
    label: '跳跃圆点',
    description: '三个小点依次轻跳，节奏明快但不刺眼。',
    labelKey: 'settings.advanced.translationLoadingStyle.dots.label',
    descriptionKey: 'settings.advanced.translationLoadingStyle.dots.description',
  },
  {
    value: 'orbit',
    label: '行星轨道',
    description: '小圆点沿轨道缓慢运行，带一点探索感。',
    labelKey: 'settings.advanced.translationLoadingStyle.orbit.label',
    descriptionKey: 'settings.advanced.translationLoadingStyle.orbit.description',
  },
  {
    value: 'sparkle',
    label: '星光',
    description: '两颗小星交替闪烁，为等待增加一点趣味。',
    labelKey: 'settings.advanced.translationLoadingStyle.sparkle.label',
    descriptionKey: 'settings.advanced.translationLoadingStyle.sparkle.description',
  },
] as const

export type TranslationLoadingStyle = typeof translationLoadingStyleOptions[number]['value']

export const DEFAULT_TRANSLATION_LOADING_STYLE: TranslationLoadingStyle = 'minimal'

/** 未知或旧配置始终回到低干扰默认样式。 */
export function normalizeTranslationLoadingStyle(value: unknown): TranslationLoadingStyle {
  return translationLoadingStyleOptions.some(option => option.value === value)
    ? value as TranslationLoadingStyle
    : DEFAULT_TRANSLATION_LOADING_STYLE
}

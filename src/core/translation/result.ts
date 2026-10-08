/**
 * @file src/core/translation/result.ts
 * 文件职责：为各翻译入口提供统一的译文展示判定，避免把与原文相同的结果重复显示。
 * 主要内容：只在比较副本中统一 Unicode 组合形式与空白、忽略不显示字形的 U+200B；空译文和相同文本均不产生额外译文，保留大小写、标点、可见词间空格、ZWJ/ZWNJ 及简繁差异。
 * 模块边界：本模块是纯文本规则，不修改来源或结果、不读取配置、不调用翻译服务，也不操作 DOM。
 */
export function hasDistinctTranslation(source: string, translation: string | undefined): boolean {
    const normalize = (text: string) => text.normalize('NFC').replace(/\u200b/gu, '').replace(/[\s\u3000]+/gu, ' ').trim();
    const translated = normalize(translation ?? '');
    return translated !== '' && translated !== normalize(source);
}

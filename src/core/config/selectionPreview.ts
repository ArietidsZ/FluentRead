/**
 * @file src/core/config/selectionPreview.ts
 * 文件职责：提供划词设置中不联网的英文原句与中文句法分析示例。
 * 主要内容：使用与真实学习回答相同的词性表格格式，由共用组件呈现交互预览。
 * 模块边界：这些内容是固定的语言学习样本，不是模型结果，不参与配置迁移或网络请求。
 */
export const sentenceSource = 'Every language offers a new way to see the world.';
export const sentenceTranslation = '每一种语言，都带来一种看世界的新方式。';
export const sentenceAnalysis = '| Text | POS | Role | Meaning |\n| --- | --- | --- | --- |\n| Every language | noun phrase | 主语 | 每一种语言 |\n| offers | verb | 谓语 | 带来 |\n| a new way | noun phrase | 宾语 | 一种新方式 |\n| to see the world | infinitive phrase | 后置定语 | 看世界的 |';

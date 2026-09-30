/**
 * @file src/core/config/selectionPreview.ts
 * 文件职责：提供划词设置中不联网的英文原句与中文句法分析示例。
 * 主要内容：使用与真实学习回答相同的词性表格格式，由共用组件呈现交互预览。
 * 模块边界：这些内容是固定的语言学习样本，不是模型结果，不参与配置迁移或网络请求。
 */
export const sentenceAnalysis = '| Text | POS | Role | Meaning |\n| --- | --- | --- | --- |\n| The | article | 限定 reader | 这位 |\n| curious | adjective | 修饰 reader | 好奇的 |\n| reader | noun | 主语 | 读者 |\n| explores | verb | 谓语 | 探索 |\n| new | adjective | 修饰 ideas | 新的 |\n| ideas | noun | 宾语 | 想法 |';

/**
 * @file src/features/full-page-translation/highlight/public.ts
 * 文件职责：向句子学习界面提供高亮句子的只读订阅合同。
 * 主要内容：导出原文、对应译文、真实上下文和屏幕位置，以及订阅与退订函数。
 * 模块边界：不启动翻译运行时、不读取配置，也不挂载收藏界面。
 */
export {subscribeHighlightedSentence, type HighlightedSentence} from '../content/sentenceHighlight';

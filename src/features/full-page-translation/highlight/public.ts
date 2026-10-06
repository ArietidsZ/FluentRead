/**
 * @file src/features/full-page-translation/highlight/public.ts
 * 文件职责：向句子学习界面提供高亮句子的只读订阅合同。
 * 主要内容：导出原文、对应译文、鼠标所在一侧与停留点、稳定的段落与句子身份、真实上下文、当前行及整段文字屏幕边界，以及订阅与退订函数。
 * 模块边界：不启动翻译运行时、不读取配置，也不挂载收藏界面。
 */
export {subscribeHighlightedSentence, type HighlightedSentence} from '../content/sentenceHighlight';

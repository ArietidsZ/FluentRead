/**
 * @file src/features/paragraph-copy/public.ts
 * 文件职责：提供段落复制功能的稳定公共出口，让 content composition root 无需了解手势实现与取词细节即可挂载该能力。
 * 主要内容：精确再导出 mountParagraphCopyContentFeature 与其挂载参数类型，并公开段落取词与文本组合的纯函数供其他调用方复用。
 * 模块边界：该 barrel 不创建监听器、不读取配置，也不写入剪贴板；所有副作用都发生在调用导出的挂载函数之后。
 */
export {mountParagraphCopyContentFeature, type ParagraphCopyContentOptions} from './content';
export {
    composeParagraphCopyText,
    findCopyableBlock,
    readParagraphTexts,
    type ParagraphCopyPayload,
    type ParagraphTexts,
} from './core';

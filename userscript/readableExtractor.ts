/**
 * @file userscript/readableExtractor.ts
 * 文件职责：在 userscript 单文件产物中替换扩展运行时的网页正文提取器加载器。
 * 主要内容：静态导入 Defuddle 完整版，loadReadablePageExtractor 立即返回同一实例；登记函数保留相同签名但无需全局注册。
 * 模块边界：userscript 没有可按 URL 加载的扩展资源，只能内联提取器；扩展产物继续按需加载独立脚本。
 */
import Defuddle, {createMarkdownContent} from 'defuddle/full';
import type {ReadablePageExtractor} from '@/src/platform/page-context/readableExtractor';

const extractor: ReadablePageExtractor = {Defuddle, createMarkdownContent};

export const READABLE_PAGE_EXTRACTOR_SCRIPT = 'pageContextExtractor.js';
export function registerReadablePageExtractor(_extractor: ReadablePageExtractor): void {}
export const loadReadablePageExtractor = (): Promise<ReadablePageExtractor> => Promise.resolve(extractor);

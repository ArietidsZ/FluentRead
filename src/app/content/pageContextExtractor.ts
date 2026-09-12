/**
 * @file src/app/content/pageContextExtractor.ts
 * 文件职责：作为按需注入的网页正文提取脚本的应用层组合根，把 Defuddle 登记到内容脚本可读取的提取器注册表。
 * 主要内容：静态导入 Defuddle 完整版与 Markdown 转换函数，并由 startPageContextExtractorApp 调用平台注册函数。
 * 模块边界：不读取页面、不发起翻译或网络请求；只有开启 AI 网页上下文的翻译才会加载本产物，DOM 快照与隐私清洗仍由翻译上下文服务负责。
 */
import Defuddle, {createMarkdownContent} from 'defuddle/full';
import {registerReadablePageExtractor} from '@/src/platform/page-context/readableExtractor';

export function startPageContextExtractorApp(): void {
    registerReadablePageExtractor({Defuddle, createMarkdownContent});
}

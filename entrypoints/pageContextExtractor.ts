/**
 * @file entrypoints/pageContextExtractor.ts
 * 文件职责：声明网页正文提取器的独立 WXT 产物，供需要 AI 网页上下文时由内容脚本按需加载。
 * 主要内容：把应用组合根注册为 unlisted script，产物以扩展可访问资源的形式随扩展打包。
 * 模块边界：入口只保存构建元数据和唯一启动委托，提取器登记与加载策略由 src/app 与 src/platform 负责。
 */
import {startPageContextExtractorApp} from '@/src/app/content/pageContextExtractor';

export default defineUnlistedScript(startPageContextExtractorApp);

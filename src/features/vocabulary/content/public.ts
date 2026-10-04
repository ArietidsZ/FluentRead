/**
 * @file src/features/vocabulary/content/public.ts
 * 文件职责：公开再次遇见收藏表达的浏览器内容生命周期。
 * 主要内容：只导出挂载与卸载合同供 content composition root 组装。
 * 模块边界：纯收藏出口不依赖本文件，设置与后台也不通过本文件访问浏览器 UI；匹配、绘制和读取实现由 feature 内部拥有。
 */
export {mountVocabularyReencounter, unmountVocabularyReencounter} from './reencounter';

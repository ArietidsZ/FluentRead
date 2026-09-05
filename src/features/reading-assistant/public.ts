/**
 * @file src/features/reading-assistant/public.ts
 * 文件职责：提供可被划词翻译复用的阅读卡组件、选区捕获及纯数据契约。
 * 主要内容：导出阅读卡、选区捕获、会话管理客户端及数据契约，隐藏后台请求编排与模型实现。
 * 模块边界：只做静态导出，不注册事件或初始化模型；跨 feature 调用保持在这个公开入口。
 */
export {default as ReadingPanel} from './ui/ReadingPanel.vue';
export {captureReadingSelection} from './selectionContext';
export type {ReadingSelection} from './types';
export {clearHarnessSessions, deleteHarnessSession, getHarnessSession, listHarnessSessions} from './client';

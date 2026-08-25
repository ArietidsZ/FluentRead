/**
 * @file src/services/config/index.ts
 *
 * 文件职责：作为配置服务的公共入口，将配置持久化、订阅和历史操作统一转出给应用组合层。
 * 主要内容：当前聚合 store.ts 的公开 API，隔离调用方与 schema、history 等内部文件布局，便于后续替换存储实现。 可核对的公开符号包括 聚合导出。
 * 模块边界：本文件位于配置 application service 层，可协调 core 规则与浏览器存储端口；不包含设置页面组件，也不实现具体翻译供应商协议，调用方应通过公开服务 API 订阅或提交配置。
 */

export * from './store';

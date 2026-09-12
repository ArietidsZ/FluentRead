/**
 * @file src/core/i18n/messages/runtime-feedback-patterns.ts
 * 文件职责：集中维护后台、Offscreen、翻译服务和各功能运行期参数化反馈的六种非中文界面译文模板。
 * 主要内容：runtimeFeedbackPatterns 登记带数值、语言代码、服务名或嵌套错误的整句中文模板，由 legacy-patterns.ts 在构建期展开进各语言资源包。
 * 模块边界：只提供纯数据，不读取配置、不访问浏览器；协议字段校验、日志和发送给模型的提示词不属于界面反馈，不在这里登记。
 */
import type {LocalizedLegacyPattern} from '../types';

export const runtimeFeedbackPatterns: readonly LocalizedLegacyPattern[] = [
];

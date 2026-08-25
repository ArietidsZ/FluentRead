/**
 * @file src/app/background/providerRuntime.ts
 * 文件职责：为后台组合根集中提供翻译供应商相关运行时能力，隔离 app/messageRuntime 对 providers 内部文件结构的直接依赖。
 * 主要内容：重导出连接测试执行器、连接测试错误格式化函数以及 Microsoft 文本翻译实现，供后台 handler 注入具体 provider 行为。
 * 模块边界：这是窄化的 app 层出口，不注册消息、不读取用户配置、不实现 HTTP 协议；供应商请求和错误解释仍由 providers/translation 模块拥有。
 */
// Background entrypoint 只依赖 app composition root；这里集中组装翻译 provider 能力。
export {
    formatConnectionTestError,
    runTranslationServiceConnectionTest,
} from '@/src/providers/translation/connectionTest';
export {translateMicrosoftTexts} from '@/src/providers/translation/microsoft';

/**
 * @file src/core/i18n/types.ts
 *
 * 文件职责：定义 FluentRead 界面语言的稳定领域类型，不依赖 Vue、浏览器或配置存储。
 * 主要内容：声明支持的语言标识、翻译参数和资源目录结构，供配置归一化、UI 适配器和
 * 可测试的纯翻译函数共同使用。
 * 模块边界：这里只描述 i18n 数据契约；语言选择的持久化由配置服务负责，Vue 响应式由
 * src/ui/i18n.ts 负责，内容翻译请求不得复用这些界面语言标识。
 */

export type UiLanguage = 'zh-CN' | 'en-US';

export type TranslationValue = string | number | boolean;

export type TranslationParams = Record<string, TranslationValue | null | undefined>;

export type MessageCatalog = Readonly<Record<string, string>>;

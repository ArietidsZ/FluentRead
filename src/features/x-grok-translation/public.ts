/**
 * @file src/features/x-grok-translation/public.ts
 * 文件职责：定义 X/Grok 优先逐帖翻译 feature 的内容侧稳定公共出口，供 content composition root 按高级配置启停页面运行时。
 * 主要内容：精确再导出页面适用性判断、每帖按钮标记、挂载依赖类型，以及 mountXGrokAutoTranslate、unmountXGrokAutoTranslate 与状态查询能力。
 * 模块边界：本文件不访问 X DOM、不读取配置也不自动挂载；后台动态注册通过 background/public 独立导出，避免跨上下文副作用。
 */
export {
    X_GROK_POST_TRANSLATION_BUTTON_ATTRIBUTE,
    isXGrokAutoTranslatePage,
    isXGrokAutoTranslateMounted,
    mountXGrokAutoTranslate,
    unmountXGrokAutoTranslate,
    type XGrokAutoTranslateOptions,
} from './content/runtime';

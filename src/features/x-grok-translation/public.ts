/**
 * @file src/features/x-grok-translation/public.ts
 * 文件职责：定义 X/Grok 原生逐帖翻译 feature 的稳定公共出口，供 content composition root 按高级配置启停页面运行时。
 * 主要内容：精确再导出页面适用性判断，以及 mountXGrokAutoTranslate、unmountXGrokAutoTranslate 与 isXGrokAutoTranslateMounted 三个生命周期能力。
 * 模块边界：本文件不访问 X DOM、不读取配置也不自动挂载；站点识别、观察器、重试和虚拟列表幂等状态全部封装在 content/runtime 内。
 */
export {
    isXGrokAutoTranslatePage,
    isXGrokAutoTranslateMounted,
    mountXGrokAutoTranslate,
    unmountXGrokAutoTranslate,
} from './content/runtime';

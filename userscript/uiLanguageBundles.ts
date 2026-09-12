/**
 * @file userscript/uiLanguageBundles.ts
 * 文件职责：在 userscript 单文件产物中替换扩展运行时的界面语言资源加载器。
 * 主要内容：模块求值时静态注册全部非中文资源包，ensureUiLanguageBundle 始终立即成功，renderWithUiLanguageBundle 只需同步渲染一次。
 * 模块边界：userscript 没有可按 URL 读取的扩展资源目录，只能内联全部语言；扩展产物继续按需加载。
 */
import {registerAllUiLanguageBundles} from '@/src/core/i18n/bundles';
import type {EnsureUiLanguageBundle, renderWithUiLanguageBundle as RenderWithUiLanguageBundle} from '@/src/platform/i18n/uiLanguageBundles';

registerAllUiLanguageBundles();

export const ensureUiLanguageBundle: EnsureUiLanguageBundle = () => Promise.resolve(true);

export const renderWithUiLanguageBundle: typeof RenderWithUiLanguageBundle = (_language, render) => render();

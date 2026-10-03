/**
 * @file src/app/popup/mount.ts
 * 文件职责：在轻量启动入口唤醒后台后，读取配置并创建 Popup Vue 应用。
 * 主要内容：配置就绪后选择首启轻量根组件或完整主菜单；只准备当前页面所需语言与缓存字体，避免引导解析主菜单与完整英文目录。
 * 模块边界：这里不读取当前标签页、不保存配置，也不处理 Popup 业务事件；所有响应式交互在 PopupApp 中，feature 与 runtime 行为通过公开模块完成。
 */
import {createApp} from 'vue';
import {Coffee} from '@element-plus/icons-vue';
import {createUiI18nPlugin} from '@/src/ui/i18n'
import {config, configReady} from '@/src/services/config/store'
import {ensureUiLanguageBundle} from '@/src/platform/i18n/uiLanguageBundles'
import {prepareInterfaceFont} from '@/src/ui/interfaceAppearance'

/** Popup 的唯一组装入口：配置就绪后才创建界面，避免默认布局先绘制。 */
export async function mountPreparedPopupApp(selector: string): Promise<void> {
  await configReady;
  const onboarding = !config.uiLanguageSetupCompleted;
  const [{default: App}] = await Promise.all([
    onboarding ? import('./PopupOnboarding.vue') : import('./PopupApp.vue'),
    Promise.all([
      ...(onboarding ? [] : [ensureUiLanguageBundle(config.uiLanguage)]),
      prepareInterfaceFont(config.interfaceFont),
    ]),
  ])
  const app = createApp(App)
  app.use(createUiI18nPlugin({documentRoot: document.body, documentTitleKey: 'metadata.popupTitle'}))
  app.component('Coffee', Coffee);
  // 由唯一的 WXT 启动入口提供挂载目标，避免 app 层假定页面结构。
  app.mount(selector)
}

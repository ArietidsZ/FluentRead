/**
 * @file src/app/popup/index.ts
 * 文件职责：创建 Popup Vue 应用并注册首屏图标，作为 WXT popup entrypoint 与 PopupApp 之间的 composition root。
 * 主要内容：加载 popup.css 和共享皮肤，并行读取配置与加载主界面，抽屉依赖由首次交互按需加载；配置和界面语言资源就绪后再创建 App，确保首帧使用已保存的皮肤、主题、布局和语言。
 * 模块边界：这里不读取当前标签页、不保存配置，也不处理 Popup 业务事件；所有响应式交互在 PopupApp 中，feature 与 runtime 行为通过公开模块完成。
 */
import {createApp} from 'vue';
import './popup.css';
import 'element-plus/es/components/base/style/css';
import '@/src/ui/styles/interface-skins.css';
import {Coffee} from '@element-plus/icons-vue'
import {createUiI18nPlugin} from '@/src/ui/i18n'
import {config, configReady} from '@/src/services/config/store'
import {ensureUiLanguageBundle} from '@/src/platform/i18n/uiLanguageBundles'

const ELEMENT_ICONS = {Coffee} as const

/** Popup 的唯一组装入口：配置就绪后才创建界面，避免默认布局先绘制。 */
export async function mountPopupApp(selector: string): Promise<void> {
  // 先启动配置 I/O，再与界面组件加载重叠；不让大型控件解析推迟首次存储请求。
  const [{default: App}] = await Promise.all([
    import('./PopupApp.vue'),
    configReady.then(() => ensureUiLanguageBundle(config.uiLanguage)),
  ])
  const app = createApp(App)
  app.use(createUiI18nPlugin({documentRoot: document.body, documentTitleKey: 'metadata.popupTitle'}))
  // 步骤 1：只注册首屏真正使用的图标。
  for (const [name, component] of Object.entries(ELEMENT_ICONS)) {
    app.component(name, component)
  }

  // 步骤 2：由唯一的 WXT 启动入口提供挂载目标，避免 app 层假定页面结构。
  app.mount(selector)
}

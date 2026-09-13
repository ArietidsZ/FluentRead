/**
 * @file src/app/options/index.ts
 * 文件职责：创建 Options Vue 应用并集中注册页面所需的 Element Plus 组件、图标与样式，向 WXT 入口暴露稳定挂载函数。
 * 主要内容：维护显式组件和图标清单，载入 Element Plus、settings-page 及共享 token 样式，createApp(OptionsApp) 后逐项注册并挂载到给定 selector。
 * 模块边界：此文件只做 UI 依赖装配，不实现导航、设置保存或业务组件；OptionsApp 管理页面状态，各 feature 负责配置和词汇逻辑，WXT 入口决定启动时机。
 */
import { createApp, type Component } from 'vue'
import {
  ElButton,
  ElCollapse,
  ElCollapseItem,
  ElCol,
  ElDialog,
  ElDivider,
  ElEmpty,
  ElIcon,
  ElInput,
  ElInputNumber,
  ElLink,
  ElOption,
  ElOptionGroup,
  ElRow,
  ElSwitch,
  ElText,
  ElTooltip,
} from 'element-plus'
import {
  CircleCheckFilled,
  Coffee,
  Download,
  Edit,
  InfoFilled,
  Loading,
  Refresh,
  Setting,
  Star,
  Upload,
  Warning,
  WarningFilled,
} from '@element-plus/icons-vue'
import OptionsApp from './OptionsApp.vue'
import UiSelect from '@/src/ui/components/UiSelect.vue'
import 'element-plus/es/components/base/style/css'
import 'element-plus/es/components/button/style/css'
import 'element-plus/es/components/collapse/style/css'
import 'element-plus/es/components/col/style/css'
import 'element-plus/es/components/dialog/style/css'
import 'element-plus/es/components/divider/style/css'
import 'element-plus/es/components/empty/style/css'
import 'element-plus/es/components/icon/style/css'
import 'element-plus/es/components/input/style/css'
import 'element-plus/es/components/input-number/style/css'
import 'element-plus/es/components/link/style/css'
import 'element-plus/es/components/option/style/css'
import 'element-plus/es/components/option-group/style/css'
import 'element-plus/es/components/popover/style/css'
import 'element-plus/es/components/row/style/css'
import 'element-plus/es/components/select/style/css'
import 'element-plus/es/components/switch/style/css'
import 'element-plus/es/components/text/style/css'
import 'element-plus/es/components/tooltip/style/css'
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/message-box/style/css'
import 'element-plus/es/components/color-picker/style/css'
import '@/src/features/settings/ui/settings-page.css'
import {createUiI18nPlugin} from '@/src/ui/i18n'
import '@/src/ui/styles/interface-skins.css'
import {config, configReady} from '@/src/services/config/store'
import {ensureUiLanguageBundle} from '@/src/platform/i18n/uiLanguageBundles'

const ELEMENT_COMPONENTS: Component[] = [
  ElButton,
  ElCollapse,
  ElCollapseItem,
  ElCol,
  ElDialog,
  ElDivider,
  ElEmpty,
  ElIcon,
  ElInput,
  ElInputNumber,
  ElLink,
  ElOption,
  ElOptionGroup,
  ElRow,
  ElSwitch,
  ElText,
  ElTooltip,
]

const ELEMENT_ICONS: Record<string, Component> = {
  CircleCheckFilled,
  Coffee,
  Download,
  Edit,
  InfoFilled,
  Loading,
  Refresh,
  Setting,
  Star,
  Upload,
  Warning,
  WarningFilled,
}

/** options 的唯一组装入口：注册页面依赖后挂载 Vue 根组件。 */
export async function mountOptionsApp(selector: string): Promise<void> {
  await configReady
  await ensureUiLanguageBundle(config.uiLanguage)
  const app = createApp(OptionsApp)
  app.use(createUiI18nPlugin({documentRoot: document.body, documentTitleKey: 'metadata.optionsTitle'}))
  app.component('ElSelect', UiSelect)

  for (const component of ELEMENT_COMPONENTS) {
    if (component.name) app.component(component.name, component)
  }
  for (const [name, component] of Object.entries(ELEMENT_ICONS)) {
    app.component(name, component)
  }

  app.mount(selector)
}

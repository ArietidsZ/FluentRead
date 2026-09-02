/**
 * @file src/core/config/interfaceAppearance.ts
 * 文件职责：定义 FluentRead 扩展界面的皮肤与栏目可见性配置契约，作为 Options、Popup 和配置持久化共同依赖的单一来源。
 * 主要内容：维护十套可扩展界面皮肤的分组、预览色、布局类型和 Popup 尺寸策略，以及栏目开关元数据、默认可见性与安全归一化函数。
 * 模块边界：本文件只描述纯配置规则和用户可见元数据，不读取浏览器存储、不操作 DOM，也不决定具体页面布局；DOM 皮肤应用由 src/ui/interfaceAppearance.ts 负责。
 */

export const interfaceSkinGroups = [
  {
    value: 'utility',
    label: '效率与可读性',
    description: '从熟悉、简洁、紧凑到高对比，按使用场景选择。',
  },
  {
    value: 'palette',
    label: '氛围配色',
    description: '用不同色彩营造轻松、沉静或护眼的阅读氛围。',
  },
] as const

export const interfaceSkinOptions = [
  {
    value: 'default',
    label: '默认风格',
    description: '保留当前 FluentRead 的界面布局与视觉效果。',
    group: 'utility',
    kind: 'default',
    popupHeight: 'fixed',
    popupWidth: 400,
    preview: {canvas: '#f6f7fb', surface: '#ffffff', accent: '#ef4776', ink: '#172033'},
  },
  {
    value: 'minimal',
    label: '简约风格',
    description: '平面留白与轻边界，让主要操作更突出。',
    group: 'utility',
    kind: 'minimal',
    popupHeight: 'content',
    popupWidth: 400,
    preview: {canvas: '#ffffff', surface: '#f3f4f6', accent: '#ef4776', ink: '#313743'},
  },
  {
    value: 'compact',
    label: '紧凑风格',
    description: '压缩间距与控件高度，适合高频快速操作。',
    group: 'utility',
    kind: 'compact',
    popupHeight: 'content',
    popupWidth: 360,
    preview: {canvas: '#f5f6f8', surface: '#ffffff', accent: '#dc315f', ink: '#283042'},
  },
  {
    value: 'contrast',
    label: '高对比 ⚡',
    description: '强化文字、边框与焦点状态，提升辨识度。',
    group: 'utility',
    kind: 'contrast',
    popupHeight: 'content',
    popupWidth: 400,
    preview: {canvas: '#ffffff', surface: '#f6dd00', accent: '#111111', ink: '#000000'},
  },
  {
    value: 'cheese',
    label: '奶酪 🧀',
    description: '奶油黄配焦糖棕，温暖、有趣又醒目。',
    group: 'palette',
    kind: 'palette',
    popupHeight: 'content',
    popupWidth: 400,
    preview: {canvas: '#f7edcf', surface: '#fffdf6', accent: '#d99a16', ink: '#3c3121'},
  },
  {
    value: 'ocean',
    label: '海盐 🌊',
    description: '清爽海盐蓝，层次清晰且适合长时间使用。',
    group: 'palette',
    kind: 'palette',
    popupHeight: 'content',
    popupWidth: 400,
    preview: {canvas: '#e2f1f4', surface: '#fbfeff', accent: '#1689a9', ink: '#173844'},
  },
  {
    value: 'matcha',
    label: '抹茶 🍵',
    description: '低饱和抹茶绿，安静自然、不喧宾夺主。',
    group: 'palette',
    kind: 'palette',
    popupHeight: 'content',
    popupWidth: 400,
    preview: {canvas: '#e7eedf', surface: '#fcfdf8', accent: '#648b4e', ink: '#31452d'},
  },
  {
    value: 'sakura',
    label: '樱花 🌸',
    description: '淡樱粉与轻盈圆角，柔和明快。',
    group: 'palette',
    kind: 'palette',
    popupHeight: 'content',
    popupWidth: 400,
    preview: {canvas: '#f9e8ee', surface: '#fffafd', accent: '#d95784', ink: '#51303d'},
  },
  {
    value: 'midnight',
    label: '夜幕 🌙',
    description: '深蓝低眩光界面，适合夜间阅读。',
    group: 'palette',
    kind: 'palette',
    popupHeight: 'content',
    popupWidth: 400,
    preview: {canvas: '#0c1523', surface: '#172337', accent: '#64c9e7', ink: '#f2f7fb'},
  },
  {
    value: 'paper',
    label: '纸张护眼 📖',
    description: '暖纸白与墨色文字，减少冷白背景刺激。',
    group: 'palette',
    kind: 'palette',
    popupHeight: 'content',
    popupWidth: 400,
    preview: {canvas: '#ebe1cd', surface: '#fffaf1', accent: '#93623a', ink: '#40372f'},
  },
] as const

export type InterfaceSkin = typeof interfaceSkinOptions[number]['value']
export type InterfaceSkinOption = typeof interfaceSkinOptions[number]

const interfaceSkinByValue = new Map<string, InterfaceSkinOption>(
  interfaceSkinOptions.map((item) => [item.value, item]),
)

export const interfaceVisibilityOptions = [
  {
    key: 'popupQuickFeatures',
    label: '快捷功能栏',
    description: '显示悬停、划词、图片、视频和文档等快捷入口。',
  },
  {
    key: 'popupSiteRule',
    label: '当前网站栏目',
    description: '显示当前网站的始终翻译和禁用扩展开关。',
  },
  {
    key: 'popupFooter',
    label: '底部信息栏',
    description: '显示翻译统计、开源项目入口和清除缓存操作。',
  },
] as const

export type InterfaceVisibilityKey = typeof interfaceVisibilityOptions[number]['key']
export type InterfaceVisibility = Record<InterfaceVisibilityKey, boolean>

export const DEFAULT_INTERFACE_VISIBILITY: InterfaceVisibility = {
  popupQuickFeatures: true,
  popupSiteRule: true,
  popupFooter: true,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 只接受注册表中的皮肤，未知值稳定回到当前默认界面。 */
export function normalizeInterfaceSkin(value: unknown): InterfaceSkin {
  return getInterfaceSkinOption(value).value
}

/** 返回完整皮肤元数据，让应用层无需识别任何具体皮肤 ID。 */
export function getInterfaceSkinOption(value: unknown): InterfaceSkinOption {
  return typeof value === 'string'
    ? interfaceSkinByValue.get(value) ?? interfaceSkinOptions[0]
    : interfaceSkinOptions[0]
}

/** Popup 根据注册元数据决定是否使用内容高度，新增皮肤不需要修改 Popup 组件。 */
export function interfaceSkinUsesContentHeight(value: unknown): boolean {
  return getInterfaceSkinOption(value).popupHeight === 'content'
}

/** Popup 宽度由皮肤元数据声明，紧凑或未来的窄版皮肤无需在组件中追加 ID 分支。 */
export function interfaceSkinPopupWidth(value: unknown): number {
  return getInterfaceSkinOption(value).popupWidth
}

/** 只保留已注册的栏目开关；旧配置缺少新栏目时默认显示，保证升级不改变现有界面。 */
export function normalizeInterfaceVisibility(value: unknown): InterfaceVisibility {
  const source = isRecord(value) ? value : {}
  return Object.fromEntries(
    interfaceVisibilityOptions.map(({key}) => [
      key,
      typeof source[key] === 'boolean' ? source[key] : DEFAULT_INTERFACE_VISIBILITY[key],
    ]),
  ) as InterfaceVisibility
}

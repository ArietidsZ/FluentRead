/**
 * @file src/core/config/interfaceAppearance.ts
 * 文件职责：定义 FluentRead 扩展界面的皮肤与栏目可见性配置契约，作为 Options、Popup 和配置持久化共同依赖的单一来源。
 * 主要内容：维护可扩展的界面皮肤注册表、Popup 栏目开关元数据、默认可见性以及安全归一化函数；新增皮肤时只需扩展这里的定义并接入对应的独立 CSS 模块。
 * 模块边界：本文件只描述纯配置规则和用户可见元数据，不读取浏览器存储、不操作 DOM，也不决定具体页面布局；DOM 皮肤应用由 src/ui/interfaceAppearance.ts 负责。
 */

export const interfaceSkinOptions = [
  {
    value: 'default',
    label: '默认风格',
    description: '保留当前 FluentRead 的界面布局与视觉效果。',
  },
  {
    value: 'minimal',
    label: '简约风格',
    description: '减少阴影和装饰，让翻译操作更突出。',
  },
  {
    value: 'plain',
    label: '朴素风格',
    description: '采用平面白底和清晰分区，信息一目了然。',
  },
  {
    value: 'compact',
    label: '紧凑风格',
    description: '压缩间距和控件高度，让 Popup 更高效。',
  },
  {
    value: 'soft',
    label: '柔和风格',
    description: '使用轻柔色彩和圆润层次，适合长时间阅读。',
  },
] as const

export type InterfaceSkin = typeof interfaceSkinOptions[number]['value']

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
  return interfaceSkinOptions.some((item) => item.value === value)
    ? value as InterfaceSkin
    : 'default'
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

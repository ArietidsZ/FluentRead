/**
 * @file src/ui/interfaceAppearance.ts
 * 文件职责：把已经归一化的界面皮肤和字体配置应用到扩展页面根节点，为 Popup 和 Options 共享同一套界面切换入口。
 * 主要内容：应用皮肤与字体变量，按当前选择启动字体下载服务并公开下载状态；配置异常时安全回退。
 * 模块边界：本文件只负责扩展自身页面的 DOM 属性，不读取或保存配置，不影响网页内容脚本和宿主页面样式。
 */

import {
  getInterfaceFontOption,
  getInterfaceSkinOption,
  interfaceFontOptions,
  type InterfaceFont,
  type InterfaceSkin,
} from '@/src/core/config/interfaceAppearance'
import {readonly, shallowRef} from 'vue'
import {createInterfaceFontLoader, getCachedInterfaceFonts, type InterfaceFontLoadState} from '@/src/services/interfaceFonts'
import {getInterfaceFontAssets, type InterfaceFontSourceId} from '@/src/core/config/interfaceFontAssets'

const fontLoadState = shallowRef<InterfaceFontLoadState>({font: 'system', status: 'system', loaded: 0, total: 0, persistent: true})
export const interfaceFontLoadState = readonly(fontLoadState)
const availableFonts = shallowRef<InterfaceFont[]>(['system'])
export const availableInterfaceFonts = readonly(availableFonts)
const installedFiles = new Set<string>()
const openFontCache = async () => caches.open('fluentread-interface-fonts-v1')

export async function refreshInterfaceFontAvailability(): Promise<void> {
  const cached = await getCachedInterfaceFonts(openFontCache)
  availableFonts.value = [...new Set([...availableFonts.value, ...cached])]
}

const fontLoader = createInterfaceFontLoader({
  fetch: (...args) => fetch(...args),
  openCache: openFontCache,
  digest: data => crypto.subtle.digest('SHA-256', data),
  install: async (asset, data) => {
    const face = new FontFace(asset.family, data, {weight: asset.weight, style: 'normal', display: 'swap'})
    await face.load()
    document.fonts.add(face)
    installedFiles.add(asset.file)
    availableFonts.value = [...new Set([...availableFonts.value, ...interfaceFontOptions
      .filter(font => getInterfaceFontAssets(font.value).every(item => installedFiles.has(item.file)))
      .map(font => font.value)])]
  },
  onState: state => { fontLoadState.value = state },
})

export function retryInterfaceFont(source?: InterfaceFontSourceId): void {
  void fontLoader.load(fontLoadState.value.font, source, true)
}

export function applyInterfaceSkin(value: unknown): InterfaceSkin {
  const skin = getInterfaceSkinOption(value)
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.interfaceSkin = skin.value
    document.documentElement.dataset.interfaceSkinKind = skin.kind
    document.documentElement.style.setProperty('--interface-popup-width', `${skin.popupWidth}px`)
  }
  return skin.value
}

export function applyInterfaceFont(value: unknown): InterfaceFont {
  const font = getInterfaceFontOption(value)
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.interfaceFont = font.value
    document.documentElement.style.setProperty('--interface-font-family', font.fontFamily)
    document.documentElement.style.setProperty('--el-font-family', font.fontFamily)
    void fontLoader.load(font.value)
  }
  return font.value
}

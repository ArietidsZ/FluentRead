/**
 * @file src/ui/interfaceAppearance.ts
 * 文件职责：把已经归一化的界面皮肤和字体配置应用到扩展页面根节点，为 Popup 和 Options 共享同一套界面切换入口。
 * 主要内容：应用皮肤与字体变量，首屏前注册已缓存字体，切换时保留当前字体直到新字体就绪，并公开下载状态、可用字体与单个字体清理；配置异常时安全回退。
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
import {getClearableInterfaceFontAssets, getInterfaceFontAssets, type InterfaceFontSourceId} from '@/src/core/config/interfaceFontAssets'

const fontLoadState = shallowRef<InterfaceFontLoadState>({font: 'system', status: 'system', loaded: 0, total: 0, persistent: true})
export const interfaceFontLoadState = readonly(fontLoadState)
const availableFonts = shallowRef<InterfaceFont[]>(['system'])
export const availableInterfaceFonts = readonly(availableFonts)
const cachedFonts = shallowRef<InterfaceFont[]>(['system'])
export const cachedInterfaceFonts = readonly(cachedFonts)
const installedFiles = new Set<string>()
const requestedFonts = new WeakMap<HTMLElement, InterfaceFont>()
const openFontCache = async () => caches.open('fluentread-interface-fonts-v1')
let availabilityVersion = 0
let activeInterfaceAppearanceRoot: HTMLElement | null = null

/**
 * Options 页面通常把皮肤写到 document.documentElement；userscript 的完整设置页
 * 运行在 closed ShadowRoot 时，需要把同一份变量写到该 ShadowRoot 的 host。
 * 未设置时保持扩展页面原有行为。
 */
export function setInterfaceAppearanceRoot(root: HTMLElement | null): void {
  activeInterfaceAppearanceRoot = root
}

function resolveInterfaceAppearanceRoot(): HTMLElement | null {
  return activeInterfaceAppearanceRoot || (typeof document !== 'undefined' ? document.documentElement : null)
}

function removeInstalledFontFiles(font: InterfaceFont): void {
  const installed = interfaceFontOptions
    .filter(option => getInterfaceFontAssets(option.value).every(asset => installedFiles.has(asset.file)))
    .map(option => option.value)
  for (const asset of getClearableInterfaceFontAssets(font, installed)) {
    installedFiles.delete(asset.file)
  }
}

export async function refreshInterfaceFontAvailability(): Promise<void> {
  const version = ++availabilityVersion
  const cached = await getCachedInterfaceFonts(openFontCache)
  if (version !== availabilityVersion) return
  cachedFonts.value = cached
  const installed = interfaceFontOptions.filter(font => getInterfaceFontAssets(font.value)
    .every(asset => installedFiles.has(asset.file))).map(font => font.value)
  availableFonts.value = [...new Set([...installed, ...cached])]
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
  onState: state => {
    fontLoadState.value = state
    if (state.status !== 'loading') void refreshInterfaceFontAvailability()
  },
})

export async function clearInterfaceFont(font: InterfaceFont): Promise<void> {
  let cleared = false
  try {
    await fontLoader.clearFont(font)
    cleared = true
  } finally {
    if (cleared) removeInstalledFontFiles(font)
    await refreshInterfaceFontAvailability()
  }
}

export function retryInterfaceFont(source?: InterfaceFontSourceId): void {
  const font = fontLoadState.value.font
  const target = resolveInterfaceAppearanceRoot()
  void fontLoader.load(font, source, true).then(() => {
    if (target && requestedFonts.get(target) === font) applyInterfaceFont(font, target)
  })
}

export function applyInterfaceSkin(value: unknown, root?: HTMLElement | null): InterfaceSkin {
  const skin = getInterfaceSkinOption(value)
  const target = root || resolveInterfaceAppearanceRoot()
  if (target) {
    target.dataset.interfaceSkin = skin.value
    target.dataset.interfaceSkinKind = skin.kind
    target.style.setProperty('--interface-popup-width', `${skin.popupWidth}px`)
  }
  return skin.value
}

export function applyInterfaceFont(value: unknown, root?: HTMLElement | null): InterfaceFont {
  const font = getInterfaceFontOption(value)
  const target = root || resolveInterfaceAppearanceRoot()
  if (target) {
    requestedFonts.set(target, font.value)
    const apply = () => {
      if (requestedFonts.get(target) !== font.value) return
      target.dataset.interfaceFont = font.value
      target.style.setProperty('--interface-font-family', font.fontFamily)
      target.style.setProperty('--el-font-family', font.fontFamily)
    }
    if (getInterfaceFontAssets(font.value).every(asset => installedFiles.has(asset.file))) apply()
    void fontLoader.load(font.value).then(() => {
      const state = fontLoadState.value
      if (state.font === font.value && (state.status === 'ready' || state.status === 'system')) apply()
    })
  }
  return font.value
}

/** 扩展专属页面在挂载前调用；只等待本地缓存，未下载字体仍在后台按需获取。 */
export async function prepareInterfaceFont(value: unknown, root?: HTMLElement | null): Promise<void> {
  const font = getInterfaceFontOption(value)
  await fontLoader.loadCached(font.value)
  applyInterfaceFont(font.value, root)
}

export function applyInterfaceTheme(dark: boolean, root?: HTMLElement | null): void {
  const target = root || resolveInterfaceAppearanceRoot()
  target?.classList.toggle('dark', dark)
}

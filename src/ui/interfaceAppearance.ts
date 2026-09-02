/**
 * @file src/ui/interfaceAppearance.ts
 * 文件职责：把已经归一化的界面皮肤配置应用到扩展页面根节点，为 Popup 和 Options 共享同一套皮肤切换入口。
 * 主要内容：从注册表解析皮肤，设置 document.documentElement 的皮肤 ID、布局类型与 Popup 宽度变量，并在配置异常时回退到默认皮肤。
 * 模块边界：本文件只负责扩展自身页面的 DOM 属性，不读取或保存配置，不影响网页内容脚本和宿主页面样式。
 */

import {getInterfaceSkinOption, type InterfaceSkin} from '@/src/core/config/interfaceAppearance'

export function applyInterfaceSkin(value: unknown): InterfaceSkin {
  const skin = getInterfaceSkinOption(value)
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.interfaceSkin = skin.value
    document.documentElement.dataset.interfaceSkinKind = skin.kind
    document.documentElement.style.setProperty('--interface-popup-width', `${skin.popupWidth}px`)
  }
  return skin.value
}

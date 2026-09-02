/**
 * @file src/ui/translationLoadingIndicator.ts
 * 文件职责：创建不受宿主网页 CSS 与同名关键帧影响的段落翻译加载指示器。
 * 主要内容：以固定尺寸的 light-DOM 宿主保留翻译状态标记，在独立 Shadow Root 内渲染简洁、圆环、圆点、轨道和星光五种反馈，并统一处理缓存色与减少动态效果。
 * 模块边界：本文件只负责指示器 DOM 与视觉隔离，不读取配置仓库、不插入目标段落，也不管理翻译请求生命周期。
 */

import {
  normalizeTranslationLoadingStyle,
  type TranslationLoadingStyle,
} from '@/src/core/config/translationLoadingStyle'

export interface TranslationLoadingIndicatorOptions {
  style: TranslationLoadingStyle
  animated: boolean
  cacheHit?: boolean
}

const HOST_IMPORTANT_STYLES: ReadonlyArray<readonly [string, string]> = [
  ['all', 'initial'],
  ['box-sizing', 'border-box'],
  ['position', 'static'],
  ['inset', 'auto'],
  ['display', 'inline-flex'],
  ['float', 'none'],
  ['clear', 'none'],
  ['flex', '0 0 16px'],
  ['width', '16px'],
  ['min-width', '16px'],
  ['max-width', '16px'],
  ['height', '16px'],
  ['min-height', '16px'],
  ['max-height', '16px'],
  ['margin', '0 0 0 2px'],
  ['padding', '0'],
  ['border', '0'],
  ['border-radius', '0'],
  ['align-items', 'center'],
  ['justify-content', 'center'],
  ['overflow', 'hidden'],
  ['visibility', 'visible'],
  ['opacity', '1'],
  ['color', 'initial'],
  ['background', 'transparent'],
  ['box-shadow', 'none'],
  ['font', 'normal 16px/1 sans-serif'],
  ['line-height', '1'],
  ['vertical-align', '-2px'],
  ['transform', 'none'],
  ['filter', 'none'],
  ['animation', 'none'],
  ['transition', 'none'],
  ['pointer-events', 'none'],
  ['user-select', 'none'],
  ['isolation', 'isolate'],
  ['contain', 'layout style paint'],
]

const LOADING_INDICATOR_STYLES = `
:host {
  all: initial !important;
  box-sizing: border-box !important;
  display: inline-flex !important;
  width: 16px !important;
  min-width: 16px !important;
  max-width: 16px !important;
  height: 16px !important;
  min-height: 16px !important;
  max-height: 16px !important;
  margin: 0 0 0 2px !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  align-items: center !important;
  justify-content: center !important;
  overflow: hidden !important;
  color: initial !important;
  background: transparent !important;
  box-shadow: none !important;
  font: normal 16px/1 sans-serif !important;
  line-height: 1 !important;
  opacity: 1 !important;
  vertical-align: -2px !important;
  transform: none !important;
  filter: none !important;
  pointer-events: none !important;
  user-select: none !important;
  isolation: isolate !important;
  contain: layout style paint !important;
}

:host::before,
:host::after {
  content: none !important;
  display: none !important;
}

.fr-loading-visual,
.fr-loading-visual > i {
  box-sizing: border-box;
}

.fr-loading-visual {
  position: relative;
  display: grid;
  width: 14px;
  height: 14px;
  margin: 0;
  padding: 0;
  border: 0;
  place-items: center;
  color: #7b8493;
  background: transparent;
  line-height: 1;
}

.fr-loading-visual > i {
  display: none;
  margin: 0;
  padding: 0;
  border: 0;
  background: currentColor;
}

:host([data-fr-loading-style="minimal"]) .fr-loading-visual > i:first-child {
  display: block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  opacity: .46;
  animation: fluent-read-loading-breathe 1.35s ease-in-out infinite;
}

:host([data-fr-loading-style="ring"]) .fr-loading-visual {
  width: 12px;
  height: 12px;
  border: 1.5px solid rgba(123, 132, 147, .22);
  border-top-color: rgba(103, 119, 148, .82);
  border-right-color: rgba(103, 119, 148, .48);
  border-radius: 50%;
  animation: fluent-read-loading-spin .92s linear infinite;
}

:host([data-fr-loading-style="dots"]) .fr-loading-visual {
  display: flex;
  width: 15px;
  height: 10px;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

:host([data-fr-loading-style="dots"]) .fr-loading-visual > i {
  display: block;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  opacity: .48;
  animation: fluent-read-loading-dot 1.05s ease-in-out infinite;
}

:host([data-fr-loading-style="dots"]) .fr-loading-visual > i:nth-child(2) {
  animation-delay: .13s;
}

:host([data-fr-loading-style="dots"]) .fr-loading-visual > i:nth-child(3) {
  animation-delay: .26s;
}

:host([data-fr-loading-style="orbit"]) .fr-loading-visual {
  width: 14px;
  height: 14px;
  border: 1px solid rgba(123, 132, 147, .24);
  border-radius: 50%;
}

:host([data-fr-loading-style="orbit"]) .fr-loading-visual > i:first-child {
  position: absolute;
  top: -1px;
  left: 5.5px;
  display: block;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  transform-origin: 1.5px 8px;
  animation: fluent-read-loading-spin 1.3s linear infinite;
}

:host([data-fr-loading-style="orbit"]) .fr-loading-visual > i:nth-child(2) {
  position: absolute;
  top: 5px;
  left: 5px;
  display: block;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  opacity: .32;
}

:host([data-fr-loading-style="sparkle"]) .fr-loading-visual {
  width: 16px;
  height: 14px;
}

:host([data-fr-loading-style="sparkle"]) .fr-loading-visual > i {
  position: absolute;
  display: block;
  clip-path: polygon(50% 0, 63% 37%, 100% 50%, 63% 63%, 50% 100%, 37% 63%, 0 50%, 37% 37%);
  border-radius: 1px;
  animation: fluent-read-loading-sparkle 1.45s ease-in-out infinite;
}

:host([data-fr-loading-style="sparkle"]) .fr-loading-visual > i:first-child {
  top: 2px;
  left: 1px;
  width: 8px;
  height: 8px;
}

:host([data-fr-loading-style="sparkle"]) .fr-loading-visual > i:nth-child(2) {
  right: 1px;
  bottom: 1px;
  width: 5px;
  height: 5px;
  opacity: .38;
  animation-delay: .42s;
}

:host([data-fr-cache="true"]) .fr-loading-visual {
  color: #679276;
}

:host([data-fr-cache="true"][data-fr-loading-style="ring"]) .fr-loading-visual {
  border-color: rgba(103, 146, 118, .22);
  border-top-color: rgba(82, 139, 101, .82);
  border-right-color: rgba(82, 139, 101, .48);
}

:host([data-fr-motion="static"]) .fr-loading-visual,
:host([data-fr-motion="static"]) .fr-loading-visual > i {
  animation: none !important;
}

:host([data-fr-motion="static"][data-fr-loading-style="minimal"]) .fr-loading-visual > i:first-child {
  opacity: .55;
  transform: none;
}

:host([data-fr-motion="static"][data-fr-loading-style="dots"]) .fr-loading-visual > i {
  opacity: .5;
  transform: none;
}

:host([data-fr-motion="static"][data-fr-loading-style="sparkle"]) .fr-loading-visual > i {
  opacity: .5;
  transform: none;
}

@keyframes fluent-read-loading-breathe {
  0%, 100% { opacity: .3; transform: scale(.82); }
  50% { opacity: .62; transform: scale(1); }
}

@keyframes fluent-read-loading-spin {
  to { transform: rotate(360deg); }
}

@keyframes fluent-read-loading-dot {
  0%, 60%, 100% { opacity: .38; transform: translateY(1px); }
  30% { opacity: .76; transform: translateY(-2px); }
}

@keyframes fluent-read-loading-sparkle {
  0%, 100% { opacity: .22; transform: scale(.72) rotate(0deg); }
  48% { opacity: .72; transform: scale(1) rotate(20deg); }
}

@media (prefers-reduced-motion: reduce) {
  .fr-loading-visual,
  .fr-loading-visual > i {
    animation: none !important;
  }
}
`

/** 创建固定外部布局、完全隔离内部视觉的加载指示器。 */
export function createTranslationLoadingIndicator(
  document: Document,
  options: TranslationLoadingIndicatorOptions,
): HTMLElement {
  const host = document.createElement('span')
  const style = normalizeTranslationLoadingStyle(options.style)
  host.className = 'fluent-read-loading'
  host.setAttribute('aria-hidden', 'true')
  host.setAttribute('translate', 'no')
  host.setAttribute('data-fr-loading-style', style)
  host.setAttribute('data-fr-motion', options.animated ? 'animated' : 'static')
  if (options.cacheHit) host.setAttribute('data-fr-cache', 'true')
  for (const [property, value] of HOST_IMPORTANT_STYLES) {
    host.style.setProperty(property, value, 'important')
  }

  // closed root 也不会被全文扫描当作待翻译页面内容，并阻止宿主页脚本
  // 直接改写内部样式；外层 host 仍保留状态机需要的可观察标记。
  const shadow = host.attachShadow({mode: 'closed'})
  const stylesheet = document.createElement('style')
  stylesheet.textContent = LOADING_INDICATOR_STYLES
  const visual = document.createElement('span')
  visual.className = 'fr-loading-visual'
  visual.setAttribute('aria-hidden', 'true')
  visual.append(
    document.createElement('i'),
    document.createElement('i'),
    document.createElement('i'),
  )
  shadow.append(stylesheet, visual)
  return host
}

/** 总开关关闭或系统要求减少动态效果时，只渲染静态状态。 */
export function shouldAnimateTranslationLoading(
  animationsEnabled: boolean,
  view: Pick<Window, 'matchMedia'> | null = null,
): boolean {
  if (!animationsEnabled) return false
  if (!view) return true
  try {
    return view.matchMedia('(prefers-reduced-motion: reduce)').matches !== true
  } catch {
    return true
  }
}

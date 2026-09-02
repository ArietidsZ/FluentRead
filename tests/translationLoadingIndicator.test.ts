import {describe, expect, it} from 'vitest'
import {parseHTML} from 'linkedom'
import {
  createTranslationLoadingIndicator,
  shouldAnimateTranslationLoading,
} from '@/src/ui/translationLoadingIndicator'
import {translationLoadingStyleOptions} from '@/src/core/config/translationLoadingStyle'

describe('段落翻译加载指示器', () => {
  it('每种注册样式都在独立 Shadow Root 内生成固定结构', () => {
    const {document} = parseHTML('<html><body></body></html>')

    for (const option of translationLoadingStyleOptions) {
      const indicator = createTranslationLoadingIndicator(document, {
        style: option.value,
        animated: true,
      })

      expect(indicator.classList.contains('fluent-read-loading')).toBe(true)
      expect(indicator.getAttribute('data-fr-loading-style')).toBe(option.value)
      expect(indicator.getAttribute('data-fr-motion')).toBe('animated')
      expect(indicator.getAttribute('aria-hidden')).toBe('true')
      expect(indicator.getAttribute('translate')).toBe('no')
      expect(indicator.style.getPropertyValue('width')).toBe('16px')
      expect(indicator.style.getPropertyValue('animation')).toBe('none')
      expect(indicator.shadowRoot).toBeNull()
    }
  })

  it('系统减少动态效果的偏好优先于总动画开关', () => {
    const reducedMotion = {matchMedia: () => ({matches: true}) as MediaQueryList}
    const regularMotion = {matchMedia: () => ({matches: false}) as MediaQueryList}

    expect(shouldAnimateTranslationLoading(false, regularMotion)).toBe(false)
    expect(shouldAnimateTranslationLoading(true, reducedMotion)).toBe(false)
    expect(shouldAnimateTranslationLoading(true, regularMotion)).toBe(true)
    expect(shouldAnimateTranslationLoading(true, null)).toBe(true)
    expect(shouldAnimateTranslationLoading(true)).toBe(true)
    expect(shouldAnimateTranslationLoading(true, {matchMedia: () => { throw new Error('blocked') }})).toBe(true)
  })

  it('关闭总动画时为所选样式生成静态兼容状态', () => {
    const {document} = parseHTML('<html><body></body></html>')
    const indicator = createTranslationLoadingIndicator(document, {
      style: 'dots',
      animated: false,
    })

    expect(indicator.getAttribute('data-fr-motion')).toBe('static')
    expect(indicator.classList.contains('static')).toBe(false)
    expect(indicator.hasAttribute('data-fr-cache')).toBe(false)
  })

  it('缓存状态只通过隔离宿主属性改变内部色彩', () => {
    const {document} = parseHTML('<html><body></body></html>')
    const indicator = createTranslationLoadingIndicator(document, {
      style: 'ring',
      animated: true,
      cacheHit: true,
    })

    expect(indicator.getAttribute('data-fr-cache')).toBe('true')
    expect(indicator.style.getPropertyValue('border')).toBe('0')
  })
})

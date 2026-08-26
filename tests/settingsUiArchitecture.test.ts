import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

function sourceBody(path: string): string {
  const content = source(path)
  const header = content.match(/^\/\*\*[\s\S]*?\*\/\s*/u)?.[0]
  return header?.includes('@file ' + path) ? content.slice(header.length) : content
}

describe('options UI composition architecture', () => {
  it('keeps the WXT options entrypoint as a thin app composition shell', () => {
    const entrypoint = source('entrypoints/options/main.ts')
    expect(entrypoint).toBe("import { mountOptionsApp } from '@/src/app/options'\n\nmountOptionsApp('#app')\n")
  })

  it('keeps the WXT popup entrypoint as a thin app composition shell', () => {
    const entrypoint = source('entrypoints/popup/main.ts')
    expect(entrypoint).toBe("import {mountPopupApp} from '@/src/app/popup';\n\nmountPopupApp('#app');\n")
  })

  it('owns settings, feature UI and shared components in their target layers', () => {
    const optionsApp = source('src/app/options/OptionsApp.vue')
    const settingsSections = source('src/features/settings/ui/SettingsSections.vue')
    const popup = source('src/app/popup/PopupApp.vue')
    const imageSettings = source('src/features/image-translation/ui/ImageOcrSettings.vue')
    const imagePublic = source('src/features/image-translation/public.ts')

    expect(optionsApp).toContain("@/src/features/settings/ui/SettingsSections.vue")
    expect(optionsApp).toContain("@/src/features/vocabulary/ui/VocabularyBook.vue")
    expect(settingsSections).not.toContain('@/entrypoints/')
    expect(settingsSections).toContain('<style scoped src="./settings-sections.css"></style>')
    expect(settingsSections).toContain('<ImageOcrSettings />')
    expect(settingsSections).toContain("id=\"settings-webpage\"")
    expect(settingsSections).toContain('<ConfigManagement')
    expect(settingsSections).toContain('<SettingsGroup')
    expect(settingsSections).not.toContain('fluentReadImageOcrDownload')
    expect(imagePublic).toContain("from './ui/ImageOcrSettings.vue'")
    expect(imageSettings).toContain('当前浏览器暂不支持图片翻译与 OCR')
    expect(imageSettings).toContain("type: 'fluentReadImageOcrDownload'")
    expect(imageSettings).toContain('<style scoped src="./image-ocr-settings.css"></style>')
    expect(popup).toContain('@/src/ui/components/CustomHotkeyInput.vue')
    expect(popup).toContain('@/src/ui/components/ServiceIcon.vue')
    expect(popup).toContain('@/src/platform/browser/ids')
    expect(popup).not.toMatch(/(?:!tab\?\.id|filter\(tab\s*=>\s*tab\.id\))/u)
    expect(settingsSections).toContain('@/src/platform/browser/ids')
    expect(settingsSections).not.toMatch(/if\s*\(\s*!?tab\.id\s*\)/u)
  })

  it('filters Chrome-only providers in every options selector without overwriting old values', () => {
    const settings = source('src/features/settings/ui/SettingsSections.vue')
    const document = source('src/app/document-translation/DocumentApp.vue')
    const translationCenter = source('src/features/translation-center/ui/TranslationCenter.vue')

    expect(settings).toContain('filterAvailableTranslationServices(options.services)')
    expect(settings).toContain('selectedTextServiceUnavailableMessage')
    expect(settings).toContain('selectedVideoServiceUnavailableMessage')
    expect(settings).toContain('Chrome内置AI翻译（当前浏览器不可用）')
    expect(document).toContain('filterAvailableTranslationServices(options.services)')
    expect(document).toContain('documentServiceUnavailableMessage')
    expect(translationCenter).toContain('filterAvailableTranslationServices(options.services)')
    expect(translationCenter).toContain('原配置会保留')
    expect(translationCenter).toContain('if (!isTranslationServiceAvailable(service)) return [service]')
  })

  it('makes the global default translation service visually explicit without changing catalog clicks', () => {
    const settings = source('src/features/settings/ui/SettingsSections.vue')
    const styles = sourceBody('src/features/settings/ui/settings-sections.css')

    expect(settings).toContain('data-testid="default-translation-service-card"')
    expect(settings).toContain(':data-default-service="config.service"')
    expect(settings).toContain('<ServiceIcon :service="config.service"')
    expect(settings).toContain('全局默认')
    expect(settings).toContain('切换默认服务')
    expect(settings).toContain('defaultTextServiceLabel')
    expect(styles).toContain('.service-default-card')
    expect(styles).toContain('box-shadow: inset 4px 0 0 var(--brand);')
  })

  it('loads shared tokens before the unchanged settings page rules', () => {
    const pageStyles = sourceBody('src/features/settings/ui/settings-page.css')
    const tokens = source('src/ui/styles/tokens.css')

    expect(pageStyles.startsWith('@import "../../../ui/styles/tokens.css";')).toBe(true)
    expect(tokens).toContain('--fr-color-brand: #ef4776;')
    expect(tokens).toContain('--surface-soft: var(--fr-color-surface-soft);')
  })
})

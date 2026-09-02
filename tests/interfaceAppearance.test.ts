import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INTERFACE_VISIBILITY,
  getInterfaceSkinOption,
  interfaceSkinGroups,
  interfaceSkinOptions,
  interfaceSkinPopupWidth,
  interfaceSkinUsesContentHeight,
  interfaceVisibilityOptions,
  normalizeInterfaceSkin,
  normalizeInterfaceVisibility,
} from '@/src/core/config/interfaceAppearance'
import { Config, normalizeConfig } from '@/src/core/config/model'

describe('界面皮肤与栏目配置', () => {
  it('默认保留当前界面并显示所有 Popup 栏目', () => {
    const config = new Config()

    expect(config.interfaceSkin).toBe('default')
    expect(config.interfaceVisibility).toEqual(DEFAULT_INTERFACE_VISIBILITY)
    const expectedSkins = [
      'default',
      'minimal',
      'compact',
      'contrast',
      'cheese',
      'ocean',
      'matcha',
      'sakura',
      'midnight',
      'paper',
    ]
    expect(interfaceSkinOptions.map((item) => item.value)).toEqual(expectedSkins)
    expect(interfaceSkinOptions.map((item) => item.label)).toEqual([
      '默认风格',
      '简约风格',
      '紧凑风格',
      '高对比 ⚡',
      '奶酪 🧀',
      '海盐 🌊',
      '抹茶 🍵',
      '樱花 🌸',
      '夜幕 🌙',
      '纸张护眼 📖',
    ])
    expect(interfaceSkinGroups.map((item) => item.value)).toEqual(['utility', 'palette'])
    expect(interfaceSkinOptions.filter((item) => item.group === 'utility')).toHaveLength(4)
    expect(interfaceSkinOptions.filter((item) => item.group === 'palette')).toHaveLength(6)
    expect(new Set(interfaceSkinOptions.map((item) => JSON.stringify(item.preview))).size).toBe(10)
    expect(interfaceSkinOptions.slice(1).every((item) => item.popupHeight === 'content')).toBe(true)
    expect(interfaceSkinOptions.filter((item) => item.value !== 'compact').every((item) => item.popupWidth === 400)).toBe(true)
    expect(getInterfaceSkinOption('compact').popupWidth).toBe(360)
    expect(interfaceVisibilityOptions.map((item) => item.key)).toEqual([
      'popupQuickFeatures',
      'popupSiteRule',
      'popupFooter',
    ])
  })

  it('只接受注册皮肤，并为升级旧配置补齐栏目开关', () => {
    for (const skin of interfaceSkinOptions) {
      expect(normalizeInterfaceSkin(skin.value)).toBe(skin.value)
    }
    expect(normalizeInterfaceSkin('plain')).toBe('default')
    expect(normalizeInterfaceSkin('soft')).toBe('default')
    expect(normalizeInterfaceSkin('unknown')).toBe('default')
    expect(normalizeInterfaceSkin(null)).toBe('default')
    expect(getInterfaceSkinOption('cheese').label).toBe('奶酪 🧀')
    expect(getInterfaceSkinOption('unknown').value).toBe('default')
    expect(getInterfaceSkinOption(null).value).toBe('default')
    expect(interfaceSkinUsesContentHeight('default')).toBe(false)
    expect(interfaceSkinUsesContentHeight('minimal')).toBe(true)
    expect(interfaceSkinUsesContentHeight('paper')).toBe(true)
    expect(interfaceSkinUsesContentHeight('unknown')).toBe(false)
    expect(interfaceSkinPopupWidth('default')).toBe(400)
    expect(interfaceSkinPopupWidth('compact')).toBe(360)
    expect(interfaceSkinPopupWidth('unknown')).toBe(400)

    expect(normalizeInterfaceVisibility({popupQuickFeatures: false})).toEqual({
      popupQuickFeatures: false,
      popupSiteRule: true,
      popupFooter: true,
    })
    expect(normalizeInterfaceVisibility({
      popupQuickFeatures: 'false',
      popupSiteRule: false,
      popupFooter: null,
      futureSection: false,
    })).toEqual({
      popupQuickFeatures: true,
      popupSiteRule: false,
      popupFooter: true,
    })
  })

  it('normalizeConfig 会清洗畸形的皮肤和栏目配置', () => {
    const normalized = normalizeConfig({
      interfaceSkin: 'cheese',
      interfaceVisibility: {popupQuickFeatures: false},
    })

    expect(normalized.interfaceSkin).toBe('cheese')
    expect(normalized.interfaceVisibility).toEqual({
      popupQuickFeatures: false,
      popupSiteRule: true,
      popupFooter: true,
    })
    expect(normalizeConfig({interfaceSkin: 'invalid', interfaceVisibility: []})).toMatchObject({
      interfaceSkin: 'default',
      interfaceVisibility: DEFAULT_INTERFACE_VISIBILITY,
    })
  })
})

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INTERFACE_VISIBILITY,
  interfaceSkinOptions,
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
    expect(interfaceSkinOptions.map((item) => item.value)).toEqual([
      'default',
      'minimal',
      'plain',
      'compact',
      'soft',
    ])
    expect(interfaceSkinOptions.map((item) => item.label)).toEqual([
      '默认风格',
      '简约风格',
      '朴素风格',
      '紧凑风格',
      '柔和风格',
    ])
    expect(interfaceVisibilityOptions.map((item) => item.key)).toEqual([
      'popupQuickFeatures',
      'popupSiteRule',
      'popupFooter',
    ])
  })

  it('只接受注册皮肤，并为升级旧配置补齐栏目开关', () => {
    expect(normalizeInterfaceSkin('minimal')).toBe('minimal')
    expect(normalizeInterfaceSkin('plain')).toBe('plain')
    expect(normalizeInterfaceSkin('compact')).toBe('compact')
    expect(normalizeInterfaceSkin('soft')).toBe('soft')
    expect(normalizeInterfaceSkin('unknown')).toBe('default')
    expect(normalizeInterfaceSkin(null)).toBe('default')

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
      interfaceSkin: 'minimal',
      interfaceVisibility: {popupQuickFeatures: false},
    })

    expect(normalized.interfaceSkin).toBe('minimal')
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

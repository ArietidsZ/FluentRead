import { describe, expect, it } from 'vitest'
import { defaultOption } from '@/entrypoints/utils/option'
import {
  isConfigImportValid,
  prepareConfigForImport,
  sanitizeConfigForExport,
} from '@/entrypoints/utils/config-transfer'
import { normalizeConfig } from '@/entrypoints/utils/model'

const validConfig = {
  on: true,
  service: 'openai',
  display: 1,
  from: 'auto',
  to: 'zh-Hans',
}

describe('configuration transfer helpers', () => {
  it('accepts the minimum import shape and rejects malformed values', () => {
    expect(isConfigImportValid(validConfig)).toBe(true)
    expect(isConfigImportValid({...validConfig, on: false, display: 0, service: 'freeTranslation'})).toBe(true)
    expect(isConfigImportValid({ ...validConfig, service: 42 })).toBe(false)
    expect(isConfigImportValid({ ...validConfig, service: 'not-a-real-service' })).toBe(false)
    expect(isConfigImportValid({ ...validConfig, on: null })).toBe(false)
    expect(isConfigImportValid({ ...validConfig, display: {} })).toBe(false)
    expect(isConfigImportValid({ ...validConfig, display: 2 })).toBe(false)
    expect(isConfigImportValid({ ...validConfig, from: 42 })).toBe(false)
    expect(isConfigImportValid({ ...validConfig, from: '  ' })).toBe(false)
    expect(isConfigImportValid({ ...validConfig, to: [] })).toBe(false)
    expect(isConfigImportValid({ ...validConfig, to: '' })).toBe(false)
    expect(isConfigImportValid({ ...validConfig, customBody: { openai: '{}' } })).toBe(true)
    expect(isConfigImportValid({ ...validConfig, customBody: { openai: null } })).toBe(false)
    expect(isConfigImportValid({ ...validConfig, to: undefined })).toBe(false)
    expect(isConfigImportValid({ service: 'openai' })).toBe(false)
    expect(isConfigImportValid(null)).toBe(false)
    expect(() => prepareConfigForImport({...validConfig, on: null}, validConfig))
      .toThrow('缺少有效的基础字段')
  })

  it('removes default-only fields without mutating the source', () => {
    const source = {
      ...validConfig,
      system_role: {
        openai: defaultOption.system_role,
        deepseek: 'Translate with a concise tone.',
      },
      user_role: {
        openai: defaultOption.user_role,
      },
      customBody: {
        openai: '   ',
        deepseek: '{"thinking":{"type":"disabled"}}',
      },
    }

    const sanitized = sanitizeConfigForExport(source)

    expect(sanitized).toEqual({
      ...validConfig,
      system_role: { deepseek: 'Translate with a concise tone.' },
      customBody: { deepseek: '{"thinking":{"type":"disabled"}}' },
    })
    expect(source.system_role).toHaveProperty('openai')
    expect(source.user_role).toHaveProperty('openai')
    expect(source.customBody).toHaveProperty('openai')
  })

  it('removes empty maps after cleaning their entries', () => {
    const sanitized = sanitizeConfigForExport({
      ...validConfig,
      system_role: { openai: defaultOption.system_role },
      user_role: { openai: defaultOption.user_role },
      customBody: { openai: '' },
    })

    expect(sanitized).toEqual(validConfig)
  })

  it('导出时移除所有凭据字段和内部 revision', () => {
    const secret = 'export-secret-sentinel'
    const structuredSecret = 'nested-export-secret-sentinel'
    const customBody = `{"apiToken":"${secret}"}`
    const proxy = `https://user:${secret}@proxy.example`
    const sanitized = sanitizeConfigForExport({
      ...validConfig,
      token: {openai: secret},
      ak: secret,
      sk: secret,
      appid: secret,
      key: secret,
      youdaoAppKey: secret,
      youdaoAppSecret: secret,
      tencentSecretId: secret,
      tencentSecretKey: secret,
      extra: {jwt: secret},
      apiToken: secret,
      accountPassword: secret,
      authorizationHeader: `Bearer ${secret}`,
      futureSafeSetting: 'keep-me',
      futureProvider: {
        endpoint: 'https://future.example',
        apiToken: structuredSecret,
        nested: {
          password: structuredSecret,
          region: 'cn',
        },
        candidates: [{token: structuredSecret, name: 'primary'}, 'literal-value'],
      },
      customBody: {openai: customBody},
      proxy: {openai: proxy},
      count: 99,
      persistCredentials: true,
      __fluentConfigRevision: 42,
    })

    expect(JSON.stringify(sanitized)).not.toContain(structuredSecret)
    for (const field of [
      'token', 'ak', 'sk', 'appid', 'key', 'youdaoAppKey', 'youdaoAppSecret',
      'tencentSecretId', 'tencentSecretKey', 'extra', '__fluentConfigRevision',
      'apiToken', 'accountPassword', 'authorizationHeader',
      'count', 'persistCredentials',
    ]) {
      expect(sanitized).not.toHaveProperty(field)
    }
    expect(sanitized.futureSafeSetting).toBe('keep-me')
    expect(sanitized.futureProvider).toEqual({
      endpoint: 'https://future.example',
      nested: {region: 'cn'},
      candidates: [{name: 'primary'}, 'literal-value'],
    })
    expect(sanitized.customBody).toEqual({openai: customBody})
    expect(sanitized.proxy).toEqual({openai: proxy})
  })

  it('导入新版公开配置时保留当前 session 凭据和持久化选择', () => {
    const currentSecret = 'current-session-secret'
    const prepared = prepareConfigForImport(
      {...validConfig, to: 'ja', count: 1, persistCredentials: true, videoServiceDefaultMigrated: false},
      {...validConfig, token: {openai: currentSecret}, count: 42, persistCredentials: false, videoServiceDefaultMigrated: true},
    )

    expect(prepared.to).toBe('ja')
    expect(prepared.token.openai).toBe(currentSecret)
    expect(prepared.count).toBe(42)
    expect(prepared.persistCredentials).toBe(false)
    expect(prepared.videoServiceDefaultMigrated).toBe(true)
  })

  it('导入旧文件时迁移其中凭据，但不能由文件静默开启本地持久化', () => {
    const legacySecret = 'legacy-import-secret'
    const prepared = prepareConfigForImport(
      {...validConfig, token: {openai: legacySecret}, extra: {jwt: legacySecret}, persistCredentials: true},
      {
        ...validConfig,
        token: {openai: 'current-secret', deepseek: 'keep-deepseek'},
        sk: 'keep-sk',
        youdaoAppSecret: 'keep-youdao-secret',
        extra: {keep: 'current-extra'},
        persistCredentials: false,
      },
    )

    expect(prepared.token.openai).toBe(legacySecret)
    expect(prepared.token.deepseek).toBe('keep-deepseek')
    expect(prepared.sk).toBe('keep-sk')
    expect(prepared.youdaoAppSecret).toBe('keep-youdao-secret')
    expect(prepared.extra).toEqual({keep: 'current-extra', jwt: legacySecret})
    expect(prepared.persistCredentials).toBe(false)
  })

  it('旧文件中的无效凭据映射不清空当前映射，只更新合法的显式字段', () => {
    const prepared = prepareConfigForImport(
      {...validConfig, ak: 'legacy-ak', token: null, extra: null},
      {...validConfig, ak: 'current-ak', token: {openai: 'keep-token'}, extra: {keep: true}},
    )

    expect(prepared.ak).toBe('legacy-ak')
    expect(prepared.token.openai).toBe('keep-token')
    expect(prepared.extra).toEqual({keep: true})
  })

  it('导入时递归丢弃未知敏感字段，但保留普通前向兼容字段和原始字符串', () => {
    const customBody = '{"nested":{"password":"body-value"}}'
    const proxy = 'https://user:proxy-password@proxy.example'
    const prepared = prepareConfigForImport(
      {
        ...validConfig,
        apiToken: 'unknown-secret',
        accountPassword: 'hidden',
        futureSafeSetting: 'keep-me',
        futureProvider: {
          apiToken: 'nested-secret',
          endpoint: 'https://future.example',
          nested: {password: 'hidden', label: 'keep-label'},
          candidates: [{token: 'hidden', model: 'keep-model'}],
        },
        customBody: {openai: customBody},
        proxy: {openai: proxy},
      },
      validConfig,
    ) as unknown as Record<string, unknown>

    expect(prepared.apiToken).toBeUndefined()
    expect(prepared.accountPassword).toBeUndefined()
    expect(prepared.futureSafeSetting).toBe('keep-me')
    expect(prepared.futureProvider).toEqual({
      endpoint: 'https://future.example',
      nested: {label: 'keep-label'},
      candidates: [{model: 'keep-model'}],
    })
    expect(prepared.customBody).toEqual({openai: customBody})
    expect(prepared.proxy).toEqual({openai: proxy})
  })

  it('preserves always-translate site rules through export and normalized import', () => {
    const exported = sanitizeConfigForExport({
      ...validConfig,
      alwaysTranslateDomains: ['https://docs.example.com/guide', 'EXAMPLE.COM', 'news.bbc.co.uk'],
      disabledExtensionDomains: ['https://app.example.net/settings', 'EXAMPLE.NET'],
    })

    expect(exported.alwaysTranslateDomains).toEqual([
      'https://docs.example.com/guide',
      'EXAMPLE.COM',
      'news.bbc.co.uk',
    ])
    expect(isConfigImportValid(exported)).toBe(true)
    expect(normalizeConfig(exported).alwaysTranslateDomains).toEqual(['example.com', 'bbc.co.uk'])
    expect(normalizeConfig(exported).disabledExtensionDomains).toEqual(['example.net'])
  })

  it('DeepLX 视频服务可以经过新版导出与导入往返而不触发旧默认迁移', () => {
    const exported = sanitizeConfigForExport(normalizeConfig({
      ...validConfig,
      videoService: 'deeplx',
      videoServiceDefaultMigrated: true,
    }))
    const prepared = prepareConfigForImport(exported, normalizeConfig(validConfig))

    expect(exported.videoServiceDefaultMigrated).toBe(true)
    expect(prepared.videoService).toBe('deeplx')
  })
})

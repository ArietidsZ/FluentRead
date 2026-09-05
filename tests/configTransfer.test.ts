import { describe, expect, it } from 'vitest'
import {defaultOption, services} from '@/src/core/config/catalog'
import {
  isConfigImportValid,
  prepareConfigForExport,
  prepareConfigForImport,
  sanitizeConfigForExport,
} from '@/src/core/config/transfer'
import { Config, normalizeConfig } from '@/src/core/config/model'

const validConfig = {
  on: true,
  service: 'openai',
  display: 1,
  from: 'auto',
  to: 'zh-Hans',
}

describe('configuration transfer helpers', () => {
  it('往返保留 DeepL API Pro 套餐，旧备份与无效套餐回到原有 Free 端点', () => {
    const current = normalizeConfig({...new Config(), ...validConfig, deeplApiPlan: 'pro'})
    const exported = prepareConfigForExport(current)

    expect(exported.deeplApiPlan).toBe('pro')
    expect(prepareConfigForImport(exported, current).deeplApiPlan).toBe('pro')
    const {deeplApiPlan: _legacyMissingPlan, ...legacy} = exported
    expect(prepareConfigForImport(legacy, current).deeplApiPlan).toBe('free')
    expect(prepareConfigForImport({...exported, deeplApiPlan: 'paid'}, current).deeplApiPlan).toBe('free')
  })

  it('往返保留非默认段落加载样式，并把旧文件与非法值迁移到柔和圆环默认值', () => {
    const current = normalizeConfig({...new Config(), ...validConfig, translationLoadingStyle: 'sparkle'})
    const orbitExport = prepareConfigForExport({...current, translationLoadingStyle: 'orbit'})

    expect(orbitExport.translationLoadingStyle).toBe('orbit')
    expect(prepareConfigForImport(orbitExport, current).translationLoadingStyle).toBe('orbit')

    const {translationLoadingStyle: _missingLegacyField, ...legacyExport} = orbitExport
    expect(prepareConfigForImport(legacyExport, current).translationLoadingStyle).toBe('ring')
    expect(prepareConfigForImport({
      ...orbitExport,
      translationLoadingStyle: 'page-controlled-animation',
    }, current).translationLoadingStyle).toBe('ring')
  })

  it('accepts the minimum import shape and rejects malformed values', () => {
    expect(isConfigImportValid(validConfig)).toBe(true)
    expect(isConfigImportValid({...validConfig, on: false, display: 0, service: 'freeTranslation'})).toBe(true)
    expect(isConfigImportValid({ ...validConfig, service: 42 })).toBe(false)
    expect(isConfigImportValid({ ...validConfig, service: 'not-a-real-service' })).toBe(false)
    expect(isConfigImportValid({
      ...validConfig,
      service: 'custom:missing',
      customOpenAIProviders: [],
    })).toBe(false)
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

  it('用户主动导出时保留全部设置、提示词和专用 API 凭据', () => {
    const source = normalizeConfig({
      ...validConfig,
      token: {openai: 'openai-key', deepseek: 'deepseek-key'},
      ak: 'access-key',
      sk: 'secret-key',
      appid: 'baidu-app-id',
      key: 'baidu-secret-key',
      youdaoAppKey: 'youdao-app-key',
      youdaoAppSecret: 'youdao-app-secret',
      tencentSecretId: 'tencent-secret-id',
      tencentSecretKey: 'tencent-secret-key',
      extra: {providerCredential: 'extra-secret'},
      model: {openai: 'custom-model'},
      customModel: {openai: 'private-deployment'},
      customBody: {openai: '{"reasoning":{"effort":"low"}}'},
      proxy: {openai: 'https://proxy.example/v1'},
      system_role: {openai: 'Custom system prompt'},
      user_role: {openai: 'Custom user prompt: {{text}}'},
      alwaysTranslateDomains: ['example.com'],
      count: 99,
      persistCredentials: true,
      __fluentConfigRevision: 42,
    })

    const exported = prepareConfigForExport(source)

    expect(exported.token).toEqual(source.token)
    expect(exported.ak).toBe(source.ak)
    expect(exported.sk).toBe(source.sk)
    expect(exported.appid).toBe(source.appid)
    expect(exported.key).toBe(source.key)
    expect(exported.youdaoAppKey).toBe(source.youdaoAppKey)
    expect(exported.youdaoAppSecret).toBe(source.youdaoAppSecret)
    expect(exported.tencentSecretId).toBe(source.tencentSecretId)
    expect(exported.tencentSecretKey).toBe(source.tencentSecretKey)
    expect(exported.extra).toEqual(source.extra)
    expect(exported.model).toEqual(source.model)
    expect(exported.customModel).toEqual(source.customModel)
    expect(exported.customModels).toEqual(source.customModels)
    expect(exported.customBody).toEqual(source.customBody)
    expect(exported.proxy).toEqual(source.proxy)
    expect(exported.system_role).toEqual(source.system_role)
    expect(exported.user_role).toEqual(source.user_role)
    expect(exported.alwaysTranslateDomains).toEqual(['example.com'])
    expect(exported).not.toHaveProperty('persistCredentials')
    expect(exported).not.toHaveProperty('count')
    expect(exported).not.toHaveProperty('__fluentConfigRevision')
  })

  it('完整迁移配置动态覆盖 Config 全字段，并按统一持久化契约往返导入', () => {
    const source = normalizeConfig({
      ...new Config(),
      on: false,
      autoTranslate: true,
      from: 'en',
      to: 'ja',
      service: 'openai',
      documentService: 'openai',
      documentModel: {openai: 'document-model-sentinel'},
      documentCustomModel: {openai: 'document-custom-model-sentinel'},
      videoTranslationEnabled: true,
      videoService: 'openai',
      token: {openai: 'schema-token-sentinel'},
      requireApiKey: {openai: true},
      appid: 'schema-appid-sentinel',
      key: 'schema-key-sentinel',
      model: {openai: 'schema-model-sentinel'},
      customModel: {openai: 'schema-custom-model-sentinel'},
      customModels: {openai: ['schema-custom-model-sentinel', 'schema-custom-model-two']},
      customBody: {openai: '{"schema":"custom-body-sentinel"}'},
      proxy: {openai: 'https://schema-proxy.invalid/v1'},
      extra: {schema: 'extra-sentinel'},
      system_role: {openai: 'schema-system-role-sentinel'},
      user_role: {openai: 'schema-user-role-sentinel {{text}}'},
      alwaysTranslateDomains: ['schema.example'],
      disabledExtensionDomains: ['disabled.example'],
      theme: 'dark',
      translationCenterServices: ['openai'],
      translationCenterSourceLanguage: 'en',
      translationCenterTargetLanguage: 'ja',
      count: 73,
      persistCredentials: true,
    })
    const exported = prepareConfigForExport(source)
    const expectedExportKeys = Object.keys(source)
      .filter(key => key !== 'count')
      .sort()
    expect(Object.keys(exported).sort()).toEqual(expectedExportKeys)

    const target = normalizeConfig({...new Config(), count: 911, persistCredentials: false})
    const imported = prepareConfigForImport(exported, target)
    for (const key of Object.keys(source) as Array<keyof Config>) {
      if (key === 'count' || key === 'videoServiceDefaultMigrated') continue
      expect(imported[key], `字段 ${key} 未完成完整导出/导入往返`).toEqual(source[key])
    }
    expect(imported.count).toBe(target.count)
    expect(imported).not.toHaveProperty('persistCredentials')
    expect(imported.videoServiceDefaultMigrated).toBe(target.videoServiceDefaultMigrated)
  })

  it('完整与公开导出都保留快捷翻译方案，并在导入时精确替换目标端方案', () => {
    const source = normalizeConfig({
      ...new Config(),
      quickTranslationProfiles: [
        {
          id: 'hover-openai', enabled: true, action: 'hover', hotkey: 'Ctrl+T',
          service: services.openai, model: 'quick-model', targetLanguage: 'ja',
          displayMode: 'bilingual', fullPageMode: 'inherit',
        },
        {
          id: 'page-default', enabled: true, action: 'full-page', hotkey: 'Ctrl+Y',
          service: '', model: '', targetLanguage: '',
          displayMode: 'translation-only', fullPageMode: 'all',
        },
      ],
    })
    const expected = source.quickTranslationProfiles
    const fullExport = prepareConfigForExport(source)
    const publicExport = sanitizeConfigForExport(source)
    const current = normalizeConfig({
      ...new Config(),
      quickTranslationProfiles: [{
        id: 'old', enabled: true, action: 'hover', hotkey: 'Alt+X',
        service: services.microsoft, model: '', targetLanguage: 'en',
        displayMode: 'inherit', fullPageMode: 'inherit',
      }],
    })

    expect(fullExport.quickTranslationProfiles).toEqual(expected)
    expect(publicExport.quickTranslationProfiles).toEqual(expected)
    expect(isConfigImportValid(fullExport)).toBe(true)
    expect(prepareConfigForImport(fullExport, current).quickTranslationProfiles).toEqual(expected)
  })

  it('完整备份精确替换凭据快照，不保留目标端多余 token、extra 或标量密钥', () => {
    const exported = prepareConfigForExport(normalizeConfig({
      ...new Config(),
      token: {openai: 'backup-openai'},
      extra: {backupCredential: 'backup-extra'},
      ak: '',
    }))
    const current = normalizeConfig({
      ...new Config(),
      token: {openai: 'current-openai', deepseek: 'target-only-token'},
      extra: {targetOnlyCredential: 'target-only-extra'},
      ak: 'target-only-ak',
    })

    const imported = prepareConfigForImport(exported, current, {credentialMode: 'replace'})

    expect(imported.token).toEqual({openai: 'backup-openai'})
    expect(imported.extra).toEqual({backupCredential: 'backup-extra'})
    expect(imported.ak).toBe('')
  })

  it('旧 v1 水合安全合并不让默认空标量清除目标端凭据，但仍接受非空更新', () => {
    const current = normalizeConfig({
      ...new Config(),
      token: {openai: 'current-openai'},
      ak: 'current-ak',
      sk: 'current-sk',
      appid: 'current-appid',
      key: 'current-key',
      youdaoAppKey: 'current-youdao-key',
      youdaoAppSecret: 'current-youdao-secret',
      tencentSecretId: 'current-tencent-id',
      tencentSecretKey: 'current-tencent-key',
    })
    const earlyV1Snapshot = prepareConfigForExport(new Config())
    const imported = prepareConfigForImport({
      ...earlyV1Snapshot,
      ak: 'replacement-ak',
      youdaoAppSecret: '   ',
    }, current, {credentialMode: 'merge-hydration-safe'})

    expect(imported).toMatchObject({
      token: {openai: 'current-openai'},
      ak: 'replacement-ak',
      sk: 'current-sk',
      appid: 'current-appid',
      key: 'current-key',
      youdaoAppKey: 'current-youdao-key',
      youdaoAppSecret: 'current-youdao-secret',
      tencentSecretId: 'current-tencent-id',
      tencentSecretKey: 'current-tencent-key',
    })
  })

  it('完整用户导出拒绝非对象', () => {
    expect(() => prepareConfigForExport(null)).toThrow('配置必须是 JSON 对象')
  })

  it('导入新版公开配置时保留当前已保存凭据并忽略旧策略字段', () => {
    const currentSecret = 'current-saved-secret'
    const prepared = prepareConfigForImport(
      {...validConfig, to: 'ja', count: 1, persistCredentials: true, videoServiceDefaultMigrated: false},
      {...validConfig, token: {openai: currentSecret}, count: 42, persistCredentials: false, videoServiceDefaultMigrated: true},
    )

    expect(prepared.to).toBe('ja')
    expect(prepared.token.openai).toBe(currentSecret)
    expect(prepared.count).toBe(42)
    expect(prepared).not.toHaveProperty('persistCredentials')
    expect(prepared.videoServiceDefaultMigrated).toBe(true)
  })

  it('导入旧文件时迁移其中凭据，并忽略已废弃的持久化开关', () => {
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
    expect(prepared).not.toHaveProperty('persistCredentials')
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

  it('动态自定义服务更换 endpoint 时不会把未显式导入的旧 token 发送给新地址', () => {
    const service = 'custom:1'
    const current = normalizeConfig({
      ...validConfig,
      service,
      customOpenAIProviders: [{
        id: service,
        name: '当前服务',
        endpoint: 'https://old.example/v1/chat/completions',
        models: ['current-model'],
      }],
      model: {[service]: 'current-model'},
      token: {[service]: 'current-secret', openai: 'keep-openai'},
    })
    const imported = (endpoint: string, token?: Record<string, string>) => ({
      ...validConfig,
      service,
      customOpenAIProviders: [{
        id: service,
        name: '导入服务',
        endpoint,
        models: ['imported-model'],
      }],
      model: {[service]: 'imported-model'},
      ...(token === undefined ? {} : {token}),
    })

    const sameEndpoint = prepareConfigForImport(
      imported('https://old.example/v1/chat/completions'),
      current,
    )
    expect(sameEndpoint.token[service]).toBe('current-secret')

    const changedEndpoint = prepareConfigForImport(
      imported('https://new.example/v1/chat/completions'),
      current,
    )
    expect(changedEndpoint.token).not.toHaveProperty(service)
    expect(changedEndpoint.token.openai).toBe('keep-openai')

    const explicitToken = prepareConfigForImport(
      imported('https://new.example/v1/chat/completions', {[service]: 'imported-secret'}),
      current,
    )
    expect(explicitToken.token[service]).toBe('imported-secret')

    const explicitEmptyToken = prepareConfigForImport(
      imported('https://new.example/v1/chat/completions', {[service]: ''}),
      current,
    )
    expect(explicitEmptyToken.token).toHaveProperty(service, '')
  })

  it('旧 custom 配置导入并更换地址时同样解绑本机旧 token', () => {
    const current = normalizeConfig({
      ...validConfig,
      service: 'custom',
      custom: 'https://old.example/v1/chat/completions',
      token: {custom: 'legacy-secret'},
    })
    const imported = prepareConfigForImport({
      ...validConfig,
      service: 'custom',
      custom: 'https://new.example/v1/chat/completions',
      model: {custom: 'legacy-model'},
    }, current)

    expect(imported.customOpenAIProviders).toEqual([
      expect.objectContaining({id: 'custom', endpoint: 'https://new.example/v1/chat/completions'}),
    ])
    expect(imported.token).not.toHaveProperty('custom')
  })

  it('导入孤立动态 token 时不会创建不存在的自定义服务', () => {
    const imported = prepareConfigForImport({
      ...validConfig,
      token: {'custom:orphan': 'orphan-secret'},
    }, validConfig)

    expect(imported.customOpenAIProviders).toEqual([])
    expect(imported.token).not.toHaveProperty('custom:orphan')
  })

  it('自定义或内置服务的 proxy 改道时不会沿用未显式导入的 token', () => {
    const customService = 'custom:proxy'
    const current = normalizeConfig({
      ...validConfig,
      service: customService,
      customOpenAIProviders: [{
        id: customService,
        name: '代理服务',
        endpoint: 'https://origin.example/v1/chat/completions',
        models: ['proxy-model'],
      }],
      model: {[customService]: 'proxy-model'},
      proxy: {
        [customService]: 'https://old-proxy.example/v1/chat/completions',
        openai: 'https://old-openai-proxy.example/v1/chat/completions',
      },
      token: {[customService]: 'custom-secret', openai: 'openai-secret'},
    })
    const imported = prepareConfigForImport({
      ...validConfig,
      service: customService,
      customOpenAIProviders: current.customOpenAIProviders,
      model: {[customService]: 'proxy-model'},
      proxy: {
        [customService]: 'https://new-proxy.example/v1/chat/completions',
        openai: 'https://new-openai-proxy.example/v1/chat/completions',
      },
    }, current)

    expect(imported.token).not.toHaveProperty(customService)
    expect(imported.token).not.toHaveProperty('openai')
  })

  it('腾讯共享密钥在任一 proxy 改道时成对解绑，只有完整显式密钥对可以重绑', () => {
    const current = normalizeConfig({
      ...validConfig,
      proxy: {[services.tencent]: 'https://old-tmt-proxy.example/'},
      tencentSecretId: 'current-tencent-id',
      tencentSecretKey: 'current-tencent-key',
    })
    const imported = (credentials: Record<string, string> = {}) => prepareConfigForImport({
      ...validConfig,
      proxy: {[services.tencent]: 'https://new-tmt-proxy.example/'},
      ...credentials,
    }, current)

    expect(imported()).toMatchObject({tencentSecretId: '', tencentSecretKey: ''})
    expect(imported({tencentSecretId: 'only-new-id'}))
      .toMatchObject({tencentSecretId: '', tencentSecretKey: ''})
    expect(imported({
      tencentSecretId: 'new-tencent-id',
      tencentSecretKey: 'new-tencent-key',
    })).toMatchObject({
      tencentSecretId: 'new-tencent-id',
      tencentSecretKey: 'new-tencent-key',
    })
  })

  it('Gemini proxy 变化不清除只会发往官方端点的 Google Key', () => {
    const current = normalizeConfig({
      ...validConfig,
      proxy: {[services.gemini]: 'https://old-gemini-proxy.example/'},
      token: {[services.gemini]: 'google-official-secret'},
    })
    const imported = prepareConfigForImport({
      ...validConfig,
      proxy: {[services.gemini]: 'https://new-gemini-proxy.example/'},
    }, current)

    expect(imported.token[services.gemini]).toBe('google-official-secret')
  })

  it('有效 proxy 未变时允许自定义 profile 更新而不丢失现有 token', () => {
    const service = 'custom:stable-proxy'
    const proxy = 'https://stable-proxy.example/v1/chat/completions'
    const current = normalizeConfig({
      ...validConfig,
      service,
      customOpenAIProviders: [{
        id: service,
        name: '旧名称',
        endpoint: 'https://old-origin.example/v1/chat/completions',
        models: ['stable-model'],
      }],
      model: {[service]: 'stable-model'},
      proxy: {[service]: proxy},
      token: {[service]: 'stable-secret'},
    })
    const imported = prepareConfigForImport({
      ...validConfig,
      service,
      customOpenAIProviders: [{
        id: service,
        name: '新名称',
        endpoint: 'https://new-origin.example/v1/chat/completions',
        models: ['stable-model'],
      }],
      model: {[service]: 'stable-model'},
      proxy: {[service]: proxy},
    }, current)

    expect(imported.token[service]).toBe('stable-secret')
  })

  it('NewAPI、Azure 与 DeepLX 直连地址改变时解绑未显式导入的 token', () => {
    const current = normalizeConfig({
      ...validConfig,
      newApiUrl: 'https://current-newapi.example/v1',
      azureOpenaiEndpoint: 'https://current-azure.example/openai/deployments/demo/chat/completions',
      deeplx: 'https://current-deeplx.example/translate',
      token: {
        [services.newapi]: 'newapi-secret',
        [services.azureOpenai]: 'azure-secret',
        [services.deeplx]: 'deeplx-secret',
      },
    })
    const imported = prepareConfigForImport({
      ...validConfig,
      newApiUrl: 'https://restored-newapi.example/v1',
      azureOpenaiEndpoint: 'https://restored-azure.example/openai/deployments/demo/chat/completions',
      deeplx: 'https://restored-deeplx.example/translate',
    }, current)

    expect(imported.token).not.toHaveProperty(services.newapi)
    expect(imported.token).not.toHaveProperty(services.azureOpenai)
    expect(imported.token).not.toHaveProperty(services.deeplx)
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

  it('公开脱敏导出保留非敏感的自定义模型列表', () => {
    const exported = sanitizeConfigForExport(normalizeConfig({
      ...validConfig,
      customModels: {grok: ['private-a', 'private-b']},
      token: {grok: 'must-not-export'},
    }))

    expect(exported.customModels).toEqual({grok: ['private-a', 'private-b']})
    expect(exported).not.toHaveProperty('token')
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

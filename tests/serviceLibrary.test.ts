import { describe, expect, it } from 'vitest'
import { Config, normalizeConfig } from '@/src/core/config/model'
import { options, services } from '@/src/core/config/catalog'
import { createApiKeyRequirementKey } from '@/src/core/config/validation'
import { buildPersonalServiceGroups, hasSavedServiceConfiguration } from '@/src/ui/view-model/serviceLibrary'

const provider = { id: 'custom:work', name: '工作接口', endpoint: 'http://localhost:11434/v1', models: ['local-model'] }

describe('personal translation service library', () => {
  it('does not classify prefilled models or default local endpoints as saved user configuration', () => {
    const config = new Config()
    for (const service of Object.values(services)) expect(hasSavedServiceConfiguration(service, config), service).toBe(false)
    config.token.openai = '   '
    config.newApiUrl = ' '
    expect(hasSavedServiceConfiguration('openai', config)).toBe(false)
    expect(hasSavedServiceConfiguration('newapi', config)).toBe(false)
  })

  it('keeps saved and partial configurations discoverable without claiming a connection check', () => {
    const cases: [string, Partial<Config>][] = [
      ['openai', {token: {openai: 'fixture-key'}}],
      ['baiduTranslation', {secret: {baiduTranslation: 'partial-secret'}}],
      ['ollama', {proxy: {ollama: 'http://localhost:11435/v1'}}],
      ['gemini', {customBody: {gemini: '{}'}}],
      ['newapi', {customHeaders: {newapi: '{}'}}],
      ['openai', {customModel: {openai: 'private-model'}}],
      ['deepseek', {customModels: {deepseek: ['another-model']}}],
      ['deepseek', {model: {deepseek: 'deepseek-reasoner'}}],
      ['openai', {requireApiKey: {[createApiKeyRequirementKey('openai', new Config().model.openai)]: false}}],
      ['tencent', {tencentSecretId: 'id-only'}],
      ['huanYuanTranslation', {tencentSecretKey: 'key-only'}],
      ['youdao', {youdaoAppKey: 'app-only'}],
      ['youdao', {youdaoAppSecret: 'secret-only'}],
      ['azureOpenai', {azureOpenaiEndpoint: 'https://example.com'}],
      ['newapi', {newApiUrl: 'http://localhost:5000'}],
      ['custom:work', {customOpenAIProviders: [provider]}],
    ]
    for (const [service, patch] of cases) {
      expect(hasSavedServiceConfiguration(service, Object.assign(new Config(), patch)), service).toBe(true)
    }
  })

  it('normalizes favorites without changing saved credentials, models, defaults or custom names', () => {
    const config = normalizeConfig({favoriteServices: ['deepseek', 'deepseek', null, 'machine', '__proto__', 'unknown', 'custom:gone', 'custom:work', 'chromeTranslator'], customOpenAIProviders: [provider], token: {deepseek: 'fixture-secret'}, service: 'freeTranslation'})
    expect(config.favoriteServices).toEqual(['deepseek', 'custom:work', 'chromeTranslator'])
    expect(config.token.deepseek).toBe('fixture-secret')
    expect(config.customOpenAIProviders[0].name).toBe('工作接口')
    expect(config.service).toBe('freeTranslation')
    expect(normalizeConfig(JSON.parse(JSON.stringify(config))).favoriteServices).toEqual(config.favoriteServices)
    expect(normalizeConfig({...config, customOpenAIProviders: []}).favoriteServices).toEqual(['deepseek', 'chromeTranslator'])
    expect(normalizeConfig({...config, favoriteServices: 'deepseek'}).favoriteServices).toEqual([])
    expect(normalizeConfig({}).favoriteServices).toEqual([])
  })

  it('prioritizes default and stable favorites, deduplicates and retains an unconfigured viewing target', () => {
    const entries = ['freeTranslation', 'openai', 'deepseek', 'gemini'].map(value => ({value, label: value}))
    expect(buildPersonalServiceGroups(entries, 'freeTranslation', 'gemini', ['deepseek', 'missing', 'freeTranslation', 'deepseek'], ['deepseek', 'openai']))
      .toEqual([
        {id: 'default', items: [entries[0]]},
        {id: 'favorites', items: [entries[2]]},
        {id: 'configured', items: [entries[1]]},
        {id: 'viewing', items: [entries[3]]},
      ])
    expect(buildPersonalServiceGroups(entries, 'freeTranslation', 'freeTranslation', [], [])).toEqual([{id: 'default', items: [entries[0]]}])
    expect(buildPersonalServiceGroups([], 'unavailable', 'deleted', [], [])).toEqual([])
  })

  it('removing a favorite does not remove its saved configuration', () => {
    const config = normalizeConfig({favoriteServices: ['openai'], token: {openai: 'fixture-key'}})
    const next = normalizeConfig({...config, favoriteServices: []})
    const entries = options.services.filter(item => item.value === 'openai')
    expect(hasSavedServiceConfiguration('openai', next)).toBe(true)
    expect(buildPersonalServiceGroups(entries, 'freeTranslation', 'openai', next.favoriteServices, ['openai'])[0].id).toBe('configured')
    expect(next.token).toEqual(config.token)
  })
})

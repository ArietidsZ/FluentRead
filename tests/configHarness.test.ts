import { describe, expect, it } from 'vitest'
import { HARNESS_ACTIONS, isHarnessService, normalizeHarnessPreferences } from '@/src/core/config/harness'
import { Config, normalizeConfig } from '@/src/core/config/model'

describe('Harness config contract', () => {
  it('keeps the feature disabled and follows the active service by default', () => {
    const config = new Config()
    expect(config.harness).toMatchObject({
      enabled: false,
      service: '',
      model: '',
      defaultAction: 'meaning',
      contextMode: 'paragraph',
      maxContextChars: 1500,
      explanationDepth: 'concise',
      learningLevel: 'intermediate',
    })
    expect(config.harness.actions).toEqual(HARNESS_ACTIONS.map((action) => action.id))
  })

  it('normalizes action whitelist, bounds, enums and arbitrary model names', () => {
    const harness = normalizeHarnessPreferences({
      enabled: 1,
      service: '  openai  ',
      model: `  ${'x'.repeat(200)}  `,
      defaultAction: 'unknown',
      actions: ['practice', 'practice', 'unknown', 'grammar'],
      contextMode: 'bad',
      maxContextChars: 99999,
      explanationDepth: 'bad',
      learningLevel: 'bad',
    })
    expect(harness).toMatchObject({
      enabled: false,
      service: 'openai',
      model: 'x'.repeat(128),
      defaultAction: 'meaning',
      actions: ['meaning', 'practice', 'grammar'],
      contextMode: 'paragraph',
      maxContextChars: 4000,
      explanationDepth: 'concise',
      learningLevel: 'intermediate',
    })
  })

  it('adds the nested field when normalizing legacy config', () => {
    const config = normalizeConfig({ service: 'openai' })
    expect(config.harness.enabled).toBe(false)
    expect(config.harness.actions).toContain('meaning')
  })

  it('accepts only gateway-supported services and configured custom providers', () => {
    expect(isHarnessService('openai')).toBe(true)
    expect(isHarnessService('gemini')).toBe(true)
    expect(isHarnessService('claude')).toBe(true)
    expect(isHarnessService('google')).toBe(false)
    expect(isHarnessService('custom:study')).toBe(false)
    expect(isHarnessService('custom:study', [{ id: 'custom:study', name: 'Study', endpoint: '', models: ['study'] }])).toBe(true)
  })

  it('preserves the supported advanced learning level', () => {
    expect(normalizeHarnessPreferences({ learningLevel: 'advanced' }).learningLevel).toBe('advanced')
  })

  it('covers selection context, detailed output and invalid service bounds', () => {
    expect(isHarnessService('x'.repeat(129))).toBe(false)
    expect(normalizeHarnessPreferences({ contextMode: 'selection', explanationDepth: 'detailed', maxContextChars: 2000 })).toMatchObject({
      contextMode: 'selection', explanationDepth: 'detailed', maxContextChars: 2000,
    })
  })
  it('normalizes custom providers before accepting their Harness selection', () => {
    const provider = {id: 'custom:study', name: 'Study', endpoint: 'https://example.test/v1/chat/completions', models: ['reader']}
    const config = normalizeConfig({customOpenAIProviders: [null, provider], harness: {enabled: true, service: 'custom:study', model: 'reader'}})
    expect(config.harness.service).toBe('custom:study')
    expect(normalizeConfig({customOpenAIProviders: 'broken', harness: {service: 'custom:study'}}).harness.service).toBe('')
  })

  it('keeps editable nested preferences separate from the persistence baseline', () => {
    const baseline = new Config()
    const edited = normalizeConfig(baseline)
    edited.harness.enabled = true
    edited.harness.contextMode = 'selection'
    edited.harness.actions.pop()
    expect(baseline.harness.enabled).toBe(false)
    expect(baseline.harness.contextMode).toBe('paragraph')
    expect(baseline.harness.actions).toHaveLength(4)
  })

})

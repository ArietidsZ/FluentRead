/**
 * @file tests/apiKeyTypes.test.ts
 * 文件职责：验证多 API Key 设置 UI 使用的纯列表归一化和检查汇总模型。
 * 主要内容：覆盖旧 token 兼容、空行、成功/失败/检查中状态和全失败边界。
 * 模块边界：不挂载 Vue、不访问浏览器 API、不测试真实连接；连接协议由后台测试覆盖。
 */
import { describe, expect, it } from 'vitest'
import { normalizeApiKeyList, summarizeApiKeyChecks, eligibleApiKeyIndexes, duplicateApiKeyIndex } from '@/src/features/settings/ui/services/apiKeyTypes'

describe('api key UI model', () => {
  it('keeps an explicit list including empty rows and falls back to legacy token', () => {
    expect(normalizeApiKeyList(['A', '', 'C'], 'legacy')).toEqual(['A', '', 'C'])
    expect(normalizeApiKeyList(undefined, 'legacy')).toEqual(['legacy'])
    expect(normalizeApiKeyList([], '')).toEqual([''])
    expect(normalizeApiKeyList([], 'stale-secret')).toEqual([''])
    expect(normalizeApiKeyList(undefined)).toEqual([''])
    expect(normalizeApiKeyList(undefined, 42 as never)).toEqual([''])
    expect(normalizeApiKeyList([42, 'fixture'])).toEqual(['fixture'])
  })

  it('does not summarize while a row is still checking', () => {
    expect(summarizeApiKeyChecks({0: {status: 'success'}, 1: {status: 'checking'}})).toBeNull()
    expect(summarizeApiKeyChecks({0: {status: 'success'}, 1: {status: 'queued'}})).toBeNull()
    expect(summarizeApiKeyChecks({})).toBeNull()
    expect(summarizeApiKeyChecks({0: {status: 'idle'}})).toBeNull()
  })

  it('summarizes all-success, partial and all-failure checks', () => {
    expect(summarizeApiKeyChecks({0: {status: 'success'}, 1: {status: 'success'}})).toEqual({kind: 'success', passed: 2, failed: 0})
    expect(summarizeApiKeyChecks({0: {status: 'success'}, 1: {status: 'error', error: '401'}})).toEqual({kind: 'partial', passed: 1, failed: 1})
    expect(summarizeApiKeyChecks({0: {status: 'error'}, 1: {status: 'error'}})).toEqual({kind: 'error', passed: 0, failed: 2})
  })
  it('keeps stable indexes while excluding blank and repeated keys', () => {
    const keys = ['first', ' ', ' second ', 'first', 'second', '']
    expect(eligibleApiKeyIndexes(keys)).toEqual([0, 2])
    expect(duplicateApiKeyIndex(keys, 0)).toBeNull()
    expect(duplicateApiKeyIndex(keys, 1)).toBeNull()
    expect(duplicateApiKeyIndex(keys, 3)).toBe(0)
    expect(duplicateApiKeyIndex(keys, 4)).toBe(2)
    expect(duplicateApiKeyIndex(keys, 99)).toBeNull()
  })
})

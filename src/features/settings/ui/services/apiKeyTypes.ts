/**
 * @file src/features/settings/ui/services/apiKeyTypes.ts
 * 文件职责：声明多 API Key 设置组件共享的纯展示状态类型。
 * 主要内容：描述逐 Key 检查状态和全量检查摘要，不包含凭据内容或网络协议。
 * 模块边界：仅供设置 UI 使用，轮询、降权、暂停和恢复由翻译运行时负责。
 */
export type ApiKeyCheckState = {status: 'idle' | 'queued' | 'checking' | 'success' | 'error'; error?: string; durationMs?: number}
export type ApiKeySummary = {kind: 'success' | 'partial' | 'error'; passed: number; failed: number}

export function normalizeApiKeyList(value: unknown, legacyToken = ''): string[] {
  if (Array.isArray(value)) {
    const keys = value.filter((item): item is string => typeof item === 'string')
    return keys.length > 0 ? keys : ['']
  }
  return [typeof legacyToken === 'string' ? legacyToken : '']
}

export function summarizeApiKeyChecks(states: Readonly<Record<number, ApiKeyCheckState>>): ApiKeySummary | null {
  const checks = Object.values(states)
  if (checks.length === 0 || checks.some(check => check.status === 'checking' || check.status === 'queued')) return null
  const successes = checks.filter(check => check.status === 'success').length
  const errors = checks.filter(check => check.status === 'error').length
  if (errors === 0 && successes > 0) return {kind: 'success', passed: successes, failed: 0}
  if (successes > 0) return {kind: 'partial', passed: successes, failed: errors}
  if (errors > 0) return {kind: 'error', passed: 0, failed: errors}
  return null
}

/** 空白草稿和重复凭据不参与请求或全量检查，保持原始行索引。 */
export function eligibleApiKeyIndexes(keys: readonly string[]): number[] {
  const seen = new Set<string>()
  return keys.flatMap((value, index) => {
    const key = value.trim()
    if (!key || seen.has(key)) return []
    seen.add(key)
    return [index]
  })
}

export function duplicateApiKeyIndex(keys: readonly string[], index: number): number | null {
  const key = keys[index]?.trim()
  if (!key) return null
  const first = keys.findIndex(value => value.trim() === key)
  return first < index ? first : null
}

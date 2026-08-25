/**
 * @file src/core/config/transfer.ts
 *
 * 文件职责：负责配置导入与导出的纯数据转换，确保外部文件只携带允许公开和恢复的配置字段。
 * 主要内容：验证导入对象所需字段，使用 sanitizeConfigForExport 剔除凭据和内部修订信息，并通过 prepareConfigForImport 将合法公开值合并到当前 Config。 可核对的公开符号包括 isConfigImportValid、sanitizeConfigForExport、prepareConfigForImport。
 * 模块边界：本文件属于 core 领域层，只定义规则、类型与纯转换；不直接读写浏览器存储、不发起网络请求、不挂载 Vue/WXT 入口，持久化、协议调用和界面编排分别由 services、providers 与 features 承担。
 */

import { isCustomBodyMapping } from './customBody'
import {
  extractConfigCredentials,
  hasCredentialFields,
  mergeConfigCredentials,
  sanitizeConfigCredentials,
} from './credentials'
import { normalizeConfig, type Config } from './model'
import { defaultOption } from './catalog'

type ConfigRecord = Record<string, any>

const requiredConfigFields = ['on', 'service', 'display', 'from', 'to'] as const

function isRecord(value: unknown): value is ConfigRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isConfigImportValid(value: unknown): value is ConfigRecord {
  if (!isRecord(value)) return false
  if (!requiredConfigFields.every((field) => field in value)) return false
  if (typeof value.service !== 'string') return false
  return !('customBody' in value) || isCustomBodyMapping(value.customBody)
}

function removeDefaultEntries(target: ConfigRecord, key: 'system_role' | 'user_role', defaultValue: string) {
  const entries = target[key]
  if (!isRecord(entries)) return

  for (const [service, value] of Object.entries(entries)) {
    if (value === defaultValue) delete entries[service]
  }

  if (Object.keys(entries).length === 0) delete target[key]
}

function removeEmptyCustomBodies(target: ConfigRecord) {
  const entries = target.customBody
  if (!isRecord(entries)) return

  for (const [service, value] of Object.entries(entries)) {
    if (typeof value !== 'string' || !value.trim()) delete entries[service]
  }

  if (Object.keys(entries).length === 0) delete target.customBody
}

export function sanitizeConfigForExport(value: unknown): ConfigRecord {
  if (!isRecord(value)) throw new Error('配置必须是 JSON 对象')

  const sanitized = sanitizeConfigCredentials(
    JSON.parse(JSON.stringify(value)),
  ) as ConfigRecord
  delete sanitized.__fluentConfigRevision
  removeDefaultEntries(sanitized, 'system_role', defaultOption.system_role)
  removeDefaultEntries(sanitized, 'user_role', defaultOption.user_role)
  removeEmptyCustomBodies(sanitized)
  return sanitized
}

/**
 * 新版导出不含凭据，因此导入时保留当前 session 凭据；旧版导出若含凭据，
 * 则显式迁移该凭据。持久化开关始终保留当前值，不能由导入文件静默开启。
 */
export function prepareConfigForImport(value: unknown, current: unknown): Config {
  const currentConfig = normalizeConfig(current)
  const importedConfig = normalizeConfig(value)
  const credentials = hasCredentialFields(value)
    ? extractConfigCredentials(value)
    : extractConfigCredentials(currentConfig)

  return normalizeConfig(mergeConfigCredentials({
    ...sanitizeConfigCredentials(importedConfig),
    persistCredentials: currentConfig.persistCredentials,
  }, credentials))
}

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
  type ConfigCredentials,
} from './credentials'
import { normalizeConfig, type Config } from './model'
import { defaultOption, servicesType } from './catalog'

type ConfigRecord = Record<string, any>

const requiredConfigFields = ['on', 'service', 'display', 'from', 'to'] as const

function isRecord(value: unknown): value is ConfigRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isConfigImportValid(value: unknown): value is ConfigRecord {
  if (!isRecord(value)) return false
  if (!requiredConfigFields.every((field) => field in value)) return false
  if (typeof value.on !== 'boolean') return false
  if (value.display !== 0 && value.display !== 1) return false
  if (typeof value.from !== 'string' || !value.from.trim()) return false
  if (typeof value.to !== 'string' || !value.to.trim()) return false
  if (typeof value.service !== 'string'
    || (!servicesType.machine.has(value.service) && !servicesType.isAI(value.service))) return false
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

const scalarCredentialFields = [
  'ak', 'sk', 'appid', 'key', 'youdaoAppKey', 'youdaoAppSecret',
  'tencentSecretId', 'tencentSecretKey',
] as const

/** 旧版文件只更新它明确提供的凭据；未提供的服务凭据继续保留。 */
function prepareImportedCredentials(value: unknown, current: unknown): ConfigCredentials {
  const currentCredentials = extractConfigCredentials(current)
  if (!hasCredentialFields(value) || !isRecord(value)) return currentCredentials

  const importedCredentials = extractConfigCredentials(value)
  const merged: ConfigCredentials = {
    ...currentCredentials,
    token: isRecord(value.token)
      ? {...currentCredentials.token, ...importedCredentials.token}
      : currentCredentials.token,
    extra: isRecord(value.extra)
      ? {...currentCredentials.extra, ...importedCredentials.extra}
      : currentCredentials.extra,
  }
  for (const field of scalarCredentialFields) {
    if (typeof value[field] === 'string') merged[field] = importedCredentials[field]
  }
  return merged
}

export function sanitizeConfigForExport(value: unknown): ConfigRecord {
  if (!isRecord(value)) throw new Error('配置必须是 JSON 对象')

  const sanitized = sanitizeConfigCredentials(
    JSON.parse(JSON.stringify(value)),
  ) as ConfigRecord
  delete sanitized.__fluentConfigRevision
  delete sanitized.count
  delete sanitized.persistCredentials
  // videoServiceDefaultMigrated 暂时保留，旧版 raw JSON 没有独立 schema；
  // 删除它会让用户主动选择的 DeepLX 在重新导入时被误判为旧默认值。
  removeDefaultEntries(sanitized, 'system_role', defaultOption.system_role)
  removeDefaultEntries(sanitized, 'user_role', defaultOption.user_role)
  removeEmptyCustomBodies(sanitized)
  return sanitized
}

/**
 * 新版导出不含凭据，因此导入时保留当前 session 凭据；旧版导出若含凭据，
 * 则只迁移文件明确提供的字段，未提供的凭据继续保留。翻译统计、迁移标记和持久化开关始终保留当前值，
 * 不能由导入文件静默覆盖。
 */
export function prepareConfigForImport(value: unknown, current: unknown): Config {
  if (!isConfigImportValid(value)) throw new TypeError('导入配置缺少有效的基础字段')
  const currentConfig = normalizeConfig(current)
  const importedConfig = normalizeConfig(value)
  const credentials = prepareImportedCredentials(value, currentConfig)

  return normalizeConfig(mergeConfigCredentials({
    ...sanitizeConfigCredentials(importedConfig),
    count: currentConfig.count,
    persistCredentials: currentConfig.persistCredentials,
    videoServiceDefaultMigrated: currentConfig.videoServiceDefaultMigrated,
  }, credentials))
}

/**
 * @file src/ui/view-model/serviceLibrary.ts
 * 文件职责：从已有配置派生个人翻译服务列表，避免把预置模型误认为用户已配置。
 * 主要内容：识别用户保存的凭据、端点、模型及自定义服务；合并默认、用户添加、已保存和少量预置常用项，保持列表稳定且去重。
 * 模块边界：只返回服务 ID 和列表，不输出凭据、不检测连接、不写入配置或调整默认服务。
 */
import { Config } from '@/src/core/config/model'
import { defaultModels, services, servicesType } from '@/src/core/config/catalog'
import { getCustomOpenAIProvider, isCustomOpenAIProviderId } from '@/src/core/config/customOpenAI'
import { getApiKeyRequirementKey } from '@/src/core/config/validation'
import type { ServiceOption } from './serviceCatalog'

const defaults = new Config()

/** 已保存只表示存在用户配置，不能据此推断凭据有效或连接正常。 */
export function hasSavedServiceConfiguration(service: string, config: Config): boolean {
  if (isCustomOpenAIProviderId(service)) return Boolean(getCustomOpenAIProvider(config.customOpenAIProviders, service))
  if ([config.token[service], config.secret[service], config.proxy[service], config.customBody[service],
    config.customHeaders[service], config.customModel[service]].some(value => Boolean(value?.trim()))) return true
  if (config.customModels[service]?.length) return true
  if (config.model[service] && config.model[service] !== defaultModels.get(service)) return true
  if (config.requireApiKey[getApiKeyRequirementKey(service, config)] === false) return true
  if (servicesType.isTencent(service)) return Boolean(config.tencentSecretId.trim() || config.tencentSecretKey.trim())
  if (service === services.youdao) return Boolean(config.youdaoAppKey.trim() || config.youdaoAppSecret.trim())
  if (service === services.azureOpenai) return Boolean(config.azureOpenaiEndpoint.trim())
  if (service === services.newapi) return config.newApiUrl !== defaults.newApiUrl && Boolean(config.newApiUrl.trim())
  return false
}

/** 预置只影响初次展示；不会覆盖用户收藏或为服务写入配置。 */
export const COMMON_SERVICE_IDS = [services.freeTranslation, services.deepseek, services.openai, services.gemini, services.localTranslation] as const

/** 默认服务优先，保留用户添加顺序和已有配置，再补充少量常用服务；同一项只展示一次。 */
export function buildServiceShortlist(
  options: ServiceOption[], defaultService: string, editingService: string,
  favorites: readonly string[], configured: readonly string[],
): ServiceOption[] {
  const byId = new Map(options.map(item => [item.value, item]))
  const ids = new Set([defaultService, ...favorites, ...configured, ...COMMON_SERVICE_IDS, editingService])
  return [...ids].flatMap(id => {
    const item = byId.get(id)
    return item ? [item] : []
  })
}

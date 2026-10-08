/**
 * @file src/features/input-translation/content/incognitoConfigKey.ts
 * 文件职责：把私密策略及其候选连接身份加入输入框请求的配置指纹。
 * 主要内容：保留专用字段的畸形状态，策略启用时纳入其服务连接哈希，取消配置变化后的迟到写入。
 * 模块边界：仅生成配置身份，不判断页面是否私密，不提供执行授权，也不记录连接值；油猴构建使用空指纹适配器。
 */
import {hasConfiguredIncognitoRoute, type IncognitoRouteConfig} from '@/src/core/config/incognitoRoute';

export function incognitoInputConfigKey<T extends IncognitoRouteConfig>(
    value: T, connectionKey: (config: T) => string,
): string {
    if (!hasConfiguredIncognitoRoute(value)) return '';
    const service = typeof value.incognitoService === 'string' ? value.incognitoService : '';
    return JSON.stringify([value.incognitoService, value.incognitoModel,
        service ? value.customModels?.[service] : undefined,
        service ? connectionKey({...value, inputBoxTranslationService: service}) : '',
    ]);
}

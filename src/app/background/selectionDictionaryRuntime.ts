/**
 * @file src/app/background/selectionDictionaryRuntime.ts
 * 文件职责：为后台划词词典装配现有配置、原生来源解析与翻译服务，供消息总入口注册。
 * 主要内容：扩展构建采用文档会话词典运行时；兼容构建保留普通词典查询与辅助释义服务选择。
 * 模块边界：这里只连接已有依赖，不请求词典、不解析来源或管理缓存；这些行为归划词 feature 与翻译服务。
 */
import {config, configReady, subscribeConfig} from '@/src/services/config/store';
import {NATIVE_PRIVATE_ROUTE_SUPPORTED} from '@/src/core/config/incognitoRoute';
import {lookupWord} from '@/src/features/selection-translation/services/wordDictionary';
import {createNativeSelectionWordLookupRuntime, createSelectionWordLookupHandler} from
    '@/src/features/selection-translation/background/wordLookupHandler';
import {translateWithCache} from '@/src/app/translation/runtime';
import type {IncognitoSourceRuntime} from '@/src/platform/browser/incognitoSource';

/** 构建能力来自编译常量；参数只供兼容构建验证，不参与页面来源判定。 */
export function createSelectionDictionaryRuntime(nativeSupported = NATIVE_PRIVATE_ROUTE_SUPPORTED) {
    if (nativeSupported) return createNativeSelectionWordLookupRuntime({ready: configReady,
        getConfig: () => config, runtime: browser.runtime as unknown as IncognitoSourceRuntime, subscribeConfig});
    return {registry: undefined, handlers: [createSelectionWordLookupHandler({lookupWord,
        getDefaultTargetLanguage: () => config.to,
        translate: request => translateWithCache({...request, serviceOverride: config.selectionTranslationService || config.service}),
        warn: (message, error) => console.warn(message, error),
    })]};
}

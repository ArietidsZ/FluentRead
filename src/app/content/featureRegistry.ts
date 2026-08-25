/**
 * @file src/app/content/featureRegistry.ts
 * 文件职责：提供 content 功能的静态注册表和激活所有权管理，使站点启停、能力门控与异步 mount/unmount 按统一生命周期执行。
 * 主要内容：定义 feature runtime/definition/result 类型，按 isEnabled 选择挂载，记录 activation 代次，使用 ensureContentFeatureMounted 处理迟到挂载，并在失效或异常时精确卸载与上报阶段。
 * 模块边界：注册表只编排 feature 公共生命周期，不知道悬浮、划词、OCR 等业务细节，不直接修改配置或 DOM；具体挂载器及能力判断由 runtime 注入。
 */
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { ensureContentFeatureMounted } from './featureLifecycle';
import {
    browserCapabilities,
    type BrowserCapabilities,
    type BrowserFeatureCapability,
} from '@/src/platform/browser/capabilities';

export interface ContentFeatureRuntime {
    ctx: ContentScriptContext;
    signal: AbortSignal;
    isCurrent: () => boolean;
}

export interface ContentFeatureDefinition {
    id: string;
    requiredCapability?: BrowserFeatureCapability;
    isEnabled: () => boolean;
    mount: (runtime: ContentFeatureRuntime) => unknown | PromiseLike<unknown>;
    unmount?: () => void;
    isMounted?: () => boolean;
}

export type ContentFeatureMountResult =
    | {id: string; status: 'mounted'}
    | {id: string; status: 'skipped'}
    | {id: string; status: 'failed'; error: unknown};

export type ContentFeaturePhase = 'mount' | 'unmount';

export interface ContentFeatureRegistryOptions {
    capabilities?: BrowserCapabilities;
    onError?: (featureId: string, phase: ContentFeaturePhase, error: unknown) => void;
}

export function rejectUnsupportedContentFeature(
    supported: boolean,
    unmount: () => void,
    sendResponse: (response: unknown) => void,
    error: string,
): boolean {
    if (supported) return false;
    unmount();
    sendResponse({status: 'unsupported', error});
    return true;
}

/**
 * 内容脚本功能注册表。
 *
 * 这个模块只管理功能生命周期，不读取业务配置，也不直接触碰页面 DOM。
 * 具体功能通过 isEnabled/mount/unmount 暴露能力，content 入口只负责组装。
 */
export class ContentFeatureRegistry {
    private readonly features: ContentFeatureDefinition[];
    private readonly options: ContentFeatureRegistryOptions;
    private readonly capabilities: BrowserCapabilities;

    constructor(features: ContentFeatureDefinition[], options: ContentFeatureRegistryOptions = {}) {
        this.features = [...features];
        this.options = options;
        this.capabilities = options.capabilities ?? browserCapabilities;
    }

    async mountEnabled(runtime: ContentFeatureRuntime): Promise<ContentFeatureMountResult[]> {
        const results: ContentFeatureMountResult[] = [];

        for (const feature of this.features) {
            // Step 1: 先确认 WXT 上下文和当前激活都有效，旧激活不再启动新功能。
            if (runtime.signal.aborted || !runtime.isCurrent()) {
                results.push({id: feature.id, status: 'skipped'});
                continue;
            }

            try {
                // Step 2: 构建能力优先于同步配置；旧的 Chrome 偏好不会让 Firefox 挂载必失败功能。
                if ((feature.requiredCapability && !this.capabilities[feature.requiredCapability])
                    || !feature.isEnabled()) {
                    results.push({id: feature.id, status: 'skipped'});
                    continue;
                }

                // Step 3: 带 isMounted 的异步 UI 复用一次重试策略；普通功能只挂载一次。
                if (feature.isMounted) {
                    await ensureContentFeatureMounted({
                        mount: () => feature.mount(runtime),
                        isMounted: feature.isMounted,
                        isStillDesired: () => !runtime.signal.aborted
                            && runtime.isCurrent()
                            && feature.isEnabled(),
                    });
                } else {
                    await feature.mount(runtime);
                }

                // Step 4: 异步挂载结束后重新校验所有权。旧 activation 的全局 unmount
                // 可能取消恢复 activation 刚重试的 singleton UI，因此失效时只跳过；
                // 当前 activation 内配置关闭时才由本 registry 执行卸载。
                if (runtime.signal.aborted || !runtime.isCurrent()) {
                    results.push({id: feature.id, status: 'skipped'});
                    continue;
                }
                if (!feature.isEnabled()) {
                    feature.unmount?.();
                    results.push({id: feature.id, status: 'skipped'});
                    continue;
                }

                if (feature.isMounted && !feature.isMounted()) {
                    throw new Error(`内容功能挂载后未就绪: ${feature.id}`);
                }

                results.push({id: feature.id, status: 'mounted'});
            } catch (error) {
                // Step 5: 一个可选功能失败不能阻断其余功能，统一交给入口记录诊断。
                this.options.onError?.(feature.id, 'mount', error);
                results.push({id: feature.id, status: 'failed', error});
            }
        }

        return results;
    }

    unmountAll(): void {
        // Step 1: 反向卸载，让后挂载的覆盖层先释放自己的监听器和 DOM。
        for (const feature of [...this.features].reverse()) {
            try {
                feature.unmount?.();
            } catch (error) {
                // Step 2: 单个清理失败不应阻止其他功能释放资源。
                this.options.onError?.(feature.id, 'unmount', error);
            }
        }
    }
}

export function createContentFeatureRegistry(
    features: ContentFeatureDefinition[],
    options?: ContentFeatureRegistryOptions,
): ContentFeatureRegistry {
    return new ContentFeatureRegistry(features, options);
}

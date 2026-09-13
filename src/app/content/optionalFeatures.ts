/**
 * @file src/app/content/optionalFeatures.ts
 * 文件职责：管理内容页默认关闭的输入框翻译与段落复制功能的按配置挂载生命周期。
 * 主要内容：为两个低频 feature 创建受 activation signal 所有的子控制器，按总开关、站点禁用和各自配置增删监听器，并在页面销毁时统一释放。
 * 模块边界：这里只编排 content 生命周期，不实现输入触发算法、段落解析或配置持久化；具体行为分别属于 input-translation、paragraph-copy 与 config store。
 */
import type {InputTranslationContentFeature} from '@/src/features/input-translation/content';

export interface OptionalContentFeatureConfig {
    on?: boolean;
    inputBoxTranslationTrigger?: string;
    paragraphCopyEnabled?: boolean;
}

export interface OptionalContentFeatureDependencies {
    activationSignal: AbortSignal;
    config: OptionalContentFeatureConfig;
    isSiteDisabled: () => boolean;
    inputTranslationFeature: InputTranslationContentFeature;
    mountParagraphCopyContentFeature: (
        options: {isSiteDisabled: () => boolean},
        signal: AbortSignal,
    ) => void;
}

export interface OptionalContentFeatureRuntime {
    sync(): void;
    dispose(): void;
}

export function createOptionalContentFeatureRuntime(
    dependencies: OptionalContentFeatureDependencies,
): OptionalContentFeatureRuntime {
    let inputFeatureController: AbortController | null = null;
    let paragraphCopyFeatureController: AbortController | null = null;
    let disposed = false;

    const createChildController = (): AbortController => {
        const child = new AbortController();
        if (dependencies.activationSignal.aborted) {
            child.abort();
            return child;
        }
        const abortChild = (): void => child.abort();
        dependencies.activationSignal.addEventListener('abort', abortChild, {once: true});
        child.signal.addEventListener('abort', () => {
            dependencies.activationSignal.removeEventListener('abort', abortChild);
        }, {once: true});
        return child;
    };

    const inputFeatureEnabled = (): boolean => dependencies.config.on !== false
        && !dependencies.isSiteDisabled()
        && dependencies.config.inputBoxTranslationTrigger !== 'disabled';
    const paragraphCopyFeatureEnabled = (): boolean => dependencies.config.on === true
        && !dependencies.isSiteDisabled()
        && dependencies.config.paragraphCopyEnabled === true;

    const sync = (): void => {
        if (disposed || dependencies.activationSignal.aborted) return;
        if (inputFeatureEnabled()) {
            if (!inputFeatureController) {
                inputFeatureController = createChildController();
                if (!inputFeatureController.signal.aborted) {
                    dependencies.inputTranslationFeature.mount(inputFeatureController.signal);
                }
            }
        } else if (inputFeatureController) {
            inputFeatureController.abort();
            inputFeatureController = null;
            dependencies.inputTranslationFeature.invalidate();
        }

        if (paragraphCopyFeatureEnabled()) {
            if (!paragraphCopyFeatureController) {
                paragraphCopyFeatureController = createChildController();
                if (!paragraphCopyFeatureController.signal.aborted) {
                    dependencies.mountParagraphCopyContentFeature(
                        {isSiteDisabled: dependencies.isSiteDisabled},
                        paragraphCopyFeatureController.signal,
                    );
                }
            }
        } else if (paragraphCopyFeatureController) {
            paragraphCopyFeatureController.abort();
            paragraphCopyFeatureController = null;
        }
    };

    const dispose = (): void => {
        if (disposed) return;
        disposed = true;
        inputFeatureController?.abort();
        paragraphCopyFeatureController?.abort();
        inputFeatureController = null;
        paragraphCopyFeatureController = null;
        dependencies.inputTranslationFeature.invalidate();
    };

    return {sync, dispose};
}

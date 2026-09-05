/**
 * @file src/features/full-page-translation/content/stateNotification.ts
 * 文件职责：向当前文档和后台发布全文会话开始及恢复状态。
 * 主要内容：保留页面内状态事件与后台布尔通知，隔离扩展失效时的同步及异步错误。
 * 模块边界：不拥有全文会话、不接收页面事件作为命令，也不修改标签页状态；后台决定发送 frame 的权限。
 */
let revision = 0;
export function getFullPageTranslationStateRevision(): number { return revision; }

export function notifyFullPageTranslationState(isTranslated: boolean): void {
    revision += 1;
    if (typeof document !== "undefined" && typeof document.dispatchEvent === "function") {
        const CustomEventConstructor = document.defaultView?.CustomEvent ??
            (typeof CustomEvent !== "undefined" ? CustomEvent : null);
        if (CustomEventConstructor) {
            document.dispatchEvent(new CustomEventConstructor(
                isTranslated ? "fluentread-translation-started" : "fluentread-translation-ended",
            ));
        }
    }
    try {
        if (typeof browser === "undefined" || !browser.runtime?.sendMessage) return;
        void Promise.resolve(browser.runtime.sendMessage({
            type: "fullPageTranslationState",
            isTranslated,
        })).catch(() => {
            // 后台可能正在重载；页面内的翻译状态不应因此失败。
        });
    } catch {
        // runtime API 在扩展上下文失效时可能同步抛错；页面清理仍须继续。
    }
}

export interface LegacyCacheClearResponse {
    success: boolean;
    error?: string;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** 把旧 content `clearCache` 消息转发给类型化后台 handler，并保留真实失败。 */
export function forwardLegacyCacheClear(
    sendBackgroundMessage: (message: {type: 'clearTranslationCache'}) => Promise<unknown>,
    sendResponse: (response: LegacyCacheClearResponse) => void,
): void {
    void sendBackgroundMessage({type: 'clearTranslationCache'})
        .then((response: unknown) => {
            if (response && typeof response === 'object'
                && (response as {success?: unknown}).success === true) {
                sendResponse({success: true});
                return;
            }
            const error = response && typeof response === 'object'
                && typeof (response as {error?: unknown}).error === 'string'
                ? (response as {error: string}).error
                : '后台未确认缓存清理成功';
            sendResponse({success: false, error});
        })
        .catch((error: unknown) => sendResponse({success: false, error: errorMessage(error)}));
}

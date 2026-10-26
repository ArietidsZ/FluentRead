/** Pure configuration boundary shared by persistence and native audio transport. */
export const DEFAULT_NATIVE_ASR_BASE_URL = 'http://127.0.0.1:8000';

/** Invalid explicit input stays disabled; only the caller may apply a missing-field default. */
export function normalizeNativeAsrBaseUrl(value: unknown): string {
    if (typeof value !== 'string' || value.length > 512) return '';
    const input = value.trim();
    if (!input || /[\u0000-\u0020\u007f]/u.test(input)) return '';
    try {
        const url = new URL(input);
        if (!['http:', 'https:'].includes(url.protocol)
            || !['127.0.0.1', '[::1]'].includes(url.hostname)
            || url.username || url.password || url.search || url.hash
            || !['', '/', '/v1', '/v1/'].includes(url.pathname)) return '';
        return url.origin;
    } catch {
        return '';
    }
}

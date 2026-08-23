type HttpStatus = Pick<Response, 'status' | 'statusText'>;
type JsonResponse = Pick<Response, 'json'>;

const MAX_PROVIDER_CODE_LENGTH = 16;

/**
 * Build an HTTP failure without reflecting a third-party response body.
 * Response bodies can contain translated/source text, provider diagnostics, or
 * secrets echoed by a proxy, so only the protocol status is safe to surface.
 */
export function createHttpStatusError(response: HttpStatus, label = '请求失败'): Error {
    return new Error(`${label}: ${response.status}`);
}

/** Only short, code-shaped provider fields may be reflected in an error. */
export function getSafeProviderErrorCode(value: unknown): string | undefined {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;

    const code = String(value).trim();
    if (
        code.length === 0
        || code.length > MAX_PROVIDER_CODE_LENGTH
        || !/^\d+$/.test(code)
    ) {
        return undefined;
    }
    return code;
}

export function createProviderCodeError(label: string, value: unknown): Error {
    const code = getSafeProviderErrorCode(value);
    return new Error(code ? `${label}（错误码 ${code}）` : label);
}

/**
 * Parse a third-party JSON response without propagating the parser's input
 * preview. V8 includes part of malformed JSON in SyntaxError messages, which
 * can contain source text or diagnostics echoed by a provider or proxy.
 */
export async function readJsonResponse<T = unknown>(
    response: JsonResponse,
    label = '返回的不是有效 JSON',
): Promise<T> {
    try {
        return await response.json() as T;
    } catch {
        throw new Error(label);
    }
}

/**
 * @file src/core/config/customHeaders.ts
 * 文件职责：校验自定义 OpenAI 服务的 HTTP 请求头，并按大小写无关规则覆盖默认头。
 * 主要内容：接受空值或字符串值组成的 JSON 对象，拒绝非法头名、控制字符和非 ByteString 值。
 * 模块边界：只做配置解析与请求头合并，不读取配置、持久化凭据或发起请求。
 */
import {parseCustomBody} from './customBody';

export function parseCustomHeaders(raw?: unknown): Record<string, string> | undefined {
    const parsed = parseCustomBody(raw);
    if (!parsed) return undefined;
    const entries = Object.entries(parsed);
    if (entries.some(([name, value]) => (
        !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name)
        || typeof value !== 'string'
        || /[^\t\x20-\x7e\x80-\xff]/u.test(value)
    ))) return undefined;
    return Object.fromEntries(entries.map(([name, value]) => [name.toLowerCase(), (value as string).trim()]));
}

export function isValidCustomHeaders(raw?: unknown): boolean {
    return parseCustomHeaders(raw) !== undefined;
}

export function mergeCustomHeaders(defaults: HeadersInit | undefined, custom: Record<string, string>): Record<string, string> {
    const headers = new Headers(defaults);
    for (const [name, value] of Object.entries(custom)) headers.set(name, value);
    return Object.fromEntries(headers.entries());
}

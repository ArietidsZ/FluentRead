/**
 * @file src/features/video-subtitle/content/hlsAudio.ts
 * 文件职责：从 X 播放器已请求的 HLS 清单读取完整音轨，避免按视频时长实时扫描。
 * 主要内容：选择音频 rendition 或低码率变体，按原顺序并发读取 fMP4 初始化段和媒体段，并严格限制大小与取消范围。
 * 模块边界：不解密媒体、不访问页面凭据、不操作播放器；fetch 由调用方注入，解码由独立浏览器音频适配器执行。
 */
export interface HlsAudioManifest {next?: string; segments?: string[]; durationMs: number}
const MAX_AUDIO_BYTES = 64 * 1024 * 1024;

export interface ReadBoundedMediaResponseOptions {
    /** Reserve bytes in a caller-owned budget before retaining each stream chunk. */
    consumeBytes?: (count: number) => boolean;
}

export function isXMediaUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.hostname === 'video.twimg.com';
    } catch { return false; }
}

function resource(value: string, base: string): string {
    const url = new URL(value, base).href;
    if (!isXMediaUrl(url)) throw new Error('视频音轨地址不属于 X');
    return url;
}

/** 只接受完整、无加密、无 byte-range 的有限 fMP4 音轨，其他格式交回播放器采集。 */
export function parseHlsAudioManifest(text: string, base: string): HlsAudioManifest | null {
    if (!isXMediaUrl(base) || text.length > 1_000_000 || !text.trim().startsWith('#EXTM3U')) return null;
    const lines = text.trim().split(/\r?\n/).map(line => line.trim());
    if (lines.some(line => /^#EXT-X-(?:BYTERANGE|DISCONTINUITY)/.test(line)
        || (/^#EXT-X-KEY:/.test(line) && !/METHOD=NONE(?:,|$)/.test(line)))) return null;
    const audios = lines.filter(line => /^#EXT-X-MEDIA:/.test(line) && /(?:^|,)TYPE=AUDIO(?:,|$)/.test(line.replace('#EXT-X-MEDIA:', '')));
    const audio = audios.find(line => /DEFAULT=YES/.test(line)) ?? audios[0];
    const audioUri = audio?.match(/URI="([^"]+)"/)?.[1];
    if (audioUri) return {next: resource(audioUri, base), durationMs: 0};
    const variants = lines.flatMap((line, index) => {
        if (!line.startsWith('#EXT-X-STREAM-INF:')) return [];
        const uri = lines[index + 1];
        if (!uri || uri.startsWith('#')) return [];
        return [{url: resource(uri, base), bandwidth: Number(line.match(/(?:^|[:,])BANDWIDTH=(\d+)/)?.[1]) || Infinity}];
    });
    if (variants.length) return {next: variants.sort((a, b) => a.bandwidth - b.bandwidth)[0].url, durationMs: 0};
    if (!lines.includes('#EXT-X-ENDLIST')) return null;
    const init = lines.find(line => line.startsWith('#EXT-X-MAP:'))?.match(/URI="([^"]+)"/)?.[1];
    if (!init) return null;
    const uris = lines.filter(line => line && !line.startsWith('#'));
    if (!uris.length || uris.length > 256) return null;
    const durationMs = lines.reduce((sum, line) => sum + (Number(line.match(/^#EXTINF:([\d.]+)/)?.[1]) || 0) * 1000, 0);
    if (durationMs <= 0 || durationMs > 20 * 60_000) return null;
    return {segments: [resource(init, base), ...uris.map(uri => resource(uri, base))], durationMs};
}

export async function readBoundedMediaResponse(
    response: Response,
    limit: number,
    signal: AbortSignal,
    options: ReadBoundedMediaResponseOptions = {},
): Promise<Uint8Array> {
    if (!response.ok || Number(response.headers.get('content-length')) > limit) throw new Error('视频音轨响应无效或过大');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('视频音轨响应为空');
    const chunks: Uint8Array[] = [];
    let length = 0;
    const cancel = () => { void reader.cancel().catch(() => undefined); };
    signal.addEventListener('abort', cancel, {once: true});
    try {
        while (!signal.aborted) {
            const part = await reader.read();
            if (part.done) break;
            if (options.consumeBytes && !options.consumeBytes(part.value.length)) {
                throw new Error('视频音轨超过读取上限');
            }
            length += part.value.length;
            if (length > limit) throw new Error('视频音轨超过读取上限');
            chunks.push(part.value);
        }
        if (signal.aborted) throw new Error('视频音轨读取已取消');
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        return bytes;
    } finally {
        signal.removeEventListener('abort', cancel);
        cancel();
        reader.releaseLock();
    }
}

export async function readXHlsAudio(
    url: string,
    initialManifest: string,
    signal: AbortSignal,
    fetchResource: (url: string, options: {signal: AbortSignal; credentials: 'omit'}) => Promise<Response>,
): Promise<{bytes: Uint8Array; durationMs: number} | null> {
    const scope = new AbortController();
    const abort = () => scope.abort();
    if (signal.aborted) abort();
    signal.addEventListener('abort', abort, {once: true});
    const timer = setTimeout(abort, 30_000);
    const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        scope.abort();
    };
    try {
        let manifest = parseHlsAudioManifest(initialManifest, url);
        const visited = new Set([url]);
        for (let depth = 0; manifest?.next && depth < 3; depth += 1) {
            url = manifest.next;
            if (visited.has(url)) {
                cleanup();
                return null;
            }
            visited.add(url);
            const response = await fetchResource(url, {signal: scope.signal, credentials: 'omit'});
            const bytes = await readBoundedMediaResponse(response, 1_000_000, scope.signal);
            manifest = parseHlsAudioManifest(new TextDecoder().decode(bytes), url);
        }
        if (!manifest?.segments || scope.signal.aborted) {
            cleanup();
            return null;
        }
        const segments = manifest.segments;
        const results: Uint8Array[] = [];
        let index = 0;
        let total = 0;
        const consumeBytes = (count: number): boolean => {
            if (!Number.isSafeInteger(count) || count < 0 || total > MAX_AUDIO_BYTES - count) return false;
            total += count;
            return true;
        };
        const worker = async () => {
            while (index < segments.length && !scope.signal.aborted) {
                const next = index++;
                const response = await fetchResource(segments[next], {signal: scope.signal, credentials: 'omit'});
                const bytes = await readBoundedMediaResponse(response, MAX_AUDIO_BYTES, scope.signal, {consumeBytes});
                results[next] = bytes;
            }
        };
        try { await Promise.all([worker(), worker(), worker()]); }
        catch (error) { scope.abort(); throw error; }
        if (scope.signal.aborted) {
            cleanup();
            return null;
        }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const segment of results) { bytes.set(segment, offset); offset += segment.length; }
        const result = {bytes, durationMs: manifest.durationMs};
        cleanup();
        return result;
    } catch (error) {
        cleanup();
        if (signal.aborted) return null;
        throw error;
    }
}

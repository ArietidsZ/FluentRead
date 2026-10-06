/**
 * @file src/platform/http/modelDownloads.ts
 * 文件职责：为按需模型数据下载提供地域提示、多来源回退与流式接收超时。
 * 主要内容：保留固定文件路径和版本，中文简体环境优先国内镜像，其他环境优先官方；网络、HTTP、断流和文件校验失败切换来源，取消与磁盘不足立即结束；流式响应不构造整份模型缓冲区。
 * 模块边界：只下载模型数据，不执行远程 JS/WASM、不处理用户文本或凭据；语言仅影响尝试顺序，不推断实际所在地。
 */
export type ModelSourcePreference = 'auto' | 'official' | 'mirror';
const OFFICIAL = 'https://huggingface.co';
const MIRRORS = ['https://hf-mirror.com', 'https://hf-mirror.net'];

export function huggingFaceDownloadOrigins(preference: ModelSourcePreference = 'auto'): string[] {
    const language = typeof navigator === 'undefined' ? '' : navigator.language;
    const preferMirror = preference === 'mirror' || (preference === 'auto' && /^zh(?:$|-CN|-Hans)/iu.test(language));
    return preferMirror ? [...MIRRORS, OFFICIAL] : [OFFICIAL, ...MIRRORS];
}

export function modelDownloadSources(url: string, preference: ModelSourcePreference = 'auto'): string[] {
    const parsed = new URL(url);
    if (parsed.origin === OFFICIAL) return huggingFaceDownloadOrigins(preference).map(origin => origin + parsed.pathname + parsed.search);
    if (parsed.origin === 'https://modelscope.cn' && parsed.pathname.startsWith('/models/')) {
        // 仅现有公开 Whisper 仓库在这两个平台使用相同仓库名、分支和文件清单。
        if (/^\/models\/onnx-community\/whisper-(?:tiny|base)\/resolve\/master\//u.test(parsed.pathname)) {
            const hfPath = parsed.pathname.slice('/models'.length).replace('/resolve/master/', '/resolve/main/');
            return [url, ...huggingFaceDownloadOrigins(preference).map(origin => origin + hfPath + parsed.search)];
        }
    }
    return [url];
}

/** consume 必须在响应体完全接收并校验/写入后完成，才能将一次来源尝试视为成功。 */
export async function withModelDownload<T>(
    url: string,
    consume: (response: Response, source: string) => Promise<T>,
    options: {signal?: AbortSignal; timeoutMs?: number; idleTimeoutMs?: number; preference?: ModelSourcePreference} = {},
): Promise<T> {
    const active = () => {if (options.signal?.aborted) throw new DOMException('模型下载已取消', 'AbortError');};
    let failure: unknown;
    for (const source of modelDownloadSources(url, options.preference)) {
        active();
        const controller = new AbortController();
        const abort = () => controller.abort();
        options.signal?.addEventListener('abort', abort, {once: true});
        let idle: ReturnType<typeof setTimeout>;
        const arm = () => {clearTimeout(idle); idle = setTimeout(abort, options.idleTimeoutMs ?? 20_000);};
        const total = setTimeout(abort, options.timeoutMs ?? 300_000);
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        try {
            arm();
            const response = await fetch(source, {signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer'});
            active();
            if (!response.ok) throw new Error(`模型文件下载失败（${response.status}）`);
            if (/text\/html/iu.test(response.headers.get('Content-Type') ?? '')) throw new Error('模型下载来源返回了网页');
            if (!response.body) throw new Error('模型文件下载缺少响应体');
            reader = response.body.getReader();
            const stream = new ReadableStream<Uint8Array>({
                async pull(target) {
                    try {
                        arm();
                        const chunk = await reader!.read();
                        if (controller.signal.aborted) throw new DOMException('模型下载超时', 'TimeoutError');
                        if (chunk.done) {clearTimeout(idle); target.close();}
                        else {arm(); target.enqueue(chunk.value);}
                    } catch (error) {target.error(error);}
                },
                cancel: reason => reader!.cancel(reason),
            });
            const result = await consume(new Response(stream, {status: response.status, statusText: response.statusText, headers: response.headers}), source);
            active();
            if (controller.signal.aborted) throw new DOMException('模型下载超时', 'TimeoutError');
            return result;
        } catch (error) {
            active();
            if (error instanceof Error && error.name === 'QuotaExceededError') throw error;
            failure = controller.signal.aborted ? new Error('模型文件下载超过等待时限', {cause: error}) : error;
        } finally {
            clearTimeout(idle!); clearTimeout(total); controller.abort();
            options.signal?.removeEventListener('abort', abort);
            if (reader) {await reader.cancel().catch(() => undefined); reader.releaseLock();}
        }
    }
    throw failure;
}

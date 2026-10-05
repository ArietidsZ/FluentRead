/**
 * @file src/features/video-subtitle/content/hlsAudioRuntime.ts
 * 文件职责：将当前 X 视频的 HLS 音轨接入浏览器音频解码，为完整字幕提供 16 kHz PCM。
 * 主要内容：按媒体来源选择清单，补读首页浏览器直接加载的清单，组合有界 HLS 读取、AudioContext 解码、时长校验和单声道重采样。
 * 模块边界：不修改用户 video 的播放状态；解码资源仅属于本次读取，页面切换或取消后必须释放。
 */
import {isXMediaUrl, readBoundedMediaResponse, readXHlsAudio} from './hlsAudio';
import {resampleToWhisperAudio} from '../transcription';

export class XHlsAudioReader {
    private readonly manifests = new Map<string, string>();

    remember(url: string, text: string): void {
        if (!isXMediaUrl(url) || !/\.m3u8(?:\?|$)/i.test(url)
            || text.length > 1_000_000 || !text.trim().startsWith('#EXTM3U')) return;
        this.manifests.set(url, text);
        if (this.manifests.size > 16) this.manifests.delete(this.manifests.keys().next().value!);
    }

    reset(): void { this.manifests.clear(); }

    private async recoverManifest(urls: string[], signal: AbortSignal): Promise<void> {
        if (urls.some(url => this.manifests.has(url))) return;
        const scope = new AbortController();
        const abort = () => scope.abort();
        signal.addEventListener('abort', abort, {once: true});
        const timer = setTimeout(abort, 5000);
        try {
            for (const url of urls.slice(-3).reverse()) {
                if (signal.aborted || scope.signal.aborted) return;
                try {
                    const response = await fetch(url, {signal: scope.signal, credentials: 'omit'});
                    const bytes = await readBoundedMediaResponse(response, 1_000_000, scope.signal);
                    if (scope.signal.aborted) return;
                    this.remember(url, new TextDecoder().decode(bytes));
                    if (this.manifests.has(url)) return;
                } catch {
                    // 旧清单可能过期，继续尝试当前媒体组内的其他已知清单。
                }
            }
        } finally {
            clearTimeout(timer);
            signal.removeEventListener('abort', abort);
            scope.abort();
        }
    }

    async read(video: HTMLVideoElement, signal: AbortSignal): Promise<Float32Array | null> {
        const mediaId = (url: string) => url.match(/(?:ext_tw_video|amplify_video|tweet_video)(?:_thumb)?\/(\d+)/)?.[1];
        const sourceId = mediaId(video.currentSrc || video.src) || mediaId(video.poster);
        // 首页并行预加载多个视频，MSE 地址不能复制。页面桥只捕获 Fetch/XHR
        // 文本响应，浏览器直接加载或 arraybuffer 清单需要从资源时序补读。
        // 有媒体 ID 时只读取这一组；没有 ID 时仍要求唯一候选，避免识别其他帖子。
        const urls = [...new Set([
            ...this.manifests.keys(),
            ...performance.getEntriesByType('resource').map(entry => entry.name),
        ])].filter(url => isXMediaUrl(url) && /\.m3u8(?:\?|$)/i.test(url)
            && (!sourceId || mediaId(url) === sourceId));
        const groups = new Set(urls.map(url => mediaId(url) || new URL(url).pathname.split('/').slice(0, -1).join('/')));
        if (groups.size !== 1 || signal.aborted) return null;
        await this.recoverManifest(urls, signal);
        // MSE 只暴露 blob 地址；在唯一媒体组明确时使用已捕获清单，拒绝猜测多个推荐视频。
        const candidates = [...this.manifests].filter(([url]) => !sourceId || mediaId(url) === sourceId);
        const ids = new Set(candidates.map(([url]) => mediaId(url) || new URL(url).pathname.split('/').slice(0, -1).join('/')));
        if (ids.size !== 1 || signal.aborted) return null;
        const candidate = candidates.find(([, text]) => /#EXT-X-STREAM-INF:|TYPE=AUDIO/.test(text)) ?? candidates[0];
        let context: AudioContext | null = null;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const close = () => { if (context && context.state !== 'closed') void context.close().catch(() => undefined); };
        signal.addEventListener('abort', close, {once: true});
        try {
            const result = await readXHlsAudio(candidate[0], candidate[1], signal, fetch);
            if (!result || signal.aborted) return null;
            if (Number.isFinite(video.duration) && Math.abs(result.durationMs - video.duration * 1000) > 1000) return null;
            context = new AudioContext({sampleRate: 16_000});
            const decoded = await Promise.race([
                context.decodeAudioData(result.bytes.buffer as ArrayBuffer),
                new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('音轨解码超时')), 10_000); }),
            ]);
            if (signal.aborted || Math.abs(decoded.duration * 1000 - result.durationMs) > 1000) return null;
            const channels = Array.from({length: decoded.numberOfChannels}, (_, index) => decoded.getChannelData(index));
            return resampleToWhisperAudio(channels, decoded.sampleRate, 16_000);
        } catch (error) {
            if (!signal.aborted) console.debug('[FluentRead] X audio fast decode unavailable', error);
            return null;
        }
        finally {
            if (timer) clearTimeout(timer);
            signal.removeEventListener('abort', close);
            close();
        }
    }
}

/**
 * @file src/features/video-subtitle/content/hlsAudioRuntime.ts
 * 文件职责：将当前 X 视频的 HLS 音轨接入浏览器音频解码，为完整字幕提供 16 kHz PCM。
 * 主要内容：按已确认的媒体身份选择清单，补读首页直接加载资源，过期/失效清单按新旧顺序有界重试，校验音轨时长并解码为单声道 PCM。
 * 模块边界：不修改用户 video 的播放状态；解码资源仅属于本次读取，页面切换或取消后必须释放。
 */
import {isXMediaUrl, readBoundedMediaResponse, readXHlsAudio} from './hlsAudio';
import {resampleToWhisperAudio} from '../transcription';
import {buildVideoAiSubtitleVideoKey, type VideoAiSubtitleCacheSource} from '../transcriptionCache';

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
        if (urls.every(url => this.manifests.has(url))) return;
        const scope = new AbortController();
        const abort = () => scope.abort();
        signal.addEventListener('abort', abort, {once: true});
        const timer = setTimeout(abort, 5000);
        try {
            for (const url of urls.slice(-3).reverse()) {
                if (signal.aborted || scope.signal.aborted) return;
                if (this.manifests.has(url)) continue;
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

    async read(video: HTMLVideoElement, signal: AbortSignal, identity?: VideoAiSubtitleCacheSource): Promise<Float32Array | null> {
        const mediaId = (url: string) => url.match(/(?:ext_tw_video|amplify_video|tweet_video)(?:_thumb)?\/(\d+)/)?.[1];
        const identityKey = identity ? buildVideoAiSubtitleVideoKey(identity) : null;
        const sourceId = mediaId(video.currentSrc || video.src) || mediaId(video.poster)
            || (identityKey?.startsWith('media:') ? identityKey.slice('media:'.length) : undefined);
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
        const candidates = [...this.manifests].reverse().filter(([url]) => !sourceId || mediaId(url) === sourceId);
        const ids = new Set(candidates.map(([url]) => mediaId(url) || new URL(url).pathname.split('/').slice(0, -1).join('/')));
        if (ids.size !== 1 || signal.aborted) return null;
        // 新清单优先；缓存里有一个旧清单并不代表它的子资源仍可读取。
        const scope = new AbortController();
        const abort = () => scope.abort();
        signal.addEventListener('abort', abort, {once: true});
        const readTimer = setTimeout(abort, 30_000);
        let context: AudioContext | null = null;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const close = () => { if (context && context.state !== 'closed') void context.close().catch(() => undefined); };
        signal.addEventListener('abort', close, {once: true});
        scope.signal.addEventListener('abort', close, {once: true});
        try {
            let result: Awaited<ReturnType<typeof readXHlsAudio>> = null;
            for (const [url, text] of candidates.slice(0, 3)) {
                if (signal.aborted || scope.signal.aborted) return null;
                try {
                    result = await readXHlsAudio(url, text, scope.signal, fetch);
                    if (result && (!Number.isFinite(video.duration) || Math.abs(result.durationMs - video.duration * 1000) <= 1000)) break;
                    result = null;
                } catch {
                    // 同一媒体的过期 rendition、缺失片段或不兼容清单不阻止下一候选。
                }
            }
            if (!result || signal.aborted || scope.signal.aborted) return null;
            if (Number.isFinite(video.duration) && Math.abs(result.durationMs - video.duration * 1000) > 1000) return null;
            context = new AudioContext({sampleRate: 16_000});
            const decoded = await Promise.race([
                context.decodeAudioData(result.bytes.buffer as ArrayBuffer),
                new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('音轨解码超时')), 10_000); }),
            ]);
            if (signal.aborted || scope.signal.aborted || Math.abs(decoded.duration * 1000 - result.durationMs) > 1000) return null;
            const channels = Array.from({length: decoded.numberOfChannels}, (_, index) => decoded.getChannelData(index));
            return resampleToWhisperAudio(channels, decoded.sampleRate, 16_000);
        } catch (error) {
            if (!signal.aborted) console.debug('[FluentRead] X audio fast decode unavailable', error);
            return null;
        }
        finally {
            if (timer) clearTimeout(timer);
            clearTimeout(readTimer);
            signal.removeEventListener('abort', abort);
            scope.abort();
            signal.removeEventListener('abort', close);
            scope.signal.removeEventListener('abort', close);
            close();
        }
    }
}

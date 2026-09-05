/**
 * @file src/features/video-subtitle/content/hlsAudioRuntime.ts
 * 文件职责：将当前 X 视频的 HLS 音轨接入浏览器音频解码，为完整字幕提供 16 kHz PCM。
 * 主要内容：按媒体来源选择清单，组合有界 HLS 读取、AudioContext 解码、时长校验和单声道重采样。
 * 模块边界：不修改用户 video 的播放状态；解码资源仅属于本次读取，页面切换或取消后必须释放。
 */
import {isXMediaUrl, readXHlsAudio} from './hlsAudio';
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

    async read(video: HTMLVideoElement, signal: AbortSignal): Promise<Float32Array | null> {
        const mediaId = (url: string) => url.match(/(?:ext_tw_video|amplify_video|tweet_video)(?:_thumb)?\/(\d+)/)?.[1];
        const sourceId = mediaId(video.currentSrc || video.src) || mediaId(video.poster);
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

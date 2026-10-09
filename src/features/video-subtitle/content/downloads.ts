/**
 * @file src/features/video-subtitle/content/downloads.ts
 * 文件职责：协调原文、译文与双语字幕导出，避免播放器运行时继续承载下载与人工轨回退细节。
 * 主要内容：选择 X 原生或完整 AI、YouTube 捕获或初始化轨道，拒绝把识别中的预览导出为完整字幕，优先人工目标时间轴，仅翻译缺失区间；集中管理反馈计时器，结束时由当前状态恢复按钮，销毁后拒绝迟到恢复。
 * 模块边界：网络、配置、界面文案、状态提示和文件下载由注入端口提供，不直接访问全局页面或存储。
 */
import type {Config} from '@/src/core/config/model';
import {buildYoutubeTimedTextUrl, chooseYoutubeCaptionTrackForLocation, finalizeVideoSubtitleCues, parseYoutubeTimedTextResponse, type VideoSubtitleCue} from './youtubeSubtitleData';
import {createVideoSubtitleAbortError, mergeBilingualVideoSubtitleCues, normalizeVideoCaptionText, translateVideoSubtitleCues} from './subtitleLogic';

interface SubtitleTrack {languageCode: string; cues: VideoSubtitleCue[]}
interface CapturedTrack {url: string; cues: VideoSubtitleCue[]}
interface VideoDownloadPorts {
    config: Config;
    document: ParentNode;
    location: Pick<Location, 'hostname' | 'pathname' | 'search' | 'href'>;
    request: typeof fetch;
    isX(): boolean;
    isDisposed(): boolean;
    isAiActive(): boolean;
    /** 完整识别中的预览只供观看，不能冒充完整 SRT。实时字幕旧入口可省略。 */
    isAiComplete?(): boolean;
    nativeX(): SubtitleTrack | null;
    aiCues(): VideoSubtitleCue[];
    captured(): CapturedTrack[];
    remember(track: CapturedTrack): void;
    human: {ready(): Promise<void>; at(time: number): string};
    translate(source: string): Promise<string>;
    ui(key: string, params?: Record<string, string | number>): string;
    status(menu: HTMLElement, message: string, delay?: number): void;
    save(cues: VideoSubtitleCue[], language: string): void;
    /** 菜单状态拥有者重算当前资格，防止旧反馈把新识别中的导出重新启用。 */
    refreshButtons?(): void;
}

export function createVideoSubtitleDownloads(ports: VideoDownloadPorts) {
    let controller: AbortController | undefined;
    let destroyed = false;
    const isDisposed = () => destroyed || ports.isDisposed();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const restoreButton = (button: HTMLButtonElement, delay = 2200) => {
        if (isDisposed()) return;
        const timer = setTimeout(() => {
            timers.delete(timer);
            if (isDisposed()) return;
            if (ports.refreshButtons) ports.refreshButtons();
            else button.disabled = false;
        }, delay);
        timers.add(timer);
    };
    const resolve = async (): Promise<SubtitleTrack> => {
        const requestController = controller, href = ports.location.href;
        const captured = ports.captured();
        const ai = ports.aiCues();
        if (ports.isX()) {
            if (ports.isAiComplete?.() === false) throw new Error(ports.ui('video.sourcePreparing'));
            if (ports.isAiActive() && ai.length) return {languageCode: 'ai', cues: ai};
            const native = ports.nativeX();
            if (native?.cues.length) return native;
            const track = captured.find(entry => entry.cues.length > 0);
            if (track) return {languageCode: 'original', cues: track.cues};
            if (ai.length) return {languageCode: 'ai', cues: ai};
            throw new Error('当前 X 视频还没有可下载的字幕，请先打开原生字幕或请求 AI 字幕');
        }
        const track = captured.find(entry => !new URL(entry.url, ports.location.href).searchParams.get('tlang')) || captured[0];
        if (track) return {languageCode: new URL(track.url, ports.location.href).searchParams.get('lang') || 'original', cues: track.cues};
        const youtube = chooseYoutubeCaptionTrackForLocation(ports.document, ports.location, ports.config.from);
        if (!youtube) throw new Error('当前视频没有可用的 YouTube 字幕轨道');
        const url = buildYoutubeTimedTextUrl(youtube);
        const response = await ports.request(url, {credentials: 'include', signal: requestController?.signal});
        if (!response.ok) throw new Error(`字幕轨道请求失败（${response.status}）`);
        const cues = finalizeVideoSubtitleCues(parseYoutubeTimedTextResponse(await response.text()));
        if (ports.isDisposed() || requestController?.signal.aborted || ports.location.href !== href) throw createVideoSubtitleAbortError();
        if (!cues.length) throw new Error('YouTube 未返回完整字幕数据，请先打开原生字幕后重试');
        ports.remember({url, cues});
        return {languageCode: youtube.languageCode, cues};
    };
    const translated = async (menu: HTMLElement, button: HTMLButtonElement, bilingual: boolean) => {
        button.disabled = true;
        if (!ports.config.on || !ports.config.videoTranslationEnabled) {
            ports.status(menu, ports.ui('video.enableFirst'), 2200); restoreButton(button); return;
        }
        controller?.abort();
        const current = new AbortController(); controller = current;
        const language = ports.config.to || 'translated';
        button.setAttribute('aria-busy', 'true');
        ports.status(menu, ports.ui('video.fetching'));
        let feedback = '';
        try {
            const result = await resolve();
            await ports.human.ready();
            const manualAt = (cue: VideoSubtitleCue) => ports.config.videoPreferHumanSubtitles
                ? ports.human.at(cue.startMs + cue.durationMs / 2) : '';
            const fallback = result.cues.filter(cue => !manualAt(cue));
            const translations = await translateVideoSubtitleCues(fallback, ports.translate, {concurrency: 3, signal: current.signal,
                onProgress: (completed, total) => ports.status(menu, ports.ui('video.translating', {completed, total})),
            });
            const byText = new Map(fallback.map((cue, index) => [normalizeVideoCaptionText(cue.text), translations[index]!.text]));
            // fallback 中的每条原文已经取得非空译文；取消或配置变更在保存前再次检查。
            const translatedCues = result.cues.map(cue => ({...cue, text: manualAt(cue) || byText.get(normalizeVideoCaptionText(cue.text))!}));
            if (ports.isDisposed() || current.signal.aborted) throw createVideoSubtitleAbortError();
            const cues = bilingual ? mergeBilingualVideoSubtitleCues(result.cues, translatedCues) : translatedCues;
            ports.save(cues, `${language}-${bilingual ? 'bilingual' : 'translated'}`);
            feedback = ports.ui('video.downloaded', {count: cues.length});
        } catch (error) {
            const aborted = error instanceof Error && error.name === 'AbortError';
            feedback = ports.ui(aborted ? 'video.cancelled' : 'video.downloadFailed');
        } finally {
            if (controller === current) controller = undefined;
            button.removeAttribute('aria-busy');
            if (!ports.isDisposed()) { ports.status(menu, feedback, 2200); restoreButton(button); }
        }
    };
    return {resolve, translated, restoreButton, cancel: () => controller?.abort(), destroy: () => {
        destroyed = true;
        controller?.abort(); timers.forEach(clearTimeout); timers.clear();
    }};
}

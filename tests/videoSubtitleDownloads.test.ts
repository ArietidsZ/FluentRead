import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {Config} from '@/src/core/config/model';
import {createVideoSubtitleDownloads} from '@/src/features/video-subtitle/content/downloads';

type Ports = Parameters<typeof createVideoSubtitleDownloads>[0];
const cue = {startMs: 0, durationMs: 1000, text: 'Original caption.'};
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function fixture(overrides: Partial<Ports> = {}) {
    const {document} = parseHTML('<html><body><button></button><div id="menu"></div></body></html>');
    const config = new Config(); config.on = true; config.to = 'zh-Hans';
    const save = vi.fn(), status = vi.fn(), translate = vi.fn(async (source: string) => `译文：${source}`), remember = vi.fn();
    const ports: Ports = {config, document, location: new URL('https://www.youtube.com/watch?v=abc'), request: vi.fn(),
        isX: () => false, isDisposed: () => false, isAiActive: () => false, nativeX: () => null, aiCues: () => [],
        captured: () => [{url: 'https://www.youtube.com/api/timedtext?v=abc&lang=en', cues: [cue]}],
        human: {ready: async () => undefined, at: () => ''}, translate, remember, ui: key => key, status, save, ...overrides};
    const downloads = createVideoSubtitleDownloads(ports);
    return {ports, downloads, config, save, status, translate, remember, document,
        button: document.querySelector('button')! as unknown as HTMLButtonElement,
        menu: document.getElementById('menu')! as unknown as HTMLElement};
}

describe('字幕下载与人工轨优先', () => {
    it('原文选择当前捕获的原始轨，缺少语言时保留原文标记', async () => {
        const original = fixture({captured: () => [
            {url: 'https://www.youtube.com/api/timedtext?v=abc&lang=zh&tlang=zh', cues: [{...cue, text: '机器轨'}]},
            {url: 'https://www.youtube.com/api/timedtext?v=abc&lang=en', cues: [cue]},
        ]});
        expect(await original.downloads.resolve()).toEqual({languageCode: 'en', cues: [cue]});
        const translated = fixture({captured: () => [{url: 'https://www.youtube.com/api/timedtext?tlang=zh', cues: [cue]}]});
        expect((await translated.downloads.resolve()).languageCode).toBe('original');
    });

    it('X 优先主动 AI、原生轨、捕获轨和已识别时间轴，没有字幕时给出说明', async () => {
        const native = {languageCode: 'en', cues: [cue]};
        const active = fixture({isX: () => true, isAiActive: () => true, aiCues: () => [cue], nativeX: () => native});
        expect((await active.downloads.resolve()).languageCode).toBe('ai');
        const source = fixture({isX: () => true, nativeX: () => native});
        expect(await source.downloads.resolve()).toBe(native);
        const captured = fixture({isX: () => true, nativeX: () => ({languageCode: 'en', cues: []})});
        expect((await captured.downloads.resolve()).languageCode).toBe('original');
        const cached = fixture({isX: () => true, captured: () => [{url: 'x:native', cues: []}], aiCues: () => [cue]});
        expect((await cached.downloads.resolve()).languageCode).toBe('ai');
        const empty = fixture({isX: () => true, isAiActive: () => true, captured: () => []});
        await expect(empty.downloads.resolve()).rejects.toThrow('还没有可下载');
    });

    it('没有捕获轨时从当前 YouTube 初始化数据读取轨道，并记住完整时间轴', async () => {
        const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({events: [{tStartMs: 0, dDurationMs: 1000, segs: [{utf8: cue.text}]}]})));
        const f = fixture({captured: () => [], request});
        const script = f.document.createElement('script');
        script.textContent = 'var ytInitialPlayerResponse={"videoDetails":{"videoId":"abc"},"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=abc&lang=en","languageCode":"en"}]}}};';
        f.document.body.appendChild(script);
        expect(await f.downloads.resolve()).toEqual({languageCode: 'en', cues: [cue]});
        expect(f.remember).toHaveBeenCalledOnce();
        request.mockResolvedValueOnce(new Response('', {status: 503}));
        await expect(f.downloads.resolve()).rejects.toThrow('503');
        request.mockResolvedValueOnce(new Response('{}'));
        await expect(f.downloads.resolve()).rejects.toThrow('完整字幕');
        f.ports.isDisposed = () => true; request.mockResolvedValueOnce(new Response('{}'));
        await expect(f.downloads.resolve()).rejects.toMatchObject({name: 'AbortError'});
        const empty = fixture({captured: () => []}); await expect(empty.downloads.resolve()).rejects.toThrow('没有可用');
    });

    it('导出双语时使用人工字幕，仅为没有人工字幕的句子请求翻译', async () => {
        const second = {...cue, startMs: 1000, text: 'Second original.'};
        const f = fixture({captured: () => [{url: 'https://www.youtube.com/api/timedtext?lang=en', cues: [cue, second]}],
            human: {ready: async () => undefined, at: time => time < 1000 ? '人工字幕' : ''}});
        await f.downloads.translated(f.menu, f.button, true);
        expect(f.translate).toHaveBeenCalledOnce(); expect(f.translate).toHaveBeenCalledWith(second.text);
        expect(f.save).toHaveBeenCalledWith([{...cue, text: 'Original caption.\n人工字幕'}, {...second, text: 'Second original.\n译文：Second original.'}], 'zh-Hans-bilingual');
        expect(f.button.getAttribute('aria-busy')).toBeNull();
        await vi.advanceTimersByTimeAsync(2200); expect(f.button.disabled).toBe(false); f.downloads.destroy();
    });

    it('关闭人工字幕优先后按配置使用服务，目标为空时仍能命名译文下载', async () => {
        const f = fixture({human: {ready: async () => undefined, at: () => '人工字幕'}});
        f.config.videoPreferHumanSubtitles = false; f.config.to = '';
        await f.downloads.translated(f.menu, f.button, false);
        expect(f.translate).toHaveBeenCalledOnce(); expect(f.translate).toHaveBeenCalledWith(cue.text);
        expect(f.save).toHaveBeenCalledWith([{...cue, text: '译文：Original caption.'}], 'translated-translated'); f.downloads.destroy();
    });

    it('关闭功能、翻译失败或取消时不导出，按钮反馈不会遗留计时器', async () => {
        const disabled = fixture(); disabled.config.on = false;
        await disabled.downloads.translated(disabled.menu, disabled.button, false);
        expect(disabled.status).toHaveBeenCalledWith(disabled.menu, 'video.enableFirst', 2200); disabled.downloads.destroy();
        const off = fixture(); off.config.videoTranslationEnabled = false;
        await off.downloads.translated(off.menu, off.button, false); off.downloads.destroy();
        const failed = fixture({translate: async () => { throw 'failure'; }});
        await failed.downloads.translated(failed.menu, failed.button, false);
        expect(failed.status).toHaveBeenLastCalledWith(failed.menu, 'video.downloadFailed', 2200); expect(failed.save).not.toHaveBeenCalled(); failed.downloads.destroy();
        const disposed = fixture({isDisposed: () => true});
        await disposed.downloads.translated(disposed.menu, disposed.button, false);
        expect(disposed.save).not.toHaveBeenCalled(); expect(disposed.status).not.toHaveBeenCalledWith(disposed.menu, 'video.cancelled', 2200); disposed.downloads.destroy();
        let finish!: (value: string) => void;
        const pending = fixture({translate: () => new Promise<string>(yes => { finish = yes; })});
        const promise = pending.downloads.translated(pending.menu, pending.button, false);
        await vi.advanceTimersByTimeAsync(0); pending.downloads.cancel(); finish('过期译文'); await promise;
        expect(pending.save).not.toHaveBeenCalled(); expect(pending.status).toHaveBeenLastCalledWith(pending.menu, 'video.cancelled', 2200); pending.downloads.destroy();
        const destroyed = fixture({translate: () => new Promise<string>(yes => { finish = yes; })});
        const last = destroyed.downloads.translated(destroyed.menu, destroyed.button, false);
        await vi.advanceTimersByTimeAsync(0); destroyed.ports.isDisposed = () => true; destroyed.downloads.destroy(); finish('迟到译文'); await last;
        expect(destroyed.save).not.toHaveBeenCalled();
    });

    it('并发下载取消上一轮；迟到网络响应与换页结果不得污染当前轨道', async () => {
        let ready!: (response: Response) => void;
        const request = vi.fn().mockImplementationOnce(() => new Promise<Response>(yes => { ready = yes; }))
            .mockResolvedValue(new Response(JSON.stringify({events: [{tStartMs: 0, dDurationMs: 1000, segs: [{utf8: cue.text}]}]})));
        const f = fixture({request, captured: () => []});
        const script = f.document.createElement('script');
        script.textContent = 'var ytInitialPlayerResponse={"videoDetails":{"videoId":"abc"},"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=abc&lang=en","languageCode":"en"}]}}};';
        f.document.body.appendChild(script);
        const first = f.downloads.translated(f.menu, f.button, false); await vi.advanceTimersByTimeAsync(0);
        const second = f.downloads.translated(f.menu, f.button, false);
        ready(new Response('{}')); await Promise.all([first, second]);
        expect(f.save).toHaveBeenCalledOnce(); f.downloads.destroy();
        request.mockImplementationOnce(() => new Promise<Response>(yes => { ready = yes; }));
        const stale = f.downloads.resolve(); (f.ports.location as URL).href = 'https://www.youtube.com/watch?v=another';
        ready(new Response('{}')); await expect(stale).rejects.toMatchObject({name: 'AbortError'});
    });
});

it('exports the explicitly selected YouTube local timeline, returns to native after cancel', async () => {
    let active = true;
    const local = {...cue, text: 'Local transcript.'};
    const f = fixture({isAiActive: () => active, aiCues: () => [local]});
    expect(await f.downloads.resolve()).toEqual({languageCode: 'ai', cues: [local]});
    active = false;
    expect(await f.downloads.resolve()).toEqual({languageCode: 'en', cues: [cue]});
});

it('does not export native captions while the selected local source is still empty', async () => {
    const f = fixture({isAiActive: () => true});
    await expect(f.downloads.resolve()).rejects.toThrow('还没有可下载的 AI 字幕');
});
it('translates local transcript text instead of substituting unrelated native human captions', async () => {
    const local = {...cue, text: 'Local transcript.'};
    const f = fixture({isAiActive: () => true, aiCues: () => [local],
        human: {ready: async () => undefined, at: () => 'Native translation.'}});
    f.config.videoPreferHumanSubtitles = true;
    await f.downloads.translated(f.menu, f.button, false);
    expect(f.translate).toHaveBeenCalledWith(local.text);
    expect(f.save).toHaveBeenCalledWith([{...local, text: '译文：Local transcript.'}], expect.any(String));
});

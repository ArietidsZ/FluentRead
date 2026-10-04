/**
 * @file src/features/image-translation/content/mangaCanvas.ts
 * 文件职责：把站点允许读取的正文画布接入既有漫画识别与局部译图合成，保留宿主画布及翻页交互。
 * 主要内容：小尺寸像素指纹识别画布重绘，任务使用独立原图快照；会话端口负责串行调度，暂停、来源变化和卸载取消旧结果；译图在隔离层跟随正文与祖先裁切，缓存只保留有界压缩图块。
 * 模块边界：只读取公开 DOM 画布，不访问站点接口、不读取受污染像素、不更改原画布或宿主样式；识别和翻译由注入的现有图片客户端完成。
 */
import {compressMangaPage, createMangaLightCache, type MangaCompressedPage, type MangaPatchPacket} from '../mangaPatchResult';
import {composeMangaPage} from './mangaCompositor';

interface CanvasState {
    identity: string;
    controller: AbortController | null;
    surface: HTMLCanvasElement | null;
    completed: boolean;
    failed: boolean;
    showing: boolean;
}

export function createMangaCanvas(ports: {
    enabled: () => boolean;
    configurationIdentity: () => string;
    cacheEnabled: () => boolean;
    acceptsInteractionLayer?: (canvas: HTMLCanvasElement, hit: Element) => boolean;
    translate: (image: string, signal: AbortSignal) => Promise<{mangaPatches?: MangaPatchPacket; lines: MangaCompressedPage['lines']}>;
}) {
    const states = new Map<HTMLCanvasElement, CanvasState>();
    const ids = new WeakMap<HTMLCanvasElement, number>();
    const lightCache = createMangaLightCache();
    let sequence = 0;
    const sample = document.createElement('canvas');
    let host: HTMLDivElement | null = null, root: ShadowRoot | null = null;
    let disposed = false;

    function identity(canvas: HTMLCanvasElement): string | null {
        if (disposed || canvas.width < 80 || canvas.height < 40 || canvas.width > 8192 || canvas.height > 8192
            || canvas.width * canvas.height > 16_000_000) return null;
        try {
            // 重设尺寸同时清除前一张受污染画布的状态，不让它阻止其他可读正文。
            sample.width = sample.height = 8;
            const context = sample.getContext('2d', {willReadFrequently: true});
            if (!context) return null;
            // 用整数位置的一比一像素抽样，避免缩图采样的边界与插值差异误判未变的原页。
            context.imageSmoothingEnabled = false;
            for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
                context.drawImage(canvas, Math.floor((x + .5) * canvas.width / 8), Math.floor((y + .5) * canvas.height / 8), 1, 1, x, y, 1, 1);
            }
            const data = context.getImageData(0, 0, 8, 8).data;
            if (!data.some(value => value !== 0)) return null;
            let hash = 2166136261;
            for (const value of data) hash = Math.imul(hash ^ value, 16777619);
            if (!ids.has(canvas)) ids.set(canvas, ++sequence);
            return `${ids.get(canvas)}:${canvas.width}:${canvas.height}:${hash >>> 0}:${ports.configurationIdentity()}`;
        } catch { return null; }
    }

    function release(canvas: HTMLCanvasElement): void {
        const state = states.get(canvas);
        if (!state) return;
        state.controller?.abort();
        state.surface?.remove();
        if (state.surface) state.surface.width = state.surface.height = 0;
        states.delete(canvas);
    }

    function update(): void {
        for (const [canvas, state] of states) {
            if (!canvas.isConnected || identity(canvas) !== state.identity) {release(canvas);continue;}
            const surface = state.surface;
            if (!surface) continue;
            const rect = canvas.getBoundingClientRect();
            let left = Math.max(0, rect.left), right = Math.min(window.innerWidth, rect.right);
            let top = Math.max(0, rect.top), bottom = Math.min(window.innerHeight, rect.bottom);
            let visible = state.showing && ports.enabled() && !document.hidden && rect.width > 0 && rect.height > 0;
            for (let parent: Element | null = canvas; parent; parent = parent.parentElement) {
                const style = getComputedStyle(parent);
                if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') visible = false;
                if (parent === document.documentElement || parent === document.scrollingElement) continue;
                const bounds = parent.getBoundingClientRect();
                if (/^(hidden|clip|auto|scroll)$/.test(style.overflowX)) {left = Math.max(left, bounds.left);right = Math.min(right, bounds.right);}
                if (/^(hidden|clip|auto|scroll)$/.test(style.overflowY)) {top = Math.max(top, bounds.top);bottom = Math.min(bottom, bounds.bottom);}
            }
            visible &&= right > left && bottom > top;
            if (visible) {
                const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
                visible = !!hit && (hit === canvas || hit.contains(canvas) || ports.acceptsInteractionLayer?.(canvas, hit) === true);
            }
            surface.style.cssText = `position:fixed;pointer-events:none;display:${visible ? 'block' : 'none'};left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;clip-path:inset(${Math.max(0, top - rect.top)}px ${Math.max(0, rect.right - right)}px ${Math.max(0, rect.bottom - bottom)}px ${Math.max(0, left - rect.left)}px);`;
        }
    }

    function show(state: CanvasState): void {
        state.showing = true;
        if (state.surface) {
            if (!host) {
                host = document.createElement('div');host.id = 'fluent-read-manga-canvas-container';
                host.setAttribute('data-fluent-read-ui', 'manga-canvas');
                host.style.cssText = 'all:initial;position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483644;';
                root = host.attachShadow({mode: 'closed'});document.documentElement.append(host);
            }
            root!.append(state.surface);
        }
        update();
    }

    function reuse(canvas: HTMLCanvasElement): boolean {
        const state = states.get(canvas);
        if (!state?.completed || state.failed || state.identity !== identity(canvas) || !ports.enabled()) return false;
        show(state);return true;
    }

    async function translate(canvas: HTMLCanvasElement): Promise<void> {
        if (reuse(canvas)) return;
        const owner = identity(canvas);
        if (!owner || !ports.enabled() || !canvas.isConnected) return;
        release(canvas);
        const controller = new AbortController();
        const state: CanvasState = {identity: owner, controller, surface: null, completed: false, failed: false, showing: true};
        states.set(canvas, state);
        const original = document.createElement('canvas');
        const current = () => !disposed && !controller.signal.aborted && states.get(canvas) === state
            && canvas.isConnected && ports.enabled() && identity(canvas) === owner;
        try {
            original.width = canvas.width;original.height = canvas.height;
            const context = original.getContext('2d');
            if (!context) throw new Error('浏览器不支持图片处理');
            context.drawImage(canvas, 0, 0);
            let page = ports.cacheEnabled() ? lightCache.get(owner) : undefined;
            if (!page) {
                const result = await ports.translate(original.toDataURL('image/png'), controller.signal);
                if (!current()) return;
                if (result.lines.length === 0) page = {width: original.width, height: original.height, patches: [], lines: []};
                else {
                    if (!result.mangaPatches) throw new Error('漫画译图数据无效');
                    page = compressMangaPage(result.mangaPatches, result.lines);
                }
                if (ports.cacheEnabled()) lightCache.put(owner, page);
            }
            const surface = page.patches.length ? await composeMangaPage(original, page, controller.signal) : null;
            if (!current()) {if (surface) surface.width = surface.height = 0;return;}
            state.surface = surface;state.completed = true;show(state);
        } catch (error) {
            if (current()) {state.failed = true;throw error;}
        } finally {
            original.width = original.height = 0;
            if (states.get(canvas) === state) state.controller = null;
        }
    }

    const clear = () => {Array.from(states.keys()).forEach(release);lightCache.clear();};
    return {
        identity, translate, reuse, release, update,
        failed: (canvas: HTMLCanvasElement) => states.get(canvas)?.failed === true,
        restore(canvas: HTMLCanvasElement) {
            const state = states.get(canvas);
            if (state) {state.controller?.abort();state.showing = false;state.surface?.remove();}
        },
        resetCache: clear,
        dispose() {disposed = true;clear();sample.width = sample.height = 0;host?.remove();host = null;root = null;},
    };
}

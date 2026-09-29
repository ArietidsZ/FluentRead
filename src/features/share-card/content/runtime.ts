/**
 * @file src/features/share-card/content/runtime.ts
 * 文件职责：统一网页译文与划词结果的分享入口，按需创建独立封闭 Shadow UI。
 * 主要内容：代理指针和焦点事件，仅对真实完成的双语译文显示一个悬浮入口；保存挂载代次、当前段落与清理句柄，滚动隐藏入口，停用和卸载释放全部资源。
 * 模块边界：只读取全文翻译公开快照，不修改正文、不暴露跨世界事件协议；卡片渲染和样式存储归 UI，页面总开关由 content registry 编排。
 */
import type {ContentScriptContext} from 'wxt/utils/content-script-context';
import type {ShadowRootContentScriptUi} from 'wxt/utils/content-script-ui/shadow-root';
import {createVueShadowUi, type VueShadowMount} from '@/src/platform/shadow-ui';
import {readBilingualExcerpt} from '@/src/features/full-page-translation/public';
import {showPageNotice} from '@/src/features/page-notice/public';
import {config} from '@/src/services/config/store';
import {normalizeUiLanguage, translate} from '@/src/core/i18n';
import {cardSourceDomain, type ShareCardExcerpt} from '../core';
import ShareCardStudio from '../ui/ShareCardStudio.vue';

interface Studio {open(excerpt: ShareCardExcerpt): Promise<void>; setAnchor(anchor: {x: number; y: number} | null): void}
let context: ContentScriptContext | null = null;
let controller: AbortController | null = null;
let ui: ShadowRootContentScriptUi<VueShadowMount> | null = null;
let pending: Promise<Studio | null> | null = null;
let generation = 0;
let hovered: HTMLElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let open = false;
const HOST_ID = 'fluent-read-share-card-container';

function instance(): Studio | null { return ui?.mounted?.instance as Studio | null ?? null; }
export function isShareCardMounted(): boolean { return Boolean(controller && !controller.signal.aborted); }
function hideLauncher(): void { clearTimeout(hideTimer); hovered = null; instance()?.setAnchor(null); }
function reportOpenFailure(): void {
    showPageNotice(translate('shareCard.openFailed', normalizeUiLanguage(config.uiLanguage)), 'error');
}
async function ensureStudio(): Promise<Studio | null> {
    if (!controller || !context) return null;
    if (ui) return instance();
    if (!pending) {
        const current = generation;
        const task = createVueShadowUi(context, {
            name: 'fluent-read-share-card-ui', hostId: HOST_ID, component: ShareCardStudio, mode: 'closed',
            props: {
                onActivate: () => {
                    const excerpt = hovered && readBilingualExcerpt(hovered);
                    if (excerpt) void openShareCard(excerpt);
                    else hideLauncher();
                },
                onClosed: () => { open = false; hideLauncher(); },
            },
        }).then(created => {
            if (current !== generation || !controller) { created.remove(); return null; }
            ui = created; return instance();
        }).finally(() => { if (pending === task) pending = null; });
        pending = task;
    }
    return pending;
}
export async function openShareCard(excerpt: {original: string; translation: string}): Promise<void> {
    if (!controller || config.on === false || !excerpt.original.trim() || !excerpt.translation.trim()) return;
    const current = generation;
    const snapshot = {original: excerpt.original, translation: excerpt.translation, source: cardSourceDomain(location.href)};
    try {
        const studio = await ensureStudio();
        if (!studio || current !== generation) return;
        open = true; hideLauncher(); await studio.open(snapshot);
    } catch { if (current === generation) { open = false; reportOpenFailure(); } }
}
export function mountShareCard(ctx: ContentScriptContext): void {
    if (controller) return;
    context = ctx; controller = new AbortController();
    const signal = controller.signal;
    const inspect = (event: Event) => {
        if (!event.isTrusted || open || config.on === false) return;
        const target = event.composedPath().find(item => item instanceof Element) as Element | undefined;
        if (target?.id === HOST_ID) { clearTimeout(hideTimer); return; }
        const excerpt = target && readBilingualExcerpt(target);
        if (!excerpt) { clearTimeout(hideTimer); hideTimer = setTimeout(hideLauncher, 240); return; }
        clearTimeout(hideTimer);
        if (hovered === excerpt.artifact) return;
        hovered = excerpt.artifact;
        const current = generation;
        void ensureStudio().then(studio => {
            if (!studio || current !== generation || hovered !== excerpt.artifact || !hovered.isConnected || open) return;
            const rect = hovered.getBoundingClientRect();
            studio.setAnchor({x: Math.max(8, Math.min(rect.right - 110, window.innerWidth - 130)), y: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 46))});
        }).catch(reportOpenFailure);
    };
    document.addEventListener('pointerover', inspect, {capture: true, passive: true, signal});
    document.addEventListener('focusin', inspect, {capture: true, signal});
    document.addEventListener('pointerout', event => { if (!event.relatedTarget) hideLauncher(); }, {capture: true, signal});
    window.addEventListener('scroll', hideLauncher, {capture: true, passive: true, signal});
    window.addEventListener('resize', hideLauncher, {passive: true, signal});
}
export function unmountShareCard(): void {
    generation++; controller?.abort(); controller = null; context = null;
    hideLauncher(); open = false; pending = null; ui?.remove(); ui = null;
}

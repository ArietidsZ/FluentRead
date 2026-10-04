/**
 * @file src/features/vocabulary/content.ts
 * 文件职责：在独立 Shadow DOM 中挂载鼠标高亮句子的听读和收藏入口。
 * 主要内容：通过 WXT context 和挂载代次控制异步界面的所有权，关闭后完整移除。
 * 模块边界：只组装界面，句子定位由全文翻译负责，收藏与朗读沿用已有后台。
 */
import type {ContentScriptContext} from 'wxt/utils/content-script-context';
import {createVueShadowUi} from '@/src/platform/shadow-ui/vue';
import SentenceActions from './ui/SentenceActions.vue';
let mounted: Awaited<ReturnType<typeof createVueShadowUi>> | undefined;
let generation = 0;
export async function mountSentenceActions(ctx: ContentScriptContext): Promise<void> {
    const owner = ++generation;
    const ui = await createVueShadowUi(ctx, {name: 'fluent-read-sentence-actions', hostId: 'fluent-read-sentence-actions', component: SentenceActions});
    if (generation !== owner) {ui.remove(); return;}
    mounted?.remove(); mounted = ui;
}
export function unmountSentenceActions(): void {generation++; mounted?.remove(); mounted = undefined;}
export function isSentenceActionsMounted(): boolean {return Boolean(mounted);}

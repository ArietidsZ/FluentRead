/**
 * @file src/features/selection-translation/background/pageZoomHandler.ts
 * 文件职责：仅向发起请求的内容脚本返回其所属标签页的页面缩放比例。
 * 主要内容：从可信 runtime sender 读取 tabId，调用后台 tabs.getZoom 并规范化结果。
 * 模块边界：不接受消息体指定的标签页，不更改页面缩放或读取宿主页内容；浏览器 API 由组合层注入。
 */

import {normalizeSelectionPageZoom, SELECTION_PAGE_ZOOM_REQUEST} from '../pageZoom';
import {isBrowserTabId} from '@/src/platform/browser/ids';

export interface SelectionPageZoomContext {
    sender?: {tab?: {id?: number}};
}

export function createSelectionPageZoomHandler(getZoom: (tabId: number) => Promise<number>) {
    return {
        type: SELECTION_PAGE_ZOOM_REQUEST,
        async handle(_message: {type: typeof SELECTION_PAGE_ZOOM_REQUEST}, context: SelectionPageZoomContext) {
            const tabId = context.sender?.tab?.id;
            if (!isBrowserTabId(tabId)) return {success: false as const};
            return {success: true as const, zoom: normalizeSelectionPageZoom(await getZoom(tabId))};
        },
    };
}

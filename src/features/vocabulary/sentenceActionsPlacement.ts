/**
 * @file src/features/vocabulary/sentenceActionsPlacement.ts
 * 文件职责：为句子操作入口和工具条选择避开当前双语正文的位置。
 * 主要内容：以实际文字边界和实测面板尺寸优先放到段落右侧或左侧；横向空间不足时固定到离当前句子较远的视口边缘，并判断指针是否位于面板或侧边过渡间隙。
 * 模块边界：只计算视口坐标，不读取 DOM、配置或存储，不修改宿主布局。
 */
type Rect = {left: number; right: number; top: number; bottom: number};
type Size = {width: number; height: number};
const gap = 8;

export function placeSentenceActions(anchor: Rect, line: Rect, panel: Size, viewport: Size): {left: number; top: number; docked: boolean} {
    const width = Math.min(panel.width, viewport.width - gap * 2);
    const height = Math.min(panel.height, viewport.height - gap * 2);
    const top = Math.max(gap, Math.min(line.top, viewport.height - height - gap));
    if (anchor.right + gap + width <= viewport.width - gap) return {left: anchor.right + gap, top, docked: false};
    if (anchor.left - gap - width >= gap) return {left: anchor.left - gap - width, top, docked: false};
    const dockTop = line.top + (line.bottom - line.top) / 2 > viewport.height / 2 ? gap : viewport.height - height - gap;
    return {left: Math.max(gap, Math.min(anchor.right - width, viewport.width - width - gap)), top: dockTop, docked: true};
}

export function isSentenceActionsPointer(anchor: Rect, panel: Rect, point: {clientX: number; clientY: number}): boolean {
    const {clientX: x, clientY: y} = point;
    if (x >= panel.left - gap && x <= panel.right + gap && y >= panel.top - gap && y <= panel.bottom + gap) return true;
    // 只保留正文之外的侧边通道，避免把另一侧或另一句的文字当成工具条。
    return y >= panel.top - gap && y <= panel.bottom + gap
        && ((panel.left >= anchor.right && x >= anchor.right && x <= panel.left)
            || (panel.right <= anchor.left && x >= panel.right && x <= anchor.left));
}

/** 由停留点朝工具条收窄的通道；运行时只在持续移动时保留，停下会重新选择句子。 */
export function isSentenceActionsTransfer(origin: {clientX: number; clientY: number}, panel: Rect, point: {clientX: number; clientY: number}): boolean {
    const between = (start: number, end: number, value: number): boolean => value >= Math.min(start, end) && value <= Math.max(start, end);
    if (origin.clientX < panel.left || origin.clientX > panel.right) {
        const edge = origin.clientX < panel.left ? panel.left : panel.right;
        if (!between(origin.clientX, edge, point.clientX)) return false;
        const ratio = (point.clientX - origin.clientX) / (edge - origin.clientX);
        return point.clientY >= origin.clientY + (panel.top - origin.clientY) * ratio - gap
            && point.clientY <= origin.clientY + (panel.bottom - origin.clientY) * ratio + gap;
    }
    const edge = origin.clientY < panel.top ? panel.top : panel.bottom;
    if (!between(origin.clientY, edge, point.clientY) || edge === origin.clientY) return false;
    const ratio = (point.clientY - origin.clientY) / (edge - origin.clientY);
    return point.clientX >= origin.clientX + (panel.left - origin.clientX) * ratio - gap
        && point.clientX <= origin.clientX + (panel.right - origin.clientX) * ratio + gap;
}

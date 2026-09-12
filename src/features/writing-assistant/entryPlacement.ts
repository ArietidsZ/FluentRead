/**
 * @file src/features/writing-assistant/entryPlacement.ts
 * 文件职责：计算写作入口在原生发送按钮两侧的有序候选位置。
 * 主要内容：优先完整文字入口，空间不足时提供紧凑图标候选；所有候选与原生按钮留有间隔并完整位于可见视口内。
 * 模块边界：只计算几何位置，不访问网页、不移动原生按钮；实际控件碰撞与遮挡由写作界面检查。
 */
interface Bounds {left: number; top: number; right: number; bottom: number}
interface ActionBounds extends Bounds {width: number; height: number}
export interface WritingEntryPlacement {left: number; top: number; width: number; height: number; compact: boolean}

export function writingEntryCandidates(action: ActionBounds, viewport: Bounds, fullWidth: number, site: 'github' | 'gmail'): WritingEntryPlacement[] {
    if (![action.left, action.top, action.right, action.bottom, action.width, action.height, viewport.left, viewport.top, viewport.right, viewport.bottom, fullWidth].every(Number.isFinite)
        || action.width <= 0 || action.height <= 0 || fullWidth < 32
        || action.right <= action.left || action.bottom <= action.top
        || viewport.right <= viewport.left || viewport.bottom <= viewport.top
        || action.left < viewport.left || action.right > viewport.right
        || action.top < viewport.top || action.bottom > viewport.bottom) return [];
    const top = action.top + (action.height - 32) / 2;
    const result: WritingEntryPlacement[] = [];
    for (const width of fullWidth === 32 ? [32] : [fullWidth, 32]) {
        const sides = site === 'github' ? ['left', 'right'] : ['right', 'left'];
        for (const side of sides) {
            const left = side === 'left' ? action.left - 8 - width : action.right + 8;
            if (left >= viewport.left + 8 && left + width <= viewport.right - 8
                && top >= viewport.top + 8 && top + 32 <= viewport.bottom - 8) {
                result.push({left, top, width, height: 32, compact: width === 32});
            }
        }
    }
    return result;
}

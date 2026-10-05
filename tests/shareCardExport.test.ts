import {afterEach, describe, expect, it, vi} from 'vitest';
import {canCopyCardImage, copyCardImage, shareCardFilename} from '@/src/features/share-card/export';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const blob = new Blob(['png'], {type:'image/png'});
describe('卡片图片导出能力回退', () => {
    it('导出名使用 UTC 日期与 PNG 扩展名', () => {
        vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-04T23:59:59Z'));
        expect(shareCardFilename()).toBe('FluentRead-2026-10-04.png');
    });
    it('缺失图片剪贴板不尝试写入，存在时直接写入 PNG', async () => {
        vi.stubGlobal('navigator', {}); vi.stubGlobal('ClipboardItem', undefined);
        expect(canCopyCardImage()).toBe(false); await expect(copyCardImage(blob)).rejects.toThrow('clipboard-unavailable');
        const write = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', {clipboard: {write}}); vi.stubGlobal('ClipboardItem', class {constructor(public items: unknown) {}});
        const pending = copyCardImage(blob); expect(write).toHaveBeenCalledOnce(); await pending;
        expect(write.mock.calls[0][0][0].items['image/png']).toBe(blob);
    });
});

import {afterEach, describe, expect, it, vi} from 'vitest';
import {canCopyCardImage, canShareCardImage, copyCardImage, shareCardImage} from '@/src/features/share-card/export';
afterEach(() => vi.unstubAllGlobals());
const blob = new Blob(['png'], {type:'image/png'});
describe('分享导出能力回退', () => {
    it('缺失图片剪贴板不尝试写入，存在时直接写入 PNG', async () => {
        vi.stubGlobal('navigator', {}); vi.stubGlobal('ClipboardItem', undefined);
        expect(canCopyCardImage()).toBe(false); await expect(copyCardImage(blob)).rejects.toThrow('clipboard-unavailable');
        const write = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', {clipboard: {write}}); vi.stubGlobal('ClipboardItem', class {constructor(public items: unknown) {}});
        const pending = copyCardImage(blob); expect(write).toHaveBeenCalledOnce(); await pending;
        expect(write.mock.calls[0][0][0].items['image/png']).toBe(blob);
    });
    it('只有文件分享可用才提供分享，取消不是失败', async () => {
        vi.stubGlobal('navigator', {canShare: () => false}); expect(canShareCardImage(blob)).toBe(false);
        const share = vi.fn().mockRejectedValue(new DOMException('Cancelled','AbortError'));
        vi.stubGlobal('navigator', {canShare: () => true, share}); expect(canShareCardImage(blob)).toBe(true);
        expect(await shareCardImage(blob)).toBe('cancelled');
        share.mockRejectedValueOnce(new DOMException('Denied','NotAllowedError')); await expect(shareCardImage(blob)).rejects.toThrow('Denied');
        share.mockResolvedValueOnce(undefined); expect(await shareCardImage(blob)).toBe('shared');
    });
});

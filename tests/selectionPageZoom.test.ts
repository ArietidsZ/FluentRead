import {describe, expect, it, vi} from 'vitest';
import {createSelectionPageZoomHandler} from '@/src/features/selection-translation/background/pageZoomHandler';
import {normalizeSelectionPageZoom, SELECTION_PAGE_ZOOM_REQUEST} from '@/src/features/selection-translation/pageZoom';

describe('selection page zoom', () => {
    it('reads only the sender tab zoom and ignores a tab id supplied in the message', async () => {
        const getZoom = vi.fn(async (_tabId: number) => 2);
        const handler = createSelectionPageZoomHandler(getZoom);
        const request = {type: SELECTION_PAGE_ZOOM_REQUEST, tabId: 99};

        await expect(handler.handle(request, {sender: {tab: {id: 7}}})).resolves.toEqual({success: true, zoom: 2});
        expect(getZoom).toHaveBeenCalledOnce();
        expect(getZoom).toHaveBeenCalledWith(7);
        await expect(handler.handle(request, {sender: {}})).resolves.toEqual({success: false});
        expect(getZoom).toHaveBeenCalledTimes(1);
    });

    it('rejects invalid browser zoom values before they reach CSS transforms', () => {
        expect(normalizeSelectionPageZoom(0.5)).toBe(0.5);
        expect(normalizeSelectionPageZoom(1)).toBe(1);
        expect(normalizeSelectionPageZoom(5)).toBe(5);
        for (const value of [0, -1, Infinity, NaN, '2', null]) {
            expect(normalizeSelectionPageZoom(value)).toBe(1);
        }
    });
});

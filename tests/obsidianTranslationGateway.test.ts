import {describe, expect, it, vi} from 'vitest';
import {createObsidianTranslator, type ObsidianRequestUrl} from '../integrations/obsidian/translation';

describe('Obsidian translation gateway', () => {
    const segments = [
        {id: 0, source: 'First paragraph'},
        {id: 1, source: 'Second paragraph'},
    ];

    it('uses requestUrl and publishes a complete translated batch', async () => {
        const request = vi.fn(async () => ({
            status: 200,
            headers: {'content-type': 'application/json'},
            text: JSON.stringify([
                {translations: [{text: '第一段'}]},
                {translations: [{text: '第二段'}]},
            ]),
        })) as unknown as ObsidianRequestUrl;
        const onSegment = vi.fn();
        const result = await createObsidianTranslator(request)(segments, {
            fileName: 'note.md',
            sourceLanguage: 'en',
            targetLanguage: 'zh-Hans',
            onSegment,
        });
        expect(result).toEqual(['第一段', '第二段']);
        expect(onSegment).toHaveBeenCalledTimes(2);
        expect(vi.mocked(request).mock.calls[0][0]).toMatchObject({
            method: 'POST',
            throw: false,
            body: '["First paragraph","Second paragraph"]',
        });
    });

    it('does not publish partial results from an incomplete provider response', async () => {
        const request = vi.fn(async () => ({
            status: 200,
            headers: {},
            text: JSON.stringify([{translations: [{text: '第一段'}]}]),
        })) as unknown as ObsidianRequestUrl;
        const onSegment = vi.fn();
        await expect(createObsidianTranslator(request)(segments, {fileName: 'note.md', onSegment}))
            .rejects.toThrow('返回数量异常');
        expect(onSegment).not.toHaveBeenCalled();
    });

    it('stops waiting and cannot publish late results after cancellation', async () => {
        let complete!: (value: {status: number; headers: Record<string, string>; text: string}) => void;
        const request = vi.fn(() => new Promise((resolve) => { complete = resolve; })) as unknown as ObsidianRequestUrl;
        const controller = new AbortController();
        const onSegment = vi.fn();
        const pending = createObsidianTranslator(request)(segments, {
            fileName: 'note.md',
            signal: controller.signal,
            onSegment,
        });
        await vi.waitFor(() => expect(vi.mocked(request)).toHaveBeenCalled());
        controller.abort();
        await expect(pending).rejects.toMatchObject({name: 'AbortError'});
        complete({status: 200, headers: {}, text: '[]'});
        expect(onSegment).not.toHaveBeenCalled();
    });
});

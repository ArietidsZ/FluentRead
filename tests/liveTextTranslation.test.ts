import {beforeEach, describe, expect, it, vi} from 'vitest';

const runtime = vi.hoisted(() => ({
    slots: [] as Array<{node: Text; prefix: string; source: string; suffix: string}>,
    translations: [] as string[],
    translateTextSlots: vi.fn(),
    getCurrentTranslationCore: vi.fn(() => ({shouldStayOriginal: () => false})),
}));

vi.mock('@/src/core/translation/public', () => ({
    collectLiveTranslationTextSlots: () => runtime.slots,
    getCurrentTranslationCore: runtime.getCurrentTranslationCore,
}));

vi.mock('@/src/features/full-page-translation/content/translationRequest', () => ({
    translateTextSlots: runtime.translateTextSlots,
}));

import {parseHTML} from 'linkedom';
import {createTranslationRequest, translateLiveText} from '@/src/features/full-page-translation/content/liveTextTranslation';

const snapshot = {service: 'microsoft', model: 'default', thinking: false, sourceLanguage: 'en', targetLanguage: 'zh',
    useCache: true, enableAIContext: false, enableAIMultiSegment: false, displayMode: 'single' as const, style: 0};

describe('实时文本翻译快照', () => {
    beforeEach(() => {
        runtime.slots = [];
        runtime.translations = [];
        runtime.translateTextSlots.mockReset();
        runtime.translateTextSlots.mockImplementation(async () => runtime.translations);
    });

    it('正文双语请求只提交可译文本槽，空内容不调用服务', async () => {
        const {document} = parseHTML('<html><body><p>Source text</p></body></html>');
        const owner = document.querySelector('p')!;
        expect(await createTranslationRequest(owner, 'content', 'bilingual', snapshot)).toEqual({kind: 'snapshot', sources: [], translations: []});
        expect(runtime.translateTextSlots).not.toHaveBeenCalled();
        runtime.slots = [{node: owner.firstChild as Text, prefix: '', source: 'Source text', suffix: ''}];
        runtime.translations = ['来源文字'];
        const result = await createTranslationRequest(owner, 'content', 'bilingual', snapshot, undefined, undefined, undefined, undefined, true, 'all');
        expect(result).toEqual({kind: 'snapshot', sources: ['Source text'], translations: ['来源文字']});
        expect(runtime.getCurrentTranslationCore).toHaveBeenLastCalledWith('all');
        expect(runtime.translateTextSlots).toHaveBeenLastCalledWith(['Source text'], snapshot, undefined, undefined, undefined, true);
        expect(owner.textContent).toBe('Source text');
    });

    it.each([{kind: 'content', mode: 'single'}, {kind: 'control', mode: 'bilingual'}] as const)(
        '$kind / $mode 请求返回原位 Text 槽并保留 all 范围', async ({kind, mode}) => {
            const {document} = parseHTML('<html><body><button>Execute</button></body></html>');
            const owner = document.querySelector('button')!;
            runtime.slots = [{node: owner.firstChild as Text, prefix: '', source: 'Execute', suffix: ''}];
            runtime.translations = ['执行'];
            const result = await createTranslationRequest(owner, kind, mode, snapshot, undefined, undefined, undefined, undefined, false, 'all');
            expect(result).toMatchObject({kind: 'live-text', changed: true, sources: ['Execute'], translations: ['执行']});
            expect(runtime.getCurrentTranslationCore).toHaveBeenLastCalledWith('all');
            expect(owner.textContent).toBe('Execute');
        },
    );

    it('空槽位返回未完成的空结果', async () => {
        const {document} = parseHTML('<html><body></body></html>');
        const result = await translateLiveText(document.body, snapshot);
        expect(result).toMatchObject({kind: 'live-text', complete: false, changed: false, sources: [], translations: []});
        expect(result.nodes).toEqual([]);
        expect(result.slots).toEqual([]);
        expect(runtime.translateTextSlots).not.toHaveBeenCalled();
    });

    it('保留槽位前后缀，并区分 unchanged、changed 与不完整响应', async () => {
        const {document} = parseHTML('<html><body></body></html>');
        const node = document.createTextNode('source');
        runtime.slots = [{node, prefix: '[', source: 'source', suffix: ']'}];

        runtime.translations = ['source'];
        const unchanged = await translateLiveText(document.body, snapshot);
        expect(unchanged).toMatchObject({complete: true, changed: false, sources: ['source'], translations: ['source']});
        expect(unchanged.slots[0]?.text).toBe('[source]');

        runtime.translations = ['译文'];
        const changed = await translateLiveText(document.body, snapshot);
        expect(changed).toMatchObject({complete: true, changed: true, sources: ['source'], translations: ['译文']});
        expect(changed.slots[0]?.text).toBe('[译文]');

        runtime.translations = [];
        const incomplete = await translateLiveText(document.body, snapshot);
        expect(incomplete.complete).toBe(false);
        expect(incomplete.slots[0]?.text).toBe('[source]');

        runtime.slots = [{node, prefix: '', source: '', suffix: ''}];
        runtime.translations = ['译文'];
        expect((await translateLiveText(document.body, snapshot)).changed).toBe(true);
    });
});

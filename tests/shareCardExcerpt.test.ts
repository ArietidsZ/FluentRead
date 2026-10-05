import {parseHTML} from 'linkedom';
import {beforeEach, describe, expect, it, vi} from 'vitest';
const mocks = vi.hoisted(() => ({getState: vi.fn()}));
vi.mock('@/src/features/full-page-translation/content/state', () => ({getTranslationState: mocks.getState}));
import {readBilingualExcerpt} from '@/src/features/full-page-translation/content/excerpt';
function fixture() {
    const {document} = parseHTML('<html><body><div><p>first<span class="fluent-read-bilingual-content" data-fr-translation-owned="true"><b>页面被改写的文字</b></span></p><p>neighbor</p></div></body></html>');
    const artifact = document.querySelector('span')!;
    const template = document.createElement('span'); template.textContent = '可信译文';
    const state = {sourceText: 'first', phase: 'translated', bilingualContent: artifact, bilingualContentTemplate: template};
    mocks.getState.mockImplementation(owner => owner === artifact.parentElement ? state : undefined);
    return {document, artifact, state};
}
describe('精确双语摘录所有权', () => {
    beforeEach(() => vi.clearAllMocks());
    it('从子节点命中本段，使用可信译文且不带相邻段落', () => {
        const {artifact} = fixture();
        expect(readBilingualExcerpt(artifact.firstElementChild!)).toEqual({original: 'first', translation: '可信译文', artifact});
    });
    it('拒绝伪造、断开的、加载中的和已恢复的工件', () => {
        const {artifact, state} = fixture();
        state.phase = 'loading'; expect(readBilingualExcerpt(artifact)).toBeNull();
        state.phase = 'translated'; mocks.getState.mockReturnValue(undefined); expect(readBilingualExcerpt(artifact)).toBeNull();
        mocks.getState.mockReturnValue(state); artifact.remove(); expect(readBilingualExcerpt(artifact)).toBeNull();
    });
    it('缺少模板时读取真实工件，无文字节点和空原文不能构造快照', () => {
        const {artifact, state} = fixture();
        Reflect.deleteProperty(state, 'bilingualContentTemplate');
        expect(readBilingualExcerpt(artifact)?.translation).toBe('页面被改写的文字');
        state.sourceText = '  ';
        expect(readBilingualExcerpt(artifact)).toBeNull();
        state.sourceText = 'first';
        Object.defineProperty(artifact, 'textContent', {value: null});
        expect(readBilingualExcerpt(artifact)).toBeNull();
    });
    it('普通正文和空译文不产生可分享快照', () => {
        const {document, state, artifact} = fixture();
        expect(readBilingualExcerpt(document.querySelector('p')!)).toBeNull();
        state.bilingualContentTemplate.textContent = ''; expect(readBilingualExcerpt(artifact)).toBeNull();
    });
});

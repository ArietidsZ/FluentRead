import {describe, expect, it} from 'vitest';
import {parseHTML} from 'linkedom';
import {isNonTranslatableLiveData} from '@/src/core/translation/liveData';
import {createTranslationSourceHistory, observeTranslationSource} from '@/src/features/full-page-translation/content/sourceStability';
import {TranslationCandidateCore, collectLiveTranslationTextSlots, extractTranslationText} from '@/src/core/translation/public';
import {isProtectedDescendantElement} from '@/src/core/translation/dom';

describe('时间、时长和动态来源过滤', () => {
    it.each(['12:34', '125:32', '12:34:56.123', '12:34 PM', 'AM 8:05', '１２：３４',
        '2026-10-03T12:34:56.789Z', '2026/10/03 12:34 +08:00', '2026年10月3日',
        '2026年10月3日12时34分56秒', '5 seconds', '2 minutes ago', 'in 5 minutes',
        '1 hour, 2 minutes', '1h 2m 3s', '500 ms', '5 分钟前', '1小时2分3秒',
        '1,234', '١٢٣٤', '１２３４', '$1,234.50', '-12.5%', '99.5‰', '1.2M'])('保持独立展示值 %s', value => {
        expect(isNonTranslatableLiveData(value)).toBe(true);
    });

    it.each(['', 'The task takes 5 minutes', 'Wait 5 seconds before retrying.', 'Chapter 5',
        'The clock reads 12:34.', 'minutes', 'seconds', 'May 5 brings a new release.',
        'This report contains 1,234 records.', '任务将在5分钟后完成。', '1 '.repeat(100) + 'seconds'])('保留正常正文 %s', value => {
        expect(isNonTranslatableLiveData(value)).toBe(false);
    });

    it('悬浮、全文和文本槽共享规则，嵌套时钟不会屏蔽相邻正文', () => {
        const {document} = parseHTML('<html><body><main><p id="time">12:34 PM</p><p id="duration">5 minutes</p><p id="prose">A readable report. <span>1,234</span><time>5 minutes ago</time><span role="timer"><b>5</b> seconds</span></p></main></body></html>');
        const core = new TranslationCandidateCore({adapters: []});
        const prose = document.querySelector<HTMLElement>('#prose')!;
        expect(core.discover(document.documentElement).map(candidate => candidate.element.id)).toEqual(['prose']);
        expect(core.resolve(document.querySelector('#time')!)).toBeNull();
        expect(core.resolve(document.querySelector('#duration')!)).toBeNull();
        expect(core.resolve(prose)?.element).toBe(prose);
        expect(collectLiveTranslationTextSlots(prose).map(slot => slot.source)).toEqual(['A readable report.']);
        expect(extractTranslationText(prose)).toBe('A readable report.');
        prose.querySelector('span')!.textContent = '1,235';
        expect(extractTranslationText(prose)).toBe('A readable report.');
    });

    function fixture() {
        const {document} = parseHTML('<html><body><p>Visitors: 100</p></body></html>');
        return {history: createTranslationSourceHistory(), identity: document.querySelector('p')!};
    }

    it('自有原文槽仅绕过自身 translate=no，其他禁译标记仍有效', () => {
        const {document} = parseHTML('<html><body><span translate="no" data-fr-translation-owned="true">Original slot</span></body></html>');
        const slot = document.querySelector('span')!;
        const options = {sourceTextSlotHosts: new Set([slot])};
        expect(isProtectedDescendantElement(slot, false, options)).toBe(false);
        slot.classList.add('notranslate');
        expect(isProtectedDescendantElement(slot, false, options)).toBe(true);
        slot.classList.remove('notranslate');
        slot.setAttribute('data-notranslate', 'true');
        expect(isProtectedDescendantElement(slot, false, options)).toBe(true);
        slot.removeAttribute('data-notranslate');
        slot.removeAttribute('translate');
        expect(isProtectedDescendantElement(slot, false, options)).toBe(false);
    });

    it('持续数字变化收敛为原文，重复观察、长间隔及静止都不会重启翻译', () => {
        const {history, identity} = fixture();
        const observe = (value: string, now: number) => observeTranslationSource(history, identity, value, now);
        expect(observe('Visitors: 100', 0)).toEqual({kind: 'ready'});
        expect(observe('Visitors: 101', 500)).toEqual({kind: 'settling', delay: 1800});
        expect(observe('Visitors: 101', 1000)).toEqual({kind: 'settling', delay: 1300});
        expect(observe('Visitors: 102', 1500)).toEqual({kind: 'numeric'});
        expect(observe('Visitors: 103', 10000)).toEqual({kind: 'numeric'});
        expect(observe('Visitors: 103', 20000)).toEqual({kind: 'numeric'});
        expect(observe('A new article is ready.', 21000)).toEqual({kind: 'settling', delay: 1800});
        expect(observe('A new article is ready.', 22800)).toEqual({kind: 'ready'});
    });

    it('普通动态内容在最后一次真实变化后恢复，重复发现不会延长窗口', () => {
        const {history, identity} = fixture();
        const observe = (value: string, now: number) => observeTranslationSource(history, identity, value, now);
        expect(observe('Loading the first section.', 0)).toEqual({kind: 'ready'});
        expect(observe('Loading the next section.', 200)).toEqual({kind: 'settling', delay: 1800});
        expect(observe('A complete article is ready.', 600)).toEqual({kind: 'settling', delay: 1800});
        expect(observe(' A complete article is ready. ', 2000)).toEqual({kind: 'settling', delay: 400});
        expect(observe('A complete article is ready.', 2400)).toEqual({kind: 'ready'});
    });

    it.each(['The task takes 5 minutes', 'The task takes 5 minutes.', '说明'.repeat(17) + '5', 'text '.repeat(25) + '5'])('包含数字的正常句子不被永久屏蔽 %s', original => {
        const {history, identity} = fixture();
        observeTranslationSource(history, identity, original, 0);
        expect(observeTranslationSource(history, identity, original.replace('5', '6'), 200).kind).toBe('settling');
        expect(observeTranslationSource(history, identity, original.replace('5', '7'), 400).kind).toBe('settling');
        expect(observeTranslationSource(history, identity, original.replace('5', '7'), 2200).kind).toBe('ready');
    });

    it('缓慢修改、不同标签和其他候选分别计数', () => {
        const {history, identity} = fixture();
        observeTranslationSource(history, identity, 'Visitors: 1', 0);
        expect(observeTranslationSource(history, identity, 'Visitors: 2', 5000).kind).toBe('settling');
        expect(observeTranslationSource(history, identity, 'Visitors: 3', 10000).kind).toBe('settling');
        expect(observeTranslationSource(history, identity, 'Orders: 4', 10200).kind).toBe('settling');
        expect(observeTranslationSource(history, identity.cloneNode(), 'Visitors: 3', 10300).kind).toBe('ready');
        expect(observeTranslationSource(history, identity, '100', 11000).kind).toBe('settling');
    });
});

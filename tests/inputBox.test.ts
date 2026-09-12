import { describe, expect, it } from 'vitest';
import {
    canCommitInputBoxTranslation,
    getDeepActiveElement,
    getInputBoxSelection,
    getInputBoxText,
    getInputBoxValueAfterInsertion,
    getInputBoxValueSnapshot,
    normalizeInputBoxTranslationInterval,
    isInputElement,
    matchesInputBoxTrigger,
    removeInsertedTriggerSymbols,
    removeTriggerSymbols,
} from '@/src/features/input-translation/content/inputBox';

function keyEvent(key: string, code: string, shiftKey = false): KeyboardEvent {
    return { key, code, shiftKey } as KeyboardEvent;
}

function fakeElement(tagName: string, attributes: Record<string, string> = {}): HTMLElement {
    return {
        tagName,
        getAttribute(name: string) {
            return attributes[name] ?? null;
        },
        isContentEditable: false,
        value: '',
        textContent: '',
        innerText: '',
        type: 'text',
    } as unknown as HTMLElement;
}

describe('输入框快捷键', () => {
    it('兼容浏览器的 Space、Equal 和 Minus 按键值', () => {
        expect(matchesInputBoxTrigger(keyEvent(' ', 'Space'), 'triple_space')).toBe(true);
        expect(matchesInputBoxTrigger(keyEvent('x', 'KeyX'), 'triple_space')).toBe(false);
        expect(matchesInputBoxTrigger(keyEvent('=', 'Equal'), 'triple_equal')).toBe(true);
        expect(matchesInputBoxTrigger(keyEvent('+', 'Equal', true), 'triple_equal')).toBe(false);
        expect(matchesInputBoxTrigger(keyEvent('-', 'Minus'), 'triple_dash')).toBe(true);
        expect(matchesInputBoxTrigger(keyEvent('_', 'Minus', true), 'triple_dash')).toBe(false);
    });

    it('只识别非敏感输入与 plaintext-only，并拒绝密码、富文本和只读控件', () => {
        expect(isInputElement(null)).toBe(false);
        expect(isInputElement({ ...fakeElement('INPUT'), disabled: true } as unknown as HTMLElement)).toBe(false);
        expect(isInputElement(fakeElement('DIV', { contenteditable: 'plaintext-only' }))).toBe(true);
        expect(isInputElement(fakeElement('INPUT'))).toBe(true);
        expect(isInputElement({ ...fakeElement('INPUT'), type: 'password' } as unknown as HTMLElement)).toBe(false);
        expect(isInputElement({ ...fakeElement('INPUT'), type: 'PASSWORD' } as unknown as HTMLElement)).toBe(false);
        expect(isInputElement({
            ...fakeElement('DIV', { contenteditable: 'true' }),
            isContentEditable: true,
        } as unknown as HTMLElement)).toBe(false);
        expect(isInputElement({ ...fakeElement('INPUT'), type: 'button' } as unknown as HTMLElement)).toBe(false);
        expect(isInputElement({ ...fakeElement('TEXTAREA'), readOnly: true } as unknown as HTMLElement)).toBe(false);
        expect(isInputElement(fakeElement('DIV'))).toBe(false);
    });

    it('能穿透开放 Shadow DOM 获取真实焦点，但仍拒绝其中的密码框', () => {
        const inner = {...fakeElement('INPUT'), type: 'password'} as unknown as HTMLElement;
        const host = {
            ...fakeElement('DIV'),
            shadowRoot: { activeElement: inner },
        } as unknown as Element;

        expect(getDeepActiveElement({ activeElement: host } as Document)).toBe(inner);
        expect(isInputElement(getDeepActiveElement({activeElement: host} as Document))).toBe(false);
        expect(matchesInputBoxTrigger(keyEvent('x', 'KeyX'), 'unknown' as never)).toBe(false);
    });

    it('只移除本次插入的触发符号并保留真实输入内容', () => {
        expect(removeTriggerSymbols('Hello   ', 'triple_space')).toBe('Hello');
        expect(removeTriggerSymbols('Hello===', 'triple_equal')).toBe('Hello');
        expect(removeTriggerSymbols('Hello---', 'triple_dash')).toBe('Hello');
        expect(removeTriggerSymbols('Hello', 'ctrl_enter')).toBe('Hello');
        expect(removeInsertedTriggerSymbols('Hello===', 'triple_equal', 5)).toBe('Hello=');
        expect(removeInsertedTriggerSymbols('a==b==', 'triple_equal', 1)).toBe('ab==');
        expect(removeInsertedTriggerSymbols('a  b', 'triple_space', 1)).toBe('ab');
        expect(removeInsertedTriggerSymbols('a--b', 'triple_dash', 1)).toBe('ab');
        expect(getInputBoxText({ ...fakeElement('DIV'), innerText: ' Hello world ' } as unknown as HTMLElement)).toBe(' Hello world ');
        expect(getInputBoxText({ ...fakeElement('DIV'), textContent: ' Text fallback ' } as unknown as HTMLElement)).toBe(' Text fallback ');
        expect(getInputBoxText(fakeElement('DIV'))).toBe('');
    });

    it('根据选区计算触发键插入位置并规范化相邻间隔', () => {
        expect(getInputBoxValueAfterInsertion('a=b', {start: 1, end: 1}, '=')).toEqual({
            value: 'a==b',
            selection: {start: 2, end: 2},
        });
        expect(normalizeInputBoxTranslationInterval(undefined)).toBe(1000);
        expect(normalizeInputBoxTranslationInterval(199.9)).toBe(200);
        expect(normalizeInputBoxTranslationInterval(2500)).toBe(2000);
        expect(getInputBoxValueAfterInsertion('abc', {start: -3, end: 99}, '=')).toEqual({
            value: '=',
            selection: {start: 1, end: 1},
        });
    });

    it('plaintext-only 仅在唯一直接文本节点时报告选区，多节点一律保守返回 null', () => {
        const textNode = {nodeType: 3};
        const singleText = {
            ...fakeElement('DIV', {contenteditable: 'plaintext-only'}),
            childNodes: [textNode],
            firstChild: textNode,
            contains: () => true,
            ownerDocument: {
                getSelection: () => ({
                    rangeCount: 1,
                    anchorNode: textNode,
                    getRangeAt: () => ({
                        startContainer: textNode,
                        endContainer: textNode,
                        startOffset: 2,
                        endOffset: 3,
                    }),
                }),
            },
        } as unknown as HTMLElement;
        expect(getInputBoxSelection(singleText)).toEqual({start: 2, end: 3});

        const multiText = {
            ...singleText,
            childNodes: [textNode, {nodeType: 3}],
        } as unknown as HTMLElement;
        expect(getInputBoxSelection(multiText)).toBeNull();
        expect(getInputBoxSelection(fakeElement('DIV', {contenteditable: 'plaintext-only'}))).toBeNull();
    });

    it('覆盖无效触发区间与输入框选区缺省分支', () => {
        expect(removeInsertedTriggerSymbols('abc', 'unknown', 0)).toBe('abc');
        expect(removeInsertedTriggerSymbols('abc', 'triple_equal', 0, 0)).toBe('abc');
        expect(removeInsertedTriggerSymbols('abc', 'triple_equal', 1)).toBe('abc');
        expect(getInputBoxSelection(fakeElement('INPUT'))).toEqual({start: 0, end: 0});
        const unavailable = fakeElement('INPUT') as any;
        unavailable.selectionStart = null;
        unavailable.selectionEnd = null;
        expect(getInputBoxSelection(unavailable)).toBeNull();
    });

    it('用原始值快照检测翻译期间的用户编辑', () => {
        const input = { ...fakeElement('INPUT'), value: 'Hello  ' } as unknown as HTMLElement;
        expect(getInputBoxValueSnapshot(input)).toBe('Hello  ');

        const contentEditable = {
            ...fakeElement('DIV', { contenteditable: 'true' }),
            innerText: ' Hello\n',
        } as unknown as HTMLElement;
        expect(getInputBoxValueSnapshot(contentEditable)).toBe(' Hello\n');
        expect(getInputBoxValueSnapshot({ ...fakeElement('DIV'), textContent: 'raw text' } as unknown as HTMLElement)).toBe('raw text');
        expect(getInputBoxValueSnapshot(fakeElement('DIV'))).toBe('');
    });

    it('禁用后即使恢复启用，旧 feature signal 的结果仍不可落地', () => {
        const controller = new AbortController();
        controller.abort();

        expect(canCommitInputBoxTranslation({
            signal: controller.signal,
            expectedValue: 'Hello',
            currentValue: 'Hello',
            expectedConfigGeneration: 0,
            currentConfigGeneration: 0,
            isEnabled: true,
            isSiteDisabled: false,
        })).toBe(false);
    });

    it('用户在请求期间编辑输入框时拒绝覆盖新内容', () => {
        const controller = new AbortController();

        expect(canCommitInputBoxTranslation({
            signal: controller.signal,
            expectedValue: 'Hello',
            currentValue: 'Hello!',
            expectedConfigGeneration: 0,
            currentConfigGeneration: 0,
            isEnabled: true,
            isSiteDisabled: false,
        })).toBe(false);
        expect(canCommitInputBoxTranslation({
            signal: controller.signal,
            expectedValue: 'Hello',
            currentValue: 'Hello',
            expectedConfigGeneration: 0,
            currentConfigGeneration: 0,
            isEnabled: true,
            isSiteDisabled: false,
        })).toBe(true);
        expect(canCommitInputBoxTranslation({
            signal: controller.signal,
            expectedValue: 'Hello',
            currentValue: 'Hello',
            expectedConfigGeneration: 0,
            currentConfigGeneration: 0,
            expectedEditGeneration: 1,
            currentEditGeneration: 2,
            isEnabled: true,
            isSiteDisabled: false,
        })).toBe(false);
    });

    it('输入翻译关闭后快速恢复也会永久作废旧配置 generation', () => {
        const controller = new AbortController();

        expect(canCommitInputBoxTranslation({
            signal: controller.signal,
            expectedValue: 'Hello',
            currentValue: 'Hello',
            expectedConfigGeneration: 2,
            currentConfigGeneration: 3,
            // 模拟关闭后已经快速恢复，当前看起来又是 enabled。
            isEnabled: true,
            isSiteDisabled: false,
        })).toBe(false);
    });
});

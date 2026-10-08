import {describe, expect, it, vi} from 'vitest';
import {resolveNativeSourcePrivacy, type IncognitoSourceRuntime, type NativeMessageSender} from '@/src/platform/browser/incognitoSource';
import {attachTranslationSourcePrivacy, getTranslationSourcePrivacy, hasTrustedPrivateSource} from '@/src/services/translation/requestPrivacy';

const root = 'moz-extension://runtime-origin-uuid';
const sender: NativeMessageSender = {id: 'extension-id-not-url-host', documentId: 'original-document', url: `${root}/options.html`, origin: root, frameId: 0};
const record = {contextId: 'context-1', contextType: 'TAB', documentId: sender.documentId, documentOrigin: root,
    documentUrl: sender.url, frameId: 0, tabId: 1, windowId: 2, incognito: false};
const runtime = (getContexts?: IncognitoSourceRuntime['getContexts']): IncognitoSourceRuntime => ({id: sender.id, getURL: () => `${root}/`, getContexts});

describe('per-request native source binding', () => {
    it('gives own native tab booleans priority over document records and ignores client identity fields', async () => {
        const contexts = vi.fn(async () => [{...record, incognito: false}]);
        expect(await resolveNativeSourcePrivacy({...sender, tab: {incognito: true}}, runtime(contexts))).toBe('private');
        expect(await resolveNativeSourcePrivacy({...sender, tab: {incognito: false}}, runtime(contexts))).toBe('regular');
        expect(contexts).not.toHaveBeenCalled();
        expect(await resolveNativeSourcePrivacy({...sender, tab: null as unknown as NativeMessageSender['tab']}, runtime(contexts))).toBe('unknown');
        for (const incognito of [undefined, 'true', 1]) {
            expect(await resolveNativeSourcePrivacy({...sender, tab: {incognito} as NativeMessageSender['tab']}, runtime(contexts))).toBe('unknown');
        }
        expect(contexts).not.toHaveBeenCalled();
        expect(await resolveNativeSourcePrivacy(undefined, runtime(contexts))).toBe('unknown');
        expect(await resolveNativeSourcePrivacy(sender, {...runtime(contexts), id: undefined})).toBe('unknown');
        expect(await resolveNativeSourcePrivacy({...sender, id: 'other'}, runtime(contexts))).toBe('unknown');
    });
    it('binds exact original documentId and extension origin, independent of runtime ID host', async () => {
        const contexts = vi.fn(async () => [{...record, documentId: 'other'}, record]);
        expect(await resolveNativeSourcePrivacy(sender, runtime(contexts))).toBe('regular');
        expect(contexts).toHaveBeenCalledWith({documentIds: ['original-document']});
        for (const contextType of ['TAB', 'POPUP', 'SIDE_PANEL']) {
            expect(await resolveNativeSourcePrivacy(sender, runtime(async () => [{...record, contextType, incognito: true}]))).toBe('private');
        }
        expect(await resolveNativeSourcePrivacy({id: sender.id, documentId: sender.documentId}, runtime(async () => [record]))).toBe('regular');
    });
    it.each([
        {}, {documentId: ''}, {documentId: ' original-document'}, {documentId: 5},
        {origin: 'null'}, {origin: 'https://site.invalid'}, {url: 'https://site.invalid/options.html'},
        {url: 'invalid'}, {url: 'moz-extension://user:password@runtime-origin-uuid/options.html'},
        {url: 'moz-extension:///options.html'},
    ])('rejects unsupported or incompatible sender %#', async patch => {
        const value = Object.keys(patch).length ? {...sender, ...patch} : {...sender, documentId: undefined};
        expect(await resolveNativeSourcePrivacy(value as NativeMessageSender, runtime(async () => [record]))).toBe('unknown');
    });
    it.each([
        undefined, null, {}, [], [null], [3], [[]], [record, record], [{...record, documentId: 'new-document'}],
        [{...record, contextId: ''}], [{...record, contextId: 5}], [{...record, contextType: 'BACKGROUND'}],
        [{...record, contextType: 'OFFSCREEN_DOCUMENT'}], [{...record, contextType: 'DEVELOPER_TOOLS'}],
        [{...record, contextType: 'UNRECOGNIZED'}], [{...record, incognito: 'false'}], [{...record, incognito: undefined}],
        [{...record, documentOrigin: 'https://site.invalid'}], [{...record, documentUrl: undefined}],
        [{...record, documentUrl: `${root}/other.html`}], [{...record, documentUrl: 'https://site.invalid/options.html'}],
        [{...record, frameId: 2}], [{...record, contextType: 'POPUP', tabId: -1, windowId: -1}],
        [{...record, contextType: 'SIDE_PANEL', tabId: -1, windowId: -1}],
    ].map(records => ({records})))('keeps malformed, stale, ambiguous and spanning false context unknown %#', async ({records}) => {
        expect(await resolveNativeSourcePrivacy(sender, runtime(async () => records))).toBe('unknown');
    });
    it('feature detects Firefox 140 missing documentId/getContexts and contains API failures', async () => {
        expect(await resolveNativeSourcePrivacy(sender, runtime())).toBe('unknown');
        expect(await resolveNativeSourcePrivacy({...sender, documentId: undefined}, runtime(async () => [record]))).toBe('unknown');
        expect(await resolveNativeSourcePrivacy(sender, {...runtime(async () => [record]), getURL: () => 'https://invalid/'})).toBe('unknown');
        expect(await resolveNativeSourcePrivacy(sender, {...runtime(async () => [record]), getURL: () => {throw new Error('unavailable');}})).toBe('unknown');
        expect(await resolveNativeSourcePrivacy(sender, runtime(async () => {throw new Error('disappeared');}))).toBe('unknown');
    });
    it('copies original sender before await and rechecks every execution without same-URL rebinding', async () => {
        const value = {...sender};
        let finish!: (records: unknown) => void;
        const contexts = vi.fn(() => new Promise<unknown>(resolve => {finish = resolve;}));
        const first = resolveNativeSourcePrivacy(value, runtime(contexts));
        value.documentId = 'new-document'; value.url = `${root}/new.html`; value.origin = 'null'; value.frameId = 1;
        finish([record]);
        expect(await first).toBe('regular');
        contexts.mockImplementationOnce(async () => [{...record, documentId: 'new-document'}]);
        expect(await resolveNativeSourcePrivacy(sender, runtime(contexts))).toBe('unknown');
        expect(contexts).toHaveBeenCalledTimes(2);
    });
    it('stores three states only in the internal symbol and carries them through object spread', () => {
        expect(getTranslationSourcePrivacy({privacy: 'private', incognito: true})).toBeUndefined();
        for (const privacy of ['regular', 'private', 'unknown'] as const) {
            const message = attachTranslationSourcePrivacy({origin: 'text'}, privacy);
            expect(getTranslationSourcePrivacy({...message})).toBe(privacy);
            expect(hasTrustedPrivateSource(message)).toBe(privacy === 'private');
            expect(JSON.stringify(message)).toBe('{"origin":"text"}');
            expect(getTranslationSourcePrivacy(JSON.parse(JSON.stringify(message)))).toBeUndefined();
        }
    });
});

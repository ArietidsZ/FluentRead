import {readFileSync} from 'node:fs';
import {describe, expect, it, vi} from 'vitest';
import {parseDocument, renderDocument} from '../src/features/document-translation/core/document';
import {translateMicrosoftTextsWithTransport} from '../src/providers/translation/microsoftTransport';
import {bilingualNoteName, renderBilingualPdfNote} from '../integrations/obsidian/output';
import {prepareMarkdownSegments} from '../integrations/obsidian/markdown';
import {extractPdfSegments} from '../integrations/obsidian/pdf';

describe('Obsidian Markdown document flow', () => {
    it('preserves properties, wiki links, code, and math while translating ordinary text', () => {
        const source = [
            '---',
            'title: Source title',
            'tags: [research]',
            '---',
            '# A note',
            'Read [[Research|the source]] and ![[figure.png]] today.',
            '> [!note] Keep this callout marker',
            '> A quoted explanation with #research.',
            '```js',
            'const secret = "do not translate";',
            '```',
            '$$',
            'E = mc^2',
            '$$',
            'The conclusion.',
        ].join('\n');
        const document = parseDocument('note.md', source);
        const segments = document.segments.map(({source: text}) => text);
        expect(segments[0]).toBe('# A note');
        expect(prepareMarkdownSegments(document.segments)[0].source).toBe('A note');
        expect(segments.some((text) => text.includes('title:') || text.includes('secret') || text.includes('E = mc'))).toBe(false);
        expect(segments.join(' ')).not.toContain('[[Research');
        expect(segments.join(' ')).not.toContain('figure.png');
        expect(segments.join(' ')).not.toContain('[!note]');
        expect(segments.join(' ')).not.toContain('#research');
        const translated = renderDocument(document, segments.map((_, index) => `译文 ${index + 1}`), 'bilingual');
        expect(translated).toContain('title: Source title');
        expect(translated).toContain('[[Research|the source]]');
        expect(translated).toContain('![[figure.png]]');
        expect(translated).toContain('> [!note] Keep this callout marker');
        expect(translated).toContain('#research');
        expect(translated).toContain('const secret = "do not translate";');
        expect(translated).toContain('E = mc^2');
        expect(translated).toContain('> 译文');
        expect(bilingualNoteName('note.md')).toBe('note.bilingual.md');
        expect(bilingualNoteName('paper.pdf')).toBe('paper.pdf.bilingual.md');
    });

    it('keeps PDF pages in the generated bilingual note', () => {
        const result = renderBilingualPdfNote('papers/research.pdf', [
            {id: 0, source: 'First page', contextLabel: '第 1 页'},
            {id: 1, source: 'Another paragraph'},
            {id: 2, source: 'Second page', contextLabel: '第 2 页'},
        ], ['第一页', '另一段', '第二页']);
        expect(result).toContain('[[papers/research.pdf]]');
        expect(result).toContain('## 第 1 页');
        expect(result).toContain('## 第 2 页');
        expect(result.indexOf('另一段')).toBeLessThan(result.indexOf('## 第 2 页'));
    });

    it('extracts text from a real two-page PDF without changing the fixture', async () => {
        const bytes = readFileSync(new URL('../examples/document-translation/sample.pdf', import.meta.url));
        const before = Buffer.from(bytes);
        const buffer = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(buffer).set(bytes);
        const segments = await extractPdfSegments(buffer);
        expect(segments.length).toBeGreaterThan(0);
        expect(segments.some(({contextLabel}) => contextLabel === '第 1 页')).toBe(true);
        expect(segments.some(({contextLabel}) => contextLabel === '第 2 页')).toBe(true);
        expect(bytes).toEqual(before);
    });
});

describe('shared Microsoft transport', () => {
    it('escapes pure text and decodes the matching translated batch', async () => {
        const transport = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
            new Response(JSON.stringify([
                {translations: [{text: '&lt;翻译&gt;'}]},
                {translations: [{text: '第二条'}]},
            ]), {status: 200}));
        const result = await translateMicrosoftTextsWithTransport(transport, ['<input>', 'second'], 'auto', 'zh-Hans');
        expect(result).toEqual(['<翻译>', '第二条']);
        expect(String(transport.mock.calls[0][0])).toContain('to=zh-Hans');
        expect(transport.mock.calls[0][1]?.body).toBe('["&lt;input&gt;","second"]');
    });
});

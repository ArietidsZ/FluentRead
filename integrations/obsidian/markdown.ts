/**
 * 只向 Obsidian 翻译请求发送 Markdown 可读文本；输出仍交给原始 ParsedDocument 保留语法。
 */
import type {DocumentSegment} from '../../src/features/document-translation/core/document';

const STRUCTURAL_PREFIX = /^(?:\s*(?:>\s*)+|\s*#{1,6}\s+|\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)/u;

export function prepareMarkdownSegments(segments: readonly DocumentSegment[]): DocumentSegment[] {
    return segments.map((segment) => {
        const source = segment.source.replace(STRUCTURAL_PREFIX, '').trim();
        return {...segment, source: source || segment.source};
    });
}

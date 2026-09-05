/**
 * @file src/features/reading-assistant/answerFormat.ts
 * 文件职责：把模型回答转换为阅读卡可安全展示的轻量段落与强调片段。
 * 主要内容：支持标题、列表和粗体；所有内容均保留为文本，由 Vue 插值输出，网页或模型提供的 HTML 不会执行。
 * 模块边界：不生成 HTML、不加载外部图片或链接，不解释脚本和工具调用，也不参与模型请求。
 */
export interface ReadingAnswerBlock {kind: 'heading' | 'paragraph' | 'item'; text: string}
export interface ReadingAnswerSpan {text: string; strong: boolean}

export function readingAnswerBlocks(answer: string): ReadingAnswerBlock[] {
    return answer.split(/\r?\n/u).flatMap((line): ReadingAnswerBlock[] => {
        const text = line.trim();
        if (!text || /^[-*_]{3,}$/u.test(text)) return [];
        const heading = text.match(/^#{1,6}\s+(.+)$/u);
        if (heading) return [{kind: 'heading' as const, text: heading[1]}];
        const item = text.match(/^(?:[-*+]\s+|\d+[.)]\s+)(.+)$/u);
        if (item) return [{kind: 'item' as const, text: item[1]}];
        return [{kind: 'paragraph' as const, text}];
    });
}

export function readingAnswerSpans(text: string): ReadingAnswerSpan[] {
    return text.split(/(\*\*[^*]+\*\*)/u).filter(Boolean).map(part => ({
        text: part.startsWith('**') && part.endsWith('**') ? part.slice(2, -2) : part,
        strong: part.startsWith('**') && part.endsWith('**'),
    }));
}

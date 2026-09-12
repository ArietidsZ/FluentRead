/**
 * @file src/core/config/writingPreview.ts
 * 文件职责：为写作助手设置页提供“当前偏好会写出什么”的示例草稿数据，让抽象的长度、风格、语气和角色有可见结果。
 * 主要内容：固定一个可复现的反馈场景，按语气选择开场、按风格选择正文、按角色选择关注点，并用长度决定展开到第几段；自定义描述回落到默认表达并显式标记。
 * 模块边界：只返回纯文本片段，不请求模型、不读取配置存储、不渲染界面；真实草稿仍由后台写作运行时生成。
 */
import {WRITING_ROLES, WRITING_TONES, type WritingLength, type WritingStyle} from './writing';

/** 示例统一使用同一条反馈，改动偏好时只有表达方式变化，便于对比。 */
export const WRITING_PREVIEW_SCENARIO = '有人反馈：长页面滚动时偶尔整段没有翻译。';

export type WritingPreviewSlot = 'opening' | 'body' | 'focus' | 'detail';
export interface WritingPreviewParagraph {slot: WritingPreviewSlot; text: string}
export interface WritingPreviewInput {
    length: WritingLength; style: WritingStyle; tone: string; role: string;
}

const openings: Record<typeof WRITING_TONES[number]['value'], string> = {
    natural: '收到，这个问题我看过了。',
    professional: '感谢反馈，问题已记录。',
    friendly: '谢谢反馈！这个我们来看看。',
    warm: '谢谢你专门来说这件事，辛苦了。',
    sincere: '这确实是我们没做好，给你添麻烦了。',
    empathetic: '读到一半发现整段没翻译，确实很影响阅读。',
    firm: '这个问题需要修掉，我们来处理。',
};
const bodies: Record<WritingStyle, string> = {
    auto: '按你描述的步骤，我复现了长段落在滚动时被跳过的情况。',
    formal: '依据您提供的复现步骤，已确认长段落在滚动过程中存在漏译。',
    neutral: '按你给的步骤复现后，确认长段落在滚动时会被跳过。',
    casual: '照你说的试了一下，确实是长段落一滚就漏。',
};
const focuses: Record<typeof WRITING_ROLES[number]['value'], string> = {
    auto: '我把复现步骤补在下面，方便其他人一起看。',
    maintainer: '我先把它归到渲染队列的问题里，排进这轮的修复清单。',
    developer: '初步看是滚动时节点还没进入观察范围，我从这里继续查。',
    user: '我换了一个浏览器也是一样，附上我的版本号供参考。',
    colleague: '要不我们先对一下复现环境，再决定谁来跟进？',
    support: '方便提供一下浏览器版本和页面链接吗？我同步给技术同事。',
    leader: '这个影响到主要的阅读场景，建议优先处理，这周给个结论。',
    subordinate: '我已经整理好复现记录，需要确认是否按这个方向继续排查。',
};
const detail = '另外纯译文模式下同样会出现，关闭其他扩展后问题依旧，应该和页面自身的懒加载有关。';
const slotsByLength: Record<WritingLength, readonly WritingPreviewSlot[]> = {
    short: ['opening', 'body'],
    standard: ['opening', 'body', 'focus'],
    detailed: ['opening', 'body', 'focus', 'detail'],
};

/** 自定义语气或角色只在真实生成时生效，示例回落到默认表达而不是留空。 */
export function isWritingPreviewPreset(value: string, kind: 'tone' | 'role'): boolean {
    return kind === 'tone' ? value in openings : value in focuses;
}
export function writingPreviewFallbacks(input: Pick<WritingPreviewInput, 'tone' | 'role'>): Array<'tone' | 'role'> {
    const result: Array<'tone' | 'role'> = [];
    if (!isWritingPreviewPreset(input.tone, 'tone')) result.push('tone');
    if (!isWritingPreviewPreset(input.role, 'role')) result.push('role');
    return result;
}
export function writingPreviewParagraphs(input: WritingPreviewInput): WritingPreviewParagraph[] {
    const tone = isWritingPreviewPreset(input.tone, 'tone') ? input.tone as keyof typeof openings : 'natural';
    const role = isWritingPreviewPreset(input.role, 'role') ? input.role as keyof typeof focuses : 'auto';
    const style = input.style in bodies ? input.style : 'auto';
    const text: Record<WritingPreviewSlot, string> = {opening: openings[tone], body: bodies[style], focus: focuses[role], detail};
    return (slotsByLength[input.length] ?? slotsByLength.short).map(slot => ({slot, text: text[slot]}));
}

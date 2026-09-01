/**
 * @file src/core/i18n/index.ts
 *
 * 文件职责：提供与 UI 框架无关的界面语言目录、归一化和翻译函数。
 * 主要内容：支持简体中文与 English，提供稳定的语言配置值、参数插值、中文旧文案迁移
 * 适配和可扩展资源目录。旧文案适配仅用于扩展自己的 UI，不会翻译网页内容或用户输入。
 * 模块边界：本文件不读写 browser.storage，也不依赖 Vue；配置模型只调用这里的纯归一化
 * 规则，Vue 响应式与持久化由 src/ui/i18n.ts 负责。
 */

import {enUSLegacyText, enUSMessages} from './messages/en-US';
import {zhCNMessages} from './messages/zh-CN';
import {
    DEFAULT_UI_LANGUAGE,
} from './language';
import type {MessageCatalog, TranslationParams, UiLanguage} from './types';

export * from './types';
export * from './language';

const catalogs: Record<UiLanguage, MessageCatalog> = {
    'zh-CN': zhCNMessages,
    'en-US': enUSMessages,
};

function formatMessage(template: string, params?: TranslationParams): string {
    if (!params) return template;
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (placeholder, name: string) => {
        const value = params[name];
        return value === undefined || value === null ? placeholder : String(value);
    });
}

/** 翻译稳定资源 key；English 缺失时回退到中文，再缺失时返回 key 便于发现漏翻。 */
export function translate(key: string, language: UiLanguage, params?: TranslationParams): string {
    const template = catalogs[language][key] ?? catalogs[DEFAULT_UI_LANGUAGE][key] ?? key;
    return formatMessage(template, params);
}

function preserveWhitespace(value: string, translated: string): string {
    const leading = value.match(/^\s*/u)?.[0] || '';
    const trailing = value.match(/\s*$/u)?.[0] || '';
    const start = leading.length;
    const end = trailing.length > 0 ? value.length - trailing.length : value.length;
    return `${leading}${translated}${end > start ? trailing : ''}`;
}

const legacyPatterns: ReadonlyArray<readonly [RegExp, (match: RegExpExecArray) => string]> = [
    [/^没有找到“(.+)”相关设置$/u, (match) => `No settings found for “${match[1]}”`],
    [/^没有找到包含“(.+)”的服务或模型$/u, (match) => `No service or model contains “${match[1]}”`],
    [/^已完成 (\d+) 次翻译$/u, (match) => `${match[1]} translations completed`],
    [/^已完成 (\d+) 个词条$/u, (match) => `${match[1]} word entries`],
    [/^(\d+) 项$/u, (match) => `${match[1]} items`],
    [/^(\d+) 个模型，点击切换$/u, (match) => `${match[1]} models · click to switch`],
    [/^已达到 (\d+) 个模型上限$/u, (match) => `The limit of ${match[1]} models has been reached`],
    [/^最多只能保存 (\d+) 个自定义服务$/u, (match) => `You can save up to ${match[1]} custom services`],
    [/^自定义服务已达到 (\d+) 个上限$/u, (match) => `The ${match[1]} custom-service limit has been reached`],
    [/^当前：(.+)$/u, (match) => `Current: ${match[1]}`],
    [/^已保存 (.+)，启用插件后生效$/u, (match) => `Saved ${match[1]}; enable the extension for it to take effect`],
    [/^已保存 (.+)，当前网页请刷新后重试$/u, (match) => `Saved ${match[1]}; refresh the current page and try again`],
    [/^已保存 (.+)；(.+)$/u, (match) => `Saved ${match[1]}; ${match[2]}`],
    [/^已关闭 (.+) 的始终翻译，当前网页保持不变$/u, (match) => `Always-translate was disabled for ${match[1]}; the current page is unchanged`],
    [/^已开启 (.+) 的始终翻译$/u, (match) => `Always-translate was enabled for ${match[1]}`],
    [/^已在 (.+) 禁用扩展$/u, (match) => `The extension was disabled on ${match[1]}`],
    [/^已恢复 (.+) 的扩展$/u, (match) => `The extension was restored on ${match[1]}`],
    [/^当前已在 (.+) 禁用扩展，请先恢复扩展$/u, (match) => `The extension is disabled on ${match[1]}; restore it first`],
    [/^恢复 (.+) 的扩展$/u, (match) => `Restore the extension on ${match[1]}`],
    [/^始终翻译 (.+)$/u, (match) => `Always translate ${match[1]}`],
    [/^在 (.+) 禁用扩展$/u, (match) => `Disable the extension on ${match[1]}`],
    [/^所有网站自动翻译已开启，(.+) 会自动翻译$/u, (match) => `Automatic translation is enabled; ${match[1]} will be translated`],
    [/^所有网站自动翻译已开启，请在完整设置中关闭全局开关$/u, () => 'Automatic translation for all websites is enabled. Disable it in full settings first.'],
    [/^当前浏览器暂不支持(.+)$/u, (match) => `This browser does not currently support ${match[1]}`],
    [/^点击开启 · YouTube$/u, () => 'Click to enable · YouTube'],
    [/^(.+) · YouTube$/u, (match) => `${match[1]} · YouTube`],
    [/^(.+) \+ 鼠标悬停$/u, (match) => `${match[1]} + hover`],
    [/^翻译服务：(.+)，当前模型：(.+)$/u, (match) => `Translation service: ${match[1]}, current model: ${match[2]}`],
    [/^翻译服务：(.+)$/u, (match) => `Translation service: ${match[1]}`],
    [/^正在播放(原文|单词|译文)$/u, (match) => `Playing ${match[1] === '原文' ? 'original' : match[1] === '单词' ? 'word' : 'translation'}`],
    [/^快捷键已设置为: (.+)$/u, (match) => `Shortcut set to: ${match[1]}`],
    [/^划词翻译快捷键已设置为: (.+)$/u, (match) => `Selection shortcut set to: ${match[1]}`],
    [/^并发数量已更新为 (.+)$/u, (match) => `Concurrency updated to ${match[1]}`],
    [/^已完成真实翻译请求（(.+) ms）。$/u, (match) => `A real translation request completed (${match[1]} ms).`],
    [/^你的请求频率过高，被【(.+)】拒绝了，请稍后再试吧~$/u, (match) => `Your request was rate-limited by ${match[1]}. Try again later.`],
    [/^网络连接失败：(.+)$/u, (match) => `Network connection failed: ${match[1]}`],
    [/^第 (\d+) 条字幕译文$/u, (match) => `Translation for subtitle ${match[1]}`],
    [/^(\d+) 条网站规则$/u, (match) => `${match[1]} website rules`],
    [/^已选 (\d+) 个服务 · 右侧卡片可拖动排序$/u, (match) => `${match[1]} services selected · drag the cards on the right to reorder`],
    [/^(\d+) 个翻译服务$/u, (match) => `${match[1]} translation services`],
    [/^已翻译 (\d+) 次$/u, (match) => `Translated ${match[1]} times`],
    [/^正在请求 (.+)…$/u, (match) => `Requesting ${match[1]}…`],
    [/^分 (\d+) 秒$/u, (match) => `${match[1]} seconds`],
    [/^第 (\d+) \/ (\d+) 页$/u, (match) => `Page ${match[1]} / ${match[2]}`],
    [/^第 (\d+)–(\d+) 条，共 (\d+) 条$/u, (match) => `${match[1]}–${match[2]} of ${match[3]}`],
    [/^查看全部 (\d+) 项$/u, (match) => `View all ${match[1]} items`],
    [/^开始复习 (\d+) 个$/u, (match) => `Review ${match[1]} items`],
    [/^复习 (\d+) 个 · 记得 (\d+) 个 · 忘了 (\d+) 个$/u, (match) => `Reviewed ${match[1]} · remembered ${match[2]} · forgot ${match[3]}`],
    [/^(\d+) 次收藏记录$/u, (match) => `${match[1]} save records`],
    [/^(\d+) 分钟后$/u, (match) => `In ${match[1]} minutes`],
    [/^(\d+) 小时后$/u, (match) => `In ${match[1]} hours`],
    [/^第 (\d+) \/ (\d+) 页 · 共 (\d+) 个$/u, (match) => `Page ${match[1]} / ${match[2]} · ${match[3]} total`],
    [/^(.+) 已标记为掌握$/u, (match) => `${match[1]} marked as mastered`],
    [/^(.+) 已回到学习队列$/u, (match) => `${match[1]} returned to the learning queue`],
    [/^已删除 (.+)$/u, (match) => `Deleted ${match[1]}`],
    [/^确认删除“(.+)”及其复习记录吗？$/u, (match) => `Delete “${match[1]}” and its review records?`],
    [/^已导出 (\d+) 个 Anki 词条$/u, (match) => `Exported ${match[1]} Anki entries`],
    [/^已恢复刚才删除的词条$/u, () => 'The deleted entry was restored'],
    [/^开始记录于 (.+)$/u, (match) => `Recording started ${match[1]}`],
    [/^更新于 (.+)$/u, (match) => `Updated ${match[1]}`],
    [/^用量趋势，共 (.+) Token$/u, (match) => `Usage trend, ${match[1]} tokens`],
    [/^完整数值：(.+) Token$/u, (match) => `Exact value: ${match[1]} tokens`],
    [/^双语 · (.+)$/u, (match) => `Bilingual · ${match[1]}`],
    [/^第 (\d+) 页$/u, (match) => `Page ${match[1]}`],
    [/^(.+) 个可翻译片段$/u, (match) => `${match[1]} translatable segments`],
    [/^(.+) 个片段$/u, (match) => `${match[1]} segments`],
    [/^(.+) 个文本片段$/u, (match) => `${match[1]} text segments`],
    [/^当前展示前 (\d+) 个片段，下载时会包含完整文件。$/u, (match) => `Showing the first ${match[1]} segments; the complete file is included in the download.`],
    [/^文件大小超过 (.+)，请先拆分文件后再翻译。$/u, (match) => `The file is larger than ${match[1]}. Split the file before translating.`],
    [/^下载(双语|译文)文件$/u, (match) => `Download ${match[1] === '双语' ? 'bilingual' : 'translated'} file`],
    [/^第 (\d+) 页第 (\d+) 个文本块译文$/u, (match) => `Translation for text block ${match[2]} on page ${match[1]}`],
    [/^第 (\d+) 个文本片段译文$/u, (match) => `Translation for text segment ${match[1]}`],
    [/^第 (\d+) 段译文$/u, (match) => `Translation for paragraph ${match[1]}`],
    [/^(.+) 项将在滚动到附近时翻译$/u, (match) => `${match[1]} items will be translated as you scroll nearby`],
    [/^最多同时处理 (\d+) 个翻译任务，(.+)；失败后最多重试 (\d+) 次，退避从 (.+) 逐步增加到最多 (.+)。$/u,
        (match) => `Up to ${match[1]} translation tasks run at once, ${match[2]}; failed requests retry up to ${match[3]} times, backing off from ${match[4]} to ${match[5]}.`],
    [/^(.+)不限速$/u, (match) => `${match[1]} unlimited`],
    [/^(.+)最多 (\d+) 次$/u, (match) => `${match[1]} up to ${match[2]} requests`],
    [/^(.+)（当前浏览器不可用）$/u, (match) => `${match[1]} (unavailable in this browser)`],
];

/**
 * 将尚未完成 key 化的扩展 UI 文案翻译成 English。
 *
 * 这个适配器是有边界的迁移工具：调用方必须只把扩展自己的文本节点/属性传入，
 * 并且 UI directive 会跳过 textarea、pre、code 和用户内容，避免误伤网页正文或译文。
 */
export function translateLegacyText(value: string, language: UiLanguage): string {
    if (language !== 'en-US' || !value.trim()) return value;
    const trimmed = value.trim();
    const exact = enUSLegacyText[trimmed];
    if (exact) return preserveWhitespace(value, exact);

    const compound = trimmed.split(' · ');
    if (compound.length > 1) {
        const translatedCompound = compound.map((part) => translateLegacyText(part, language)).join(' · ');
        if (translatedCompound !== trimmed) return preserveWhitespace(value, translatedCompound);
    }

    for (const [pattern, resolver] of legacyPatterns) {
        const match = pattern.exec(trimmed);
        if (match) return preserveWhitespace(value, resolver(match));
    }
    return value;
}

export {enUSMessages, enUSLegacyText, zhCNMessages};

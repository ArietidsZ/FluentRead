/**
 * @file src/features/settings/model/siteAdaptationEditor.ts
 * 文件职责：提供网站适配编辑器的草稿校验、内置规则复制、开关和网址匹配预览。
 * 主要内容：所有编辑先生成草稿，合法规则才可替换持久配置；预览复用运行时编译器的覆盖与匹配规则。
 * 模块边界：不读写配置、不访问网络或文件；调用方传入浏览器 document 以校验 CSS 支持。
 */

import {composeSiteAdapters, resolveSiteRule} from '@/src/core/site-adaptation/compiler';
import {parseSiteRulePack, SITE_RULE_LIMITS, validateSelectors} from '@/src/core/site-adaptation/schema';
import type {
    SiteAdaptationSettings, SiteRule, SiteRuleIssue, SiteRulePack, SiteRulePackParseResult,
} from '@/src/core/site-adaptation/types';

export const SITE_ADAPTATION_EXAMPLE: SiteRulePack = {
    version: 1,
    rules: [{
        id: 'my-article-site', name: '我的文章网站',
        match: {hosts: ['example.com', '*.example.com'], paths: ['/articles/*']},
        mode: 'focus', content: [{css: ['article h1', 'article p', 'article li'], atomic: true}],
        protect: ['code', 'pre', 'button', '[data-no-translate]'],
        exclude: ['article nav', '.advertisement'],
    }],
};

export function formatSiteRulePack(pack: SiteRulePack): string {
    return JSON.stringify(pack, null, 2);
}

/** 文本边界限制先于 JSON.parse，避免巨大导入文件占用解析器。 */
export function parseSiteAdaptationDraft(text: string, document: Document): SiteRulePackParseResult {
    if (new TextEncoder().encode(text).byteLength > SITE_RULE_LIMITS.bytes) {
        return {ok: false, issues: [{path: '$', message: '规则包不能超过 2 MB'}]};
    }
    let value: unknown;
    try { value = JSON.parse(text); }
    catch {
        return {ok: false, issues: [{path: '$', message: 'JSON 格式无效，请检查引号、逗号和括号。'}]};
    }
    const result = parseSiteRulePack(value);
    if (!result.ok) return result;
    const issues = validateSelectors(result.pack, document);
    return issues.length ? {ok: false, issues} : result;
}

export function searchSiteRules(rules: readonly SiteRule[], query: string): SiteRule[] {
    const term = query.trim().toLocaleLowerCase();
    return rules.filter((rule) => [rule.id, rule.name, ...rule.match.hosts]
        .some((value) => value.toLocaleLowerCase().includes(term)));
}

/** 只更改目标开关，保留已保存的自定义包及其他禁用项。 */
export function setSiteRuleEnabled(
    settings: SiteAdaptationSettings, id: string, enabled: boolean,
): SiteAdaptationSettings {
    const disabled = new Set(settings.disabledRuleIds);
    if (enabled) disabled.delete(id);
    else disabled.add(id);
    return {...settings, disabledRuleIds: [...disabled]};
}

/** 草稿有未保存修改时保留用户文本，外部存储更新不能覆盖正在编辑的内容。 */
export function reconcileSiteRuleDraft(
    draft: string, previous: SiteRulePack, incoming: SiteRulePack, preserveDraft = false,
): string {
    if (preserveDraft) return draft;
    return draft === formatSiteRulePack(previous) ? formatSiteRulePack(incoming) : draft;
}

/** 后台确认只完成本次提交的文本，不消费等待期间新输入的草稿及撤销记录。 */
export function completeSiteRuleDraftSave(draft: string, submitted: string, pack: SiteRulePack): {
    draft: string; clearUndo: boolean;
} {
    return draft === submitted
        ? {draft: formatSiteRulePack(pack), clearUndo: true}
        : {draft, clearUndo: false};
}

/** 显式等待持久化端口，阻止重复提交，错误留给 UI 提示而不是假报成功。 */
export function createSiteAdaptationCommitter(persist: (settings: SiteAdaptationSettings) => Promise<void>): {
    commit(settings: SiteAdaptationSettings): Promise<'saved' | 'failed' | 'busy'>;
} {
    let pending = false;
    return {
        async commit(settings) {
            if (pending) return 'busy';
            pending = true;
            try {
                await persist(JSON.parse(JSON.stringify(settings)) as SiteAdaptationSettings);
            } catch {
                pending = false;
                return 'failed';
            }
            pending = false;
            return 'saved';
        },
    };
}

interface SiteRuleDraftImportTicket {
    sequence: number;
    draft: string;
}

/** 文件读取只能替换发起时的草稿；后发导入及用户新输入均优先于迟到结果。 */
export function createSiteRuleDraftImportGuard(): {
    begin(draft: string): SiteRuleDraftImportTicket;
    check(ticket: SiteRuleDraftImportTicket, draft: string): 'current' | 'superseded' | 'edited';
} {
    let sequence = 0;
    return {
        begin(draft) { return {sequence: ++sequence, draft}; },
        check(ticket, draft) {
            if (ticket.sequence !== sequence) return 'superseded';
            return ticket.draft === draft ? 'current' : 'edited';
        },
    };
}

export type SiteRuleDraftUpdate = {ok: true; draft: string} | {ok: false; issues: SiteRuleIssue[]};

/** 同 ID 替换单条草稿，其他规则及模板保持不变，展开模板后不依赖内置包。 */
export function copySiteRuleToDraft(
    draft: string, source: SiteRulePack, rule: SiteRule, document: Document,
): SiteRuleDraftUpdate {
    const parsed = parseSiteAdaptationDraft(draft, document);
    if (!parsed.ok) return parsed;
    const standalone = resolveSiteRule(source, rule);
    const index = parsed.pack.rules.findIndex((item) => item.id === rule.id);
    if (index < 0) parsed.pack.rules.push(standalone);
    else parsed.pack.rules[index] = standalone;
    const nextDraft = formatSiteRulePack(parsed.pack);
    const validation = parseSiteAdaptationDraft(nextDraft, document);
    return validation.ok ? {ok: true, draft: nextDraft} : validation;
}

export interface SiteRulePreviewItem {
    rule: SiteRule;
    source: 'builtin' | 'custom';
    enabled: boolean;
}
export type SiteRulePreview = {ok: true; url: string; rules: SiteRulePreviewItem[]} | {ok: false};

/** 只解析网址，不打开或请求该网站。停用规则仍显示，以解释未生效原因。 */
export function previewSiteRules(
    input: string, builtin: SiteRulePack, settings: SiteAdaptationSettings,
): SiteRulePreview {
    let url: URL;
    try { url = new URL(input.trim()); }
    catch { return {ok: false}; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return {ok: false};
    const ruleMap = new Map(builtin.rules.map((rule) => [rule.id, {rule, source: 'builtin' as const}]));
    const customRules = new Map(settings.custom.rules.map((rule) => [rule.id, rule]));
    const adapters = composeSiteAdapters(builtin, {...settings, enabled: true, disabledRuleIds: []});
    const rules = adapters.filter((adapter) => adapter.matches(url))
        .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0))
        .map((adapter): SiteRulePreviewItem => {
            const custom = customRules.get(adapter.id);
            const selected = custom ? {rule: custom, source: 'custom' as const} : ruleMap.get(adapter.id)!;
            return {...selected, enabled: settings.enabled && !settings.disabledRuleIds.includes(adapter.id)};
        });
    return {ok: true, url: url.href, rules};
}

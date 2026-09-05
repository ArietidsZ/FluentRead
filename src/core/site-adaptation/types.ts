/**
 * @file src/core/site-adaptation/types.ts
 * 文件职责：定义 FluentRead 网站适配 JSON 的版本、内容边界与配置契约。
 * 主要内容：声明规则包、共享模板、内容目标、持久设置与校验结果类型。
 * 模块边界：只描述数据，不执行网页脚本、修改页面样式或读取配置存储。
 */

export interface SiteContentRule {
    css: string[];
    resolve?: 'self' | 'closest';
    atomic?: boolean;
    key?: string;
}

export interface SiteRecipe {
    mode?: 'augment' | 'focus';
    content?: SiteContentRule[];
    protect?: string[];
    exclude?: string[];
    watchIgnore?: string[];
}

export interface SiteRule extends SiteRecipe {
    id: string;
    name: string;
    match: {hosts: string[]; paths?: string[]; excludePaths?: string[]};
    profile?: string;
    priority?: number;
}

export interface SiteRulePack {
    version: 1;
    profiles?: Record<string, SiteRecipe>;
    rules: SiteRule[];
}

export interface SiteAdaptationSettings {
    enabled: boolean;
    disabledRuleIds: string[];
    custom: SiteRulePack;
}

export interface SiteRuleIssue {
    path: string;
    message: string;
}

export type SiteRulePackParseResult =
    | {ok: true; pack: SiteRulePack}
    | {ok: false; issues: SiteRuleIssue[]};

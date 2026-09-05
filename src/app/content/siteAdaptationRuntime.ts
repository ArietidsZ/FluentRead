/**
 * @file src/app/content/siteAdaptationRuntime.ts
 * 文件职责：装配当前文档的网站适配会话，并提供主页面默认的取消与恢复端口。
 * 主要内容：初始化规则与路由身份，将规则发布给共享核心，允许邮件子页面注入自身会话清理。
 * 模块边界：只连接核心与现有公开生命周期能力，不实现候选算法、配置存储或额外监听器。
 */
import {builtinSiteRulePack} from '@/src/core/site-adaptation/catalog';
import {createSiteAdaptationSession, type SiteAdaptationSession} from '@/src/core/site-adaptation/session';
import {setCurrentTranslationAdapters} from '@/src/core/translation/current';
import {restoreOriginalContent} from '@/src/features/full-page-translation/public';
import {cancelAllTranslations} from '@/src/app/translation/client';
import {resetPageTranslationContextCache} from '@/src/services/translation/context';

function invalidatePageTranslation(): void {
    restoreOriginalContent();
    cancelAllTranslations();
    resetPageTranslationContextCache();
}

export function createContentSiteAdaptationRuntime(
    initialSettings: unknown,
    url: URL,
    invalidate: () => void = invalidatePageTranslation,
): SiteAdaptationSession {
    const session = createSiteAdaptationSession(builtinSiteRulePack, {
        apply: setCurrentTranslationAdapters, invalidate,
    });
    session.update(initialSettings);
    session.routeChanged(url);
    return session;
}

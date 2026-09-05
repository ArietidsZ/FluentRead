/**
 * @file src/app/content/pageStyles.ts
 * 文件职责：为当前顶层文档或受支持邮件子页面安装公共翻译样式。
 * 主要内容：复用唯一样式标识并把移除函数绑定 WXT context 失效，供各内容组合根清理。
 * 模块边界：仅绑定内联 CSS 与文档生命周期，不发现候选、不挂载 UI，也不修改宿主样式表。
 */
import type {ContentScriptContext} from 'wxt/utils/content-script-context';
import pageStyles from './page.css?inline';

export function installPageStyles(ctx: ContentScriptContext): () => void {
    const existing = document.getElementById('fluent-read-page-styles');
    if (existing) return () => undefined;
    const style = document.createElement('style');
    style.id = 'fluent-read-page-styles';
    style.textContent = pageStyles;
    (document.head ?? document.documentElement).appendChild(style);
    const remove = () => style.remove();
    ctx.onInvalidated(remove);
    return remove;
}

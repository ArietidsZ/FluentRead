import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it, vi} from 'vitest';
import ts from 'typescript';

// 编译真实 Popup action，注入浏览器边界，验证恢复与配置更新不会走错误的副作用路径。
function loadAction(name: string, ports: Record<string, unknown>) {
    const source = readFileSync(resolve(__dirname, '../src/app/popup/PopupApp.vue'), 'utf8');
    const script = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)![1];
    const ast = ts.createSourceFile('popup.ts', script, ts.ScriptTarget.Latest, true);
    const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)!;
    const code = ts.transpileModule(declaration.getText(ast), {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
    return new Function(...Object.keys(ports), `${code}\nreturn ${name};`)(...Object.values(ports));
}

describe('Popup actions across configuration and page state', () => {
    it('Popup 启动仅读取站点，不再请求网页翻译状态', async () => {
        const browser = {tabs: {query: vi.fn(async () => [{id: 3, url: 'https://example.com/article'}]), sendMessage: vi.fn()}};
        const currentTabId = {value: null};
        const currentSiteDomain = {value: ''};
        await loadAction('hydrateCurrentSite', {browser, currentTabId, currentSiteDomain, getSiteBaseDomain: () => 'example.com'})();
        expect(currentTabId.value).toBe(3);
        expect(currentSiteDomain.value).toBe('example.com');
        expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it('总开关保留在设置页，Popup 只展示暂停状态', () => {
        const popup = readFileSync(resolve(__dirname, '../src/app/popup/PopupApp.vue'), 'utf8');
        const settings = readFileSync(resolve(__dirname, '../src/features/settings/ui/SettingsSections.vue'), 'utf8');
        expect(popup).not.toContain('setPluginEnabled');
        expect(popup).toContain('v-if="!config.on"');
        expect(settings).toContain('v-model="config.on"');
    });
    it('站点禁用快速撤回不发送可能晚到的页面覆盖命令', () => {
        const config = {value: {disabledExtensionDomains: [] as string[]}};
        const browser = {tabs: {sendMessage: vi.fn(async () => undefined)}};
        const action = loadAction('setCurrentSiteExtensionDisabled', {config, browser,
            currentSiteDomain: {value: 'example.com'}, currentTabId: {value: 3},
            pageTranslated: {value: false}, translating: {value: false}, showNotice: vi.fn()});
        action(true); action(false);
        expect(config.value.disabledExtensionDomains).toEqual([]);
        expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it('局部翻译先检查服务可用性，进入页面选择模式后关闭 Popup，失败时留在 Popup 说明原因', async () => {
        const showNotice = vi.fn();
        const close = vi.fn();
        const sendMessage = vi.fn(async () => ({status: 'success'}));
        const browser = {tabs: {query: vi.fn(async () => [{id: 7}]), sendMessage}};
        const t = (key: string) => key;
        const ports = {browser, showNotice, t, window: {close}, isBrowserTabId: (id: unknown) => typeof id === 'number'};
        const blocked = loadAction('startSectionTranslation', {...ports, credentialWarning: {value: '缺少 API Key'}});
        await blocked();
        expect(showNotice).toHaveBeenLastCalledWith('缺少 API Key', 'error');
        expect(sendMessage).not.toHaveBeenCalled();

        const action = loadAction('startSectionTranslation', {...ports, credentialWarning: {value: ''}});
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await action();
        expect(sendMessage).toHaveBeenCalledWith(7, {type: 'contextMenuTranslate', action: 'section'});
        expect(close).toHaveBeenCalledOnce();

        for (const response of [{status: 'failed'}, {status: 'disabled'}, undefined]) {
            sendMessage.mockResolvedValueOnce(response as never);
            await action();
            expect(showNotice).toHaveBeenLastCalledWith('popup.sectionTranslationUnavailable', 'error');
        }
        browser.tabs.query.mockResolvedValueOnce([{}] as never);
        await action();
        expect(showNotice).toHaveBeenLastCalledWith('popup.sectionTranslationUnavailable', 'error');
        expect(close).toHaveBeenCalledOnce();
    });
});

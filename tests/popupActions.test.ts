import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it, vi} from 'vitest';
import ts from 'typescript';
import {normalizeConfig} from '@/src/core/config/model';
import {resolveConfiguredHotkey} from '@/src/core/hotkey';
import {buildConfigDiff} from '@/src/core/config/diff';

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
    it('悬停开关关闭并重开后恢复预设、手势与自定义快捷键，不改变额外方案', () => {
        for (const hotkey of ['Control', 'Alt', 'Shift', 'Escape', '`', 'DoubleClick', 'LongPress', 'MiddleClick', 'TwoFinger', 'ThreeFinger', 'FourFinger', 'DoubleClickScree', 'TripleClickScree', 'custom']) {
            const config = {value: normalizeConfig({hotkey, customHotkey: 'Alt+J'})};
            const extra = config.value.quickTranslationProfiles;
            const action = loadAction('toggleDefaultHoverShortcut', {config, resolveConfiguredHotkey,
                defaultHoverEnabled: {get value() {return config.value.hotkey !== 'none';}},
                quickTranslationConflictMessage: () => '', showNotice: vi.fn()});
            action();
            expect(config.value.hotkey).toBe('none');
            config.value = normalizeConfig(JSON.parse(JSON.stringify(config.value)));
            expect(config.value.hoverShortcutBeforeDisable).toBe(hotkey);
            action();
            expect(config.value.hotkey).toBe(hotkey);
            expect(config.value.customHotkey).toBe('Alt+J');
            expect(config.value.quickTranslationProfiles).toEqual(extra);
        }
    });

    it('旧版关闭状态和损坏恢复字段安全迁移；空自定义键回退，冲突时不覆盖独立方案', () => {
        expect(normalizeConfig({hotkey: 'none'}).hotkey).toBe('none');
        expect(normalizeConfig({hotkey: 'none', hoverShortcutBeforeDisable: 'Computer'}).hoverShortcutBeforeDisable).toBe('Control');
        const config = {value: normalizeConfig({hotkey: 'none', hoverShortcutBeforeDisable: 'custom', customHotkey: ''})};
        const showNotice = vi.fn();
        let conflict = '';
        const action = loadAction('toggleDefaultHoverShortcut', {config, resolveConfiguredHotkey,
            defaultHoverEnabled: {value: false}, quickTranslationConflictMessage: () => conflict, showNotice});
        action(); expect(config.value.hotkey).toBe('Control');
        config.value.hotkey = 'none'; conflict = '快捷键已被独立方案使用'; action();
        expect(config.value.hotkey).toBe('none');
        expect(showNotice).toHaveBeenCalledWith(conflict, 'error');
    });

    it('划词开关恢复关闭前的译文显示偏好且保留触发、卡片与收藏设置', () => {
        const config = {value: normalizeConfig({selectionTranslatorMode: 'translation-only', selectionTranslatorTrigger: 'contextMenu', selectionTranslatorPresentation: 'card', vocabularyBookEnabled: true})};
        const setSelectionMode = loadAction('setSelectionMode', {config});
        const action = loadAction('toggleSelectionTranslation', {config, setSelectionMode});
        action();
        expect(config.value.selectionTranslatorMode).toBe('disabled');
        expect(config.value.disableSelectionTranslator).toBe(true);
        config.value = normalizeConfig(JSON.parse(JSON.stringify(config.value)));
        action();
        expect(config.value.selectionTranslatorMode).toBe('translation-only');
        expect(config.value.disableSelectionTranslator).toBe(false);
        expect(config.value.selectionTranslatorTrigger).toBe('contextMenu');
        expect(config.value.selectionTranslatorPresentation).toBe('card');
        expect(config.value.vocabularyBookEnabled).toBe(true);
        setSelectionMode('bilingual'); action(); action();
        expect(config.value.selectionTranslatorMode).toBe('bilingual');
        expect(normalizeConfig({selectionTranslatorMode: 'disabled'}).selectionTranslatorModeBeforeDisable).toBe('bilingual');
        expect(normalizeConfig({selectionTranslatorMode: 'disabled', selectionTranslatorModeBeforeDisable: 'invalid' as never}).selectionTranslatorModeBeforeDisable).toBe('bilingual');
    });

    it('关闭前的记忆字段保存在配置中但不重复进入用户差异预览', () => {
        expect(buildConfigDiff({hoverShortcutBeforeDisable: 'Control', selectionTranslatorModeBeforeDisable: 'bilingual'},
            {hoverShortcutBeforeDisable: 'Alt', selectionTranslatorModeBeforeDisable: 'translation-only'}).changeCount).toBe(0);
    });
    it('Popup 启动读取真实网页状态，恢复按钮与当前内容状态一致，缺少内容脚本不隐藏站点', async () => {
        const browser = {tabs: {query: vi.fn(async () => [{id: 3, url: 'https://example.com/article'}]), sendMessage: vi.fn(async () => ({isTranslated: true}))}};
        const currentTabId = {value: null};
        const currentSiteDomain = {value: ''};
        const pageTranslated = {value: false};
        const action = loadAction('hydrateCurrentSite', {browser, currentTabId, currentSiteDomain, pageTranslated, getSiteBaseDomain: () => 'example.com'});
        await action();
        expect(currentTabId.value).toBe(3);
        expect(currentSiteDomain.value).toBe('example.com');
        expect(browser.tabs.sendMessage).toHaveBeenCalledWith(3, {type: 'getFullPageTranslationState'});
        expect(pageTranslated.value).toBe(true);
        browser.tabs.sendMessage.mockRejectedValueOnce(new Error('No receiver'));
        await action();
        expect(pageTranslated.value).toBe(false);
        expect(currentSiteDomain.value).toBe('example.com');
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
        const ports = {browser, showNotice, t, window: {close}, isBrowserTabId: (id: unknown) => typeof id === 'number',
            config: {value: {on: true}}, currentSiteExtensionDisabled: {value: false}, translating: {value: false}};
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

    it('网页翻译→恢复→再翻译使用对应消息，失败/禁用/无脚本时不误标成功', async () => {
        const pageTranslated = {value: false};
        const translating = {value: false};
        const showNotice = vi.fn();
        const sendMessage = vi.fn(async (_id: number, message: {action: string}) => ({status: 'success', isTranslated: message.action === 'fullPage'}));
        const browser = {tabs: {query: vi.fn(async () => [{id: 7}]), sendMessage}};
        const ports = {browser, pageTranslated, translating, showNotice, config: {value: {on: true}},
            currentSiteExtensionDisabled: {value: false}, credentialWarning: {value: ''}, isThunderbird: false,
            isBrowserTabId: (id: unknown) => typeof id === 'number'};
        const action = loadAction('togglePageTranslation', ports);
        await action(); expect(pageTranslated.value).toBe(true);
        await action(); expect(pageTranslated.value).toBe(false);
        await action(); expect(pageTranslated.value).toBe(true);
        expect(sendMessage.mock.calls.map(call => call[1].action)).toEqual(['fullPage', 'restore', 'fullPage']);
        for (const response of [{status: 'failed'}, {status: 'disabled'}, undefined]) {
            pageTranslated.value = false;
            sendMessage.mockResolvedValueOnce(response as never);
            await action();
            expect(pageTranslated.value).toBe(false);
            expect(translating.value).toBe(false);
            expect(showNotice).toHaveBeenLastCalledWith('当前页面暂不支持翻译，请刷新后重试', 'error');
        }
        sendMessage.mockRejectedValueOnce(new Error('No receiver'));
        await action(); expect(pageTranslated.value).toBe(false);
        browser.tabs.query.mockResolvedValueOnce([{}] as never);
        await action(); expect(pageTranslated.value).toBe(false);
    });

    it('暂停、站点禁用和执行中阻止新操作，缺少凭据不阻止恢复已有译文', async () => {
        const sendMessage = vi.fn(async () => ({status: 'success', isTranslated: false}));
        const ports = {browser: {tabs: {query: vi.fn(async () => [{id: 7}]), sendMessage}},
            config: {value: {on: true}}, currentSiteExtensionDisabled: {value: false}, translating: {value: false},
            pageTranslated: {value: false}, credentialWarning: {value: '缺少 API Key'}, showNotice: vi.fn(), isThunderbird: false,
            isBrowserTabId: (id: unknown) => typeof id === 'number', t: (key: string) => key, window: {close: vi.fn()}};
        const action = loadAction('togglePageTranslation', ports);
        await action(); expect(sendMessage).not.toHaveBeenCalled();
        ports.pageTranslated.value = true;
        await action(); expect(sendMessage).toHaveBeenCalledWith(7, {type: 'contextMenuTranslate', action: 'restore'});
        ports.credentialWarning.value = '';
        for (const name of ['config', 'currentSiteExtensionDisabled', 'translating']) {
            ports.config.value.on = name !== 'config';
            ports.currentSiteExtensionDisabled.value = name === 'currentSiteExtensionDisabled';
            ports.translating.value = name === 'translating';
            await action(); await loadAction('startSectionTranslation', ports)();
        }
        expect(sendMessage).toHaveBeenCalledOnce();
    });
});

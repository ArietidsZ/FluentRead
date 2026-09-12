// 输入框翻译专项：生产扩展、隔离 Edge、真实按键和本地确定性供应商响应。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const argument = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const {chromium} = require(path.join(argument('playwright-root', path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')), 'playwright'));
const helper = require(argument('focus-safe-helper', path.join(os.homedir(), '.codex/skills/fluentread-extension-ui-test/scripts/focus-safe-browser.cjs')));
const extensionDir = path.resolve(argument('extension-dir', '.output/chrome-mv3'));
const artifactsDir = path.resolve(argument('artifacts-dir', '/private/tmp/fluentread-input-translation'));
fs.mkdirSync(artifactsDir, {recursive: true});
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-input-translation-'));
const report = {extensionDir, profileDir, evidence: 'Production extension; real browser input; deterministic mock provider, no external provider certification', cases: [], consoleErrors: []};
let session;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const html = `<!doctype html><html><head><meta charset="utf-8"><title>输入框翻译 · 交互验证</title><style>
body{margin:0;padding:48px;background:#f5f3f7;color:#292337;font:16px/1.7 system-ui}main{max-width:820px;margin:auto;background:white;border-radius:20px;padding:32px}h1{margin:0;font-size:26px}p{color:#696275}label{display:block;margin:24px 0}input,textarea,[contenteditable]{box-sizing:border-box;width:100%;padding:14px;border:1px solid #cfc8da;border-radius:10px;font:18px/1.6 system-ui}textarea{min-height:130px}small{color:#81758b}
</style></head><body><main><h1>输入框翻译</h1><p>输入、触发、继续编辑与恢复原文</p><label>消息<textarea id="message">明天下午见面。</textarea></label><label>另一输入框<input id="other" value="请帮我确认时间。"></label><label>密码<input id="password" type="password" value="private"></label><label>富文本编辑区<div id="rich" contenteditable="true"><b>这段格式需要保留。</b></div></label><label>纯文本编辑区<div id="plain" contenteditable="plaintext-only">你好</div></label><small>本页使用本地测试响应，验证扩展交互。</small></main></body></html>`;

async function main() {
  try {
    session = await helper.launchFocusSafePersistentContext({chromium, profileDir,
      browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', background: true,
      headless: false, viewport: {width: 1280, height: 900}, displayTarget: 'secondary', timeout: 30000,
      browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking']});
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    const context = session.context;
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    await worker.evaluate(() => {
      globalThis.inputTest = {mode: 'success', requests: [], pending: [], result: 'Let us meet tomorrow afternoon.'};
      const originalFetch = globalThis.fetch.bind(globalThis);
      globalThis.fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href);
        if (url.protocol === 'chrome-extension:') return originalFetch(input, init);
        const state = globalThis.inputTest;
        const body = JSON.parse(init?.body || '{}');
        state.requests.push({url: url.href, body});
        if (state.mode === 'pending') await new Promise(resolve => state.pending.push(resolve));
        if (state.mode === 'failure') return new Response('simulated failure', {status: 503});
        const payload = Array.isArray(body)
          ? body.map(() => ({translations: [{text: state.result}]}))
          : {id: 'input-fixture', object: 'chat.completion', created: 1, model: body.model,
            choices: [{index: 0, message: {role: 'assistant', content: state.result}, finish_reason: 'stop'}],
            usage: {prompt_tokens: 12, completion_tokens: 8, total_tokens: 20}};
        return new Response(JSON.stringify(payload), {status: 200, headers: {'content-type': 'application/json'}});
      };
    });
    const options = await helper.newPageWithoutForeground(context);
    options.on('pageerror', error => report.consoleErrors.push(error.message));
    await options.goto(`chrome-extension://${extensionId}/options.html#settings-translation`);
    await options.locator('.settings-section').first().waitFor({state: 'attached'});
    let sequence = 0;
    async function readConfig() {
      return options.evaluate(async () => {
        const r = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
        return typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
      });
    }
    async function patch(updates) {
      const result = await options.evaluate(async ({updates, sequence}) => {
        const r = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
        const current = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
        return chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config: updates,
          expected: Object.fromEntries(Object.keys(updates).map(key => [key, current[key]])),
          clientId: 'input-translation-browser-test', sequence, baseRevision: current.__fluentConfigRevision});
      }, {updates, sequence: ++sequence});
      assert.equal(result.success, true, JSON.stringify(result));
      await pause(400);
    }
    async function snap(name, page = options) {
      await pause(350); // Let dialog and theme transitions settle before capturing evidence.
      const file = `${name}.png`;
      await page.screenshot({path: path.join(artifactsDir, file), animations: 'disabled'});
      for (const dialog of await page.getByRole('dialog').all()) {
        if (!await dialog.isVisible()) continue;
        const bounds = await dialog.boundingBox();
        const viewport = await page.evaluate(() => ({width: innerWidth, height: innerHeight}));
        assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height + 1, `dialog stays inside viewport: ${name} ${JSON.stringify(bounds)}`);
        report.dialogGeometry ||= {};
        report.dialogGeometry[name] = bounds;
      }
      return file;
    }
    async function selectTestId(testId, label) {
      await options.getByTestId(testId).click();
      await options.locator('.el-select-dropdown:visible').getByRole('option', {name: label, exact: true}).click();
    }
    const defaults = await readConfig();
    assert.equal(defaults.inputBoxTranslationInterval, 1000);
    assert.equal(defaults.inputBoxTranslationService, 'microsoft');
    await patch({on: true, uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, useCache: false,
      inputBoxTranslationTrigger: 'triple_equal', inputBoxTranslationTarget: 'en',
      inputBoxTranslationInterval: 600, inputBoxTranslationService: 'microsoft',
      hotkey: 'disabled', selectionTranslatorMode: 'disabled', floatingBallPosition: 'disabled',
      translationMaxRetries: 0});
    await options.reload();
    const group = options.getByTestId('input-translation-settings');
    const profileEditor = options.getByTestId('input-translation-profile-editor');
    const promptEditor = options.getByTestId('input-translation-prompts');
    async function openProfile() {
      if (!await profileEditor.isVisible()) await options.getByTestId('input-translation-profile').click();
      await profileEditor.waitFor({state: 'visible'});
    }
    async function openPrompts() {
      await openProfile();
      const toggle = options.getByTestId('input-translation-prompt-toggle');
      if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
      await promptEditor.waitFor({state: 'visible'});
    }
    await group.waitFor({state: 'visible'});
    await group.scrollIntoViewIfNeeded();
    report.initialConfig = Object.fromEntries(Object.entries(await readConfig()).filter(([key]) => key.startsWith('inputBoxTranslation') || key === 'on'));
    await snap('00-initial-settings');
    await options.getByTestId('input-translation-timing-toggle').click();
    const interval = options.getByTestId('input-translation-interval').locator('input');
    await interval.fill('750');
    await interval.press('Tab');
    await options.waitForFunction(async () => {
      const r = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      return (typeof r.value === 'string' ? JSON.parse(r.value) : r.value).inputBoxTranslationInterval === 750;
    });
    await options.reload();
    await group.scrollIntoViewIfNeeded();
    assert.equal((await readConfig()).inputBoxTranslationInterval, 750);
    report.quickClose = {interval: 750, persistedAfterReload: true};
    await options.getByTestId('input-translation-timing-toggle').click();
    await options.getByTestId('input-translation-interval-reset').click();
    await pause(350);
    assert.equal((await readConfig()).inputBoxTranslationInterval, 1000);
    report.cases.push({name: 'interval edit and restore default', passed: true});
    await snap('01-timing-panel');
    await group.getByRole('heading', {name: '输入框翻译', exact: true}).click();
    await options.getByTestId('input-translation-timing-panel').waitFor({state: 'hidden'});
    await snap('01-settings-machine');

    const saved = await readConfig();
    await patch({service: 'microsoft', requireApiKey: {...saved.requireApiKey, 'v2:["openai","input-test-model"]': false, 'v2:["openai","global-model"]': false}, proxy: {...saved.proxy, openai: 'http://127.0.0.1:11434/v1/chat/completions'},
      model: {...saved.model, openai: 'global-model'},
      user_role: {...saved.user_role, openai: 'GLOBAL PROMPT {{origin}} {{to}}'},
      system_role: {...saved.system_role, openai: 'GLOBAL SYSTEM'},
      inputBoxTranslationService: 'microsoft', inputBoxTranslationModel: '',
      inputBoxTranslationPrompt: '', inputBoxTranslationSystemPrompt: ''});
    const globalBefore = await readConfig();
    await options.reload();
    await group.scrollIntoViewIfNeeded();
    await selectTestId('input-translation-trigger', '已关闭');
    assert.ok((await group.textContent()).includes('选择一个快捷键'));
    await openProfile();
    await selectTestId('input-translation-service', 'OpenAI');
    const modelInput = options.locator('input[data-testid="input-translation-model"], [data-testid="input-translation-model"] input');
    await modelInput.fill('input-test-model');
    await options.getByTestId('input-translation-profile-done').click();
    await profileEditor.waitFor({state: 'hidden'});
    await openProfile();
    assert.equal(await modelInput.inputValue(), 'input-test-model', 'typing a custom model then Done preserves it without Enter');
    await openPrompts();
    await options.getByTestId('input-translation-system-default').click();
    await options.getByTestId('input-translation-user-default').click();
    assert.ok((await promptEditor.locator('[data-prompt-role="system"] textarea').inputValue()).includes('professional translation assistant'));
    assert.ok((await promptEditor.locator('[data-prompt-role="user"] textarea').inputValue()).includes('{{origin}}'));
    await pause(400);
    await options.reload();
    await openPrompts();
    assert.ok((await promptEditor.locator('[data-prompt-role="system"] textarea').inputValue()).includes('professional translation assistant'));
    await promptEditor.getByRole('button', {name: '重置此提示词，不影响其他提示词', exact: true}).first().click();
    await promptEditor.getByRole('button', {name: '重置此提示词，不影响其他提示词', exact: true}).first().click();
    assert.equal(await promptEditor.locator('[data-prompt-role="system"] textarea').inputValue(), '');
    assert.equal(await promptEditor.locator('[data-prompt-role="user"] textarea').inputValue(), '');
    await promptEditor.locator('[data-prompt-role="system"] textarea').fill('   ');
    await promptEditor.locator('[data-prompt-role="user"] textarea').fill('\n  ');
    assert.ok((await options.getByTestId('input-translation-prompt-toggle').textContent()).includes('当前使用独立默认提示词'));
    assert.equal(await promptEditor.getByRole('alert').count(), 0);
    report.cases.push({name: 'default prompts can be loaded, edited, persisted and reset; whitespace uses default semantics', passed: true});
    await promptEditor.locator('[data-prompt-role="system"] textarea').fill('Keep the message polite. Return only translated text.');
    await promptEditor.locator('[data-prompt-role="user"] textarea').fill('Translate this input into {{to}}: {{origin}}');
    await pause(500);
    await options.reload();
    assert.equal((await readConfig()).inputBoxTranslationService, 'openai');
    assert.equal((await readConfig()).inputBoxTranslationModel, 'input-test-model');
    assert.equal((await readConfig()).inputBoxTranslationSystemPrompt, 'Keep the message polite. Return only translated text.');
    await group.scrollIntoViewIfNeeded();
    assert.equal((await readConfig()).inputBoxTranslationTrigger, 'disabled', 'editing a profile must not enable translation');
    await selectTestId('input-translation-trigger', '连按三下等号(=)');
    assert.ok((await group.textContent()).includes('输入文字后，连按三下等号(=)，即可替换为英语'));
    assert.equal(await promptEditor.count(), 0, 'prompt editor is opened on demand');
    const desktopBounds = await group.boundingBox();
    assert.ok(desktopBounds.height < 420, `common AI settings fit one compact card: ${desktopBounds.height}`);
    report.settingsLayout = {desktopCardHeight: desktopBounds.height, promptEditorInitiallyClosed: true};
    await group.getByRole('heading', {name: '输入框翻译', exact: true}).click();
    await options.mouse.move(20, 20);
    await snap('02-settings-ai');
    await group.screenshot({path: path.join(artifactsDir, '02-settings-card.png'), animations: 'disabled'});
    await openProfile();
    await snap('02a-profile');
    await openPrompts();
    await promptEditor.waitFor({state: 'visible'});
    await promptEditor.locator('[data-prompt-role="user"]').scrollIntoViewIfNeeded();
    await snap('02b-prompts');
    await options.getByTestId('input-translation-profile-done').click();
    await profileEditor.waitFor({state: 'hidden'});
    for (const width of [820, 390]) {
      await options.setViewportSize({width, height: 900});
      await group.scrollIntoViewIfNeeded();
      const overflow = await options.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false);
      await snap(`03-settings-${width}`);
      if (width === 390) {
        await openProfile();
        await snap('03-profile-390');
        await openPrompts();
        await promptEditor.waitFor({state: 'visible'});
        const dialog = options.getByRole('dialog');
        const bounds = await dialog.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, 'prompt dialog fits narrow viewport');
        await promptEditor.locator('[data-prompt-role="user"]').scrollIntoViewIfNeeded();
        await snap('03-prompts-390');
        await options.keyboard.press('Escape');
        await profileEditor.waitFor({state: 'hidden'});
      }
    }
    await options.setViewportSize({width: 1280, height: 900});
    await patch({theme: 'dark'});
    await group.scrollIntoViewIfNeeded();
    await group.getByRole('heading', {name: '输入框翻译', exact: true}).click();
    await snap('04-settings-dark');
    await openProfile();
    await snap('04-profile-dark');
    await openPrompts();
    await snap('04-prompts-dark');
    await options.getByTestId('input-translation-profile-done').click();
    await profileEditor.waitFor({state: 'hidden'});
    await patch({theme: 'light', inputBoxTranslationInterval: 400});
    assert.equal((await readConfig()).service, 'microsoft');
    assert.deepEqual((await readConfig()).model, globalBefore.model);
    assert.deepEqual((await readConfig()).customModel, globalBefore.customModel);
    assert.equal((await readConfig()).user_role.openai, 'GLOBAL PROMPT {{origin}} {{to}}');
    report.cases.push({name: 'independent AI config, responsive layout, preserved global config', passed: true});

    await context.route('https://input-translation.example/**', route => route.fulfill({status: 200, contentType: 'text/html', body: html}));
    const page = await helper.newPageWithoutForeground(context);
    page.on('pageerror', error => report.consoleErrors.push(error.message));
    await page.goto('https://input-translation.example/test');
    await page.waitForSelector('#fluent-read-page-styles', {state: 'attached'});
    await helper.activateExtensionTabWithoutForeground(context, page);
    const textarea = page.locator('#message');
    const requests = () => worker.evaluate(() => globalThis.inputTest.requests);
    const mode = value => worker.evaluate(value => globalThis.inputTest.mode = value, value);
    const release = () => worker.evaluate(() => {
      globalThis.inputTest.mode = 'success';
      globalThis.inputTest.pending.splice(0).forEach(resolve => resolve());
    });
    async function triple(symbol = '=', gap = 60) {
      for (let i = 0; i < 3; i++) {await page.keyboard.press(symbol); if (i < 2) await pause(gap);}
    }
    async function expectValue(value) {
      try { await page.waitForFunction(value => document.querySelector('#message').value === value, value, {timeout: 15000}); }
      catch (error) {
        report.failedInput = {expected: value, actual: await textarea.inputValue(), active: await page.evaluate(() => document.activeElement?.id)};
        report.runtimeRequests = await requests();
        await snap('failed-input', page);
        throw error;
      }
    }
    await textarea.fill('明天下午见面。=');
    await triple();
    await expectValue('Let us meet tomorrow afternoon.');
    const first = (await requests()).at(-1);
    assert.equal(first.body.model, 'input-test-model');
    assert.ok(JSON.stringify(first.body).includes('明天下午见面。='));
    assert.ok(JSON.stringify(first.body).includes('Keep the message polite.'));
    assert.ok(!JSON.stringify(first.body).includes('GLOBAL PROMPT'));
    report.cases.push({name: 'triple equal uses independent model and prompts, preserves original equals', passed: true});
    const domSession = await context.newCDPSession(page);
    const tree = await domSession.send('DOM.getDocument', {depth: -1, pierce: true});
    const findRestore = node => {
      if (node.nodeName === 'BUTTON' && (node.children || []).some(child => child.nodeValue === '恢复原文')) return node;
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) {
        const found = findRestore(child); if (found) return found;
      }
    };
    const restoreNode = findRestore(tree.root);
    assert.ok(restoreNode, 'successful translation offers restore original');
    const box = await domSession.send('DOM.getBoxModel', {nodeId: restoreNode.nodeId});
    const quad = box.model.content;
    await pause(250);
    const style = await domSession.send('DOM.resolveNode', {nodeId: restoreNode.nodeId});
    const visibility = await domSession.send('Runtime.callFunctionOn', {
      objectId: style.object.objectId,
      functionDeclaration: 'function() { const parent = getComputedStyle(this.parentElement); return {opacity: parent.opacity, display: parent.display, visibility: parent.visibility}; }',
      returnByValue: true,
    });
    assert.deepEqual(visibility.result.value, {opacity: '1', display: 'block', visibility: 'visible'});
    report.successTooltipVisibility = visibility.result.value;
    await snap('05-translated-input', page);
    await page.mouse.click((quad[0] + quad[4]) / 2, (quad[1] + quad[5]) / 2);
    await expectValue('明天下午见面。=');
    await textarea.focus(); await page.keyboard.press('End'); await triple();
    await expectValue('Let us meet tomorrow afternoon.');
    report.cases.push({name: 'restore original and translate again', passed: true});

    let before = (await requests()).length;
    await textarea.fill('间隔太慢');
    await triple('=', 550);
    await pause(500);
    assert.equal((await requests()).length, before);
    assert.equal(await textarea.inputValue(), '间隔太慢===');
    report.cases.push({name: 'slow triple does not translate', passed: true});
    await pause(450);
    await textarea.fill('这是原始消息');
    await mode('pending');
    await triple();
    await pause(500);
    await textarea.fill('这是新编辑的消息');
    await release();
    await pause(600);
    assert.equal(await textarea.inputValue(), '这是新编辑的消息');
    report.cases.push({name: 'editing while pending preserves new content', passed: true});

    await mode('pending');
    await textarea.fill('失焦后仍完成翻译');
    await triple();
    await pause(400);
    await page.locator('#other').click();
    await release();
    await expectValue('Let us meet tomorrow afternoon.');
    report.cases.push({name: 'blur without another edit still allows translation', passed: true});

    await mode('pending');
    await textarea.fill('取消这次翻译');
    await triple();
    await pause(400);
    await page.keyboard.press('Escape');
    const cancelledValue = await textarea.inputValue();
    await release();
    await pause(500);
    assert.equal(await textarea.inputValue(), cancelledValue);
    report.cases.push({name: 'Escape cancels late writeback', passed: true});

    await mode('failure');
    await textarea.fill('服务失败时保留我');
    await triple();
    await pause(1500);
    assert.ok((await textarea.inputValue()).startsWith('服务失败时保留我'));
    await mode('success');
    await triple();
    await expectValue('Let us meet tomorrow afternoon.');
    report.cases.push({name: 'failure retains text and next trigger succeeds', passed: true});

    before = (await requests()).length;
    await page.locator('#password').focus(); await triple();
    await page.locator('#rich').focus(); await triple();
    await pause(500);
    assert.equal((await requests()).length, before);
    assert.equal(await page.locator('#rich b').count(), 1);
    report.cases.push({name: 'password and rich editor excluded', passed: true});
    await snap('06-host-inputs-preserved', page);
    for (const [trigger, symbol] of [['triple_space', 'Space'], ['triple_dash', '-']]) {
      await patch({inputBoxTranslationTrigger: trigger});
      await textarea.fill('请保留原来的结尾-'); await triple(symbol);
      await expectValue('Let us meet tomorrow afternoon.');
    }
    await patch({inputBoxTranslationTrigger: 'ctrl_enter'});
    await textarea.fill('普通快捷键翻译'); await page.keyboard.press('Control+Enter');
    await expectValue('Let us meet tomorrow afternoon.');
    report.cases.push({name: 'Space, dash and Control+Enter triggers', passed: true});
    await patch({inputBoxTranslationTrigger: 'triple_equal', inputBoxTranslationInterval: 1200});
    await textarea.fill('间隔设置立即生效'); await triple('=', 650);
    await expectValue('Let us meet tomorrow afternoon.');
    report.cases.push({name: 'interval change applies without page reload', passed: true});
    assert.deepEqual(report.consoleErrors, []);
    report.runtimeRequests = await requests();
    report.persistenceCases = report.cases.filter(item => /config|interval/.test(item.name));
    report.completed = true;
  } finally {
    fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
    if (session) await session.close();
  }
}
main().catch(error => {
  report.fatal = error.stack;
  fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
  console.error(error);
  process.exitCode = 1;
});

#!/usr/bin/env node
'use strict';
// 服务配置专项：紧凑页签、标签旁提示、多 Key、实际请求限制、区域、本地模型与自定义服务；不下载模型或调用外部服务。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const arg = (name, fallback) => {const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1];};
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifactsDir = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-service-configuration'));
const {chromium} = require(path.join(arg('playwright-root'), 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground} = require(arg('focus-safe-helper'));
const report = {ok: false, artifact: extensionDir.endsWith('-dev') ? 'development' : 'production', evidenceBoundary: 'Real extension UI and background persistence in a temporary profile; connection results are fixtures. No external providers or model downloads.', cases: [], persistenceCases: [], quickClose: false, latestWriteWins: false, crossPageSync: false, screenshots: [], layouts: [], consoleErrors: []};
fs.mkdirSync(artifactsDir, {recursive: true});
(async () => {
  let launched, page;
  try {
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-service-config-'));
    launched = await launchFocusSafePersistentContext({chromium, profileDir, browserPath: arg('browser-path', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'), background: true, headless: false, viewport: {width: 1440, height: 960}, timeout: 30000, browserArgs: ['--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check']});
    Object.assign(report, {launchMode: launched.launchMode, focusPolicy: launched.focusPolicy, windowPlacement: launched.windowPlacement});
    assert.equal(report.windowPlacement.browserFrontmost, false);
    const context = launched.context;
    const session = await context.browser().newBrowserCDPSession();
    let origin;
    try {const {id} = await session.send('Extensions.loadUnpacked', {path: extensionDir}); origin = `chrome-extension://${id}`;}
    finally {await session.detach();}
    const open = async name => {const p = await newPageWithoutForeground(context, 30000); p.on('pageerror', e => report.consoleErrors.push(e.message)); p.on('console', m => {if (m.type() === 'error') report.consoleErrors.push(m.text());}); await p.goto(`${origin}/${name}.html`, {waitUntil: 'domcontentloaded'}); return p;};
    const popup = await open('popup');
    const readConfig = () => popup.evaluate(async () => {const r = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'}); const credentials = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:credentials'}); return {...(typeof r.value === 'string' ? JSON.parse(r.value) : r.value), ...(credentials.value || {})};});
    await popup.waitForFunction(async () => (await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'})).value);
    const patch = async changes => {
      const before = await readConfig();
      const expected = Object.fromEntries(Object.keys(changes).map(k => [k, before[k]]));
      const result = await popup.evaluate(({changes, expected}) => chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config: changes, expected, clientId: `service-ui-${crypto.randomUUID()}`, sequence: 1}), {changes, expected});
      assert.equal(result.success, true, JSON.stringify({error: result.error, reason: result.reason, code: result.code, keys: Object.keys(result)}));
    };
    const first = await readConfig();
    const fixtureId = 'custom:ui-fixture';
    await patch({uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, theme: 'light', service: 'openai', apiKeyRotationEnabled: {...first.apiKeyRotationEnabled, openai: false}, customOpenAIProviders: [{id: fixtureId, name: '自定义接口示例', endpoint: 'http://localhost:11434/v1', models: ['fixture-model']}], model: {...first.model, [fixtureId]: 'fixture-model'}});
    page = await open('options');
    await page.locator('button[data-section="settings-services"]').click();
    const selectService = async id => {
      const toggle = page.locator('.mobile-directory-toggle');
      if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
      await page.locator(`[data-service-value="${id}"]:visible`).first().click();
      await page.locator(`[data-service-configuration-service="${id}"]`).waitFor({state: 'visible'});
    };
    const tab = async group => {await page.locator(`[data-service-settings-tabs] [id$="tab-${group}"]`).click(); await page.locator(`[data-configuration-group="${group}"]`).waitFor({state: 'visible'});};
    const screenshot = async name => {await page.waitForTimeout(220); const file = path.join(artifactsDir, `${name}.png`); await page.screenshot({path: file, animations: 'disabled'}); report.screenshots.push(file);};
    const layout = async name => {
      await page.waitForTimeout(150);
      const state = await page.evaluate(() => {
        const visible = node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
        const ids = [...document.querySelectorAll('[id]')].map(n => n.id);
        const overflow = [...document.querySelectorAll('.service-detail, .service-settings-panel, .api-key-list, .request-limit-settings, .prompt-template-field')].filter(visible).filter(n => n.scrollWidth > n.clientWidth + 1).map(n => n.className);
        return {width: innerWidth, height: innerHeight, docWidth: document.documentElement.scrollWidth, docHeight: document.documentElement.scrollHeight, overflow, duplicateIds: ids.filter((id, i) => ids.indexOf(id) !== i)};
      });
      assert(state.docWidth <= state.width + 1 && state.docHeight <= state.height + 1, `${name}: document overflow ${JSON.stringify(state)}`);
      assert.deepEqual(state.overflow, [], `${name}: control overflow`); assert.deepEqual(state.duplicateIds, [], `${name}: duplicate IDs`); report.layouts.push({name, ...state});
    };
    const choose = async (selector, value) => {await selector.click(); await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({hasText: value}).click();};
    const saved = async predicate => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {if (predicate(await readConfig())) return; await popup.waitForTimeout(80);}
      assert.fail(`Config did not persist: ${predicate.toString()}`);
    };
    await selectService('openai');
    assert.equal(await page.locator('[data-service-settings-tabs] [role="tab"]').count(), 4);
    assert.equal(await page.locator('[data-service-settings-tabs] [role="tabpanel"]:visible').count(), 1);
    assert.equal(await page.locator('#service-keys-settings, .api-key-columns, .service-options-heading, details.service-disclosure').count(), 0);
    const initialDefault = await page.locator('.service-catalog').getAttribute('data-default-service');
    assert.equal(await page.locator('[data-testid="model-thinking-control"] strong').textContent(), '深度思考');
    await screenshot('openai-model'); await layout('openai-model');
    // Native tab roles expose a single pane and support keyboard activation.
    const modelTab = page.locator('[id$="tab-translation"]'); await modelTab.focus(); await modelTab.press('ArrowRight');
    await page.locator('#service-prompts-settings').waitFor({state: 'visible'});
    assert.equal(await page.locator('#service-prompts-settings').isVisible(), true);
    await page.locator('[data-testid="prompt-editor-user"] textarea').fill('Translate {{origin}} into {{to}}. Saved UI fixture.');
    await page.locator('[data-testid="prompt-editor-user"] textarea').press('Tab');
    await saved(c => c.user_role.openai.includes('Saved UI fixture.'));
    await screenshot('openai-prompts'); report.cases.push('one visible settings pane; keyboard activation; prompt saves');
    await tab('translation');
    const thinking = page.locator('[data-testid="model-thinking-control"] .el-switch');
    await thinking.click();
    const model = (await readConfig()).model.openai;
    await saved(c => Object.values(c.modelThinking.openai || {}).some(Boolean));
    report.persistenceCases.push('model thinking saved through the existing store');
    await page.locator('[data-api-key-list] .api-key-entry input').first().fill('fixture-key-one');
    await page.locator('[data-api-key-list] .api-key-entry input').first().press('Tab');
    const rotation = page.locator('[data-api-key-rotation-setting] .el-switch');
    await rotation.click(); await page.locator('[data-api-key-add]').click();
    await page.waitForFunction(() => document.activeElement === document.querySelectorAll('.api-key-entry input')[1]);
    await page.locator('[data-api-key-list] .api-key-entry input').nth(1).fill('fixture-key-two');
    await page.locator('[data-api-key-list] .api-key-entry input').nth(1).press('Tab');
    await saved(c => c.apiKeys.openai.length === 2 && c.apiKeys.openai[1] === 'fixture-key-two');
    await rotation.click(); assert.equal(await page.locator('[data-api-key-list] .api-key-entry input').count(), 1);
    await rotation.click(); assert.equal(await page.locator('[data-api-key-list] .api-key-entry input').nth(1).inputValue(), 'fixture-key-two');
    await screenshot('openai-multiple-keys'); await layout('openai-multiple-keys');
    report.cases.push('rotation is beside keys; disabling preserves all keys; no duplicate column headings');
    await page.evaluate(() => {
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = function(message, ...args) {
        if (message?.type !== 'testTranslationService') return original(message, ...args);
        const promise = new Promise(resolve => setTimeout(() => resolve({success: true, durationMs: 120}), 120));
        const callback = args.find(a => typeof a === 'function'); if (callback) {promise.then(callback); return;} return promise;
      };
    });
    await page.locator('[data-connection-test-button]').click();
    await page.locator('[data-api-key-summary]').waitFor();
    assert.equal(await page.locator('.api-key-state.is-success').count(), 2);
    await layout('keys-with-results'); await screenshot('openai-keys-results');
    await tab('requests');
    const limits = page.locator('[data-testid="request-limit-settings"]');
    assert.equal(await limits.locator('input[role="spinbutton"]:disabled').count(), 3);
    await choose(limits.locator('.request-limit-inheritance .el-select'), '自定义');
    const concurrency = limits.locator('input[role="spinbutton"]').first();
    await concurrency.fill('3'); await concurrency.press('Tab');
    await saved(c => Object.values(c.modelRequestLimits.openai || {}).some(p => p.enabled && p.limits.maxConcurrentTranslations === 3));
    await screenshot('openai-request-limits'); await layout('openai-request-limits');
    await choose(limits.locator('.request-limit-inheritance .el-select'), '跟随全局设置');
    assert.equal(await concurrency.isDisabled(), true);
    await choose(limits.locator('.request-limit-inheritance .el-select'), '自定义'); assert.equal(await concurrency.inputValue(), '3');
    await choose(limits.locator('.request-limit-scope .el-select'), '整个服务');
    await choose(limits.locator('.request-limit-inheritance .el-select'), '自定义');
    await concurrency.fill('5'); await concurrency.press('Tab');
    await saved(c => c.serviceRequestLimits.openai?.limits.maxConcurrentTranslations === 5);
    assert.equal((await readConfig()).modelRequestLimits.openai[model].limits.maxConcurrentTranslations, 3);
    report.cases.push('actual inherited limits remain visible; custom model/service limits isolated; disabled custom values retained');
    await tab('custom-request');
    assert.equal(await page.locator('#service-custom-request-settings > .connection-field').first().locator('.provider-field-help').count(), 0);
    await screenshot('openai-compatibility'); await layout('openai-compatibility');
    for (const id of ['azureTranslator', 'aliyunTranslation']) {
      await selectService(id);
      const field = page.locator('[data-cloud-region]');
      assert.equal(await field.locator('.connection-field-control > *').count(), 1);
      const before = await field.boundingBox(); await field.locator('button.field-help').hover();
      await page.locator('.fluentread-field-help-popper:visible').waitFor();
      if (id === 'aliyunTranslation') assert.equal(await page.locator('.fluentread-field-help-popper:visible code').count(), 1);
      else assert.match(await page.locator('.fluentread-field-help-popper:visible').innerText(), /Ocp-Apim-Subscription-Region/);
      assert.equal(Math.round((await field.boundingBox()).height), Math.round(before.height));
      await screenshot(`${id}-hover`); await page.locator('.detail-hero').hover();
      report.cases.push(`${id}: region help on hover without expanding form`);
    }
    await selectService('ollama'); assert.equal(await page.locator('[data-service-value="ollama"] strong').textContent(), 'Ollama');
    assert.equal(await page.locator('[data-ollama-endpoint] .connection-field-control > *').count(), 1);
    await selectService('huanYuan'); assert.equal(await page.locator('[data-service-value="huanYuan"] strong').textContent(), '腾讯混元模型');
    for (const [id, attribute] of [['minimax', 'data-minimax-endpoint'], ['mimo', 'data-mimo-endpoint']]) {
      await selectService(id);
      assert.equal(await page.locator('.provider-account-fields .connection-field-control > p').count(), 0);
      const region = page.locator('.provider-account-fields .connection-field').last();
      await region.locator('button.field-help').hover();
      await page.locator(`.fluentread-field-help-popper:visible [${attribute}]`).waitFor();
      await screenshot(`${id}-region-hover`); await page.locator('.detail-hero').hover();
      report.cases.push(`${id}: aligned account fields, endpoint in region help`);
    }
    await selectService('freeTranslation'); await tab('requests');
    assert.equal(await page.locator('.is-advanced .recovery-copy').count(), 0);
    const wait = page.locator('.is-advanced input[role="spinbutton"]');
    await wait.fill('7'); await wait.press('Tab'); await saved(c => c.freeTranslationTimeoutMs === 7000);
    await screenshot('free-service-request-limits'); await layout('free-service-request-limits');
    report.cases.push('free-service timeout is aligned with limits; explanations in label help; actual save');
    await selectService('localTranslation');
    const card = page.locator('.local-model').first(); const height = (await card.boundingBox()).height;
    await card.locator('button.local-model-info').hover();
    const tooltip = page.locator('.fluentread-field-help-popper:visible'); await tooltip.waitFor();
    assert.equal(await tooltip.locator('a[href^="https://huggingface.co/"]').count(), 1);
    assert.equal(Math.round((await card.boundingBox()).height), Math.round(height));
    assert.equal(await page.locator('.local-model > .local-model-description').count(), 0);
    await screenshot('local-model-hover'); await page.locator('.detail-hero').hover();
    await card.locator('button.local-model-info').focus(); await tooltip.waitFor(); await screenshot('local-model-focus');
    report.cases.push('local model details on hover and keyboard focus; card height unchanged; license link available');
    await selectService(fixtureId);
    assert.equal(await page.locator('.service-description').count(), 0, 'Custom endpoint is not duplicated above the form');
    const endpoint = page.locator('[data-testid="custom-service-endpoint-row"]');
    assert.equal(await endpoint.locator('.connection-field-control > *').count(), 1);
    await endpoint.locator('button.field-help').hover(); await tooltip.waitFor();
    assert.match(await tooltip.innerText(), /Chat Completions.*\/v1/s);
    await screenshot('custom-endpoint-hover'); await page.locator('.detail-hero').hover();
    await page.locator('[data-testid="custom-service-delete"]').click();
    await page.locator('.el-message-box').waitFor(); await page.locator('.el-message-box .el-button').first().click();
    assert.equal((await readConfig()).customOpenAIProviders.some(p => p.id === fixtureId), true);
    report.cases.push('custom endpoint has only an input; combined label help; compact delete action retains confirmation and cancel');
    assert.equal(await page.locator('.service-catalog').getAttribute('data-default-service'), initialDefault);
    // Short-lived page and external updates must use real background persistence.
    await selectService('openai'); await tab('prompts');
    const userPrompt = page.locator('[data-testid="prompt-editor-user"] textarea');
    await userPrompt.fill('First save {{origin}}'); await userPrompt.fill('Latest save {{origin}}');
    await page.close(); await saved(c => c.user_role.openai === 'Latest save {{origin}}');
    page = await open('options'); await page.locator('button[data-section="settings-services"]').click(); await selectService('openai'); await tab('prompts');
    assert.equal(await page.locator('[data-testid="prompt-editor-user"] textarea').inputValue(), 'Latest save {{origin}}');
    report.quickClose = true; report.latestWriteWins = true; report.persistenceCases.push('rapid prompt edits, immediate close and reopen preserve the final value');
    const second = await open('options'); await second.locator('button[data-section="settings-services"]').click();
    await page.locator('[data-testid="prompt-editor-user"] textarea').fill('Cross page {{origin}}');
    await second.locator('[id$="tab-prompts"]').click();
    await second.waitForFunction(() => document.querySelector('[data-testid="prompt-editor-user"] textarea')?.value === 'Cross page {{origin}}');
    report.crossPageSync = true; await second.close(); await screenshot('persistence-reopened');
    for (const width of [1440, 1024, 820, 390]) {
      await page.setViewportSize({width, height: 960}); await selectService(fixtureId);
      for (const group of ['translation', 'prompts', 'requests', 'custom-request']) {await tab(group); await layout(`custom-${width}-${group}`); if (width === 390) {await page.locator(`[data-configuration-group="${group}"]`).scrollIntoViewIfNeeded(); await screenshot(`custom-${width}-${group}`);}}
    }
    await page.setViewportSize({width: 1440, height: 960});
    await patch({theme: 'dark'}); await selectService(fixtureId); await tab('requests'); await screenshot('custom-dark-limits'); await layout('custom-dark-limits');
    await patch({uiLanguage: 'en-US'}); await selectService('openai'); await tab('requests'); await screenshot('openai-english-limits'); await layout('openai-english-limits');
    assert.match(await page.locator('[data-service-value="huanYuan"] strong').textContent(), /Tencent Hunyuan Models/);
    assert.equal(await page.locator('[data-service-value="ollama"] strong').textContent(), 'Ollama');
    report.cases.push('responsive panes at 1440/1024/820/390; dark and English; unchanged default service');
    await selectService(fixtureId);
    await page.locator('[data-testid="custom-service-delete"]').click();
    await page.locator('.el-message-box').waitFor(); await page.locator('.el-message-box .el-button').last().click();
    await saved(c => !c.customOpenAIProviders.some(p => p.id === fixtureId));
    assert.equal((await readConfig()).service, 'openai');
    report.cases.push('confirmed deletion removes only the fixture custom service and preserves the default');
    assert.deepEqual(report.consoleErrors, []); report.ok = true;
  } catch (error) {
    report.error = error.stack || String(error); if (page && !page.isClosed()) await page.screenshot({path: path.join(artifactsDir, 'failure.png')}).catch(() => {}); process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
    if (launched) await launched.close().catch(() => {});
    console.log(JSON.stringify({ok: report.ok, cases: report.cases.length, layouts: report.layouts.length, screenshots: report.screenshots.length, error: report.error, report: path.join(artifactsDir, 'report.json')}));
  }
})();

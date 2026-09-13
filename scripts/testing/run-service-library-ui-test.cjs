#!/usr/bin/env node
/**
 * @file scripts/testing/run-service-library-ui-test.cjs
 * 在隔离后台 Edge 中验证新版翻译服务设置页的服务 rail、添加 picker、配置持久化和响应式边界。
 * 仅在本次临时 profile 写入 fixture 配置，不请求真实翻译服务，不接触用户浏览器或凭据。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const args = Object.fromEntries(process.argv.slice(2).reduce((out, value, index, all) => {
  if (value.startsWith('--')) out.push([value.slice(2), all[index + 1]]);
  return out;
}, []));
for (const field of ['extension-dir', 'playwright-root', 'focus-safe-helper', 'artifacts-dir']) assert(args[field], `Missing --${field}`);
const {chromium} = createRequire(path.join(args['playwright-root'], 'service-library.cjs'))('playwright');
const helper = require(args['focus-safe-helper']);
const extensionDir = path.resolve(args['extension-dir']);
const artifacts = path.resolve(args['artifacts-dir']);
const browserPath = args['browser-path'] || '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
fs.mkdirSync(artifacts, {recursive: true});
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-service-library-'));
const report = {
  ok: false,
  evidence: 'production-extension-ui-with-fixture-config',
  browserPath,
  cases: [],
  screenshots: [],
  consoleErrors: [],
  persistenceCases: [],
  quickClose: false,
  latestWriteWins: false,
  crossPageSync: false,
  hooks: {serviceRail: false, serviceAddPicker: false, customServiceDialog: false, apiKeySelectors: false, responsive: false},
};
const save = () => fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));

(async () => {
  let session;
  let page;
  try {
    session = await helper.launchFocusSafePersistentContext({
      chromium, profileDir, browserPath, headless: false, background: true, displayTarget: 'secondary',
      viewport: {width: 1440, height: 1000}, timeout: 30000,
      browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check'],
    });
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    assert.equal(report.windowPlacement.browserFrontmost, false);
    const context = session.context;
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: 30000});
    const id = new URL(worker.url()).host;
    const optionsUrl = `chrome-extension://${id}/options.html#settings-services`;
    const attach = target => {
      target.on('pageerror', error => report.consoleErrors.push(error.message));
      target.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
    };
    const newOptions = async () => { const target = await helper.newPageWithoutForeground(context, 30000); attach(target); await target.goto(optionsUrl); return target; };
    page = await newOptions();
    const readConfig = async () => page.evaluate(async () => {
      const result = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      return typeof result.value === 'string' ? JSON.parse(result.value) : result.value;
    });
    const seed = async patch => page.evaluate(async next => {
      const result = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      const current = typeof result.value === 'string' ? JSON.parse(result.value) : result.value;
      return chrome.runtime.sendMessage({type: 'persistConfig', config: {...current, ...next}, clientId: 'service-library-ui-fixture', sequence: Date.now(), baseRevision: current.__fluentConfigRevision});
    }, patch).then(result => assert.equal(result.success, true));
    const shot = async name => { await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); }); const file = path.join(artifacts, `${name}.png`); await page.screenshot({path: file, fullPage: true}); report.screenshots.push(file); };
    const visible = selector => page.locator(`${selector}:visible`);
    const rail = () => visible('.service-rail');
    const selected = service => visible(`[data-service-value="${service}"]`);
    const picker = () => page.getByTestId('service-add-dialog');
    const addItem = service => picker().locator(`[data-service-add-value="${service}"]`);
    const searchReady = () => page.waitForFunction(() => document.activeElement === document.querySelector('[data-testid="service-add-dialog"] input[type="search"]'));

    await seed({uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, service: 'freeTranslation', favoriteServices: [], theme: 'light', customOpenAIProviders: []});
    await page.reload(); await rail().waitFor({state: 'visible'});
    assert.equal(await page.locator('[data-service-view], .catalog-toolbar, .catalog-browse').count(), 0);
    assert.equal(await page.locator('.no-model-panel').count(), 0);
    const railValues = await rail().locator('[data-service-value]').evaluateAll(nodes => nodes.map(node => node.dataset.serviceValue));
    assert.equal(new Set(railValues).size, railValues.length, `rail 重复服务：${railValues}`);
    const expectedShortlist = ['freeTranslation', 'deepseek', 'openai', 'gemini', 'localTranslation'];
    assert.deepEqual(railValues, expectedShortlist.filter(value => railValues.includes(value)), `首用 rail 必须按可用项保留五个常用服务：${railValues}`);
    assert.equal(railValues.length, 5, `首用 rail 应显示准确 5 项：${railValues}`);
    report.hooks.serviceRail = true; report.cases.push({id: 'first-use-short-rail', values: railValues});
    const initialDefault = await page.locator('.service-catalog').getAttribute('data-default-service');
    await shot('service-library-first-use-five');
    await page.getByTestId('service-add').click(); await picker().waitFor({state: 'visible'});
    assert.equal(await page.getByRole('dialog', {name: '添加服务', exact: true}).count(), 1);
    await searchReady();
    assert.equal(await picker().locator('input[aria-label="搜索所有翻译服务"]').count(), 1);
    assert.equal(await picker().locator('.directory-filters').count(), 1);
    await shot('service-library-add-picker');
    const allCandidates = ['claude', 'ollama', 'cohere', 'qwen', 'mistral'];
    const available = [];
    for (const candidate of allCandidates) if (await addItem(candidate).count()) available.push(candidate);
    assert(available.length >= 2, `弹层缺少可用于添加的目录服务：${available}`);
    const firstAdd = available[0];
    await addItem(firstAdd).click(); await picker().waitFor({state: 'hidden'});
    assert.equal(await page.locator('.service-catalog').getAttribute('data-editing-service'), firstAdd);
    assert.equal(await page.locator('.service-catalog').getAttribute('data-default-service'), initialDefault);
    report.hooks.serviceAddPicker = true; report.cases.push('add-picker-persists-favorite-and-opens-editing');
    await page.getByTestId('service-add').click(); await picker().waitFor({state: 'visible'});
    assert.equal(await addItem(firstAdd).getAttribute('data-service-added'), 'true');
    const secondAdd = available[1];
    await addItem(secondAdd).click(); await picker().waitFor({state: 'hidden'});
    assert.equal(await page.locator('.service-catalog').getAttribute('data-editing-service'), secondAdd);
    await page.close();
    page = await newOptions(); await rail().waitFor({state: 'visible'});
    const reopenedConfig = await readConfig();
    assert(reopenedConfig.favoriteServices.includes(firstAdd) && reopenedConfig.favoriteServices.includes(secondAdd));
    assert.equal(reopenedConfig.service, initialDefault);
    assert.equal(await rail().locator(`[data-service-value="${firstAdd}"]`).count(), 1);
    assert.equal(await rail().locator(`[data-service-value="${secondAdd}"]`).count(), 1);
    await page.getByTestId('service-add').click(); await picker().waitFor({state: 'visible'});
    const search = picker().locator('input[aria-label="搜索所有翻译服务"]');
    await search.fill('service-does-not-exist-97531'); await picker().getByRole('status').waitFor({state: 'visible'}); await search.press('Escape'); await picker().waitFor({state: 'hidden'});
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'service-add');
    const afterAdds = await readConfig(); assert(afterAdds.favoriteServices.includes(firstAdd)); if (secondAdd) assert(afterAdds.favoriteServices.includes(secondAdd));
    report.quickClose = true; report.latestWriteWins = true; report.persistenceCases.push('rapid-two-adds-close-reopen-latest-value-wins', 'picker-search-empty-and-escape');

    await seed({token: {openai: 'fixture-not-a-live-key'}, favoriteServices: [...new Set([...(afterAdds.favoriteServices || []), 'openai'])]}); await page.reload(); await rail().waitFor({state: 'visible'});
    assert.equal(await rail().locator('[data-service-value="openai"]').count(), 1); report.cases.push('configured-user-item-retained');
    await selected('claude').click();
    assert.equal(await page.locator('.service-catalog').getAttribute('data-default-service'), initialDefault);
    await selected('deepseek').click(); await shot('service-library-deepseek');
    const singleKey = page.locator('[data-api-key-list] input[type="password"]').first();
    await singleKey.fill('fixture-deepseek-key');
    await page.getByTestId('custom-service-advanced').locator('summary').click();
    await page.locator('[data-api-key-rotation-setting] .el-switch').click();
    await page.locator('[data-api-key-add]').click();
    await page.locator('[data-api-key-index="1"] input').fill('fixture-second-key');
    await page.getByTestId('custom-service-advanced').locator('summary').click();
    assert.equal(await page.locator('[data-api-key-index]').count(), 2);
    await page.close(); page = await newOptions(); await rail().waitFor({state: 'visible'});
    await selected('deepseek').click();
    assert.equal(await page.locator('[data-api-key-index]').count(), 2);
    await page.getByTestId('custom-service-advanced').locator('summary').click();
    await page.locator('[data-api-key-rotation-setting] .el-switch').click();
    assert.equal(await page.locator('[data-api-key-index]').count(), 1);
    await page.locator('[data-api-key-index="0"] input').fill('fixture-updated-first-key');
    await page.locator('[data-api-key-rotation-setting] .el-switch').click();
    assert.equal(await page.locator('[data-api-key-index="1"] input').inputValue(), 'fixture-second-key');
    await page.locator('[data-api-key-rotation-setting] .el-switch').click();
    await page.getByTestId('custom-service-advanced').locator('summary').click();
    report.persistenceCases.push('single-key-multi-key-mode-and-hidden-key-values-preserved');
    await selected('claude').click();
    const setDefault = visible('.catalog-set-default').first();
    await setDefault.click();
    assert.equal(await page.locator('.service-catalog').getAttribute('data-default-service'), 'claude');
    const popup = await helper.newPageWithoutForeground(context, 30000); attach(popup); await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.waitForFunction(async () => {
      const result = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      const value = typeof result.value === 'string' ? JSON.parse(result.value) : result.value;
      return value.service === 'claude';
    });
    await popup.getByRole('button', {name: /翻译服务/}).click();
    assert.equal(await popup.locator('[data-service-value="claude"]').count(), 1);
    await popup.close();
    report.crossPageSync = true; report.cases.push('explicit-set-default-popup-storage-and-ui');

    await page.getByTestId('service-add').click(); await picker().waitFor({state: 'visible'});
    await picker().getByTestId('custom-service-add').click();
    const customDialog = page.getByTestId('custom-service-dialog'); await customDialog.waitFor({state: 'visible'}); report.hooks.customServiceDialog = true;
    await customDialog.getByTestId('custom-service-save').click(); assert.equal(await customDialog.getByRole('alert').count(), 3);
    await customDialog.getByTestId('custom-service-name').fill('工作翻译接口'); await customDialog.getByTestId('custom-service-endpoint').fill('http://localhost:11434/v1'); await customDialog.getByTestId('custom-service-api-key').fill('fixture-key'); await customDialog.getByTestId('custom-service-model').fill('local-model'); await customDialog.getByTestId('custom-service-save').click(); await customDialog.waitFor({state: 'hidden'});
    await page.locator('[data-service-value^="custom:"]').first().waitFor({state: 'visible'}); report.cases.push('custom-service-zero-to-one');
    const advanced = page.getByTestId('custom-service-advanced');
    assert.equal(await advanced.getAttribute('open'), null); assert.equal(await page.locator('.no-model-panel').count(), 0); report.cases.push('advanced-collapsed-and-no-empty-model-placeholder');
    report.hooks.apiKeySelectors = (await page.locator('input[type="password"], [data-api-key], [data-testid*="api-key"]').count()) > 0;
    await selected('freeTranslation').click();
    const freeAdvanced = page.getByTestId('custom-service-advanced');
    assert.equal(await freeAdvanced.getAttribute('open'), null);
    await freeAdvanced.locator('summary').click();
    assert.equal(await freeAdvanced.getAttribute('open'), '');
    const sequentialMode = freeAdvanced.locator('input[type="radio"][value="sequential"]');
    assert.equal(await sequentialMode.count(), 1); await sequentialMode.check();
    const timeoutInput = freeAdvanced.locator('input[aria-label*="等待"], input[aria-label*="timeout" i]').first();
    assert.equal(await timeoutInput.count(), 1, '免费翻译高级设置缺少超时控件');
    await timeoutInput.fill('7'); await timeoutInput.press('Enter');
    await page.close(); page = await newOptions(); await rail().waitFor({state: 'visible'});
    await selected('freeTranslation').click();
    const reopenedFreeAdvanced = page.getByTestId('custom-service-advanced');
    assert.equal(await reopenedFreeAdvanced.getAttribute('open'), null);
    const reopenedMode = await page.locator('input[type="radio"][value="sequential"]').isChecked();
    assert.equal(reopenedMode, true);
    assert.equal(await page.locator('input[aria-label*="等待"], input[aria-label*="timeout" i]').first().inputValue(), '7');
    await reopenedFreeAdvanced.locator('summary').click(); await shot('service-library-free-advanced');
    await selected('claude').click();
    assert.equal(await page.getByTestId('custom-service-advanced').getAttribute('open'), null);
    report.persistenceCases.push('free-advanced-mode-timeout-reopen-and-service-reset');
    const customValues = await page.locator('[data-service-value^="custom:"]').evaluateAll(nodes => nodes.map(node => node.dataset.serviceValue));
    await seed({customOpenAIProviders: Array.from({length: 20}, (_, index) => ({id: index === 0 ? customValues[0] : `custom:test${index}`, name: `自定义翻译服务 ${index}`, endpoint: 'http://localhost:11434/v1', models: ['local-model']}))}); await page.reload(); await rail().waitFor({state: 'visible'});
    assert(await page.locator('[data-service-value^="custom:"]').count() >= 20, '自定义服务达到 20 条后不可达'); report.cases.push('custom-service-counts-0-1-20-reachable');

    for (const width of [1440, 1024, 820, 390]) {
      await page.setViewportSize({width, height: 1000});
      const metrics = await page.evaluate(() => ({width: innerWidth, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, height: innerHeight, overflow: [...document.querySelectorAll('.service-catalog button, .service-catalog input, .service-rail, .service-detail')].filter(node => { if (getComputedStyle(node).display === 'none' || getComputedStyle(node).visibility === 'hidden') return false; const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0 && (box.left < -1 || box.right > innerWidth + 1); }).length}));
      assert(metrics.scrollWidth <= width + 1, JSON.stringify(metrics)); assert(metrics.scrollHeight <= metrics.height + 1, JSON.stringify(metrics)); assert.equal(metrics.overflow, 0, JSON.stringify(metrics)); report.cases.push({id: `layout-${width}`, metrics}); if (width === 390 || width === 1440) await shot(`service-library-${width}`);
    }
    await page.getByTestId('service-add').click(); await picker().waitFor({state: 'visible'}); await searchReady();
    await shot('service-library-add-picker-narrow');
    assert((await picker().boundingBox()).width <= 390);
    await picker().locator('input[type="search"]').press('Escape'); await picker().waitFor({state: 'hidden'});
    report.hooks.responsive = true; await page.setViewportSize({width: 1440, height: 1000}); await seed({theme: 'dark'}); await page.reload(); await rail().waitFor({state: 'visible'}); await shot('service-library-dark');
    await seed({uiLanguage: 'en-US'}); await page.reload(); await rail().waitFor({state: 'visible'}); assert(await page.getByRole('button', {name: /Add service|Add custom service/i}).count() >= 1); await shot('service-library-english');
    assert.deepEqual(report.consoleErrors, []); report.ok = true; save();
  } catch (error) { report.error = error.stack; if (page) await page.screenshot({path: path.join(artifacts, 'failure.png'), fullPage: true}).catch(() => {}); save(); process.exitCode = 1; }
  finally { if (session) await session.close(); fs.rmSync(profileDir, {recursive: true, force: true}); save(); console.log(JSON.stringify(report, null, 2)); }
})();

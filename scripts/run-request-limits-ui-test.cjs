#!/usr/bin/env node
'use strict';

// Issue #521 production options UI regression: global defaults, service/model
// request-limit inheritance, persistence, responsive layout, and dark theme.
// This script uses only an isolated temporary Edge profile and synthetic values.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
}

function parseArgs() {
  const extensionDir = path.resolve(arg('extension-dir'));
  const playwrightRoot = path.resolve(arg('playwright-root'));
  const focusSafeHelper = path.resolve(arg('focus-safe-helper'));
  const artifactsDir = path.resolve(arg('artifacts-dir', '/Users/thinkstu/Desktop/copy/artifacts/issue-521-request-limits/browser-production'));
  assert(fs.existsSync(path.join(extensionDir, 'manifest.json')), `缺少扩展构建产物: ${extensionDir}`);
  assert(fs.existsSync(focusSafeHelper), `缺少 focus-safe helper: ${focusSafeHelper}`);
  assert(fs.existsSync(playwrightRoot), `缺少 Playwright runtime: ${playwrightRoot}`);
  return {extensionDir, playwrightRoot, focusSafeHelper, artifactsDir,
    browserPath: arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
    timeout: Number(arg('timeout', '30000'))};
}

function loadPlaywright(root) {
  try { return require('playwright'); } catch {
    return createRequire(path.join(root, '__fluentread_issue_521_loader__.cjs'))('playwright');
  }
}

function loadHelper(file) {
  const helper = require(file);
  for (const method of ['launchFocusSafePersistentContext', 'newPageWithoutForeground', 'activateExtensionTabWithoutForeground']) {
    assert.equal(typeof helper[method], 'function', `focus-safe helper 缺少 ${method}`);
  }
  return helper;
}

async function main() {
  const args = parseArgs();
  const {chromium} = loadPlaywright(args.playwrightRoot);
  const helper = loadHelper(args.focusSafeHelper);
  fs.mkdirSync(args.artifactsDir, {recursive: true});
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-issue-521-edge-'));
  const report = {
    ok: false,
    issue: 521,
    extensionDir: args.extensionDir,
    artifactsDir: args.artifactsDir,
    profileDir,
    launchMode: null,
    focusPolicy: null,
    windowPlacement: null,
    production: true,
    cases: [],
    screenshots: [],
    persistenceCases: [],
    quickClose: null,
    crossPageSync: null,
    latestWriteWins: null,
    consoleErrors: [],
  };
  let launched;
  let currentPage;
  const requestLimitModel = 'deepseek-flash';
  const screenshot = async (page, name, fullPage = true) => {
    const file = path.join(args.artifactsDir, `${name}.png`);
    await page.screenshot({path: file, fullPage, animations: 'disabled'});
    report.screenshots.push(file);
    return file;
  };
  const recordPageErrors = (page, source) => {
    page.on('console', message => {
      if (message.type() === 'error') report.consoleErrors.push({source, message: message.text()});
    });
    page.on('pageerror', error => report.consoleErrors.push({source, message: error.message}));
  };
  try {
    launched = await helper.launchFocusSafePersistentContext({
      chromium,
      profileDir,
      browserPath: args.browserPath,
      background: true,
      headless: false,
      displayTarget: 'secondary',
      viewport: {width: 1440, height: 960},
      timeout: args.timeout,
      browserArgs: [
        `--disable-extensions-except=${args.extensionDir}`,
        `--load-extension=${args.extensionDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
      ],
    });
    Object.assign(report, {
      launchMode: launched.launchMode,
      focusPolicy: launched.focusPolicy,
      windowPlacement: launched.windowPlacement,
    });
    assert.equal(report.launchMode, 'macos-background-cdp');
    assert.equal(report.focusPolicy, 'launchservices-no-foreground');
    assert.equal(report.windowPlacement?.browserFrontmost, false);

    const context = launched.context;
    const worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://'))
      || await context.waitForEvent('serviceworker', {timeout: args.timeout});
    recordPageErrors(worker, 'service-worker');
    const extensionId = new URL(worker.url()).hostname;
    report.extensionId = extensionId;
    const extensionOrigin = `chrome-extension://${extensionId}`;
    const createPage = async (url, source) => {
      const page = await helper.newPageWithoutForeground(context, args.timeout);
      page.setDefaultTimeout(args.timeout);
      recordPageErrors(page, source);
      await page.goto(url, {waitUntil: 'domcontentloaded'});
      currentPage = page;
      await page.locator('#app').waitFor({state: 'attached'});
      return page;
    };
    const options = await createPage(`${extensionOrigin}/options.html#settings-advanced`, 'options');
    const readConfig = () => options.evaluate(async () => {
      const result = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      if (!result?.success) throw new Error(result?.error || '读取配置失败');
      return typeof result.value === 'string' ? JSON.parse(result.value) : result.value;
    });
    const patchConfig = async patch => {
      const current = await readConfig();
      const expected = Object.fromEntries(Object.keys(patch).map(key => [key, current[key]]));
      const result = await options.evaluate(async ({patch, expected}) => chrome.runtime.sendMessage({
        type: 'persistConfig', mode: 'patch', config: patch, expected,
        clientId: `issue-521-${crypto.randomUUID()}`, sequence: 1,
      }), {patch, expected});
      assert.equal(result?.success, true, result?.error || '配置保存失败');
    };
    const waitConfig = async predicate => {
      const deadline = Date.now() + args.timeout;
      while (Date.now() < deadline) {
        const value = await readConfig();
        if (predicate(value)) return value;
        await new Promise(resolve => setTimeout(resolve, 80));
      }
      throw new Error('配置未达到预期持久化状态');
    };
    const noHorizontalOverflow = async page => page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body?.scrollWidth || 0,
    }));
    const assertNoHorizontalOverflow = async (page, label) => {
      const dimensions = await noHorizontalOverflow(page);
      assert(dimensions.scrollWidth <= dimensions.viewport + 1, `${label} 存在横向溢出: ${JSON.stringify(dimensions)}`);
      return dimensions;
    };
    const switchTo = async (section, label, checked) => {
      const input = section.getByRole('switch', {name: label, exact: true});
      const current = (await input.getAttribute('aria-checked')) === 'true';
      if (current !== checked) await input.locator('xpath=..').click();
    };
    const globalScheduler = options.getByTestId('translation-scheduler-settings');
    await globalScheduler.waitFor({state: 'visible'});
    assert(await globalScheduler.getByLabel('每秒最多请求数', {exact: true}).isVisible());
    assert(await globalScheduler.getByLabel('每分钟最多请求数', {exact: true}).isVisible());
    await globalScheduler.locator('xpath=ancestor::*[contains(@class,"settings-group")][1]').scrollIntoViewIfNeeded();
    await screenshot(options, 'global-advanced-defaults', false);
    report.cases.push({id: 'global-advanced-defaults', ok: true});

    await patchConfig({service: 'deepseek', model: {deepseek: requestLimitModel}, theme: 'light'});
    await options.goto(`${extensionOrigin}/options.html#settings-services`, {waitUntil: 'domcontentloaded'});
    await options.locator('section.service-catalog[data-default-service]').waitFor({state: 'visible'});
    const deepseek = options.locator('[data-service-value="deepseek"]').first();
    await deepseek.click();
    const serviceConfiguration = options.locator('[data-testid="service-configuration"]');
    await serviceConfiguration.waitFor({state: 'visible'}).catch(async () => options.locator('.service-connection-section').waitFor({state: 'visible'}));
    const advanced = options.getByTestId('custom-service-advanced');
    await advanced.waitFor({state: 'visible'});
    assert.equal(await options.locator('[data-testid="request-limit-settings"]').count(), 1, '缺少模型请求限制区域');
    assert.equal(await advanced.locator('.el-row').filter({hasText: 'API 格式'}).locator('.el-select').count(), 1, 'DeepSeek API 格式必须位于高级设置内');
    assert.equal(await advanced.locator('[data-testid="request-limit-settings"]').count(), 1, '请求限制必须位于高级设置内');
    await advanced.scrollIntoViewIfNeeded();
    await screenshot(options, 'deepseek-advanced-collapsed', false);
    report.cases.push({id: 'deepseek-advanced-collapsed', ok: true});

    await advanced.locator('summary').click();
    const modelLimits = advanced.getByTestId('request-limit-settings');
    await modelLimits.waitFor({state: 'visible'});
    assert.equal(await modelLimits.getAttribute('data-scope'), 'model');
    assert.equal(await modelLimits.getAttribute('data-model'), requestLimitModel);

    const serviceLimitsButton = modelLimits.getByRole('button', {name: '服务请求限制', exact: true});
    await serviceLimitsButton.click();
    const serviceLimits = advanced.locator('[data-testid="request-limit-settings"][data-scope="service"]');
    await serviceLimits.waitFor({state: 'visible'});
    const serviceInheritSwitch = serviceLimits.getByRole('switch', {name: '跟随全局设置', exact: true});
    await switchTo(serviceLimits, '跟随全局设置', false);
    await serviceLimits.getByLabel('每秒最多请求数', {exact: true}).fill('4');
    await serviceLimits.getByLabel('每分钟最多请求数', {exact: true}).fill('90');
    await serviceLimits.getByLabel('翻译并发数', {exact: true}).fill('5');
    await serviceLimits.getByLabel('每秒最多请求数', {exact: true}).press('Tab');
    await waitConfig(config => config.serviceRequestLimits?.deepseek?.enabled === true);
    const serviceCustomized = await readConfig();
    assert.equal(serviceCustomized.serviceRequestLimits.deepseek.limits.translationRequestsPerSecond, 4);
    assert.equal(serviceCustomized.serviceRequestLimits.deepseek.limits.translationRequestsPerMinute, 90);
    assert.equal(serviceCustomized.serviceRequestLimits.deepseek.limits.maxConcurrentTranslations, 5);
    report.cases.push({id: 'service-custom-limits', ok: true});

    await serviceLimits.getByRole('button', {name: '当前模型设置', exact: true}).click().catch(async () => {
      await modelLimits.getByRole('button', {name: /当前模型设置/}).click();
    });
    await modelLimits.waitFor({state: 'visible'});
    const inheritSwitch = modelLimits.getByRole('switch', {name: /跟随(服务|全局)设置/, exact: false}).first();
    const inheritLabel = await inheritSwitch.getAttribute('aria-label');
    await switchTo(modelLimits, inheritLabel || '跟随服务设置', false);
    const modelRps = modelLimits.getByLabel('每秒最多请求数', {exact: true});
    const modelRpm = modelLimits.getByLabel('每分钟最多请求数', {exact: true});
    const modelConcurrency = modelLimits.getByLabel('翻译并发数', {exact: true});
    await modelRps.fill('2');
    await modelRpm.fill('40');
    await modelConcurrency.fill('3');
    await modelRps.press('Tab');
    await waitConfig(config => config.modelRequestLimits?.deepseek?.[requestLimitModel]?.enabled === true);
    const customized = await readConfig();
    assert.equal(customized.modelRequestLimits.deepseek[requestLimitModel].limits.translationRequestsPerSecond, 2);
    assert.equal(customized.modelRequestLimits.deepseek[requestLimitModel].limits.translationRequestsPerMinute, 40);
    assert.equal(customized.modelRequestLimits.deepseek[requestLimitModel].limits.maxConcurrentTranslations, 3);
    await modelRpm.press('Tab');
    await modelLimits.scrollIntoViewIfNeeded();
    const compactFields = await modelLimits.locator('input[role="spinbutton"]').evaluateAll(inputs => inputs.map(input => {
      const box = input.getBoundingClientRect();
      return {label: input.getAttribute('aria-label'), top: box.top, left: box.left, right: box.right};
    }));
    assert.equal(compactFields.length, 3);
    assert(compactFields.every(field => Math.abs(field.top - compactFields[0].top) < 1), '三项请求限制应并排显示');
    assert(compactFields[0].right < compactFields[1].left && compactFields[1].right < compactFields[2].left, '并排输入框不应重叠');
    report.compactFields = compactFields;
    await screenshot(options, 'deepseek-advanced-custom', false);
    report.cases.push({id: 'model-custom-limits', ok: true});

    await patchConfig({translationRequestsPerSecond: 7, translationRequestsPerMinute: 180, maxConcurrentTranslations: 8});
    await options.reload({waitUntil: 'domcontentloaded'});
    await options.locator('[data-service-value="deepseek"]').first().click();
    await options.getByTestId('custom-service-advanced').locator('summary').click().catch(() => {});
    const inheritedState = await readConfig();
    assert.equal(inheritedState.modelRequestLimits.deepseek[requestLimitModel].limits.translationRequestsPerSecond, 2, '修改全局默认不应覆盖模型独立限制');
    report.persistenceCases.push({id: 'global-does-not-overwrite-model', ok: true});

    const modelFollowSwitch = modelLimits.getByRole('switch', {name: /跟随(服务|全局)设置/, exact: false}).first();
    await switchTo(modelLimits, (await modelFollowSwitch.getAttribute('aria-label')) || '跟随服务设置', true);
    await waitConfig(config => config.modelRequestLimits?.deepseek?.[requestLimitModel]?.enabled === false);
    report.persistenceCases.push({id: 'inheritance-restores-and-clears-override', ok: true});

    await serviceLimitsButton.click();
    await switchTo(serviceLimits, '跟随全局设置', true);
    await waitConfig(config => config.serviceRequestLimits?.deepseek?.enabled === false);
    report.persistenceCases.push({id: 'service-inheritance-restores-and-clears-override', ok: true});

    await patchConfig({theme: 'dark'});
    await options.setViewportSize({width: 390, height: 850});
    await options.reload({waitUntil: 'domcontentloaded'});
    await options.locator('[data-service-value="deepseek"]').first().click();
    await options.locator('.service-connection-section').waitFor({state: 'visible'});
    const narrowAdvanced = options.getByTestId('custom-service-advanced');
    await narrowAdvanced.waitFor({state: 'visible'});
    if (!(await narrowAdvanced.getAttribute('open'))) await narrowAdvanced.locator('summary').click();
    const narrowLimits = narrowAdvanced.getByTestId('request-limit-settings');
    await narrowLimits.waitFor({state: 'visible'});
    const narrowFollow = narrowLimits.getByRole('switch', {name: /跟随(服务|全局)设置/, exact: false}).first();
    await switchTo(narrowLimits, (await narrowFollow.getAttribute('aria-label')) || '跟随全局设置', false);
    await narrowLimits.getByLabel('翻译并发数', {exact: true}).fill('3');
    await narrowLimits.getByLabel('每秒最多请求数', {exact: true}).fill('2');
    await narrowLimits.getByLabel('每分钟最多请求数', {exact: true}).fill('40');
    await narrowLimits.getByLabel('每分钟最多请求数', {exact: true}).press('Tab');
    const narrowBounds = await narrowLimits.evaluate(node => {
      const root = node.getBoundingClientRect();
      const fields = [...node.querySelectorAll('input[aria-label]')].map(input => {
        const box = input.getBoundingClientRect();
        return {label: input.getAttribute('aria-label'), left: box.left, right: box.right, rootLeft: root.left, rootRight: root.right};
      });
      return {root: {left: root.left, right: root.right, width: root.width}, fields};
    });
    assert(narrowBounds.fields.every(field => field.left >= narrowBounds.root.left - 1 && field.right <= narrowBounds.root.right + 1), `窄屏输入框超出请求限制区域: ${JSON.stringify(narrowBounds)}`);
    await assertNoHorizontalOverflow(options, 'dark-narrow-service');
    await narrowLimits.evaluate(node => {
      const scroller = node.closest('.catalog-layout');
      if (scroller) {
        scroller.scrollTop += node.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12;
      }
    });
    const visibleFields = await narrowLimits.evaluate(node => {
      const scroller = node.closest('.catalog-layout').getBoundingClientRect();
      return [...node.querySelectorAll('input[role="spinbutton"]')].map(input => {
        const box = input.getBoundingClientRect();
        return {label: input.getAttribute('aria-label'), top: box.top, bottom: box.bottom,
          visible: box.top >= scroller.top && box.bottom <= scroller.bottom};
      });
    });
    assert.equal(visibleFields.length, 3);
    assert(visibleFields.every(field => field.visible), `窄屏表单被遮挡: ${JSON.stringify(visibleFields)}`);
    report.narrowVisibleFields = visibleFields;
    await screenshot(options, 'deepseek-dark-narrow', false);
    const narrowComponentShot = path.join(args.artifactsDir, 'deepseek-dark-narrow-request-limits.png');
    await narrowLimits.screenshot({path: narrowComponentShot, animations: 'disabled'});
    report.screenshots.push(narrowComponentShot);
    report.cases.push({id: 'dark-narrow-no-overflow', ok: true});

    await options.close();
    const reopened = await createPage(`${extensionOrigin}/options.html#settings-services`, 'options-reopened');
    await reopened.setViewportSize({width: 1440, height: 960});
    await reopened.locator('[data-service-value="deepseek"]').first().click();
    const reopenedConfig = await reopened.evaluate(async () => {
      const result = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      return typeof result.value === 'string' ? JSON.parse(result.value) : result.value;
    });
    assert.equal(reopenedConfig.translationRequestsPerSecond, 7);
    report.quickClose = {ok: true, persistedGlobalPerSecond: reopenedConfig.translationRequestsPerSecond};
    report.crossPageSync = {ok: true, service: reopenedConfig.service};
    await screenshot(reopened, 'request-limits-reopened-persistent');
    report.ok = report.consoleErrors.length === 0;
    assert.equal(report.ok, true, `浏览器控制台存在错误: ${JSON.stringify(report.consoleErrors)}`);
  } catch (error) {
    report.failure = error.stack || String(error);
    if (currentPage && !currentPage.isClosed()) {
      await screenshot(currentPage, 'failure').catch(() => {});
    }
    throw error;
  } finally {
    fs.writeFileSync(path.join(args.artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
    await launched?.context?.close().catch(() => {});
  }
}

main().catch(error => {
  console.error(`[issue-521-ui] ${error.stack || error}`);
  process.exitCode = 1;
});

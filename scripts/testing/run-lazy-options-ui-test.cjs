'use strict';

/**
 * @file scripts/testing/run-lazy-options-ui-test.cjs
 * 文件职责：在隔离 Edge 中验证 Options 按需分区挂载、深链接、配置持久化以及 Popup 基础交互。
 * 主要内容：确认首次通用设置不创建未访问的服务、视频、界面、数据和学习组件，依次访问这些分区后返回仍保留实例；验证布尔开关快速关闭、重开和 Popup 跨页面同步，并覆盖服务选择器、抽屉、About 互斥显示与异步深链接。
 * 模块边界：只操作本次临时 profile 和真实扩展页面，不请求真实翻译服务，不连接用户浏览器，不替代完整设置中心回归。
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const extensionDir = path.resolve(argument('extension-dir', '.output/chrome-mv3'));
const playwrightRoot = path.resolve(argument('playwright-root', ''));
const focusHelper = path.resolve(argument('focus-safe-helper', ''));
const artifactsDir = path.resolve(argument('artifacts-dir', '/private/tmp/fluentread-lazy-options-ui'));
const browserPath = argument('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
const timeout = Number(argument('timeout', '30000'));
const suite = argument('suite', 'lazy-sections');
assert.ok(['lazy-sections', 'hotkeys'].includes(suite), 'suite 仅支持 lazy-sections 或 hotkeys');

assert.ok(fs.existsSync(path.join(extensionDir, 'manifest.json')), `扩展产物不存在：${extensionDir}`);
assert.ok(fs.existsSync(focusHelper), `防抢焦点 helper 不存在：${focusHelper}`);
assert.ok(playwrightRoot, '缺少 --playwright-root');
assert.ok(Number.isFinite(timeout) && timeout >= 1000, `timeout 无效：${timeout}`);
fs.mkdirSync(artifactsDir, {recursive: true});

const {chromium} = require(path.join(playwrightRoot, 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground} = require(focusHelper);
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const optionsPath = manifest.options_page || manifest.options_ui?.page;
const popupPath = manifest.action?.default_popup || manifest.browser_action?.default_popup;
assert.ok(optionsPath, '扩展清单缺少 Options 入口');
assert.ok(popupPath, '扩展清单缺少 Popup 入口');

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-lazy-options-'));
const report = {
  ok: false,
  extensionDir,
  suite,
  manifest: {options: optionsPath, popup: popupPath, version: manifest.version},
  cases: [],
  screenshots: [],
  consoleErrors: [],
  lazyMount: {},
  persistenceCases: [],
  quickClose: false,
  latestWriteWins: false,
  crossPageSync: false,
  deepLink: false,
  popup: {},
};
let session;

function saveReport() {
  fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
}

function attachDiagnostics(page, label) {
  page.on('pageerror', error => report.consoleErrors.push({label, type: 'pageerror', error: error.message}));
  page.on('console', message => {
    if (message.type() === 'error') report.consoleErrors.push({label, type: 'console', error: message.text()});
  });
}

async function screenshot(page, name) {
  const target = path.join(artifactsDir, `${name}.png`);
  await page.screenshot({path: target, fullPage: false});
  report.screenshots.push(target);
  return target;
}

function parseConfigResponse(response) {
  assert.ok(response?.success !== false, `配置读取失败：${response?.error || '未知错误'}`);
  const value = typeof response.value === 'string' ? JSON.parse(response.value) : response.value;
  assert.ok(value && typeof value === 'object', '配置读取结果不是对象');
  return value;
}

async function readConfig(page) {
  const response = await page.evaluate(() => chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'}));
  return parseConfigResponse(response);
}

async function persistConfig(page, patch, clientId) {
  const current = await readConfig(page);
  const response = await page.evaluate(({current, patch, clientId}) => chrome.runtime.sendMessage({
    type: 'persistConfig',
    mode: 'replace',
    config: {...current, ...patch},
    clientId,
    sequence: Date.now(),
    baseRevision: current.__fluentConfigRevision,
  }), {current, patch, clientId});
  assert.equal(response?.success, true, `配置写入失败：${response?.error || '未知错误'}`);
  return {...current, ...patch};
}

async function openExtensionPage(context, url, label) {
  const page = await newPageWithoutForeground(context, timeout);
  attachDiagnostics(page, label);
  await page.goto(url, {waitUntil: 'domcontentloaded', timeout});
  return page;
}

async function waitForOptionsReady(page) {
  await page.locator('#settings-general [data-testid="default-translation-service-card"]').waitFor({state: 'visible', timeout});
}

async function navigateOptions(page, id) {
  await page.locator(`nav button[data-section="${id}"]`).click();
  await page.waitForFunction(expected => location.hash === `#${expected}`, id, {timeout});
  await page.waitForTimeout(250);
}

async function visible(locator) {
  return locator.count().then(async count => count > 0 && locator.first().isVisible());
}

(async () => {
  try {
    session = await launchFocusSafePersistentContext({
      chromium,
      profileDir,
      browserPath,
      headless: false,
      background: true,
      displayTarget: argument('display', 'secondary'),
      viewport: {width: 1440, height: 1000},
      timeout,
      browserArgs: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    Object.assign(report, {
      launchMode: session.launchMode,
      focusPolicy: session.focusPolicy,
      windowPlacement: session.windowPlacement,
    });
    assert.equal(report.windowPlacement.browserFrontmost, false);

    const context = session.context;
    const worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://'))
      || await context.waitForEvent('serviceworker', {timeout, predicate: item => item.url().startsWith('chrome-extension://')});
    const extensionOrigin = `chrome-extension://${new URL(worker.url()).host}`;
    const optionsUrl = `${extensionOrigin}/${optionsPath}`;
    const popupUrl = `${extensionOrigin}/${popupPath}`;

    let page = await openExtensionPage(context, `${optionsUrl}#settings-general`, 'options');
    await waitForOptionsReady(page);
    await persistConfig(page, {
      uiLanguage: 'zh-CN',
      uiLanguageSetupCompleted: true,
      theme: 'light',
      on: true,
      service: 'freeTranslation',
      favoriteServices: [],
      customOpenAIProviders: [],
    }, `lazy-options-seed-${process.pid}`);
    await page.reload({waitUntil: 'domcontentloaded'});
    await waitForOptionsReady(page);

    if (suite === 'hotkeys') {
      await navigateOptions(page, 'settings-harness');
      await page.locator('#settings-harness').getByRole('radio', {name: '快捷键', exact: true}).click();
      await page.locator('.harness-hotkey-button').click();
      const dialog = page.getByRole('dialog', {name: '自定义快捷键', exact: true});
      await dialog.waitFor({state: 'visible', timeout});
      await dialog.getByRole('button', {name: 'F9', exact: true}).click();
      await dialog.getByRole('button', {name: '确认', exact: true}).click();
      await dialog.waitFor({state: 'hidden', timeout});
      await page.waitForFunction(() => document.querySelector('.harness-hotkey-button')?.textContent?.trim() === 'F9');
      assert.equal((await readConfig(page)).harness.customHotkey, 'F9');
      report.cases.push('lazy-harness-hotkey-dialog-confirms-and-persists');
      await navigateOptions(page, 'settings-translation');
      await page.getByTestId('quick-profile-add-hover').click();
      await dialog.waitFor({state: 'visible', timeout});
      await dialog.getByRole('button', {name: 'F10', exact: true}).click();
      await dialog.getByRole('button', {name: '确认', exact: true}).click();
      await dialog.waitFor({state: 'hidden', timeout});
      assert.equal((await readConfig(page)).quickTranslationProfiles.some(profile => profile.hotkey === 'F10'), true);
      report.cases.push('lazy-quick-profile-hotkey-dialog-confirms-and-persists');
      await screenshot(page, 'lazy-hotkeys');
      assert.deepEqual(report.consoleErrors, []);
      report.ok = true;
      return;
    }

    const initialState = await page.evaluate(() => ({
      hiddenSelectors: {
        services: document.querySelector('#settings-services') === null && document.querySelector('.service-catalog') === null,
        video: document.querySelector('#settings-video') === null && document.querySelector('.video-model-management') === null,
        interface: document.querySelector('#settings-interface') === null && document.querySelector('.interface-font-settings') === null,
        data: document.querySelector('#settings-data') === null,
        learning: document.querySelector('#settings-vocabulary') === null,
        usage: document.querySelector('#settings-model-usage') === null,
      },
      visibleAbout: [...document.querySelectorAll('#settings-about')].filter(node => getComputedStyle(node).display !== 'none').length,
      visibleGeneral: Boolean(document.querySelector('#settings-general')?.getClientRects().length),
    }));
    assert.deepEqual(initialState.hiddenSelectors, {
      services: true,
      video: true,
      interface: true,
      data: true,
      learning: true,
      usage: true,
    });
    assert.equal(initialState.visibleAbout, 0);
    assert.equal(initialState.visibleGeneral, true);
    report.lazyMount.initial = initialState;
    report.cases.push('first-general-mount-excludes-unvisited-sections');
    await screenshot(page, '01-general-first-use');
    const languageRow = page.getByTestId('translation-language-setting');
    const languageLayout = await languageRow.evaluate(node => {
      const label = node.querySelector('.settings-item-copy');
      const control = node.querySelector('.settings-item-control');
      const labelBox = label.getBoundingClientRect();
      const controlBox = control.getBoundingClientRect();
      return {
        label: node.querySelector('.settings-item-copy strong')?.textContent,
        redundantHeadingCount: document.querySelectorAll('#translated-display-heading').length,
        sameRow: labelBox.top < controlBox.bottom && controlBox.top < labelBox.bottom,
        controlToRight: controlBox.left > labelBox.left,
      };
    });
    assert.equal(languageLayout.label, '翻译语言');
    assert.equal(languageLayout.redundantHeadingCount, 0);
    assert.equal(languageLayout.sameRow, true);
    assert.equal(languageLayout.controlToRight, true);
    report.languageLayout = languageLayout;
    const languageScreenshot = path.join(artifactsDir, 'translation-language-single-row.png');
    await languageRow.screenshot({path: languageScreenshot});
    report.screenshots.push(languageScreenshot);
    report.cases.push('translation-language-label-and-selector-share-one-row');

    const deepLinkPage = await openExtensionPage(context, `${optionsUrl}#settings-interface`, 'options-deep-link');
    await deepLinkPage.locator('#settings-interface').waitFor({state: 'visible', timeout});
    const deepLinkState = await deepLinkPage.evaluate(() => ({
      activeId: document.querySelector('nav button[aria-current="page"]')?.getAttribute('data-section'),
      interfaceVisible: Boolean(document.querySelector('#settings-interface')?.getClientRects().length),
      servicesMounted: document.querySelector('#settings-services') !== null || document.querySelector('.service-catalog') !== null,
    }));
    assert.equal(deepLinkState.activeId, 'settings-interface');
    assert.equal(deepLinkState.interfaceVisible, true);
    assert.equal(deepLinkState.servicesMounted, false);
    report.deepLink = deepLinkState;
    report.cases.push('interface-deep-link-mounts-target-section-first');
    await screenshot(deepLinkPage, '02-interface-deep-link');
    await deepLinkPage.close();

    await navigateOptions(page, 'settings-services');
    await page.locator('.service-catalog').waitFor({state: 'visible', timeout});
    report.lazyMount.services = {mounted: true, defaultService: await page.locator('.service-catalog').getAttribute('data-default-service')};
    assert.equal(report.lazyMount.services.defaultService, 'freeTranslation');
    report.cases.push('services-loads-on-first-navigation');

    await navigateOptions(page, 'settings-video');
    await page.locator('#settings-video').waitFor({state: 'visible', timeout});
    await page.locator('.video-model-management').waitFor({state: 'visible', timeout});
    report.lazyMount.video = {mounted: true};
    report.cases.push('video-loads-on-first-navigation');

    await navigateOptions(page, 'settings-interface');
    await page.locator('#settings-interface').waitFor({state: 'visible', timeout});
    await page.locator('.interface-font-settings').waitFor({state: 'visible', timeout});
    report.lazyMount.interface = {mounted: true};
    report.cases.push('interface-loads-on-first-navigation');

    await navigateOptions(page, 'settings-data');
    await page.locator('#settings-data').waitFor({state: 'visible', timeout});
    report.lazyMount.data = {mounted: true};
    report.cases.push('data-loads-on-first-navigation');

    await navigateOptions(page, 'settings-vocabulary');
    await page.locator('#settings-vocabulary').waitFor({state: 'visible', timeout});
    await page.locator('#settings-vocabulary').evaluate(node => { node.dataset.retentionProbe = 'visited-learning'; });
    report.lazyMount.learning = {mounted: true};
    report.cases.push('learning-loads-on-first-navigation');

    await navigateOptions(page, 'settings-about');
    const aboutState = await page.evaluate(() => ({
      aboutCount: document.querySelectorAll('#settings-about').length,
      aboutVisible: [...document.querySelectorAll('#settings-about')].filter(node => Boolean(node.getClientRects().length)).length,
      generalVisible: [...document.querySelectorAll('#settings-general')].filter(node => Boolean(node.getClientRects().length)).length,
      activeId: document.querySelector('nav button[aria-current="page"]')?.getAttribute('data-section'),
    }));
    assert.equal(aboutState.aboutCount, 1);
    assert.equal(aboutState.aboutVisible, 1);
    assert.equal(aboutState.generalVisible, 0);
    assert.equal(aboutState.activeId, 'settings-about');
    report.cases.push('about-is-the-only-visible-content-branch');
    report.deepLink = true;
    await screenshot(page, '02-about-only');

    await navigateOptions(page, 'settings-general');
    await page.locator('#settings-general [data-testid="default-translation-service-card"]').waitFor({state: 'visible', timeout});
    const retained = await page.evaluate(() => ({
      services: document.querySelectorAll('#settings-services').length,
      video: document.querySelectorAll('#settings-video').length,
      interface: document.querySelectorAll('#settings-interface').length,
      data: document.querySelectorAll('#settings-data').length,
      learning: document.querySelectorAll('#settings-vocabulary').length,
    }));
    // KeepAlive 将另一顶层组件移出当前 DOM，但再次激活时复用同一实例。
    assert.deepEqual(retained, {services: 1, video: 1, interface: 1, data: 1, learning: 0});
    report.lazyMount.retainedAfterReturn = retained;
    report.cases.push('visited-sections-remain-mounted-after-return');
    await navigateOptions(page, 'settings-vocabulary');
    await page.locator('#settings-vocabulary').waitFor({state: 'visible', timeout});
    assert.equal(await page.locator('#settings-vocabulary').getAttribute('data-retention-probe'), 'visited-learning');
    report.cases.push('learning-component-retains-its-instance-after-reactivation');
    await navigateOptions(page, 'settings-general');
    await waitForOptionsReady(page);

    const generalSwitch = page.locator('#settings-general [role="switch"]').first();
    const beforeSwitch = await generalSwitch.getAttribute('aria-checked');
    await generalSwitch.locator('..').click();
    const afterSwitch = await generalSwitch.getAttribute('aria-checked');
    assert.notEqual(afterSwitch, beforeSwitch);
    await page.close();
    report.quickClose = true;
    report.persistenceCases.push({field: 'on', before: beforeSwitch, after: afterSwitch, closedImmediately: true});

    page = await openExtensionPage(context, `${optionsUrl}#settings-general`, 'options-reopen');
    await waitForOptionsReady(page);
    const reopenedSwitch = page.locator('#settings-general [role="switch"]').first();
    assert.equal(await reopenedSwitch.getAttribute('aria-checked'), afterSwitch);
    report.persistenceCases.push({field: 'on', reopened: afterSwitch});
    report.cases.push('boolean-setting-survives-immediate-options-close-and-reopen');

    const firstLatestValue = await reopenedSwitch.getAttribute('aria-checked');
    await reopenedSwitch.locator('..').click();
    const latestIntermediate = await reopenedSwitch.getAttribute('aria-checked');
    await reopenedSwitch.locator('..').click();
    const latestFinal = await reopenedSwitch.getAttribute('aria-checked');
    assert.equal(latestFinal, firstLatestValue);
    assert.notEqual(latestIntermediate, firstLatestValue);
    await page.close();
    page = await openExtensionPage(context, `${optionsUrl}#settings-general`, 'options-latest-write-reopen');
    await waitForOptionsReady(page);
    assert.equal(await page.locator('#settings-general [role="switch"]').first().getAttribute('aria-checked'), latestFinal);
    report.latestWriteWins = true;
    report.persistenceCases.push({field: 'on', rapidValues: [firstLatestValue, latestIntermediate, latestFinal], reopened: latestFinal});
    report.cases.push('rapid-consecutive-setting-writes-retain-final-value');
    await screenshot(page, '03-options-reopened-persistence');

    const popup = await openExtensionPage(context, popupUrl, 'popup');
    await popup.locator('.popup-shell[data-config-ready="true"]').waitFor({state: 'visible', timeout});
    const popupSwitch = popup.locator('.popup-shell [role="switch"]').first();
    assert.equal(await popupSwitch.getAttribute('aria-checked'), latestFinal);
    report.crossPageSync = true;
    report.popup.mount = true;
    report.cases.push('options-setting-is-visible-in-reopened-popup');

    if (latestFinal !== 'true') {
      await page.locator('#settings-general [role="switch"]').first().locator('..').click();
      await popup.waitForFunction(() => document.querySelector('.popup-shell [role="switch"]')?.getAttribute('aria-checked') === 'true', undefined, {timeout});
      report.cases.push('options-change-updates-an-already-open-popup');
    }

    await popup.locator('.service-field').click();
    await popup.locator('.service-picker-panel').waitFor({state: 'visible', timeout});
    assert.ok(await popup.locator('.service-option:visible').count() > 0, 'Popup 服务选择器没有可见选项');
    await popup.keyboard.press('Escape');
    await popup.locator('.service-picker-panel').waitFor({state: 'hidden', timeout});
    report.popup.servicePicker = true;
    report.cases.push('popup-service-picker-opens-and-closes-with-escape');

    await popup.locator('[data-popup-quick-feature="selection"]').click();
    await popup.getByRole('heading', {name: '划词翻译设置', exact: true}).waitFor({state: 'visible', timeout});
    const drawer = popup.locator('.popup-drawer:visible');
    assert.equal(await drawer.count(), 1);
    await drawer.getByLabel('关闭', {exact: true}).click();
    await popup.getByRole('heading', {name: '划词翻译设置', exact: true}).waitFor({state: 'hidden', timeout});
    report.popup.drawer = true;
    report.cases.push('popup-selection-drawer-opens-and-closes');
    await screenshot(popup, '04-popup-selector-and-drawer');

    assert.deepEqual(report.consoleErrors, []);
    report.ok = true;
  } catch (error) {
    report.failure = error instanceof Error ? {message: error.message, stack: error.stack} : {message: String(error)};
    report.ok = false;
    for (const [index, page] of (session?.context.pages() || []).entries()) {
      if (page.isClosed() || !page.url().startsWith('chrome-extension://')) continue;
      await screenshot(page, `failure-${index}`).catch(() => undefined);
      const dom = await page.content().catch(() => '');
      fs.writeFileSync(path.join(artifactsDir, `failure-${index}.html`), dom);
    }
  } finally {
    saveReport();
    await session?.close();
    fs.rmSync(profileDir, {recursive: true, force: true});
    saveReport();
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
})().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});

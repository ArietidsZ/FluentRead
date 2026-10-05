#!/usr/bin/env node
// 回答风格与关于页专项：真实生产扩展、独立后台 Edge，只验证布局、静态介绍和赞赏码放大，不调用模型或外部赞赏服务。
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const arg = (name, fallback) => { const index = process.argv.indexOf(`--${name}`); return index < 0 ? fallback : process.argv[index + 1]; };
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifactsDir = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-settings-preview-about'));
const {chromium} = require(path.join(arg('playwright-root'), 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground} = require(arg('focus-safe-helper'));
const report = {ok: false, extensionDir, cases: [], screenshots: [], layout: [], consoleErrors: []};

(async () => {
  fs.mkdirSync(artifactsDir, {recursive: true});
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-preview-about-edge-'));
  let launched;
  let page;
  try {
    launched = await launchFocusSafePersistentContext({chromium, profileDir, browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', background: true, headless: false, viewport: {width: 1440, height: 1000}, timeout: 30000, browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    Object.assign(report, {launchMode: launched.launchMode, focusPolicy: launched.focusPolicy, windowPlacement: launched.windowPlacement});
    assert.equal(report.launchMode, 'macos-background-cdp');
    assert.equal(report.windowPlacement.browserFrontmost, false);
    const context = launched.context;
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: 30000});
    const origin = worker.url().split('/').slice(0, 3).join('/');
    page = await newPageWithoutForeground(context, 30000);
    page.setDefaultTimeout(12000);
    page.on('pageerror', error => report.consoleErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
    const patch = async changes => {
      const response = await page.evaluate(async changes => {
        const read = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
        if (!read.success) throw Error(read.error);
        const config = typeof read.value === 'string' ? JSON.parse(read.value) : read.value;
        return chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config: changes, expected: Object.fromEntries(Object.keys(changes).map(key => [key, config[key]])), clientId: `preview-about-${crypto.randomUUID()}`, sequence: 1});
      }, changes);
      assert.equal(response.success, true, response.error);
    };
    const shot = async name => { const file = path.join(artifactsDir, `${name}.png`); await page.screenshot({path: file}); report.screenshots.push(file); };
    await page.goto(`${origin}/options.html#settings-writing`);
    await page.locator('.writing-settings').waitFor();
    await patch({uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, animations: false, theme: 'light'});
    await page.reload();
    const choices = page.locator('.writing-style-controls');
    const sample = page.locator('.style-preview');
    for (const width of [1440, 1024, 820, 390]) {
      await page.setViewportSize({width, height: 1000});
      await page.locator('.writing-default-style').scrollIntoViewIfNeeded();
      const settingsBox = await choices.boundingBox(); const previewBox = await sample.boundingBox();
      assert(settingsBox && previewBox);
      if (width > 1100) {
        assert(previewBox.x + previewBox.width < settingsBox.x, 'preview is on the left');
        assert(Math.abs(previewBox.y - settingsBox.y) < 2, 'columns align at the top');
        assert(settingsBox.width >= previewBox.width, 'choices retain their wider column');
      } else assert(previewBox.y + previewBox.height < settingsBox.y, 'preview precedes settings on narrow screens');
      assert(await page.locator('.writing-settings').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      report.layout.push({width, previewBox, settingsBox});
      await shot(`writing-${width}`);
    }
    await page.setViewportSize({width: 1440, height: 1000});
    const before = await sample.locator('.preview-body').innerText();
    await choices.getByRole('radiogroup', {name: '您的角色', exact: true}).getByRole('radio', {name: '维护者', exact: true}).click();
    await page.waitForFunction(previous => document.querySelector('.style-preview .preview-body')?.textContent.trim() !== previous, before);
    assert.notEqual(await sample.locator('.preview-body').innerText(), before);
    report.cases.push('left-preview-right-settings, narrow stacking and live preview');

    await page.goto(`${origin}/options.html#settings-about`);
    const list = page.locator('.about-features');
    await list.waitFor();
    assert.equal(await list.locator('li').count(), 3);
    assert.equal(await list.locator('button, a, [role="button"], [tabindex]').count(), 0);
    for (const item of await list.locator('li').all()) {
      assert.equal(await item.locator('svg').count(), 1, 'only the feature icon remains');
      assert.notEqual(await item.evaluate(el => getComputedStyle(el).cursor), 'pointer');
      await item.click();
      assert.equal(page.url(), `${origin}/options.html#settings-about`);
    }
    report.cases.push('three static descriptions without arrows or navigation');
    await shot('about-static-descriptions');

    const trigger = page.locator('.about-support-wechat');
    const dialog = page.locator('.about-approve-dialog');
    const open = async () => {
      const pageCount = context.pages().length;
      await trigger.click(); await dialog.waitFor({state: 'visible'});
      await page.waitForFunction(() => !document.querySelector('.dialog-fade-enter-active'));
      await dialog.locator('img').evaluate(image => image.decode());
      assert.equal(page.url(), `${origin}/options.html#settings-about`);
      assert.equal(context.pages().length, pageCount, 'opening the image does not create a tab');
      const bounds = await dialog.boundingBox();
      assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= (await page.viewportSize()).width + 1 && bounds.y + bounds.height <= (await page.viewportSize()).height + 1, 'dialog stays in the viewport');
      assert((await dialog.locator('img').boundingBox()).width > (await trigger.locator('img').boundingBox()).width, 'the preview enlarges the code');
    };
    const closed = async () => { await dialog.waitFor({state: 'hidden'}); await page.waitForFunction(() => document.activeElement === document.querySelector('.about-support-wechat')); };
    await open(); await shot('wechat-preview-desktop');
    await page.keyboard.press('Tab');
    assert(await dialog.evaluate(el => el.contains(document.activeElement)), 'focus stays inside the dialog');
    await page.keyboard.press('Escape'); await closed();
    await open(); await dialog.locator('.el-dialog__headerbtn').click(); await closed();
    await open(); await page.locator('.el-overlay-dialog').click({position: {x: 5, y: 5}}); await closed();
    for (const theme of ['light', 'dark']) {
      await patch({theme}); await page.setViewportSize({width: 390, height: 844});
      await open(); await shot(`wechat-preview-mobile-${theme}`);
      await page.keyboard.press('Escape'); await closed();
    }
    await page.setViewportSize({width: 1440, height: 1000});
    for (const [locale, expected] of [['zh-CN', '放大微信赞赏码'], ['en-US', 'Enlarge the WeChat support code'], ['ja-JP', 'WeChat 支援コードを拡大'], ['ko-KR', 'WeChat 후원 코드 확대'], ['fr-FR', 'Agrandir le code de soutien WeChat'], ['ru-RU', 'Увеличить код поддержки WeChat'], ['es-ES', 'Ampliar el código de apoyo de WeChat']]) {
      await patch({uiLanguage: locale});
      await page.waitForFunction(expected => document.querySelector('.about-support-wechat')?.getAttribute('aria-label') === expected, expected);
      const label = await trigger.getAttribute('aria-label');
      assert(label && (locale === 'zh-CN' || !/[\u4e00-\u9fff]/u.test(label) || locale === 'ja-JP'), `translated trigger ${locale}`);
      await open(); await page.keyboard.press('Escape'); await closed();
    }
    report.cases.push('in-page enlarged image, no new tab, focus trap and return, Escape/button/mask close, mobile light/dark, seven UI languages');
    assert.equal(report.consoleErrors.length, 0, JSON.stringify(report.consoleErrors));
    report.ok = true;
  } catch (error) {
    report.error = error.stack;
    if (page && !page.isClosed()) await page.screenshot({path: path.join(artifactsDir, 'failure.png')}).catch(() => {});
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
    if (launched) await launched.close();
    fs.rmSync(profileDir, {recursive: true, force: true});
    console.log(JSON.stringify(report, null, 2));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

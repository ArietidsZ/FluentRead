'use strict';
/**
 * @file scripts/testing/run-settings-reading-menu-ui-test.cjs
 * 文件职责：在生产扩展中专项验证阅读辅助、右键菜单、设置框标题和补齐后的页内导航。
 * 主要内容：通过隔离 Edge 检查三行布局与虚线、真实样式跳转、高亮联动、左侧预览与右侧开关、场景键盘切换、依赖禁用、保存重开、完整导航，以及七种语言的桌面和窄屏布局。
 * 模块边界：只操作本次临时 profile，使用不抢焦点 helper，不下载模型或调用翻译，不推断 Firefox 实机表现。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1]; };
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifacts = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-settings-refinement-production'));
const {chromium} = require(path.join(arg('playwright-root'), 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground, activateExtensionTabWithoutForeground} = require(arg('focus-safe-helper'));
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-reading-menu-ui-'));
fs.mkdirSync(artifacts, {recursive: true});
const report = {ok: false, artifact: 'production', extensionDir, caseCoverage: [], layouts: [], screenshots: [], consoleErrors: []};
let session, page, base;
const save = () => fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
async function shot(locator, name) {
  const original = page.viewportSize();
  const height = Math.ceil(await locator.evaluate(el => el.getBoundingClientRect().height));
  if (height + 120 > original.height) await page.setViewportSize({width: original.width, height: height + 120});
  await locator.scrollIntoViewIfNeeded();
  const file = path.join(artifacts, `${name}.png`);
  await locator.screenshot({path: file}); report.screenshots.push(file);
  if (height + 120 > original.height) await page.setViewportSize(original);
}
async function config() {
  return page.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
    if (!response.success) throw new Error(response.error);
    return typeof response.value === 'string' ? JSON.parse(response.value) : response.value;
  });
}
async function patch(values) {
  const current = await config();
  const expected = Object.fromEntries(Object.keys(values).map(key => [key, current[key]]));
  const response = await page.evaluate(({values, expected}) => chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config: values, expected}), {values, expected});
  assert(response.success, response.error);
  await page.waitForFunction(async values => {
    const response = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
    const current = typeof response.value === 'string' ? JSON.parse(response.value) : response.value;
    return Object.entries(values).every(([key, value]) => JSON.stringify(current[key]) === JSON.stringify(value));
  }, values);
}
async function navigate(section) {
  if (await page.locator('.mobile-settings-navigation').isVisible()) await page.locator('.mobile-settings-navigation').selectOption(section);
  else await page.locator(`.sidebar [data-section="${section}"]`).click();
  await page.waitForFunction(id => location.hash === `#${id}`, section);
}
async function anchor(id) {
  await page.locator(`[data-settings-anchor-link="${id}"]`).click();
  await page.waitForFunction(id => {
    const container = document.querySelector('.settings-card');
    const target = [...container.querySelectorAll('[data-settings-panel], [data-settings-anchor]')]
      .find(el => (el.dataset.settingsAnchor || el.dataset.settingsPanel) === id && el.getClientRects().length);
    const top = container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top - container.clientTop - 2;
    return Math.abs(container.scrollTop - Math.max(0, Math.min(top, container.scrollHeight - container.clientHeight))) < 4
      && document.querySelector(`[data-settings-anchor-link="${id}"]`)?.getAttribute('aria-current') === 'location';
  }, id);
}
async function layout(label) {
  const metrics = await page.evaluate(() => {
    const c = document.querySelector('.settings-card');
    return {width: innerWidth, documentWidth: document.documentElement.scrollWidth, contentWidth: c.clientWidth, contentScrollWidth: c.scrollWidth};
  });
  assert(metrics.documentWidth <= metrics.width + 1 && metrics.contentScrollWidth <= metrics.contentWidth + 1, `${label}: horizontal overflow`);
  for (const selector of ['.settings-card-heading', '.context-menu-workspace', '.context-menu-entry', '.reading-assistance-settings']) {
    const bad = await page.locator(`${selector}:visible`).evaluateAll(nodes => nodes.filter(el => el.scrollWidth > el.clientWidth + 1).map(el => ({text: el.textContent.slice(0, 60), width: el.clientWidth, scroll: el.scrollWidth})));
    assert.deepEqual(bad, [], `${label}: ${selector} overflow`);
  }
  report.layouts.push({label, ...metrics});
}
(async () => {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
    report.manifest = {options: manifest.options_page || manifest.options_ui?.page, popup: manifest.action?.default_popup};
    assert(report.manifest.options && report.manifest.popup);
    session = await launchFocusSafePersistentContext({chromium, profileDir, background: true, headless: false, displayTarget: 'secondary',
      browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', viewport: {width: 1440, height: 960}, timeout: 30000,
      browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    assert.equal(report.launchMode, 'macos-background-cdp'); assert.equal(report.windowPlacement.browserFrontmost, false);
    const worker = session.context.serviceWorkers()[0] || await session.context.waitForEvent('serviceworker', {timeout: 30000});
    base = worker.url().match(/^chrome-extension:\/\/[^/]+/)[0];
    page = await newPageWithoutForeground(session.context, 30000);
    await page.setViewportSize({width: 1440, height: 960});
    page.on('pageerror', error => report.consoleErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
    await page.goto(`${base}/${report.manifest.options}`);
    await page.locator('.settings-group').first().waitFor();
    await activateExtensionTabWithoutForeground(session.context, page);
    await patch({uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, theme: 'light', interfaceSkin: 'default', animations: false, display: 1,
      bilingualSentenceHighlightEnabled: true, contextMenuEnabled: true, selectionTranslatorMode: 'bilingual', disableSelectionTranslator: false,
      disableImageTranslator: false, imageTranslationContextMenuEnabled: true, selectionAreaEnabled: true,
      contextMenuEntries: {translateSelection: true, translatePage: true, translateArea: false, toggleSite: false}});
    await page.reload();
    await navigate('settings-translation');
    const ids = ['reading', 'hover', 'input', 'page', 'context-menu', 'floating-ball', 'paragraph-copy', 'section-translation', 'excluded-languages'];
    assert.deepEqual(await page.locator('.settings-section-navigation button').evaluateAll(nodes => nodes.map(n => n.dataset.settingsAnchorLink)), ids);
    for (const id of ids) { await anchor(id); report.caseCoverage.push({navigation: id}); }
    await anchor('reading');
    const reading = page.locator('.reading-assistance-settings');
    const rows = reading.locator('.settings-group-body > .settings-item');
    assert.equal(await rows.count(), 3);
    assert.equal(await rows.nth(0).locator('small').innerText(), '双语模式下，将鼠标移到原文或译文上，即可高亮对应句子，方便对照阅读。 注意，当原文与译文的句子划分不同时，会一起高亮相邻句子。');
    for (const i of [1, 2]) assert.equal(await rows.nth(i).evaluate(el => getComputedStyle(el).borderTopStyle), 'dashed');
    const source = reading.getByTestId('bilingual-highlight-preview-source').locator('span');
    await source.nth(1).hover();
    assert.equal(await reading.locator('.is-sentence-highlighted').count(), 2);
    await reading.locator('.el-switch').click();
    assert.equal(await reading.locator('.is-sentence-highlighted').count(), 0);
    await reading.locator('.el-switch').click();
    await source.first().focus();
    assert.equal(await reading.locator('.is-sentence-highlighted').count(), 2);
    await shot(reading, 'reading-assistance-light');
    const styleLink = reading.getByTestId('open-sentence-highlight-styles');
    assert.equal(await styleLink.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
    await styleLink.click();
    await page.waitForFunction(() => location.hash === '#settings-interface');
    await page.locator('#translation-sentence-highlight-style').waitFor({state: 'visible'});
    report.caseCoverage.push({readingRows: 3, separators: 'dashed', highlightToggleAndKeyboard: true, styleNavigation: true});
    await navigate('settings-translation'); await anchor('hover');
    const heading = page.locator('[data-settings-panel="hover"] .settings-group-heading');
    const sizes = await heading.evaluate(el => {
      const h = el.querySelector('h2'), p = el.querySelector('p');
      return {titleSize: parseFloat(getComputedStyle(h).fontSize), descriptionSize: parseFloat(getComputedStyle(p).fontSize),
        inline: Math.abs(h.getBoundingClientRect().top - p.getBoundingClientRect().top) < 4, marker: getComputedStyle(el, '::before').content};
    });
    assert(sizes.titleSize > sizes.descriptionSize && sizes.inline && sizes.marker !== 'none');
    report.caseCoverage.push({groupHeading: sizes});
    await shot(page.locator('[data-settings-panel="hover"]'), 'hover-group-light');
    await anchor('context-menu');
    const menu = page.locator('.context-menu-settings');
    const preview = menu.locator('.context-menu-preview'), settings = menu.locator('.context-menu-entry-grid');
    const positions = await menu.evaluate(el => {
      const a = el.querySelector('.context-menu-preview').getBoundingClientRect();
      const b = el.querySelector('.context-menu-entry-grid').getBoundingClientRect();
      return {previewRight: a.right, settingsLeft: b.left, topDifference: Math.abs(a.top - b.top)};
    });
    assert(positions.previewRight <= positions.settingsLeft && positions.topDifference < 2, 'Preview must be left of settings');
    const radios = preview.getByRole('radio');
    for (const [index, scene] of ['selection', 'page', 'image'].entries()) {
      await radios.nth(index).click();
      assert.equal(await preview.locator('.context-menu-preview-stage').getAttribute('data-preview-scene'), scene);
      assert.equal(await preview.locator('.context-menu-preview-list li').count(), 1);
    }
    await radios.first().focus(); await radios.first().press('ArrowRight');
    assert.equal(await radios.nth(1).getAttribute('aria-checked'), 'true');
    const entry = id => menu.locator(`[data-context-menu-entry="${id}"] .el-switch`);
    await entry('translatePage').click();
    assert.equal(await preview.locator('.context-menu-preview-list').count(), 0);
    await entry('translateArea').click();
    await preview.locator('.context-menu-preview-list').waitFor();
    assert((await preview.locator('.context-menu-preview-list').innerText()).includes('截图翻译屏幕区域'));
    await entry('translatePage').click();
    assert((await preview.locator('.context-menu-preview-list').innerText()).includes('翻译全文'));
    await radios.nth(2).click(); await entry('translateImage').click();
    assert.equal(await preview.locator('.context-menu-preview-list').count(), 0);
    await entry('translateImage').click();
    const master = menu.locator('.settings-group-body > .settings-item .el-switch');
    await master.click();
    assert.equal(await preview.locator('.context-menu-preview-list').count(), 0);
    assert.equal(await settings.locator('.el-switch.is-disabled').count(), 5);
    await master.click(); await radios.nth(1).click();
    await shot(menu, 'context-menu-light');
    await layout('zh-CN light 1440');
    await page.reload(); await anchor('context-menu');
    const saved = await config();
    assert.equal(saved.contextMenuEntries.translateArea, true); assert.equal(saved.contextMenuEnabled, true); assert.equal(saved.imageTranslationContextMenuEnabled, true);
    assert.equal(saved.bilingualSentenceHighlightEnabled, true);
    report.caseCoverage.push({menuPreviewLeft: true, entryGrid: 5, scenes: 3, keyboardScenes: true, pageAreaPriority: true, masterDisabled: true, reopenedPersistence: true});
    for (const language of ['zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'ru-RU', 'es-ES']) {
      await patch({uiLanguage: language});
      for (const width of [1440, 390]) {
        await page.setViewportSize({width, height: 960}); await layout(`${language} light ${width}`);
        if (language === 'zh-CN' || language === 'en-US') {
          await anchor('context-menu'); await shot(menu, `context-menu-${language}-${width}`);
          await anchor('reading'); await shot(reading, `reading-assistance-${language}-${width}`);
        }
      }
    }
    await patch({uiLanguage: 'zh-CN', theme: 'dark'}); await page.setViewportSize({width: 1440, height: 960});
    await anchor('context-menu'); await shot(menu, 'context-menu-dark');
    await anchor('reading'); await shot(reading, 'reading-assistance-dark'); await layout('zh-CN dark 1440');
    for (const section of ['settings-general', 'settings-interface', 'settings-sites', 'settings-image-translation', 'settings-data']) {
      await navigate(section);
      for (const width of [1440, 820, 390]) {
        await page.setViewportSize({width, height: 960}); await layout(`${section} dark ${width}`);
      }
      await page.setViewportSize({width: 1440, height: 960});
      const headings = page.locator('.settings-card-heading:visible');
      assert(await headings.count() > 0);
      await shot(headings.first(), `${section}-heading-dark`);
    }
    assert.deepEqual(report.consoleErrors, []);
    report.ok = true;
  } catch (error) {
    report.failure = error.stack || String(error);
    if (page) await page.screenshot({path: path.join(artifacts, 'failure.png')}).catch(() => {});
    process.exitCode = 1;
  } finally {
    save();
    await session?.close().catch(() => {});
    fs.rmSync(profileDir, {recursive: true, force: true});
    console.log(JSON.stringify(report, null, 2));
  }
})();

#!/usr/bin/env node
'use strict';

// Production extension, temporary Edge profile and deterministic loopback provider.
// Fixtures independently reproduce Epoch navigation/footer, workflow controls,
// tree/tabs, expanded content and a dynamically mounted portal. This is deliberately
// separate from real-site/provider matrix evidence.
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const {createHash} = require('node:crypto');
const {startTranslationFixtureServer} = require('./run-full-page-translation-test.cjs');

function parseArgs(argv) {
  const args = {timeout: 45000, liveEpoch: false, allowNetwork: false, browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--background') continue;
    if (key === '--live-epoch') {args.liveEpoch = true;continue;}
    if (key === '--live-only') {args.liveOnly = true;args.liveEpoch = true;continue;}
    if (key === '--allow-network') {args.allowNetwork = true;continue;}
    if (!key.startsWith('--') || key === '--headed') throw new Error('此脚本仅允许不抢焦点的 --background 隔离浏览器');
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`参数缺少值：${key}`);
    args[key.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  for (const key of ['extensionDir', 'playwrightRoot', 'focusSafeHelper', 'artifactsDir']) {
    if (!args[key]) throw new Error(`缺少 ${key}`);
    args[key] = path.resolve(args[key]);
  }
  args.timeout = Number(args.timeout);
  if (!Number.isFinite(args.timeout) || args.timeout <= 0) throw new Error('timeout 必须为正数');
  if (args.liveEpoch && !args.allowNetwork) throw new Error('--live-epoch 必须显式传入 --allow-network');
  return args;
}

async function installProvider(worker, translationUrl, blockedUrl) {
  await worker.evaluate(({translationUrl, blockedUrl}) => {
    if (globalThis.__frAllNodesFixtureInstalled) return;
    const original = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
      if (url.hostname === 'edge.microsoft.com' && url.pathname === '/translate/translatetext') {
        return original(input instanceof Request ? new Request(translationUrl, input) : translationUrl, init);
      }
      if (/^https?:$/.test(url.protocol) && !['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
        return original(`${blockedUrl}?url=${encodeURIComponent(url.href)}`);
      }
      return original(input, init);
    };
    globalThis.__frAllNodesFixtureInstalled = true;
  }, {translationUrl, blockedUrl});
}

async function configure(popup) {
  return popup.evaluate(async () => {
    const send = message => new Promise((resolve, reject) => chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else resolve(response);
    }));
    const stored = await send({type: 'configStorageRead', key: 'local:config'});
    if (!stored.success) throw new Error(stored.error || '读取配置失败');
    const config = typeof stored.value === 'string' ? JSON.parse(stored.value) : stored.value;
    const revision = config.__fluentConfigRevision;
    for (const key of Object.keys(config)) if (key.startsWith('__fluentConfig')) delete config[key];
    Object.assign(config, {on: true, display: 1, service: 'freeTranslation', uiLanguage: 'zh-CN',
      uiLanguageSetupCompleted: true, contextMenuEnabled: true, fullPageTranslationMode: 'all', mouseHoverTranslationDelay: 0});
    const result = await send({type: 'persistConfig', config, clientId: 'all-nodes-browser-fixture', sequence: 1, baseRevision: revision});
    if (!result.success) throw new Error(result.error || '配置未保存');
    return {service: config.service, display: config.display, fullPageTranslationMode: config.fullPageTranslationMode, uiLanguage: config.uiLanguage};
  });
}

async function action(popup, url, actionName) {
  return popup.evaluate(async ({url, actionName}) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(tab => tab.url === url);
    if (!tab?.id) throw new Error('找不到隔离 fixture 页签');
    const response = await chrome.tabs.sendMessage(tab.id, {type: 'contextMenuTranslate', action: actionName});
    if (response?.status !== 'success') throw new Error(`翻译动作 ${actionName} 失败: ${JSON.stringify(response)}`);
    return response;
  }, {url, actionName});
}

async function snapshot(page) {
  return page.evaluate(() => {
    const wrapper = '.fluent-read-bilingual-content';
    const tracked = [...document.querySelectorAll('[data-all-node], [data-dynamic-node], #article-body, #workflow-body, #project-body')];
    return {
      count: document.querySelectorAll(wrapper).length,
      translatedLabels: tracked.filter(e => !e.querySelector(wrapper) && /[\u3400-\u9fff]/u.test(e.textContent)).length,
      nested: document.querySelectorAll(`${wrapper} ${wrapper}`).length,
      duplicateParents: [...new Set([...document.querySelectorAll(wrapper)].map(e => e.parentElement))]
        .filter(e => e.querySelectorAll(':scope > .fluent-read-bilingual-content').length > 1).map(e => e.id || e.tagName),
      nodes: Object.fromEntries(tracked.map(e => [e.id, {count: e.querySelectorAll(wrapper).length, text: e.textContent, visible: !!e.getClientRects().length}])),
      protected: Object.fromEntries([...document.querySelectorAll('[data-protected]')].map(e => [e.id, {html: e.innerHTML, value: e.value ?? null}])),
      links: Object.fromEntries([...document.querySelectorAll('a')].map(e => [e.id, {href: e.getAttribute('href'), target: e.getAttribute('target'), rel: e.getAttribute('rel')}])),
      identityPreserved: !window.__fixtureOriginalElements || window.__fixtureOriginalElements.every(([id, element]) => document.getElementById(id) === element),
      events: {...window.fixtureEvents},
      url: location.href,
    };
  });
}

function assertInvariant(current, baseline, phase) {
  assert.equal(current.nested, 0, `${phase}: nested translation wrappers`);
  assert.deepEqual(current.duplicateParents, [], `${phase}: repeated wrappers`);
  assert.deepEqual(current.protected, baseline.protected, `${phase}: protected input/code/exclusion changed`);
  assert.deepEqual(current.links, baseline.links, `${phase}: link attributes changed`);
  assert.equal(current.identityPreserved, true, `${phase}: application element identity changed`);
  assert.equal(current.url, baseline.url, `${phase}: unexpected navigation`);
}

async function waitForNodes(page, ids, expectedCount, timeout, controlIds = []) {
  try {
    await page.waitForFunction(({ids, expectedCount, controlIds}) => ids.every(id => {
      const node = document.getElementById(id);
      const translations = node?.querySelectorAll('.fluent-read-bilingual-content');
      if (expectedCount === 1 && controlIds.includes(id)) {
        return translations?.length === 0 && /[\u3400-\u9fff]/u.test(node.textContent);
      }
      return translations?.length === expectedCount && (expectedCount === 0 || [...translations].every(e => /[\u3400-\u9fff]/u.test(e.textContent)));
    }), {ids, expectedCount, controlIds}, {timeout});
  } catch (error) {
    throw new Error(`${error.message}\nNode states: ${JSON.stringify((await snapshot(page)).nodes)}`);
  }
}

async function clickInteractions(page) {
  for (const id of ['workflow-save', 'epoch-contact', 'epoch-graph', 'tab-history']) await page.locator(`#${id}`).click();
}

async function runLiveEpoch(page, popup, context, helper, args) {
  const url = 'https://epoch.ai/data/ai-data-centers';
  const pageErrors = [];
  const recordError = error => pageErrors.push(error.message);
  page.on('pageerror', recordError);
  await page.goto(url, {waitUntil: 'domcontentloaded', timeout: args.timeout});
  await page.waitForSelector('nav.secondary-nav a', {timeout: args.timeout});
  await page.waitForSelector('#fluent-read-page-styles', {state: 'attached', timeout: args.timeout});
  // Epoch sends server-rendered controls before hydrating its interactive chart.
  // Wait for initial hydration, and resolve current chart nodes on each read.
  await page.waitForTimeout(3500);
  await helper.activateExtensionTabWithoutForeground(context, page, args.timeout);
  await page.evaluate(() => {
    const definitions = [
      ...[0, 1, 2, 3].map(index => ({selector: 'nav.secondary-nav a', index, dynamic: false})),
      {selector: 'footer .newsletter-title', index: 0, dynamic: false},
      ...[...document.querySelectorAll('footer a')].flatMap((element, index) =>
        element.getClientRects().length && (element.textContent.match(/\p{L}/gu)?.length || 0) >= 2
          ? [{selector: 'footer a', index, dynamic: false}] : []),
      ...[0, 1, 2].map(index => ({selector: 'button.button-tab', index, dynamic: true})),
    ];
    const controls = definitions.map(definition => ({...definition, element: document.querySelectorAll(definition.selector)[definition.index]})).filter(entry => entry.element);
    window.__epochContract = {
      controls: controls.map(({element, ...definition}) => ({...definition, element, original: element.textContent, href: element.getAttribute('href')})),
      footerHeading: document.querySelector('footer h2.tagline'),
      inputs: [...document.querySelectorAll('input[placeholder*="Search"]')].map(element => ({element, value: element.value, placeholder: element.getAttribute('placeholder')})),
    };
  });
  const read = () => page.evaluate(() => {
    const contract = window.__epochContract;
    return {
      url: location.href,
      title: document.title,
      controls: contract.controls.map(({element: initialElement, original, href, selector, index, dynamic}) => {
        const element = document.querySelectorAll(selector)[index];
        return {original, text: element?.textContent, wrapperCount: element?.querySelectorAll('.fluent-read-bilingual-content').length,
          connected: element?.isConnected === true, hrefUnchanged: element?.getAttribute('href') === href,
          dynamic, remounted: element !== initialElement};
      }),
      footerHeading: {text: contract.footerHeading?.textContent, wrapperCount: contract.footerHeading?.querySelectorAll('.fluent-read-bilingual-content').length},
      inputsUnchanged: contract.inputs.every(({element, value, placeholder}) => element.isConnected && element.value === value && element.getAttribute('placeholder') === placeholder),
      wrapperCount: document.querySelectorAll('.fluent-read-bilingual-content').length,
      nestedWrappers: document.querySelectorAll('.fluent-read-bilingual-content .fluent-read-bilingual-content').length,
      duplicateParents: [...new Set([...document.querySelectorAll('.fluent-read-bilingual-content')].map(e => e.parentElement))].filter(e => e.querySelectorAll(':scope > .fluent-read-bilingual-content').length > 1).length,
    };
  });
  const baseline = await read();
  assert(baseline.controls.length >= 7, 'Epoch 实站缺少预期导航、页脚和图表控件');
  await page.screenshot({path: path.join(args.artifactsDir, 'epoch-live-before.png')});
  await action(popup, url, 'fullPage');
  await page.waitForFunction(() => !!document.querySelector('h1 .fluent-read-bilingual-content'), undefined, {timeout: args.timeout});
  const ordinary = await read();
  for (const control of ordinary.controls.slice(0, 4)) assert.equal(control.text, control.original, 'Epoch 普通模式意外修改导航');
  await page.evaluate(() => {window.__epochOriginalWrapper = document.querySelector('h1 .fluent-read-bilingual-content');});
  await action(popup, url, 'allNodes');
  try {
    await page.waitForFunction(() => window.__epochContract.controls.every(({selector, index}) => /[\u3400-\u9fff]/u.test(document.querySelectorAll(selector)[index]?.textContent || '')) &&
      !!window.__epochContract.footerHeading?.querySelector('.fluent-read-bilingual-content'), undefined, {timeout: args.timeout});
  } catch (error) {
    throw new Error(`${error.message}\nEpoch 控件状态：${JSON.stringify(await read())}`);
  }
  const translated = await read();
  assert(await page.evaluate(() => window.__epochOriginalWrapper.isConnected), 'Epoch 升级翻译丢失已有正文 wrapper');
  for (const control of translated.controls) {
    assert.equal(control.wrapperCount, 0, 'Epoch 控件应原位翻译');
    assert(control.connected && control.hrefUnchanged, 'Epoch 控件身份或链接发生变化');
    if (!control.dynamic) assert.equal(control.remounted, false, 'Epoch 静态导航和页脚元素身份变化');
  }
  assert(translated.inputsUnchanged, 'Epoch 搜索输入发生变化');
  assert.equal(translated.nestedWrappers, 0, 'Epoch 译文嵌套');
  assert.equal(translated.duplicateParents, 0, 'Epoch 译文重复');
  await page.screenshot({path: path.join(args.artifactsDir, 'epoch-live-translated-top.png')});
  await page.locator('footer').scrollIntoViewIfNeeded();
  await page.screenshot({path: path.join(args.artifactsDir, 'epoch-live-translated-footer.png')});
  await action(popup, url, 'allNodes');
  await page.waitForTimeout(500);
  const repeated = await read();
  assert.deepEqual(repeated.controls.map(e => e.text), translated.controls.map(e => e.text), 'Epoch 重复扫描重译已有控件');
  await action(popup, url, 'restore');
  await page.waitForFunction(() => !document.querySelector('.fluent-read-bilingual-content'), undefined, {timeout: args.timeout});
  const restored = await read();
  for (const control of restored.controls) assert.equal(control.text, control.original, 'Epoch 控件原文未恢复');
  assert(restored.inputsUnchanged, 'Epoch 恢复后搜索输入发生变化');
  await page.screenshot({path: path.join(args.artifactsDir, 'epoch-live-restored-footer.png')});
  page.off('pageerror', recordError);
  process.stdout.write('Epoch 实际站点导航、图表控件和页脚升级/重复/恢复契约通过。\n');
  return {evidenceType: 'live-site-production-extension-with-controlled-loopback-provider', providerQualityTested: false,
    sourceUrl: url, selectors: ['nav.secondary-nav a', 'footer .newsletter-title', 'footer a (visible readable text)', 'button.button-tab', 'footer h2.tagline'],
    baseline, ordinary, translated, repeated, restored, pageErrors};
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assert(fs.existsSync(path.join(args.extensionDir, 'manifest.json')), '缺少生产 manifest.json');
  const {chromium} = createRequire(path.join(args.playwrightRoot, '__all_nodes_loader.cjs'))('playwright');
  const helper = require(args.focusSafeHelper);
  for (const method of ['launchFocusSafePersistentContext', 'newPageWithoutForeground', 'activateExtensionTabWithoutForeground']) assert.equal(typeof helper[method], 'function');
  fs.mkdirSync(args.artifactsDir, {recursive: true});
  fs.rmSync(path.join(args.artifactsDir, 'report.json'), {force: true});
  const html = fs.readFileSync(path.join(__dirname, '../tests/fixtures/all-nodes-translation-fixture.html'));
  const server = http.createServer((request, response) => {response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});response.end(html);});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/all-nodes.html`;
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-all-nodes-'));
  const unexpectedNetwork = [];
  const provider = await startTranslationFixtureServer(unexpectedNetwork);
  const runtimeErrors = [];
  const workerErrors = [];
  let permitLivePageNetwork = false;
  let session;
  let page;
  const manifest = JSON.parse(fs.readFileSync(path.join(args.extensionDir, 'manifest.json'), 'utf8'));
  const bundleFiles = [...new Set(['manifest.json', manifest.background?.service_worker,
    ...(manifest.content_scripts || []).flatMap(entry => entry.js || [])].filter(Boolean))].sort();
  const bundleHash = createHash('sha256');
  for (const filename of bundleFiles) {bundleHash.update(filename);bundleHash.update(fs.readFileSync(path.join(args.extensionDir, filename)));}
  const report = {evidenceType: 'production-extension-equivalent-fixtures', liveSite: false,
    extensionDir: args.extensionDir, extensionBundleSha256: bundleHash.digest('hex'), extensionBundleFiles: bundleFiles,
    examples: ['Epoch semantic navigation/footer and graph controls', 'Workflow menu and action toolbar', 'Project tree and tabs', 'Expanded content and dynamic portal', 'Protected input, editor, code, math and opt-out']};
  try {
    session = await helper.launchFocusSafePersistentContext({chromium, profileDir, browserPath: args.browserPath,
      headless: false, background: true, viewport: {width: 1280, height: 900}, timeout: args.timeout,
      browserArgs: [`--disable-extensions-except=${args.extensionDir}`, `--load-extension=${args.extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    const context = session.context;
    context.on('serviceworker', worker => installProvider(worker, provider.translationUrl, provider.blockedUrl).catch(error => workerErrors.push(error.message)));
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: args.timeout});
    await installProvider(worker, provider.translationUrl, provider.blockedUrl);
    await context.route('**/*', async route => {
      const requestUrl = new URL(route.request().url());
      if (!permitLivePageNetwork && /^https?:$/.test(requestUrl.protocol) && !['127.0.0.1', 'localhost', '::1'].includes(requestUrl.hostname)) {
        unexpectedNetwork.push(requestUrl.href);await route.abort();return;
      }
      await route.continue();
    });
    const popup = await helper.newPageWithoutForeground(context, args.timeout);
    const extensionId = new URL(worker.url()).hostname;
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    report.config = await configure(popup);
    // Updating no properties checks existence without changing the registered menu.
    // Browser startup/config sync can recreate menus, so retry only this read probe.
    let menuRegistered = false;
    for (let attempt = 0; attempt < 40 && !menuRegistered; attempt += 1) {
      menuRegistered = await worker.evaluate(async () => {
        try {
          await chrome.contextMenus.update('fluent-read-translate-all-nodes', {});
          return true;
        } catch {return false;}
      });
      if (!menuRegistered) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(menuRegistered, '网页右键菜单未注册识别全部节点');
    report.entry = {surface: 'page-context-menu', menuId: 'fluent-read-translate-all-nodes',
      registrationVerified: true, nativeMenuClickTested: false, actionEvidence: 'public-content-message-route'};
    page = await helper.newPageWithoutForeground(context, args.timeout);
    page.on('pageerror', error => runtimeErrors.push(error.message));
    if (args.liveOnly) {
      permitLivePageNetwork = true;
      report.liveEpoch = await runLiveEpoch(page, popup, context, helper, args);
      Object.assign(report, {passed: true, evidenceType: 'live-site-production-extension-with-controlled-loopback-provider', liveSite: true,
        launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement,
        providerRequests: provider.requestCount(), translatedItems: provider.translatedItemCount(), unexpectedNetwork, workerErrors});
      assert(provider.requestCount() > 0, 'Epoch 受控翻译 provider 未收到请求');
      assert.deepEqual(unexpectedNetwork, [], 'Epoch 翻译请求意外访问真实 provider');
      assert.deepEqual(workerErrors, [], 'Epoch service worker fixture 安装失败');
      fs.writeFileSync(path.join(args.artifactsDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
      process.stdout.write(`${JSON.stringify({passed: true, artifactsDir: args.artifactsDir, liveSite: true, windowPlacement: report.windowPlacement}, null, 2)}\n`);
      return;
    }
    await page.goto(url);
    await page.waitForSelector('#fluent-read-page-styles', {state: 'attached', timeout: args.timeout});
    await helper.activateExtensionTabWithoutForeground(context, page, args.timeout);
    await page.evaluate(() => {window.__fixtureOriginalElements = [...document.querySelectorAll('[id]')].map(e => [e.id, e]);});
    const baseline = await snapshot(page);
    report.baseline = baseline;
    const staticIds = await page.locator('[data-all-node]').evaluateAll(nodes => nodes.map(e => e.id));
    const bodyIds = ['article-body', 'workflow-body', 'project-body'];
    const dynamicIds = ['expanded-owner', 'expanded-details', 'tree-child', 'portal-duplicate', 'portal-archive'];
    const controlIds = [...staticIds.filter(id => id !== 'footer-tagline'), ...dynamicIds];
    await action(popup, url, 'fullPage');
    await waitForNodes(page, bodyIds, 1, args.timeout);
    const ordinary = await snapshot(page);
    for (const id of ['epoch-latest', 'epoch-dashboard', 'footer-about', 'workflow-overview', 'tab-history', 'tree-label']) {
      assert.equal(ordinary.nodes[id].count, 0, `普通模式意外翻译 ${id}`);
    }
    assertInvariant(ordinary, baseline, 'ordinary');
    await page.evaluate(ids => {window.__ordinaryWrappers = ids.flatMap(id => [...document.getElementById(id).querySelectorAll('.fluent-read-bilingual-content')]);}, bodyIds);
    report.ordinary = ordinary;
    process.stdout.write('普通模式正文与排除区域契约通过。\n');

    // The entry belongs to the native page context menu, not the popup. Native
    // OS menu selection would require foreground focus, so registration is checked
    // separately and this browser layer exercises its public content-message route.
    await popup.reload();
    assert.equal(await popup.getByRole('button', {name: '识别全部节点', exact: true}).count(), 0, 'Popup 不应包含识别全部节点入口');
    await action(popup, url, 'allNodes');
    await waitForNodes(page, [...staticIds, ...bodyIds], 1, args.timeout, controlIds);
    assert(await page.evaluate(() => window.__ordinaryWrappers.every(e => e.isConnected)), '升级范围丢失已译正文 wrapper');
    const expanded = await snapshot(page);
    assertInvariant(expanded, baseline, 'all-nodes');
    report.allNodes = expanded;
    await page.screenshot({path: path.join(args.artifactsDir, 'all-nodes-translated.png'), fullPage: true});
    await action(popup, url, 'allNodes');
    await page.waitForTimeout(500);
    const repeated = await snapshot(page);
    assert.equal(repeated.count, expanded.count, '重复扫描不得改变译文数量');
    assert.equal(repeated.translatedLabels, expanded.translatedLabels, '重复扫描不得丢失原位控件译文');
    for (const id of staticIds) assert.equal(repeated.nodes[id].text, expanded.nodes[id].text, `重复扫描重译已有节点 ${id}`);
    assertInvariant(repeated, baseline, 'repeated');
    report.repeated = repeated;
    await clickInteractions(page);
    assert.deepEqual((await snapshot(page)).events, {save: 1, contact: 1, graph: 1, history: 1, portal: 0, expansion: 0});
    for (const id of ['epoch-more', 'tree-expand', 'workflow-portal']) await page.locator(`#${id}`).click();
    await waitForNodes(page, dynamicIds, 1, args.timeout, controlIds);
    await page.locator('#portal-duplicate').click();
    const dynamic = await snapshot(page);
    assertInvariant(dynamic, baseline, 'dynamic');
    assert.equal(dynamic.events.portal, 1);
    report.dynamic = dynamic;
    process.stdout.write('全部节点、重复扫描、展开和动态 portal 契约通过。\n');

    await action(popup, url, 'restore');
    await waitForNodes(page, [...staticIds, ...bodyIds, ...dynamicIds], 0, args.timeout);
    const restored = await snapshot(page);
    assert.equal(restored.count, 0, '恢复后仍有译文');
    assertInvariant(restored, baseline, 'restored');
    for (const id of [...staticIds, ...bodyIds]) assert.equal(restored.nodes[id].text, baseline.nodes[id].text, `恢复原文失败 ${id}`);
    for (const id of dynamicIds.filter(id => baseline.nodes[id])) assert.equal(restored.nodes[id].text, baseline.nodes[id].text, `动态节点恢复失败 ${id}`);
    assert.equal(restored.nodes['portal-duplicate'].text, 'Duplicate workflow');
    assert.equal(restored.nodes['portal-archive'].text, 'Archive workflow');
    await clickInteractions(page);
    report.restored = restored;
    await action(popup, url, 'allNodes');
    await waitForNodes(page, [...staticIds, ...bodyIds, ...dynamicIds], 1, args.timeout, controlIds);
    const retranslated = await snapshot(page);
    assertInvariant(retranslated, baseline, 'retranslated');
    assert.deepEqual(retranslated.events, {save: 2, contact: 2, graph: 2, history: 2, portal: 1, expansion: 1});
    report.retranslated = retranslated;
    await page.screenshot({path: path.join(args.artifactsDir, 'all-nodes-retranslated.png'), fullPage: true});
    assert(provider.requestCount() > 0, '确定性翻译 provider 未收到请求');
    const providerSource = provider.requestPayloads().flat().join('\n');
    for (const protectedText of [
      'private input unchanged', 'Private editor text remains untouched.', 'Editable draft remains untouched.',
      'Do not translate source code', 'Explicit translation exclusion remains untouched.',
      'Another explicit exclusion remains untouched.', 'Hidden application content remains untouched.', 'Vector drawing text',
    ]) assert(!providerSource.includes(protectedText), `受保护内容进入翻译请求：${protectedText}`);
    assert.deepEqual(unexpectedNetwork, [], '本地 fixture 意外访问外网');
    assert.deepEqual(workerErrors, [], 'service worker fixture 安装失败');
    assert.deepEqual(runtimeErrors, [], '页面运行异常');
    Object.assign(report, {passed: true, launchMode: session.launchMode, focusPolicy: session.focusPolicy,
      windowPlacement: session.windowPlacement, provider: 'freeTranslation / Microsoft loopback deterministic fixture',
      providerRequests: provider.requestCount(), translatedItems: provider.translatedItemCount(),
      lifecycleCounts: [expanded.count, restored.count, retranslated.count],
      controlLifecycleCounts: [expanded.translatedLabels, restored.translatedLabels, retranslated.translatedLabels], unexpectedNetwork, runtimeErrors});
    if (args.liveEpoch) {
      await action(popup, url, 'restore');
      permitLivePageNetwork = true;
      report.fixtureProviderRequests = provider.requestCount();
      report.liveEpoch = await runLiveEpoch(page, popup, context, helper, args);
      report.liveEpoch.providerRequests = provider.requestCount() - report.fixtureProviderRequests;
      report.providerRequests = provider.requestCount();
      report.translatedItems = provider.translatedItemCount();
    }
    fs.writeFileSync(path.join(args.artifactsDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({passed: true, artifactsDir: args.artifactsDir, lifecycleCounts: report.lifecycleCounts, launchMode: report.launchMode, windowPlacement: report.windowPlacement}, null, 2)}\n`);
  } catch (error) {
    report.passed = false;
    report.error = error.stack || String(error);
    report.providerRequests = provider.requestCount();
    report.providerPayloads = provider.requestPayloads();
    if (page && !page.isClosed()) {report.failureState = await snapshot(page).catch(() => null);await page.screenshot({path: path.join(args.artifactsDir, 'failure.png'), fullPage: true}).catch(() => {});}
    fs.writeFileSync(path.join(args.artifactsDir, 'failure-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    throw error;
  } finally {
    await session?.close();
    await provider.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(profileDir, {recursive: true, force: true});
  }
}

if (require.main === module) main().catch(error => {process.stderr.write(`${error.stack || error}\n`);process.exitCode = 1;});
module.exports = {parseArgs, assertInvariant};

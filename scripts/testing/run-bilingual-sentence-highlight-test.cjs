#!/usr/bin/env node
'use strict';
// 逐句高亮生产回归：临时配置、第二屏后台窗口、本地确定性响应与真实 DevTools 指针/快捷键。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const argument = (name, fallback) => {const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1];};
const subset = (actual, expected) => expected && typeof expected === 'object' && !Array.isArray(expected)
  ? actual && Object.entries(expected).every(([key, value]) => subset(actual[key], value))
  : JSON.stringify(actual) === JSON.stringify(expected);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const source = [
  'The first sentence introduces the topic and provides enough background to understand this long paragraph.',
  'The second sentence explains a complex idea that deserves careful comparison with the translated text.',
  'The final sentence concludes the discussion and invites readers to check the original meaning.',
];
const translation = [
  '第一句话介绍主题，并提供足够的背景来理解这个长段落。',
  '第二句话解释一个复杂的想法，值得与翻译后的文本仔细比较。',
  '最后一句话总结讨论，并邀请读者核对原意。',
];
const replace = [
  ...source.map((sentence, i) => [sentence, translation[i]]),
  ['First rich sentence has a', '第一句包含'], ['linked phrase', '链接短语'],
  ['Second rich sentence contains', '第二句包含'], ['bold words', '加粗词语'], ['Third rich sentence ends here.', '第三句在这里结束。'],
  ['. ', '。'],
];
async function startFixture() {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*'); response.setHeader('Access-Control-Allow-Headers', '*');
    if (request.method === 'OPTIONS') {response.writeHead(204); response.end(); return;}
    if (request.method === 'POST') {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const prompt = body.messages.filter(item => item.role === 'user').map(item => item.content).join('\n');
      const text = /SOURCE_BEGIN([\s\S]*?)SOURCE_END/u.exec(prompt)?.[1];
      requests.push({source: text});
      let output = text || '';
      for (const [from, to] of replace) output = output.replaceAll(from, to);
      if (prompt.includes('SPLIT_SENTENCE')) output = output.replace(translation[1], '第二句话解释一个复杂的想法。这个想法值得与翻译后的文本仔细比较。');
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({id: 'bilingual-fixture', object: 'chat.completion', created: 1, model: 'fixture',
        choices: [{index: 0, message: {role: 'assistant', content: output}, finish_reason: 'stop'}]})); return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Bilingual sentence comparison</title><style>body{margin:0;padding:50px 8vw;font:20px/1.9 system-ui;color:#263044;background:#fff}main{max-width:950px}p{margin:30px 0}a{color:#5268c1}.fluent-read-bilingual-content{margin-top:14px!important}h1{font-size:28px}</style></head><body><main><h1 translate="no">Bilingual sentence comparison</h1><p id="primary">${source.join(' ')}</p><p id="rich">First rich sentence has a <a href="#example">linked phrase</a>. Second rich sentence contains <strong>bold words</strong>. Third rich sentence ends here.</p><p id="neighbor">This neighboring paragraph must remain unchanged during hover translation.</p></main></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise(resolve => server.close(resolve))};
}
async function main() {
  const extensionDir = path.resolve(argument('extension-dir', '.output/chrome-mv3'));
  const artifactsDir = path.resolve(argument('artifacts-dir', '/private/tmp/fluentread-bilingual-highlight'));
  const packages = argument('playwright-root'); const helperPath = argument('focus-safe-helper');
  assert(packages && helperPath); assert(fs.existsSync(path.join(extensionDir, 'manifest.json')));
  const {chromium} = require(path.join(packages, 'playwright'));
  const {launchFocusSafePersistentContext, newPageWithoutForeground, activateExtensionTabWithoutForeground} = require(helperPath);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-sentence-edge-'));
  fs.mkdirSync(artifactsDir, {recursive: true});
  const fixture = await startFixture();
  const report = {ok: false, extensionDir, profileDir, artifactsDir, checks: [], consoleErrors: [], screenshots: [],
    evidenceBoundary: 'Local deterministic HTML/provider; no external provider quality or Firefox runtime claim.'};
  let launched; let page;
  try {
    launched = await launchFocusSafePersistentContext({chromium, profileDir, background: true, headless: false,
      browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', viewport: {width: 1440, height: 960}, timeout: 30000,
      browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    Object.assign(report, {launchMode: launched.launchMode, focusPolicy: launched.focusPolicy, windowPlacement: launched.windowPlacement});
    assert.equal(report.launchMode, 'macos-background-cdp'); assert.equal(report.focusPolicy, 'launchservices-no-foreground');
    assert.equal(report.windowPlacement.browserFrontmost, false);
    const context = launched.context;
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: 30000});
    const origin = /^chrome-extension:\/\/[^/]+/u.exec(worker.url())[0];
    const createPage = async url => {
      const result = await newPageWithoutForeground(context, 30000);
      result.on('pageerror', error => report.consoleErrors.push(error.message));
      await result.goto(url, {waitUntil: 'domcontentloaded'}); return result;
    };
    const popup = await createPage(`${origin}/popup.html`);
    const readConfig = () => popup.evaluate(async () => {
      const result = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      if (!result?.success) throw new Error(result?.error); return typeof result.value === 'string' ? JSON.parse(result.value) : result.value;
    });
    const untilConfig = async predicate => {
      for (let i = 0; i < 200; i++) {const config = await readConfig(); if (config && predicate(config)) return config; await wait(50);}
      throw new Error('Configuration did not converge');
    };
    await untilConfig(config => config.to && config.service);
    const patchConfig = async patch => {
      const current = await readConfig(); const initial = Object.hasOwn(patch, 'token');
      if (initial) assert.equal(current.customOpenAIProviders?.length, 0);
      const expected = Object.fromEntries(Object.keys(patch).map(key => [key, current[key]]));
      const result = await popup.evaluate(({patch, current, expected, initial}) => chrome.runtime.sendMessage({
        type: 'persistConfig', mode: initial ? 'replace' : 'patch', config: initial ? {...current, ...patch} : patch, expected,
        baseRevision: initial ? current.__fluentConfigRevision : undefined, clientId: `sentence-${crypto.randomUUID()}`, sequence: 1,
      }), {patch, current, expected, initial});
      assert.equal(result?.success, true, result?.error);
      await untilConfig(config => Object.keys(patch).filter(key => key !== 'token').every(key => subset(config[key], patch[key])));
    };
    const service = 'custom:sentence-fixture';
    await patchConfig({uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, on: true, display: 1, style: 1,
      service, from: 'en', to: 'zh-Hans', useCache: true, autoTranslate: false, bilingualSentenceHighlightEnabled: true,
      customOpenAIProviders: [{id: service, name: '逐句高亮夹具', endpoint: `${fixture.url}/v1/chat/completions`, models: ['fixture']}],
      token: {[service]: 'synthetic-local-fixture-not-a-secret'}, model: {[service]: 'fixture'},
      user_role: {[service]: 'SOURCE_BEGIN{{origin}}SOURCE_END'}, enableAIContext: false, enableAIMultiSegment: false,
      glossaryEnabled: false, hotkey: 'Control', floatingBallHotkey: 'Alt+T', mouseHoverTranslationDelay: 0,
      selectionTranslatorMode: 'disabled', disableSelectionTranslator: true, animations: false});
    page = await createPage(fixture.url);
    await page.locator('#fluent-read-page-styles').waitFor({state: 'attached'});
    const highlights = () => page.evaluate(() => [...(CSS.highlights.get('fluentread-bilingual-sentence') || [])].map(range => range.toString()).join(''));
    const hoverText = async (selector, text) => {
      const point = await page.evaluate(({selector, text}) => {
        const root = document.querySelector(selector); const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode; const i = node.textContent.indexOf(text); if (i < 0) continue;
          const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + Math.min(text.length, 2));
          const rect = range.getClientRects()[0]; return {x: rect.left + Math.max(1, rect.width / 2), y: rect.top + rect.height / 2};
        }
        throw new Error(`No text ${text} in ${selector}`);
      }, {selector, text});
      await page.mouse.move(point.x, point.y); await wait(90);
    };
    const assertPair = async (sourceText, translatedText) => assert.equal(await highlights(), sourceText + translatedText);
    const toggle = async selector => {
      await activateExtensionTabWithoutForeground(context, page, 30000);
      await page.locator(selector).hover(); await page.keyboard.down('Control'); await page.keyboard.up('Control');
    };
    const shot = async (surface, name) => {const file = path.join(artifactsDir, `${name}.png`); await surface.screenshot({path: file}); report.screenshots.push(file);};
    const counts = [];
    for (const expected of [1, 0, 1]) {
      await toggle('#primary');
      await page.waitForFunction(expected => document.querySelectorAll('#primary > .fluent-read-bilingual-content').length === expected, expected);
      counts.push(await page.locator('#primary > .fluent-read-bilingual-content').count());
      assert.equal(await page.locator('#neighbor .fluent-read-bilingual-content').count(), 0);
      if (!expected) {await wait(100); assert.equal(await highlights(), '');}
    }
    report.toggleCounts = counts;
    await hoverText('#primary', source[0]); await assertPair(source[0], translation[0]);
    const before = await page.evaluate(() => {
      const root = document.querySelector('#primary'); window.__originalText = root.firstChild; window.__hoverMutations = [];
      window.__hoverObserver = new MutationObserver(records => window.__hoverMutations.push(...records.map(r => r.type)));
      window.__hoverObserver.observe(root, {subtree: true, childList: true, attributes: true, characterData: true});
      return {html: root.innerHTML, rect: JSON.stringify(root.getBoundingClientRect())};
    });
    const requestCount = fixture.requests.length;
    for (let index = 0; index < 3; index++) {
      await hoverText('#primary', source[index]); await assertPair(source[index], translation[index]);
      await hoverText('#primary .fluent-read-bilingual-content', translation[index]); await assertPair(source[index], translation[index]);
    }
    await hoverText('#primary', source[1]); await shot(page, 'sentence-two');
    const after = await page.evaluate(() => {
      window.__hoverObserver.disconnect(); const root = document.querySelector('#primary');
      return {html: root.innerHTML, rect: JSON.stringify(root.getBoundingClientRect()), mutations: window.__hoverMutations,
        sameTextNode: root.firstChild === window.__originalText};
    });
    assert.equal(after.html, before.html); assert.equal(after.rect, before.rect); assert.deepEqual(after.mutations, []); assert(after.sameTextNode);
    assert.equal(fixture.requests.length, requestCount);
    report.hover = {mutations: 0, geometryDelta: 0, sameTextNode: true, extraRequests: 0};
    report.checks.push('three sentence pairs, both hover directions, zero host mutation/layout shift/request');
    await page.mouse.move(5, 5); await wait(100); assert.equal(await highlights(), '');
    await hoverText('#primary', source[1]);
    await page.evaluate(() => {const node = document.querySelector('#primary').firstChild; const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 4); getSelection().removeAllRanges(); getSelection().addRange(range);});
    await wait(100); assert.equal(await highlights(), ''); await page.evaluate(() => getSelection().removeAllRanges());
    report.checks.push('pointer leave and real selection clear');
    await patchConfig({bilingualSentenceHighlightEnabled: false});
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-fr-bilingual-sentence-highlight'));
    await hoverText('#primary', source[0]); assert.equal(await highlights(), '');
    await patchConfig({bilingualSentenceHighlightEnabled: true});
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-fr-bilingual-sentence-highlight'));
    await hoverText('#primary', source[2]); await assertPair(source[2], translation[2]);
    report.checks.push('live config off/on without retranslation');
    // 通过服务响应生成拆句结果，不绕过 renderer 的工件完整性保护。
    await toggle('#primary'); await page.waitForFunction(() => !document.querySelector('#primary .fluent-read-bilingual-content'));
    await patchConfig({useCache: false, user_role: {[service]: 'SPLIT_SENTENCE\nSOURCE_BEGIN{{origin}}SOURCE_END'}});
    await toggle('#primary'); await page.locator('#primary > .fluent-read-bilingual-content').waitFor({state: 'attached'});
    await hoverText('#primary', source[2]); await assertPair(source[2], translation[2]);
    await hoverText('#primary', source[1]); await assertPair(source[1], '第二句话解释一个复杂的想法。这个想法值得与翻译后的文本仔细比较。');
    report.checks.push('provider splits middle sentence, group preserves final pair');
    // 恢复后重新翻译，随后验证富文本原节点身份。
    await toggle('#primary'); await page.waitForFunction(() => !document.querySelector('#primary .fluent-read-bilingual-content'));
    await patchConfig({useCache: true, user_role: {[service]: 'SOURCE_BEGIN{{origin}}SOURCE_END'}});
    await page.evaluate(() => {window.__originalLink = document.querySelector('#rich a'); window.__originalBold = document.querySelector('#rich strong');});
    await toggle('#rich'); await page.locator('#rich > .fluent-read-bilingual-content').waitFor({state: 'attached'});
    await hoverText('#rich a', 'linked phrase');
    assert((await highlights()).startsWith('First rich sentence has a linked phrase.'));
    assert((await highlights()).replace(/\s/gu, '').includes('第一句包含链接短语'));
    await hoverText('#rich strong', 'bold words'); assert((await highlights()).startsWith('Second rich sentence contains bold words.'));
    assert.equal(await page.evaluate(() => window.__originalLink === document.querySelector('#rich a') && window.__originalBold === document.querySelector('#rich strong')), true);
    await shot(page, 'rich-text');
    await page.evaluate(() => document.querySelector('#rich').remove()); await wait(100); assert.equal(await highlights(), '');
    report.checks.push('linked and bold sentences, original node identity, detached owner cleanup');
    const options = await createPage(`${origin}/options.html`);
    const control = options.locator('.el-switch:has(input[aria-label="双语逐句高亮"])'); await control.waitFor({state: 'visible'});
    const preview = options.getByTestId('bilingual-highlight-preview');
    await preview.locator('[data-testid="bilingual-highlight-preview-source"] span').nth(1).hover();
    assert.equal(await preview.locator('.is-sentence-highlighted').count(), 2);
    assert((await preview.locator('.is-sentence-highlighted').first().innerText()).includes('Move over'));
    await preview.locator('[data-testid="bilingual-highlight-preview-translation"] span').nth(2).focus();
    assert.equal(await preview.locator('.is-sentence-highlighted').count(), 2);
    assert((await preview.locator('.is-sentence-highlighted').first().innerText()).includes('Compare difficult'));
    await shot(options, 'settings-light');
    await control.click(); await untilConfig(config => !config.bilingualSentenceHighlightEnabled);
    await options.reload(); await control.waitFor({state: 'visible'}); assert.equal(await control.locator('input').getAttribute('aria-checked'), 'false');
    await control.click(); await untilConfig(config => config.bilingualSentenceHighlightEnabled);
    await patchConfig({theme: 'dark'}); await options.setViewportSize({width: 390, height: 844});
    await preview.scrollIntoViewIfNeeded(); await preview.locator('[data-testid="bilingual-highlight-preview-translation"] span').nth(1).hover();
    await shot(options, 'settings-dark-390');
    assert.equal(await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    report.checks.push('settings multiple pairs, keyboard focus, saved toggle after reload, dark 390px');
    assert.deepEqual(report.consoleErrors, []);
    report.requests = fixture.requests; report.ok = true;
  } catch (error) {
    report.error = error.stack || String(error);
    if (page && !page.isClosed()) await page.screenshot({path: path.join(artifactsDir, 'failure.png')}).catch(() => {});
    throw error;
  } finally {
    fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
    await launched?.close(); await fixture.close(); fs.rmSync(profileDir, {recursive: true, force: true});
  }
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => {console.error(error); process.exitCode = 1;});

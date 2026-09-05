#!/usr/bin/env node
'use strict';

// 中文简繁生产浏览器回归：临时 Edge、无前台焦点启动、真实配置选择和真实快捷键。
// loopback AI fixture 只验证请求与 UI 链路；--live-google 独立报告无需凭据的外部服务实译。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const paragraphs = {
  en: [
    'This software reads the document and translates the language on this page.',
    'The second paragraph explains the settings for the computer network.',
  ],
  'zh-Hans': [
    '这个软件读取文档并翻译这个页面上的语言。',
    '第二个段落说明计算机网络的设置。',
  ],
  'zh-Hant': [
    '這個軟體讀取文件並翻譯這個頁面上的語言。',
    '第二個段落說明電腦網路的設定。',
  ],
};
const pairs = [
  {from: 'en', to: 'zh-Hans'},
  {from: 'en', to: 'zh-Hant'},
  {from: 'zh-Hans', to: 'zh-Hant'},
  {from: 'zh-Hant', to: 'zh-Hans'},
];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
}
function matchesSubset(actual, expected) {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    return actual && typeof actual === 'object'
      && Object.entries(expected).every(([key, value]) => matchesSubset(actual[key], value));
  }
  return JSON.stringify(actual) === JSON.stringify(expected);
}
function fixtureTranslation(source, target) {
  let matched = false;
  let result = source;
  for (const sentences of Object.values(paragraphs)) {
    sentences.forEach((sentence, index) => {
      if (result.includes(sentence)) {
        matched = true;
        result = result.replaceAll(sentence, paragraphs[target][index]);
      }
    });
  }
  assert(matched, `fixture 收到未知原文：${source}`);
  return result;
}
function assertScript(text, target) {
  assert(text.trim(), '译文不能为空');
  // 样例包含多个稳定区分字，不把所有汉字直接判作简体或繁体。
  if (target === 'zh-Hans') {
    assert(/[这读译页语个说计机网设]/u.test(text), `缺少简体证据：${text}`);
    assert(!/[這讀譯頁語個說計機網設]/u.test(text), `简体译文混入繁体：${text}`);
  } else {
    assert(/[這讀譯頁語個說計機網設]/u.test(text), `缺少繁体证据：${text}`);
    assert(!/[这读译页语个说计机网设]/u.test(text), `繁体译文混入简体：${text}`);
  }
}
async function startFixture() {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', '*');
    if (request.method === 'OPTIONS') {response.writeHead(204); response.end(); return;}
    if (request.method === 'POST' && request.url === '/v1/chat/completions') {
      try {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const prompt = body.messages.filter(message => message.role === 'user').map(message => message.content).join('\n');
        const targetName = /TARGET_BEGIN([\s\S]*?)TARGET_END/u.exec(prompt)?.[1];
        const source = /SOURCE_BEGIN([\s\S]*?)SOURCE_END/u.exec(prompt)?.[1];
        assert.equal(typeof source, 'string', '实际模板必须包含原文');
        const target = /\bzh-(Hans|Hant)\b/u.exec(targetName || '')?.[0];
        assert(target, `{{to}} 未传入明确的简繁目标：${targetName}`);
        assert(targetName.includes(target === 'zh-Hans' ? 'Simplified Chinese' : 'Traditional Chinese'),
          '{{to}} 必须包含模型可理解的中文书写体系名称');
        const translated = fixtureTranslation(source, target);
        requests.push({source, target, targetName, prompt, translated});
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({id: 'chinese-script-fixture', object: 'chat.completion', created: 1,
          model: 'chinese-script-fixture', choices: [{index: 0, message: {role: 'assistant', content: translated}, finish_reason: 'stop'}],
          usage: {prompt_tokens: 20, completion_tokens: 20, total_tokens: 40}}));
      } catch (error) {
        response.writeHead(400); response.end(JSON.stringify({error: {message: error.message}}));
      }
      return;
    }
    const url = new URL(request.url, 'http://fixture.local');
    const source = url.searchParams.get('source') || 'en';
    const texts = paragraphs[source];
    if (!texts) {response.writeHead(404); response.end(); return;}
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><html lang="${source}"><head><meta charset="utf-8"><title>Chinese script translation fixture</title></head><body style="padding:64px;font:22px/1.8 sans-serif"><main><p id="chinese-primary">${texts[0]}</p><p id="chinese-neighbor">${texts[1]}</p></main></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {url: `http://127.0.0.1:${server.address().port}`, requests,
    close: () => new Promise(resolve => server.close(resolve))};
}

async function main() {
  const extensionDir = path.resolve(argument('extension-dir', '.output/chrome-mv3'));
  const packages = argument('playwright-root');
  const helperPath = argument('focus-safe-helper');
  assert(packages && helperPath, '必须传入 --playwright-root 和 --focus-safe-helper');
  assert(fs.existsSync(path.join(extensionDir, 'manifest.json')), '缺少扩展构建产物');
  const {chromium} = require(path.join(packages, 'playwright'));
  const {launchFocusSafePersistentContext, newPageWithoutForeground, activateExtensionTabWithoutForeground} = require(helperPath);
  const artifactsDir = path.resolve(argument('artifacts-dir', '/private/tmp/fluentread-chinese-browser'));
  fs.mkdirSync(artifactsDir, {recursive: true});
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-chinese-edge-'));
  const fixture = await startFixture();
  const report = {ok: false, extensionDir, artifactsDir, profileDir,
    scope: 'production Popup native language selection, persistence, real Control hover and Alt+T full-page [1,0,1], Chinese script discrimination and target cache isolation',
    evidenceBoundary: 'The local HTML and loopback OpenAI-compatible server are deterministic fixtures. Their success does not prove any external service translation quality or availability.',
    fixture: {ok: false, cases: []}, liveGoogle: {requested: process.argv.includes('--live-google'), cases: []},
    screenshots: [], consoleErrors: [], ui: {}};
  let launched;
  let currentPage;
  try {
    launched = await launchFocusSafePersistentContext({chromium, profileDir,
      browserPath: argument('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
      background: true, headless: false, viewport: {width: 1440, height: 960}, timeout: 30000,
      browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    Object.assign(report, {launchMode: launched.launchMode, focusPolicy: launched.focusPolicy, windowPlacement: launched.windowPlacement});
    assert.equal(report.launchMode, 'macos-background-cdp');
    assert.equal(report.focusPolicy, 'launchservices-no-foreground');
    const context = launched.context;
    const capture = (surface, source) => {
      surface.on('console', message => {if (message.type() === 'error') report.consoleErrors.push({source, message: message.text()});});
      surface.on('pageerror', error => report.consoleErrors.push({source, message: error.message}));
    };
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: 30000});
    capture(worker, 'worker');
    const extensionOrigin = /^chrome-extension:\/\/[^/]+/u.exec(worker.url())[0];
    const createPage = async (url, name) => {
      const page = await newPageWithoutForeground(context, 30000);
      page.setDefaultTimeout(20000); capture(page, name);
      await page.goto(url, {waitUntil: 'domcontentloaded'});
      currentPage = page;
      return page;
    };
    const popup = await createPage(`${extensionOrigin}/popup.html`, 'popup');
    const readConfig = () => popup.evaluate(async () => {
      const result = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      if (!result?.success) throw new Error(result?.error || '读取配置失败');
      return typeof result.value === 'string' ? JSON.parse(result.value) : result.value;
    });
    const waitConfig = async predicate => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const value = await readConfig();
        if (value && predicate(value)) return value;
        await wait(50);
      }
      throw new Error('配置未达到预期持久化状态');
    };
    await waitConfig(config => config.to && config.service);
    const patchConfig = async patch => {
      const current = await readConfig();
      const expected = Object.fromEntries(Object.keys(patch).map(key => [key, current[key]]));
      const initialCredentials = Object.hasOwn(patch, 'token');
      if (initialCredentials) assert.equal(current.customOpenAIProviders?.length, 0, '合成凭据仅可写入空白临时 profile');
      const result = await popup.evaluate(async ({patch, expected, current, initialCredentials}) => chrome.runtime.sendMessage({
        type: 'persistConfig', mode: initialCredentials ? 'replace' : 'patch',
        config: initialCredentials ? {...current, ...patch} : patch, expected,
        baseRevision: initialCredentials ? current.__fluentConfigRevision : undefined,
        clientId: `chinese-fixture-${crypto.randomUUID()}`, sequence: 1}), {patch, expected, current, initialCredentials});
      assert.equal(result?.success, true, result?.error);
      await waitConfig(config => Object.keys(patch).filter(key => key !== 'token').every(key => matchesSubset(config[key], patch[key])));
    };
    const shot = async (page, name) => {
      const file = path.join(artifactsDir, `${name}.png`);
      await page.screenshot({path: file, animations: 'disabled'}); report.screenshots.push(file);
    };
    const service = 'custom:chinese-script-fixture';
    await patchConfig({uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, on: true, service,
      from: 'en', to: 'zh-Hans', display: 1, useCache: true, autoTranslate: false,
      customOpenAIProviders: [{id: service, name: '中文简繁测试服务', endpoint: `${fixture.url}/v1/chat/completions`, models: ['chinese-script-fixture']}],
      token: {[service]: 'synthetic-local-fixture-not-a-secret'}, model: {[service]: 'chinese-script-fixture'},
      user_role: {[service]: 'TARGET_BEGIN{{to}}TARGET_END\nSOURCE_BEGIN{{origin}}SOURCE_END'},
      enableAIContext: false, enableAIMultiSegment: false, glossaryEnabled: false,
      hotkey: 'Control', floatingBallHotkey: 'Alt+T', fullPageTranslationMode: 'all',
      mouseHoverTranslationDelay: 0, selectionTranslatorMode: 'disabled', disableSelectionTranslator: true,
      animations: false});
    await popup.reload({waitUntil: 'domcontentloaded'});
    const sourceSelect = popup.locator('.language-pair select').nth(0);
    const targetSelect = popup.locator('.language-pair select').nth(1);
    await sourceSelect.waitFor({state: 'visible'});
    report.ui.sourceChoices = await sourceSelect.locator('option').evaluateAll(nodes => nodes.map(node => ({value: node.value, label: node.textContent})));
    report.ui.targetChoices = await targetSelect.locator('option').evaluateAll(nodes => nodes.map(node => ({value: node.value, label: node.textContent})));
    for (const choices of [report.ui.sourceChoices, report.ui.targetChoices]) {
      assert(choices.some(item => item.value === 'zh-Hans' && item.label.includes('简体中文')));
      assert(choices.some(item => item.value === 'zh-Hant' && item.label.includes('繁體中文')));
    }
    const selectLanguages = async (from, to) => {
      await activateExtensionTabWithoutForeground(context, popup, 30000);
      await sourceSelect.selectOption(from); await targetSelect.selectOption(to);
      await waitConfig(config => config.from === from && config.to === to);
      await popup.reload({waitUntil: 'domcontentloaded'});
      await sourceSelect.waitFor({state: 'visible'});
      assert.equal(await sourceSelect.inputValue(), from);
      assert.equal(await targetSelect.inputValue(), to);
    };
    await selectLanguages('zh-Hans', 'zh-Hant');
    await shot(popup, 'popup-simplified-to-traditional');
    await selectLanguages('zh-Hant', 'zh-Hans');
    await shot(popup, 'popup-traditional-to-simplified');
    report.ui.nativeSelectionPersistence = true;

    const runCase = async (pair, mode, live = false) => {
      await selectLanguages(pair.from, pair.to);
      const name = `${live ? 'google' : 'fixture'}-${pair.from}-${pair.to}-${mode}`;
      const article = await createPage(`${fixture.url}/article?source=${pair.from}&case=${name}`, name);
      const url = article.url();
      try {
        await article.locator('#fluent-read-page-styles').waitFor({state: 'attached'});
        const primary = article.locator('#chinese-primary');
        const neighbor = article.locator('#chinese-neighbor');
        const beforeText = await primary.innerText();
        assert.equal(beforeText, paragraphs[pair.from][0]);
        const requestStart = fixture.requests.length;
        const counts = [];
        let requestCountAfterFirst;
        let translated = '';
        for (const expected of [1, 0, 1]) {
          await activateExtensionTabWithoutForeground(context, article, 30000);
          if (mode === 'hover') {
            await primary.click(); await primary.hover();
            await article.keyboard.down('Control'); await article.keyboard.up('Control');
          } else {
            await primary.click();
            await article.keyboard.down('Alt'); await article.keyboard.press('t'); await article.keyboard.up('Alt');
          }
          await article.waitForFunction(({expected, mode}) => {
            const count = document.querySelectorAll('#chinese-primary .fluent-read-bilingual-content').length;
            const neighborCount = document.querySelectorAll('#chinese-neighbor .fluent-read-bilingual-content').length;
            return count === expected && neighborCount === (mode === 'full' ? expected : 0);
          }, {expected, mode}, {timeout: live ? 45000 : 20000});
          counts.push(await primary.locator('.fluent-read-bilingual-content').count());
          if (expected) {
            const textNodes = primary.locator('.fluent-read-bilingual-content');
            await article.waitForFunction(() => document.querySelector('#chinese-primary .fluent-read-bilingual-content')?.textContent?.trim(), undefined, {timeout: live ? 45000 : 20000});
            translated = await textNodes.innerText();
            assertScript(translated, pair.to);
            if (!live) assert.equal(translated.trim(), paragraphs[pair.to][0]);
            if (mode === 'full') {
              const neighborText = await neighbor.locator('.fluent-read-bilingual-content').innerText();
              assertScript(neighborText, pair.to);
              if (!live) assert.equal(neighborText.trim(), paragraphs[pair.to][1]);
            }
          } else {
            assert.equal(await primary.innerText(), beforeText, '恢复原文必须保留原始文字');
          }
          assert.equal(article.url(), url);
          assert.equal(await article.locator('.fluent-read-bilingual-content .fluent-read-bilingual-content').count(), 0);
          if (counts.length === 1) requestCountAfterFirst = fixture.requests.length;
        }
        if (!live) {
          assert.equal(fixture.requests.length, requestCountAfterFirst, '重复翻译应命中相同书写体系的缓存');
          assert(fixture.requests.slice(requestStart).every(request => request.target === pair.to), '请求或缓存不能串用另一书写体系');
        }
        await shot(article, name);
        return {...pair, mode, status: 'passed', counts, translated, requestDelta: fixture.requests.length - requestStart,
          sourceRestored: true, urlStable: true, noNestedTranslations: true};
      } catch (error) {
        await shot(article, `${name}-failure`).catch(() => {});
        fs.writeFileSync(path.join(artifactsDir, `${name}-failure.html`), await article.content().catch(() => ''));
        throw error;
      } finally {
        await article.close(); currentPage = popup;
      }
    };
    for (const mode of ['hover', 'full']) {
      for (const pair of pairs) report.fixture.cases.push(await runCase(pair, mode));
    }
    // 首次同英文原文的两个目标必须分别请求，随后回到简体应复用已保存的简体结果。
    for (const target of ['zh-Hans', 'zh-Hant']) {
      assert(fixture.requests.some(request => request.target === target && request.source.includes(paragraphs.en[0])), `缺少英文到 ${target} 的独立请求`);
    }
    const beforeRevisit = fixture.requests.length;
    report.fixture.cacheRevisit = await runCase(pairs[0], 'hover');
    assert.equal(fixture.requests.length, beforeRevisit, '切回简体必须命中简体缓存');
    report.fixture.ok = true;
    report.fixture.targetCacheIsolation = true;
    if (report.liveGoogle.requested) {
      await patchConfig({service: 'google', useCache: false});
      for (const mode of ['hover', 'full']) {
        for (const pair of pairs) {
          try {report.liveGoogle.cases.push(await runCase(pair, mode, true));}
          catch (error) {report.liveGoogle.cases.push({...pair, mode, status: 'failed', error: error.stack || String(error)});}
        }
      }
      report.liveGoogle.ok = report.liveGoogle.cases.every(item => item.status === 'passed');
      report.liveGoogle.evidenceBoundary = 'These requests use the actual Google provider without a fixture response; failures can include network or remote-service limitations and are reported separately from deterministic fixture results.';
    }
    assert.equal(report.windowPlacement.mode, 'background-visible-no-focus');
    assert.equal(report.windowPlacement.browserFrontmost, false);
    report.ok = report.fixture.ok && (!report.liveGoogle.requested || report.liveGoogle.ok);
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    report.error = error.stack || String(error);
    if (currentPage && !currentPage.isClosed()) {
      await currentPage.screenshot({path: path.join(artifactsDir, 'failure.png')}).catch(() => {});
      report.visibleText = await currentPage.locator('body').innerText().catch(() => '');
    }
    process.exitCode = 1;
  } finally {
    report.fixture.requests = fixture.requests;
    fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
    await launched?.close();
    await fixture.close();
    fs.rmSync(profileDir, {recursive: true, force: true});
    process.stdout.write(`${JSON.stringify({ok: report.ok, fixtureOk: report.fixture.ok,
      fixtureCases: report.fixture.cases.length, liveGoogle: report.liveGoogle, error: report.error, artifactsDir})}\n`);
  }
}
if (require.main === module) main().catch(error => {process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1;});
module.exports = {startFixture, fixtureTranslation, assertScript, paragraphs, pairs};

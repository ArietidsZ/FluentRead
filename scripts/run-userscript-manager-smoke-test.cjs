#!/usr/bin/env node

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');

function parseArgs(argv) {
  if (argv[0] === '--') argv = argv.slice(1);
  const args = {
    timeout: 60000,
    installMode: 'file',
    installLabel: '从文件安装',
    saveLabel: '保存并关闭',
    installedLabel: '脚本已安装。',
  };
  const names = new Set([
    'artifact', 'managerExtension', 'browserPath', 'playwrightRoot',
    'focusSafeHelper', 'artifactsDir', 'timeout', 'installMode',
    'installLabel', 'saveLabel', 'installedLabel',
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const token = argv[index];
    const key = token?.startsWith('--')
      ? token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
      : '';
    const value = argv[index + 1];
    if (!names.has(key) || !value || value.startsWith('--')) {
      throw new Error(`Unknown or incomplete argument: ${token || '<missing>'}`);
    }
    args[key] = value;
  }
  for (const key of ['artifact', 'managerExtension', 'browserPath', 'playwrightRoot', 'focusSafeHelper', 'artifactsDir']) {
    if (!args[key]) throw new Error(`Required argument: --${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
    args[key] = path.resolve(args[key]);
  }
  args.timeout = Number(args.timeout);
  if (!Number.isSafeInteger(args.timeout) || args.timeout < 1000) throw new Error('--timeout must be at least 1000 ms');
  if (!['file', 'url'].includes(args.installMode)) throw new Error('--install-mode must be file or url');
  return args;
}

function requirePlaywright(root) {
  try {
    return require('playwright');
  } catch {
    return createRequire(path.join(root, '__fluentread_manager_loader__.cjs'))('playwright');
  }
}

function requireFocusSafeHelper(helperPath) {
  const helper = require(helperPath);
  for (const method of ['launchFocusSafePersistentContext', 'newPageWithoutForeground']) {
    if (typeof helper[method] !== 'function') throw new Error(`Focus-safe helper lacks ${method}`);
  }
  return helper;
}

function readUserscriptMetadata(source) {
  if (!source.startsWith('// ==UserScript==\n')) throw new Error('Artifact lacks userscript metadata');
  const version = source.match(/^\/\/ @version\s+(\S+)$/m)?.[1];
  const requires = [...source.matchAll(/^\/\/ @require\s+(https:\/\/\S+)$/gm)].map((match) => match[1]);
  if (!version || requires.length === 0) throw new Error('Artifact lacks version or @require declarations');
  return {version, requires};
}

function managerName(extensionPath, manifest) {
  const key = /^__MSG_(.+)__$/.exec(manifest.name)?.[1];
  if (!key) return manifest.name;
  const localePath = path.join(extensionPath, '_locales', manifest.default_locale, 'messages.json');
  if (!fs.existsSync(localePath)) return manifest.name;
  const messages = JSON.parse(fs.readFileSync(localePath, 'utf8'));
  return messages[key]?.message || manifest.name;
}

async function startFixture(artifactBytes) {
  const original = 'FluentRead keeps the original paragraph and adds a safe bilingual translation.';
  const server = http.createServer((request, response) => {
    if (request.url === '/candidate.user.js') {
      response.writeHead(200, {'content-type': 'application/javascript; charset=utf-8'});
      response.end(artifactBytes);
      return;
    }
    response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>FluentRead manager smoke</title></head><body><main><h1>FluentRead manager smoke</h1><p id="target">${original}</p></main></body></html>`);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    original,
    url: `http://127.0.0.1:${server.address().port}/fixture`,
    installUrl: `http://127.0.0.1:${server.address().port}/candidate.user.js`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function withSettingsShadow(page, callback, values = []) {
  const cdp = await page.context().newCDPSession(page);
  let objectId;
  try {
    const {root} = await cdp.send('DOM.getDocument', {depth: -1, pierce: true});
    const find = (node) => {
      const attributes = node.attributes || [];
      if (attributes.includes('id')
        && attributes[attributes.indexOf('id') + 1] === 'fluent-read-userscript-settings-container') return node;
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) {
        const found = find(child);
        if (found) return found;
      }
      return null;
    };
    const shadow = find(root)?.shadowRoots?.[0];
    if (!shadow) throw new Error('Settings closed Shadow DOM was not found by browser inspection');
    const resolved = await cdp.send('DOM.resolveNode', {nodeId: shadow.nodeId});
    objectId = resolved.object.objectId;
    const result = await cdp.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: callback.toString(),
      arguments: values.map((value) => ({value})),
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  } finally {
    if (objectId) await cdp.send('Runtime.releaseObject', {objectId}).catch(() => {});
    await cdp.detach();
  }
}

async function readFloatingBallSetting(page) {
  return withSettingsShadow(page, function () {
    const label = [...this.querySelectorAll('label.toggle')]
      .find((item) => item.textContent.includes('显示全文翻译悬浮球'));
    const input = label?.querySelector('input[type="checkbox"]');
    if (!input) throw new Error('Floating ball setting was not found');
    return input.checked;
  });
}

async function saveFloatingBallSetting(page, enabled, timeout) {
  const before = await withSettingsShadow(page, function (nextValue) {
    const label = [...this.querySelectorAll('label.toggle')]
      .find((item) => item.textContent.includes('显示全文翻译悬浮球'));
    const input = label?.querySelector('input[type="checkbox"]');
    if (!input) throw new Error('Floating ball setting was not found');
    const previous = input.checked;
    if (previous !== nextValue) input.click();
    const save = this.querySelector('footer button.primary');
    if (!save || save.disabled) throw new Error('Settings save button is not ready');
    save.click();
    return previous;
  }, [enabled]);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const status = await withSettingsShadow(page, function () {
      return this.querySelector('footer .status')?.textContent || '';
    });
    if (status.includes('设置已保存')) return {before, status};
    if (status.includes('保存失败')) throw new Error(`Settings save failed: ${status}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Settings did not report a completed save');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const key of ['artifact', 'managerExtension', 'browserPath', 'focusSafeHelper']) {
    if (!fs.existsSync(args[key])) throw new Error(`Missing ${key}: ${args[key]}`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(args.managerExtension, 'manifest.json'), 'utf8'));
  if (manifest.manifest_version !== 3) throw new Error('This smoke test expects a Manifest V3 userscript manager');
  const artifactBytes = fs.readFileSync(args.artifact);
  const metadata = readUserscriptMetadata(artifactBytes.toString('utf8'));
  const {chromium} = requirePlaywright(args.playwrightRoot);
  const focusSafe = requireFocusSafeHelper(args.focusSafeHelper);
  fs.mkdirSync(args.artifactsDir, {recursive: true});
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-userscript-manager-'));
  let session;
  let fixture;
  const evidence = {
    manager: `${managerName(args.managerExtension, manifest)} ${manifest.version}`,
    userscriptVersion: metadata.version,
    browserPath: args.browserPath,
    artifact: args.artifact,
    installMode: args.installMode,
    requires: metadata.requires,
    responses: [],
    requestFailures: [],
    consoleErrors: [],
  };
  try {
    fixture = await startFixture(artifactBytes);
    session = await focusSafe.launchFocusSafePersistentContext({
      chromium,
      profileDir: profile,
      browserPath: args.browserPath,
      headless: false,
      background: true,
      browserArgs: [
        '--no-first-run',
        '--no-default-browser-check',
        `--disable-extensions-except=${args.managerExtension}`,
        `--load-extension=${args.managerExtension}`,
      ],
      viewport: {width: 1280, height: 900},
      timeout: args.timeout,
    });
    const context = session.context;
    const requested = new Set(metadata.requires);
    const successfulRequires = new Set();
    context.on('response', (response) => {
      if (!requested.has(response.url())) return;
      evidence.responses.push({url: response.url(), status: response.status()});
    });
    context.on('requestfinished', (request) => {
      if (!requested.has(request.url())) return;
      void request.response().then((response) => {
        if (response && response.status() >= 200 && response.status() < 400) successfulRequires.add(request.url());
      }).catch((error) => {
        evidence.requestFailures.push({url: request.url(), error: error.message});
      });
    });
    context.on('requestfailed', (request) => {
      if (requested.has(request.url())) evidence.requestFailures.push({url: request.url(), error: request.failure()?.errorText});
    });
    const isManagerWorker = (worker) => worker.url().endsWith('/sw.js');
    const worker = context.serviceWorkers().find(isManagerWorker)
      || await context.waitForEvent('serviceworker', {predicate: isManagerWorker, timeout: args.timeout});
    const managerId = new URL(worker.url()).host;
    evidence.managerId = managerId;
    const managerPage = await focusSafe.newPageWithoutForeground(context, args.timeout);
    await managerPage.goto(`chrome://extensions/?id=${managerId}`, {waitUntil: 'domcontentloaded'});
    const permission = managerPage.locator('extensions-detail-view extensions-toggle-row#allow-user-scripts');
    await permission.waitFor({state: 'visible', timeout: args.timeout});
    if (await permission.getAttribute('checked') === null) await permission.locator('cr-toggle').click();
    if (await permission.getAttribute('checked') === null) throw new Error('User scripts permission did not enable');

    const installStartedAt = Date.now();
    if (args.installMode === 'file') {
      await managerPage.goto(`chrome-extension://${managerId}/options/index.html`, {waitUntil: 'domcontentloaded'});
      const [chooser] = await Promise.all([
        managerPage.waitForEvent('filechooser', {timeout: args.timeout}),
        managerPage.getByText(args.installLabel, {exact: true}).click(),
      ]);
      await chooser.setFiles(args.artifact);
      await managerPage.getByText(args.saveLabel, {exact: true}).click();
      await managerPage.getByText('FluentRead-流畅阅读', {exact: false}).first().waitFor({timeout: args.timeout});
    } else {
      // Opening a .user.js URL follows the same confirmation path as a public script link.
      // Violentmonkey redirects the navigation, which may reject the original goto promise.
      try {
        await managerPage.goto(fixture.installUrl, {waitUntil: 'domcontentloaded'});
      } catch (error) {
        if (!managerPage.url().includes('/confirm/index.html')) throw error;
      }
      await managerPage.waitForURL(/\/confirm\/index\.html/, {timeout: args.timeout});
      await managerPage.locator('button#confirm').click({timeout: args.timeout});
      await managerPage.getByText(args.installedLabel, {exact: false}).waitFor({timeout: args.timeout});
      await managerPage.goto(`chrome-extension://${managerId}/options/index.html`, {waitUntil: 'domcontentloaded'});
      await managerPage.waitForFunction((version) => {
        const text = document.body.innerText;
        return text.includes('FluentRead-流畅阅读') && text.includes(version);
      }, metadata.version, {timeout: args.timeout});
      evidence.dashboardRegistered = true;
    }
    // The editor can close while Violentmonkey is still downloading @require files.
    // A new tab opened in that interval can receive the entry before Vue is available.
    while (successfulRequires.size < requested.size && Date.now() - installStartedAt < args.timeout) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    evidence.requireReadyMs = Date.now() - installStartedAt;
    if (successfulRequires.size < requested.size) throw new Error('Script manager did not finish @require downloads');
    evidence.managerInstalled = true;

    const page = await focusSafe.newPageWithoutForeground(context, args.timeout);
    page.on('console', (message) => {
      if (message.type() === 'error') evidence.consoleErrors.push(message.text().slice(0, 300));
    });
    page.on('pageerror', (error) => evidence.consoleErrors.push((error.stack || error.message).slice(0, 600)));
    await page.goto(fixture.url, {waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => Boolean(
      document.querySelector('#fluent-read-page-styles')
      && document.querySelector('#fluent-read-floating-ball-container')
    ), undefined, {timeout: args.timeout});
    evidence.initial = await page.evaluate(() => ({
      url: location.href,
      original: document.querySelector('#target')?.textContent,
      pageVue: typeof window.Vue,
      pageElementPlus: typeof window.ElementPlus,
    }));
    evidence.desktopScreenshot = path.join(args.artifactsDir, 'desktop.png');
    evidence.mobileScreenshot = path.join(args.artifactsDir, 'mobile.png');
    await page.screenshot({path: evidence.desktopScreenshot});
    await page.setViewportSize({width: 390, height: 844});
    await page.screenshot({path: evidence.mobileScreenshot});
    await page.setViewportSize({width: 1280, height: 900});

    await page.evaluate(() => window.dispatchEvent(new CustomEvent('fluentread-userscript-open-settings')));
    await page.waitForFunction(() => Boolean(document.querySelector('#fluent-read-userscript-settings-container')), undefined, {timeout: args.timeout});
    evidence.settings = await page.evaluate(() => ({
      open: Boolean(document.querySelector('#fluent-read-userscript-settings-container')),
      closedShadow: document.querySelector('#fluent-read-userscript-settings-container')?.shadowRoot === null,
    }));
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('fluentread-userscript-close-settings')));

    const toggle = async (expected) => {
      await page.keyboard.down('Alt');
      await page.keyboard.press('t');
      await page.keyboard.up('Alt');
      await page.waitForFunction((count) =>
        document.querySelectorAll('#target .fluent-read-bilingual-content').length === count,
      expected, {timeout: args.timeout});
      return page.evaluate(() => ({
        count: document.querySelectorAll('#target .fluent-read-bilingual-content').length,
        original: document.querySelector('#target')?.firstChild?.textContent,
        translation: document.querySelector('#target .fluent-read-bilingual-content')?.textContent || '',
        url: location.href,
      }));
    };
    evidence.translated = await toggle(1);
    evidence.translatedScreenshot = path.join(args.artifactsDir, 'translated.png');
    await page.screenshot({path: evidence.translatedScreenshot});
    evidence.restored = await toggle(0);
    evidence.retranslated = await toggle(1);

    // Exercise the actual manager-backed GM storage, not just a simulated API.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('fluentread-userscript-open-settings')));
    await page.locator('#fluent-read-userscript-settings-container').waitFor({state: 'attached', timeout: args.timeout});
    evidence.persistence = {initial: await readFloatingBallSetting(page)};
    if (!evidence.persistence.initial) throw new Error('Floating ball was disabled before persistence test');
    evidence.persistence.disabled = await saveFloatingBallSetting(page, false, args.timeout);
    await page.locator('#fluent-read-floating-ball-container').waitFor({state: 'detached', timeout: args.timeout});
    await page.reload({waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => Boolean(document.querySelector('#fluent-read-page-styles')), undefined, {timeout: args.timeout});
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('fluentread-userscript-open-settings')));
    await page.locator('#fluent-read-userscript-settings-container').waitFor({state: 'attached', timeout: args.timeout});
    evidence.persistence.afterReload = await readFloatingBallSetting(page);
    if (evidence.persistence.afterReload || await page.locator('#fluent-read-floating-ball-container').count()) {
      throw new Error('Floating ball preference was lost after reloading the userscript page');
    }
    evidence.persistence.reenabled = await saveFloatingBallSetting(page, true, args.timeout);
    await page.locator('#fluent-read-floating-ball-container').waitFor({state: 'attached', timeout: args.timeout});
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('fluentread-userscript-close-settings')));
    evidence.windowPlacement = session.windowPlacement;
    evidence.focusPolicy = session.focusPolicy;

    for (const url of metadata.requires) {
      if (!successfulRequires.has(url)) throw new Error(`@require did not return success: ${url}`);
    }
    if (evidence.requestFailures.length || evidence.consoleErrors.length) throw new Error('Network or console errors occurred');
    if (evidence.initial.original !== fixture.original) throw new Error('Initial source text changed');
    if (evidence.initial.pageVue !== 'undefined' || evidence.initial.pageElementPlus !== 'undefined') {
      throw new Error('Userscript leaked UI globals into the host page');
    }
    if (!evidence.settings.open || !evidence.settings.closedShadow) throw new Error('Settings did not open in a closed Shadow DOM');
    if (![evidence.translated, evidence.restored, evidence.retranslated].every((state) =>
      state.original === fixture.original && state.url === fixture.url)) throw new Error('Translation altered the original page');
    if (!/[\u3400-\u9fff]/u.test(evidence.translated.translation)
      || !/[\u3400-\u9fff]/u.test(evidence.retranslated.translation)) throw new Error('Translation did not produce Chinese text');
    if (evidence.windowPlacement?.mode !== 'background-visible-no-focus'
      || evidence.windowPlacement.browserFrontmost !== false
      || evidence.focusPolicy !== 'launchservices-no-foreground') throw new Error('Browser focus isolation failed');
    evidence.status = 'passed';
  } catch (error) {
    evidence.status = 'failed';
    evidence.failure = error.message;
    throw error;
  } finally {
    fs.writeFileSync(path.join(args.artifactsDir, 'evidence.json'), JSON.stringify(evidence, null, 2));
    try {
      if (session) await session.close();
    } finally {
      if (fixture) await fixture.close();
      fs.rmSync(profile, {recursive: true, force: true});
    }
  }
  console.log(`Verified userscript ${metadata.version} in ${evidence.manager}; evidence: ${args.artifactsDir}`);
}

if (require.main === module) main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

module.exports = {parseArgs, readUserscriptMetadata};

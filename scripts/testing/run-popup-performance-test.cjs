'use strict';

// 生产 Popup 冷文档与重复打开性能探针；只使用临时 Edge profile，不接触日常浏览器。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
};
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifactsDir = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-popup-performance'));
const {chromium} = require(path.join(arg('playwright-root', '/Users/thinkstu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'), 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground} = require(arg('focus-safe-helper', '/Users/thinkstu/.codex/skills/fluentread-extension-ui-test/scripts/focus-safe-browser.cjs'));
const report = {extensionDir, samples: [], consoleErrors: []};
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-popup-perf-'));
fs.mkdirSync(artifactsDir, {recursive: true});

async function verifyLanguageMenus(page) {
  const target = page.locator('.language-pair .el-select').nth(1);
  if (!/简体中文/u.test(await target.innerText())) throw new Error('关闭菜单时未显示已保存的目标语言');
  if (await page.locator('.el-select-dropdown__item').count()) throw new Error('关闭菜单仍挂载语言选项');
  await target.locator('.el-select__wrapper').click();
  await target.locator('input').fill('Japanese');
  await page.locator('.el-select-dropdown:visible').getByRole('option', {name: /日本語/u}).waitFor({state: 'visible'});
  await target.locator('input').press('ArrowDown');
  await target.locator('input').press('Enter');
  await page.waitForFunction(async () => (await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'}))?.value?.to === 'ja');
  if (!/日本語/u.test(await target.innerText())) throw new Error('键盘选择后标签未更新');
  await target.locator('.el-select__wrapper').click();
  await target.locator('input').press('Escape');
  await page.waitForFunction(() => !document.querySelector('.el-select-dropdown__item'));

  const patchConfig = async (patch, sequence) => page.evaluate(async ({patch, sequence}) => {
    const current = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
    const result = await chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config: patch,
      expected: Object.fromEntries(Object.keys(patch).map(key => [key, current.value[key]])),
      clientId: 'popup-performance-ui', sequence, baseRevision: current.value.__fluentConfigRevision || 0});
    if (!result?.success) throw new Error(result?.error || '配置更新失败');
  }, {patch, sequence});
  await patchConfig({to: 'de', uiLanguage: 'en-US', theme: 'dark'}, 1);
  await page.waitForFunction(() => document.documentElement.lang === 'en-US' && document.body.innerText.includes('Settings'));
  await page.waitForFunction(() => /German|Deutsch/u.test(document.querySelectorAll('.language-pair .el-select')[1]?.textContent || ''));
  await page.screenshot({path: path.join(artifactsDir, 'popup-dark-en.png')});
  await patchConfig({uiLanguage: 'zh-CN'}, 2);
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN' && document.body.innerText.includes('设置'));
  const expected = (await target.innerText()).trim();
  await page.reload({waitUntil: 'load'});
  await page.locator('.popup-shell[data-config-ready="true"]').waitFor({state: 'visible'});
  if ((await page.locator('.language-pair .el-select').nth(1).innerText()).trim() !== expected) throw new Error('重新打开后语言标签未保持');
  return {search: true, keyboardSelection: true, escape: true, closedOptions: 0, crossPageSync: true, languageRoundTrip: true, reopened: true};
}

async function main() {
  let launched;
  try {
    launched = await launchFocusSafePersistentContext({
      chromium, profileDir, browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      headless: false, background: true, viewport: {width: 1440, height: 1000}, timeout: 30000,
      browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check'],
    });
    const {context} = launched;
    Object.assign(report, {launchMode: launched.launchMode, focusPolicy: launched.focusPolicy, windowPlacement: launched.windowPlacement});
    const worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://'))
      || await context.waitForEvent('serviceworker', {timeout: 30000});
    const extensionOrigin = `chrome-extension://${new URL(worker.url()).host}`;
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
    report.manifestEntrypoint = manifest.action.default_popup;
    // 用扩展自带图片文档调用真实配置端口，不加载 popup/options JS；配置实际由后台加密仓库保存。
    const setup = await newPageWithoutForeground(context, 30000);
    await setup.goto(`${extensionOrigin}/icon/128.png`);
    await setup.evaluate(async () => {
      const current = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      if (!current?.success) throw new Error('无法读取性能测试配置');
      const patch = {uiLanguageSetupCompleted: true, uiLanguage: 'zh-CN', interfaceSkin: 'default', interfaceFont: 'system'};
      const response = await chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config: patch,
        expected: Object.fromEntries(Object.keys(patch).map(key => [key, current.value[key]])),
        clientId: 'popup-performance-setup', sequence: 1, baseRevision: current.value.__fluentConfigRevision || 0});
      if (!response?.success) throw new Error(`无法准备性能测试配置: ${response?.error || '无响应'}`);
      const saved = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      if (!saved?.value?.uiLanguageSetupCompleted) throw new Error('性能测试配置未持久化');
    });
    await setup.close();
    for (let index = 0; index < 7; index++) {
      const page = await newPageWithoutForeground(context, 30000);
      page.on('pageerror', error => report.consoleErrors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
      await page.setViewportSize({width: 400, height: 600});
      await page.addInitScript(() => {
        window.__popupPerf = {readyMs: null, longTasks: [], treeWalks: 0};
        const original = Document.prototype.createTreeWalker;
        Document.prototype.createTreeWalker = function (...args) { window.__popupPerf.treeWalks++; return original.apply(this, args); };
        new PerformanceObserver(list => window.__popupPerf.longTasks.push(...list.getEntries().map(entry => ({start: entry.startTime, duration: entry.duration})))).observe({type: 'longtask', buffered: true});
        const observer = new MutationObserver(() => {
          if (document.querySelector('.popup-shell[data-config-ready="true"]') && window.__popupPerf.readyMs === null) {
            window.__popupPerf.readyMs = performance.now();
            requestAnimationFrame(() => { window.__popupPerf.frameMs = performance.now(); });
            observer.disconnect();
          }
        });
        observer.observe(document, {subtree: true, childList: true, attributes: true});
      });
      const session = await context.newCDPSession(page);
      await session.send('Performance.enable');
      await session.send('Network.enable');
      await session.send('Network.setCacheDisabled', {cacheDisabled: true});
      if (index === 0 && process.argv.includes('--cold-worker')) {
        // 仅操作本次隔离实例；首个配置请求必须重新唤醒扩展后台。
        const versions = new Map();
        session.on('ServiceWorker.workerVersionUpdated', event => {
          for (const version of event.versions) versions.set(version.versionId, version);
        });
        await session.send('ServiceWorker.enable');
        await session.send('ServiceWorker.stopAllWorkers');
        const deadline = Date.now() + 10000;
        while (![...versions.values()].some(version => version.scriptURL.startsWith(extensionOrigin) && version.runningStatus === 'stopped')) {
          if (Date.now() >= deadline) throw new Error('未确认隔离扩展后台已停止，不能报告后台冷启动数据');
          await page.waitForTimeout(50);
        }
        report.coldWorkerStopped = true;
      }
      await page.goto(`${extensionOrigin}/${manifest.action.default_popup}`, {waitUntil: 'load'});
      await page.locator('.popup-shell[data-config-ready="true"]').waitFor({state: 'visible'});
      if (await page.locator('.language-onboarding-shell').count()) throw new Error('正常菜单性能用例意外进入首次安装引导');
      await page.waitForTimeout(250);
      const sample = await page.evaluate(() => ({...window.__popupPerf,
        domNodes: document.querySelectorAll('*').length,
        hiddenOptions: document.querySelectorAll('.el-select-dropdown__item').length,
        width: document.querySelector('.popup-shell').getBoundingClientRect().width,
        height: document.querySelector('.popup-shell').getBoundingClientRect().height,
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      }));
      const {metrics} = await session.send('Performance.getMetrics');
      sample.metrics = Object.fromEntries(metrics.filter(item => ['ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'TaskDuration', 'JSHeapUsedSize', 'LayoutCount'].includes(item.name)).map(item => [item.name, item.value]));
      sample.index = index;
      report.samples.push(sample);
      if (index === 0) {
        await page.screenshot({path: path.join(artifactsDir, 'popup.png')});
        // 记录浏览器实际解析的脚本字节，不依赖扩展协议缺失的 Resource Timing。
        const parsed = new Set();
        session.on('Debugger.scriptParsed', event => { if (event.url.startsWith(extensionOrigin)) parsed.add(new URL(event.url).pathname); });
        await session.send('Debugger.enable');
        report.initialScripts = [...parsed].map(file => ({file, bytes: fs.statSync(path.join(extensionDir, file)).size}));
        report.initialScriptBytes = report.initialScripts.reduce((sum, item) => sum + item.bytes, 0);
      }
      if (index === 6 && process.argv.includes('--verify-ui')) report.languageMenus = await verifyLanguageMenus(page);
      await session.detach();
      await page.close();
    }
    const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    report.median = {readyMs: median(report.samples.map(item => item.readyMs)), frameMs: median(report.samples.map(item => item.frameMs)), scriptMs: median(report.samples.map(item => item.metrics.ScriptDuration * 1000))};
    report.ok = report.consoleErrors.length === 0 && report.samples.every(item => !item.overflowX && item.height <= 600);
    if (!report.ok) throw new Error('Popup 性能采样发现控制台或布局异常');
  } finally {
    fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
    await launched?.close().catch(() => {});
    fs.rmSync(profileDir, {recursive: true, force: true});
  }
  console.log(JSON.stringify({ok: report.ok, median: report.median, initialScriptBytes: report.initialScriptBytes, first: report.samples[0]}, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });

#!/usr/bin/env node
// Production-extension regression for an open X menu whose native controls unmount.
// Uses seeded transcript cues and a deterministic translation response, not live ASR.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');
const {spawnSync} = require('node:child_process');
const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
};
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifacts = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-video-menu-state'));
const helperPath = arg('focus-safe-helper');
const playwrightRoot = arg('playwright-root');
if (!helperPath || !playwrightRoot) throw new Error('Explicit focus-safe helper and Playwright runtime are required');
const helper = require(path.resolve(helperPath));
const {chromium} = createRequire(path.join(playwrightRoot, 'video-menu-proof.cjs'))('playwright');
fs.mkdirSync(artifacts, {recursive: true});
const mediaFile = path.join(artifacts, 'fixture.mp4');
const media = spawnSync(arg('ffmpeg', '/opt/homebrew/bin/ffmpeg'), [
  '-y', '-f', 'lavfi', '-i', 'color=c=0x10283f:s=960x540:r=10',
  '-t', '10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mediaFile,
], {encoding: 'utf8'});
assert.equal(media.status, 0, media.stderr);
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-menu-state-'));
const report = {success: false, evidence: 'Production extension; X DOM fixture; seeded AI cache; mocked translation; no live ASR', checks: [], errors: []};
let session;
let page;
async function main() {
  session = await helper.launchFocusSafePersistentContext({
    chromium, profileDir,
    browserPath: arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
    headless: false, background: true, displayTarget: 'secondary', viewport: {width: 1280, height: 900},
    browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check'],
  });
  const {context} = session;
  Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
  context.on('page', candidate => candidate.on('pageerror', error => report.errors.push(error.message)));
  const worker = context.serviceWorkers().find(candidate => candidate.url().endsWith('/background.js'))
    || await context.waitForEvent('serviceworker', {predicate: candidate => candidate.url().endsWith('/background.js')});
  const id = new URL(worker.url()).host;
  await worker.evaluate(() => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => String(input?.url || input).startsWith('https://edge.microsoft.com/translate/translatetext')
      ? new Response(JSON.stringify([{translations: [{text: '字幕菜单同步测试'}]}]), {status: 200, headers: {'content-type': 'application/json'}})
      : originalFetch(input, init);
  });
  const control = await helper.newPageWithoutForeground(context);
  await control.goto(`chrome-extension://${id}/popup.html`);
  let sequence = 0;
  const patchConfig = async patch => {
    const response = await control.evaluate(async ({patch, sequence}) => {
      const stored = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      if (!stored.success) throw new Error('Cannot read fixture configuration');
      const current = typeof stored.value === 'string' ? JSON.parse(stored.value) : stored.value || {};
      return chrome.runtime.sendMessage({type: 'persistConfig', clientId: 'video-menu-state-proof', sequence,
        config: {...current, ...patch}, ...(Number.isSafeInteger(current.__fluentConfigRevision) ? {baseRevision: current.__fluentConfigRevision} : {})});
    }, {patch, sequence: ++sequence});
    assert.equal(response.success, true);
  };
  await patchConfig({on: true, uiLanguage: 'zh-CN', from: 'en', to: 'zh-Hans',
    videoTranslationEnabled: true, videoSubtitleVisible: true, videoSubtitleDisplayMode: 'bilingual',
    videoService: 'microsoft', videoServiceDefaultMigrated: true, videoLocalModel: 'tiny', videoSourceLanguage: 'auto'});
  const cached = await control.evaluate(() => chrome.runtime.sendMessage({type: 'fluentReadSetVideoAiSubtitleCache',
    source: {mediaId: '424242'}, model: 'tiny', sourceLanguage: 'auto',
    cues: [{startMs: 0, durationMs: 10000, text: 'Subtitle menu state fixture.'}]}));
  assert.equal(cached.cached, true);
  const url = 'https://x.com/fluentread/status/424242';
  await context.route('https://video.twimg.com/**', route => route.fulfill({contentType: 'video/mp4', body: fs.readFileSync(mediaFile)}));
  await context.route(url, route => route.fulfill({contentType: 'text/html', body: `<!doctype html><html><body style="margin:24px;background:#f3f5f9">
    <h1>字幕菜单状态同步</h1><article><div data-testid="videoPlayer" style="position:relative;width:960px;height:540px">
    <video src="https://video.twimg.com/ext_tw_video/424242/pu/fixture.mp4" style="width:100%;height:100%" muted></video>
    <div class="fixture-controls" style="position:absolute;bottom:0;display:flex;width:100%;height:44px;background:#222">
    <button aria-label="Play">Play</button><button aria-label="Settings">Settings</button></div></div></article></body></html>`}));
  page = await helper.newPageWithoutForeground(context);
  await page.goto(url);
  await helper.activateExtensionTabWithoutForeground({serviceWorkers: () => [worker]}, page);
  await page.locator('video').hover();
  const menu = page.locator('#fluent-read-video-subtitle-menu');
  const action = name => menu.locator(`[data-action="${name}"]`);
  const checked = async (locator, expected) => {
    await locator.evaluate((element, value) => new Promise((resolve, reject) => {
      const started = Date.now();
      const poll = () => element.getAttribute('aria-checked') === String(value) ? resolve()
        : Date.now() - started > 2500 ? reject(new Error(`Stale menu: ${element.dataset.action || element.dataset.mode} expected ${value}; got ${element.outerHTML}`))
          : setTimeout(poll, 25);
      poll();
    }), expected);
  };
  const screenshot = async name => {
    await menu.screenshot({path: path.join(artifacts, `${name}.png`)});
    fs.writeFileSync(path.join(artifacts, `${name}.html`), await menu.evaluate(element => element.outerHTML));
  };
  await page.locator('#fluent-read-video-subtitle-button').click();
  await checked(action('toggle-ai-subtitle'), true);
  await screenshot('ready');
  await page.evaluate(() => {
    window.fixtureControls = document.querySelector('.fixture-controls');
    window.fixtureMenu = document.querySelector('#fluent-read-video-subtitle-menu');
    window.fixtureControls.remove();
  });
  await page.waitForFunction(() => !document.querySelector('#fluent-read-video-subtitle-button'));
  await action('toggle-ai-subtitle').click();
  await screenshot('after-close-ai');
  await checked(action('toggle-ai-subtitle'), false);
  assert.match(await action('toggle-ai-subtitle').innerText(), /生成 AI 字幕/);
  assert.equal(await action('toggle-ai-subtitle').locator('[data-state]').innerText(), '');
  await page.waitForFunction(() => !document.querySelector('#fluent-read-video-subtitle-original')?.textContent);
  report.checks.push('关闭 AI 后字幕消失，按钮和已就绪状态立即更新');
  await action('toggle-ai-subtitle').click();
  await checked(action('toggle-ai-subtitle'), true);
  for (const value of [false, true, false, true]) {
    await action('toggle-visible').click();
    await checked(action('toggle-visible'), value);
    await page.waitForFunction(visible => {
      const layer = document.querySelector('#fluent-read-video-subtitle-layer');
      return visible ? layer && getComputedStyle(layer).display !== 'none'
        : !layer || getComputedStyle(layer).display === 'none' || !layer.textContent;
    }, value);
  }
  report.checks.push('隐藏与显示字幕可连续切换');
  for (const mode of ['translation-only', 'original-only', 'bilingual']) {
    await menu.locator(`[data-mode="${mode}"]`).click();
    for (const candidate of ['translation-only', 'original-only', 'bilingual']) {
      await checked(menu.locator(`[data-mode="${candidate}"]`), candidate === mode);
    }
    await page.waitForFunction(selected => {
      const layer = document.querySelector('#fluent-read-video-subtitle-layer');
      return layer && ['translation-only', 'original-only'].every(candidate =>
        layer.classList.contains(`fluent-read-video-display-${candidate}`) === (selected === candidate));
    }, mode);
  }
  report.checks.push('三种显示模式同步且保持单选');
  await action('toggle-translation').click();
  await checked(action('toggle-translation'), false);
  await checked(action('toggle-ai-subtitle'), false);
  await action('toggle-translation').click();
  await checked(action('toggle-translation'), true);
  await checked(action('toggle-ai-subtitle'), true);
  report.checks.push('翻译开关与 AI 关闭及缓存恢复联动');
  await patchConfig({videoSubtitleVisible: false, videoSubtitleDisplayMode: 'original-only'});
  await checked(action('toggle-visible'), false);
  await checked(menu.locator('[data-mode="original-only"]'), true);
  await patchConfig({videoSubtitleVisible: true, videoSubtitleDisplayMode: 'bilingual'});
  await checked(action('toggle-visible'), true);
  report.checks.push('其他扩展页面保存的设置同步到仍打开的菜单');
  // Fail one model-readiness query in the fixture's extension world to exercise
  // regeneration feedback without downloading or running a speech model.
  const probe = await context.newCDPSession(page);
  const worlds = [];
  probe.on('Runtime.executionContextCreated', event => worlds.push(event.context));
  await probe.send('Runtime.enable');
  let world;
  for (const candidate of worlds.filter(candidate => candidate.auxData?.isDefault === false)) {
    const identity = await probe.send('Runtime.evaluate', {contextId: candidate.id, returnByValue: true,
      expression: 'globalThis.chrome?.runtime?.id'});
    if (identity.result?.value === id) { world = candidate; break; }
  }
  assert.ok(world, 'FluentRead isolated world is available');
  await probe.send('Runtime.evaluate', {contextId: world.id, expression: `(() => {
    const runtime = chrome.runtime, send = runtime.sendMessage;
    runtime.sendMessage = function(...args) {
      if (args[0]?.type !== 'fluentReadGetLocalVideoModelState') return send.apply(runtime, args);
      runtime.sendMessage = send;
      const response = {success:false,error:'fixture readiness failure'};
      const callback = args[args.length - 1];
      if (typeof callback === 'function') { queueMicrotask(() => callback(response)); return; }
      return Promise.resolve(response);
    };
  })()`});
  await menu.locator('summary').click();
  await action('regenerate-ai-subtitle').click();
  await page.waitForFunction(() => document.querySelector('[data-action="toggle-ai-subtitle"]')?.title === '无法读取模型状态，请重试');
  assert.equal(await action('regenerate-ai-subtitle').isEnabled(), true);
  await checked(action('toggle-ai-subtitle'), true);
  await probe.detach();
  await action('toggle-ai-subtitle').click();
  await checked(action('toggle-ai-subtitle'), false);
  await action('toggle-ai-subtitle').click();
  await checked(action('toggle-ai-subtitle'), true);
  await menu.locator('summary').click();
  report.checks.push('AI 说明可展开，重新识别遇到模型查询失败会更新反馈并允许重试');
  for (const name of ['download-subtitles', 'download-translated-subtitles']) {
    const downloaded = page.waitForEvent('download');
    await action(name).click();
    const download = await downloaded;
    const destination = path.join(artifacts, `${name}.srt`);
    await download.saveAs(destination);
    assert.match(fs.readFileSync(destination, 'utf8'), /00:00:00,000 --> 00:00:10,000/);
    assert.match(await action(name).innerText(), /1/);
  }
  report.checks.push('原文和译文下载及结果反馈正常');
  await screenshot('controls-absent');
  await page.evaluate(() => document.querySelector('[data-testid="videoPlayer"]').append(window.fixtureControls));
  await page.locator('#fluent-read-video-subtitle-button').waitFor({state: 'attached'});
  assert.equal(await page.evaluate(() => window.fixtureMenu === document.querySelector('#fluent-read-video-subtitle-menu')), true);
  await page.locator('#fluent-read-video-subtitle-button').click();
  if (!(await menu.isVisible())) await page.locator('#fluent-read-video-subtitle-button').click();
  await checked(action('toggle-translation'), true);
  await checked(action('toggle-visible'), true);
  await screenshot('controls-restored');
  await menu.press('Escape');
  assert.equal(await menu.isVisible(), false);
  report.checks.push('控制栏重挂载保留菜单节点与状态，Esc 正常关闭');
  await page.locator('#fluent-read-video-subtitle-button').click();
  const optionsCreated = context.waitForEvent('page');
  await action('open-settings').click();
  const options = await optionsCreated;
  await options.waitForURL(/options.html/);
  report.checks.push('设置入口打开视频设置');
  await options.close();
  assert.deepEqual(report.errors, []);
  report.success = true;
}
main().catch(async error => {
  report.failure = error.stack;
  if (page) await page.screenshot({path: path.join(artifacts, 'failure.png')}).catch(() => {});
  process.exitCode = 1;
}).finally(async () => {
  fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await session?.close();
  fs.rmSync(profileDir, {recursive: true, force: true});
});

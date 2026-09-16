#!/usr/bin/env node
// Production-extension regression for X control placement and menu state across remounts.
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
    globalThis.fixtureTranslationCalls = 0;
    globalThis.fetch = async (input, init) => {
      if (!String(input?.url || input).startsWith('https://edge.microsoft.com/translate/translatetext')) return originalFetch(input, init);
      globalThis.fixtureTranslationCalls += 1;
      return new Response(JSON.stringify([{translations: [{text: '字幕菜单同步测试'}]}]), {status: 200, headers: {'content-type': 'application/json'}});
    };
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
  await context.route(url, route => route.fulfill({contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>
    .fixture-controls{position:absolute;bottom:0;left:12px;right:12px;display:flex;align-items:center;height:44px;background:#222;color:#fff}
    .fixture-controls button{display:flex;align-items:center;justify-content:center;width:32px;height:32px;flex:none;padding:0;border:0;background:transparent;color:#fff;font-size:20px}
    .fixture-time{flex:1;min-width:0;font:12px Arial;white-space:nowrap;overflow:hidden}
    .fixture-actions{display:flex;align-items:center;flex:none}
    [data-testid="videoPlayer"]:fullscreen{width:100vw!important;height:100vh!important}
    </style></head><body style="margin:24px;background:#f3f5f9">
    <h1>字幕菜单状态同步</h1><article><div data-testid="videoPlayer" style="position:relative;width:960px;height:540px;overflow:hidden">
    <video src="https://video.twimg.com/ext_tw_video/424242/pu/fixture.mp4" style="width:100%;height:100%" muted></video>
    <div class="fixture-controls"><button aria-label="Play" onclick="this.dataset.clicked='true'">▶</button><span class="fixture-time">0:02 / 0:13</span>
    <div class="fixture-actions"><button aria-label="Captions">▣</button><button aria-label="Volume">◖</button><button aria-label="Settings">⚙</button>
    <div id="fixture-pip"><button aria-label="Picture in picture" onclick="this.dataset.clicked='true'">▣</button></div>
    <div id="fixture-fullscreen"><button aria-label="Full screen" onclick="this.closest('[data-testid=videoPlayer]').requestFullscreen()">⛶</button></div>
    </div></div></div></article></body></html>`}));
  page = await helper.newPageWithoutForeground(context);
  await page.goto(url);
  await helper.activateExtensionTabWithoutForeground({serviceWorkers: () => [worker]}, page);
  await page.locator('video').hover();
  const checkPlacement = async name => {
    await page.waitForFunction(() => {
      const button = document.querySelector('#fluent-read-video-subtitle-button');
      return button?.previousElementSibling?.id === 'fixture-pip' && button?.nextElementSibling?.id === 'fixture-fullscreen';
    });
    const geometry = await page.evaluate(() => {
      const rect = element => {
        const {left, right, top, bottom, width, height} = element.getBoundingClientRect();
        return {left, right, top, bottom, width, height};
      };
      return {
        player: rect(document.querySelector('[data-testid="videoPlayer"]')),
        video: rect(document.querySelector('video')),
        button: rect(document.querySelector('#fluent-read-video-subtitle-button')),
        pip: rect(document.querySelector('#fixture-pip')),
        fullscreen: rect(document.querySelector('#fixture-fullscreen')),
        count: document.querySelectorAll('#fluent-read-video-subtitle-button').length,
      };
    });
    assert.equal(geometry.count, 1);
    assert.ok(geometry.button.width > 0 && geometry.button.height > 0);
    assert.ok(geometry.button.left >= geometry.pip.right - 1 && geometry.button.right <= geometry.fullscreen.left + 1, JSON.stringify(geometry));
    for (const control of [geometry.pip, geometry.button, geometry.fullscreen]) {
      assert.ok(control.left >= geometry.video.left && control.right <= geometry.video.right && control.bottom <= geometry.video.bottom, JSON.stringify(geometry));
    }
    (report.placement ||= []).push({name, ...geometry});
  };
  for (const width of [960, 572, 360, 320]) {
    await page.locator('[data-testid="videoPlayer"]').evaluate((player, width) => player.style.width = width + 'px', width);
    await checkPlacement(`width-${width}`);
  }
  await page.locator('[data-testid="videoPlayer"]').screenshot({path: path.join(artifacts, 'portrait-controls.png')});
  await page.locator('[aria-label="Play"]').click();
  await page.locator('#fixture-pip button').click();
  assert.equal(await page.locator('[aria-label="Play"]').getAttribute('data-clicked'), 'true');
  assert.equal(await page.locator('#fixture-pip button').getAttribute('data-clicked'), 'true');
  await page.evaluate(() => document.querySelector('.fixture-actions').append(document.querySelector('#fluent-read-video-subtitle-button')));
  await checkPlacement('host-moved-icon');
  await page.evaluate(() => document.querySelector('#fluent-read-video-subtitle-button').remove());
  await checkPlacement('host-removed-icon');
  await page.locator('#fixture-fullscreen button').click();
  await page.waitForFunction(() => Boolean(document.fullscreenElement));
  await page.locator('#fixture-fullscreen button').evaluate(button => button.setAttribute('aria-label', 'Exit full screen'));
  await checkPlacement('fullscreen');
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement);
  await checkPlacement('exit-fullscreen');
  await page.evaluate(() => {
    const actions = document.querySelector('.fixture-actions');
    const replacement = actions.cloneNode(true);
    replacement.querySelector('#fluent-read-video-subtitle-button')?.remove();
    actions.replaceWith(replacement);
  });
  await checkPlacement('controls-replaced');
  await page.locator('[data-testid="videoPlayer"]').evaluate(player => player.style.width = '960px');
  report.checks.push('320–960px 视频内图标固定在画中画和全屏之间；宿主移位/删除、控件重建、全屏进出后恢复，原生按钮仍可点击');
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
  const modes = ['bilingual', 'translation-only', 'original-only', 'off'];
  const checkedMode = async selected => {
    for (const candidate of modes) await checked(menu.locator(`[data-mode="${candidate}"]`), candidate === selected);
  };
  assert.equal(await menu.locator('[data-action="toggle-translation"], [data-action="toggle-visible"], [data-action="regenerate-ai-subtitle"]').count(), 0);
  for (const mode of ['translation-only', 'original-only', 'bilingual']) {
    await menu.locator(`[data-mode="${mode}"]`).click();
    await checkedMode(mode);
    await page.waitForFunction(selected => {
      const layer = document.querySelector('#fluent-read-video-subtitle-layer');
      return layer && ['translation-only', 'original-only'].every(candidate =>
        layer.classList.contains(`fluent-read-video-display-${candidate}`) === (selected === candidate));
    }, mode);
  }
  report.checks.push('四段显示方式同步且保持单选');
  await menu.locator('[data-mode="off"]').click();
  await checkedMode('off');
  await checked(action('toggle-ai-subtitle'), false);
  await page.waitForFunction(() => !document.querySelector('#fluent-read-video-subtitle-original')?.textContent);
  assert.equal(await menu.locator('[data-timing-row]').isVisible(), false);
  await screenshot('off');
  await menu.locator('[data-mode="bilingual"]').click();
  await checkedMode('bilingual');
  await checked(action('toggle-ai-subtitle'), true);
  report.checks.push('“关闭”停止 AI 并收起时间行，重新选择显示方式后恢复缓存字幕');
  await patchConfig({videoSubtitleVisible: false, videoSubtitleDisplayMode: 'original-only'});
  await checkedMode('off');
  await menu.locator('[data-mode="original-only"]').click();
  await checkedMode('original-only');
  await page.waitForFunction(() => {
    const layer = document.querySelector('#fluent-read-video-subtitle-layer');
    return layer && !layer.classList.contains('fluent-read-video-display-hidden');
  });
  await patchConfig({videoSubtitleVisible: true, videoSubtitleDisplayMode: 'bilingual'});
  await checkedMode('bilingual');
  report.checks.push('其他页面隐藏字幕时菜单显示为关闭，选择任一显示方式即恢复可见');
  // 在扩展隔离世界里按消息类型伪造后台响应：不下载模型，也不运行语音识别。
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
  const fakeResponses = responses => probe.send('Runtime.evaluate', {contextId: world.id, expression: `(() => {
    const runtime = chrome.runtime;
    const send = runtime.__fixtureSend || runtime.sendMessage;
    runtime.__fixtureSend = send;
    const queue = ${JSON.stringify(responses)};
    runtime.sendMessage = function(...args) {
      const responses = queue[args[0]?.type];
      if (!responses?.length) return send.apply(runtime, args);
      const response = responses.shift();
      const callback = args[args.length - 1];
      if (typeof callback === 'function') { queueMicrotask(() => callback(response)); return; }
      return Promise.resolve(response);
    };
  })()`});
  await action('toggle-ai-subtitle').click();
  await checked(action('toggle-ai-subtitle'), false);
  const cleared = await control.evaluate(() => chrome.runtime.sendMessage({type: 'fluentReadClearVideoAiSubtitleCache'}));
  assert.equal(cleared.success, true);
  await fakeResponses({fluentReadGetLocalVideoModelState: [{success: false, error: 'fixture readiness failure'}]});
  await action('toggle-ai-subtitle').click();
  await page.waitForFunction(() => document.querySelector('[data-action="toggle-ai-subtitle"]')?.title === '无法读取模型状态，请重试');
  assert.match(await action('toggle-ai-subtitle').innerText(), /重试生成 AI 字幕/);
  report.checks.push('模型状态读取失败时单行显示错误并允许重试');
  await fakeResponses({
    fluentReadGetLocalVideoModelState: [{success: true, models: []}, {success: true, models: []}],
    fluentReadPrepareLocalVideoModel: [{success: false, error: '模型文件下载失败（503）：config.json'}],
  });
  await action('toggle-ai-subtitle').click();
  const prompt = menu.locator('[data-model-prompt]');
  await prompt.waitFor({state: 'visible'});
  assert.equal(await menu.locator('.fluent-read-video-menu-main').isVisible(), false);
  assert.match(await prompt.innerText(), /约 100 MB[\s\S]*约 150 MB/);
  assert.equal(await prompt.locator('.fluent-read-video-model-option-badge').count(), 1);
  await screenshot('model-prompt');
  const optionsPage = [];
  context.on('page', candidate => optionsPage.push(candidate.url()));
  await prompt.locator('[data-action="model-prompt-cancel"]').first().click();
  await prompt.waitFor({state: 'hidden'});
  assert.equal(await menu.locator('.fluent-read-video-menu-main').isVisible(), true);
  await action('toggle-ai-subtitle').click();
  await prompt.waitFor({state: 'visible'});
  await prompt.locator('[data-model-choice="tiny"]').click();
  await checked(prompt.locator('[data-model-choice="tiny"]'), true);
  assert.equal(await prompt.locator('[data-action="model-prompt-confirm"]').innerText(), '下载并生成');
  await prompt.locator('[data-action="model-prompt-confirm"]').click();
  await page.waitForFunction(() => document.querySelector('[data-action="toggle-ai-subtitle"]')?.title?.startsWith('模型下载失败：'));
  assert.deepEqual(optionsPage.filter(url => url.includes('options.html')), []);
  report.checks.push('首次生成先在菜单内确认模型与大小，取消可返回，确认后下载失败给出单行错误且不跳转设置页');
  await probe.detach();
  const reseeded = await control.evaluate(() => chrome.runtime.sendMessage({type: 'fluentReadSetVideoAiSubtitleCache',
    source: {mediaId: '424242'}, model: 'tiny', sourceLanguage: 'auto',
    cues: [{startMs: 0, durationMs: 10000, text: 'Subtitle menu state fixture.'}]}));
  assert.equal(reseeded.cached, true);
  await action('toggle-ai-subtitle').click();
  await checked(action('toggle-ai-subtitle'), true);
  report.checks.push('缓存命中时直接恢复 AI 字幕，不弹出模型确认');
  for (const name of ['download-subtitles', 'download-translated-subtitles', 'download-bilingual-subtitles']) {
    const downloaded = page.waitForEvent('download');
    await action(name).click();
    const download = await downloaded;
    const destination = path.join(artifacts, `${name}.srt`);
    await download.saveAs(destination);
    const srt = fs.readFileSync(destination, 'utf8');
    assert.match(srt, /00:00:00,000 --> 00:00:10,000/);
    assert.match(await menu.locator('[data-download-status]').innerText(), /1/);
    (report.downloads ||= {})[name] = {filename: download.suggestedFilename(), body: srt.trim()};
  }
  assert.match(report.downloads['download-subtitles'].body, /Subtitle menu state fixture\.$/u);
  assert.match(report.downloads['download-translated-subtitles'].body, /字幕菜单同步测试$/u);
  // 双语文件把原文与译文放在同一条 cue 的两行里。
  assert.match(report.downloads['download-bilingual-subtitles'].body, /Subtitle menu state fixture\.\n字幕菜单同步测试$/u);
  assert.ok(report.downloads['download-bilingual-subtitles'].filename.endsWith('-bilingual.srt'), report.downloads['download-bilingual-subtitles'].filename);
  report.checks.push('原文、译文和双语下载及结果反馈正常，双语文件保留两行');
  await screenshot('controls-absent');
  await page.evaluate(() => document.querySelector('[data-testid="videoPlayer"]').append(window.fixtureControls));
  await page.locator('#fluent-read-video-subtitle-button').waitFor({state: 'attached'});
  await checkPlacement('controls-restored');
  assert.equal(await page.evaluate(() => window.fixtureMenu === document.querySelector('#fluent-read-video-subtitle-menu')), true);
  await page.locator('#fluent-read-video-subtitle-button').click();
  if (!(await menu.isVisible())) await page.locator('#fluent-read-video-subtitle-button').click();
  await checked(menu.locator('[data-mode="bilingual"]'), true);
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
  for (const [name, width, height, layout] of [['phone-landscape', 390, 220, 'wide'], ['portrait', 300, 530, 'stack'], ['desktop', 960, 540, 'stack']]) {
    await page.locator('[data-testid="videoPlayer"]').evaluate((player, size) => {
      player.style.width = `${size.width}px`;
      player.style.height = `${size.height}px`;
    }, {width, height});
    if (!(await menu.isVisible())) await page.locator('#fluent-read-video-subtitle-button').click();
    await page.waitForFunction(expected => document.querySelector('#fluent-read-video-subtitle-menu')?.dataset.layout === expected, layout);
    const geometry = await page.evaluate(() => {
      const player = document.querySelector('[data-testid="videoPlayer"]').getBoundingClientRect();
      const menu = document.querySelector('#fluent-read-video-subtitle-menu');
      const rect = menu.getBoundingClientRect();
      return {player: {top: player.top, left: player.left, right: player.right, bottom: player.bottom},
        menu: {top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height},
        scrolls: menu.scrollHeight > menu.clientHeight + 1, overflowX: menu.scrollWidth > menu.clientWidth + 1};
    });
    assert.ok(geometry.menu.top >= geometry.player.top && geometry.menu.left >= geometry.player.left
      && geometry.menu.right <= geometry.player.right && geometry.menu.bottom <= geometry.player.bottom, JSON.stringify(geometry));
    assert.equal(geometry.scrolls, false, JSON.stringify(geometry));
    assert.equal(geometry.overflowX, false, JSON.stringify(geometry));
    (report.menuLayouts ||= []).push({name, layout, ...geometry});
    await page.locator('[data-testid="videoPlayer"]').screenshot({path: path.join(artifacts, `menu-${name}.png`)});
  }
  report.checks.push('手机横屏播放器使用矮行布局，竖屏与桌面保持单列，菜单不滚动、不越出播放器');
  // 识别结果已是目标语言（繁体中文 → 简体中文目标）时不请求翻译，双语只显示原文一行。
  const chineseCue = '所以成進去的相機 然後基本上 這個東西';
  assert.equal((await control.evaluate(() => chrome.runtime.sendMessage({type: 'fluentReadClearVideoAiSubtitleCache'}))).success, true);
  assert.equal((await control.evaluate(text => chrome.runtime.sendMessage({type: 'fluentReadSetVideoAiSubtitleCache',
    source: {mediaId: '424242'}, model: 'tiny', sourceLanguage: 'auto', cues: [{startMs: 0, durationMs: 10000, text}]}), chineseCue)).cached, true);
  if (!(await menu.isVisible())) await page.locator('#fluent-read-video-subtitle-button').click();
  await action('toggle-ai-subtitle').click();
  await checked(action('toggle-ai-subtitle'), false);
  await page.evaluate(() => { const video = document.querySelector('video'); video.pause(); video.currentTime = 2; });
  const callsBeforeChinese = await worker.evaluate(() => globalThis.fixtureTranslationCalls);
  await action('toggle-ai-subtitle').click();
  await checked(action('toggle-ai-subtitle'), true);
  await page.waitForFunction(text => document.querySelector('#fluent-read-video-subtitle-original')?.textContent === text, chineseCue);
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => document.querySelector('#fluent-read-video-subtitle')?.textContent || ''), '');
  await menu.locator('[data-mode="translation-only"]').click();
  await page.waitForFunction(text => document.querySelector('#fluent-read-video-subtitle')?.textContent === text, chineseCue);
  await page.locator('[data-testid="videoPlayer"]').screenshot({path: path.join(artifacts, 'same-language-translation-only.png')});
  await menu.locator('[data-mode="bilingual"]').click();
  await page.waitForFunction(() => !document.querySelector('#fluent-read-video-subtitle')?.textContent);
  await page.locator('[data-testid="videoPlayer"]').screenshot({path: path.join(artifacts, 'same-language-bilingual.png')});
  assert.equal(await worker.evaluate(() => globalThis.fixtureTranslationCalls), callsBeforeChinese);
  report.checks.push('识别结果已是目标语言时不请求翻译：双语只显示原文一行，仅译文模式仍显示该句');
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

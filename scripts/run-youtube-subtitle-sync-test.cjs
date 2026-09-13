#!/usr/bin/env node
// Production-extension regression with controlled YouTube DOM/time and a mocked
// translation service. Fullscreen and clicks use the real browser; no live media claim.
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
const artifacts = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-youtube-sync'));
const helperPath = arg('focus-safe-helper');
const playwrightRoot = arg('playwright-root');
if (!helperPath || !playwrightRoot) throw new Error('Explicit focus-safe helper and Playwright runtime are required');
const helper = require(path.resolve(helperPath));
const {chromium} = createRequire(path.join(playwrightRoot, 'youtube-sync-proof.cjs'))('playwright');
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-edge-profile-youtube-sync-'));
fs.mkdirSync(artifacts, {recursive: true});
const mediaFile = path.join(artifacts, 'fixture.mp4');
const media = spawnSync(arg('ffmpeg', '/opt/homebrew/bin/ffmpeg'), ['-y', '-f', 'lavfi', '-i', 'color=c=0x123044:s=960x540:r=10',
  '-t', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mediaFile], {encoding: 'utf8'});
assert.equal(media.status, 0, media.stderr);
const report = {success: false, evidence: 'Production extension; controlled YouTube DOM and video clock; mocked translations; real fullscreen/clicks', checks: [], errors: []};
let session, page;
const translations = {
  'Sea otters have strong teeth.': '海獭有强有力的牙齿。',
  'They open the shell.': '它们打开贝壳。',
  'The same beginning belongs to a future sentence.': '这是一条未来的字幕。',
  'Slow translation belongs here.': '这是一条延迟的译文。',
  'The next caption is ready.': '下一句字幕已就绪。',
  'A native sentence without a timed track.': '这句原文没有时间轨道。',
  'Another native sentence.': '另一句原文。',
};
const cues = [
  {tStartMs: 0, dDurationMs: 1000, segs: [{utf8: 'Sea otters have strong teeth.'}]},
  {tStartMs: 1000, dDurationMs: 1000, segs: [{utf8: 'They open the shell.'}]},
  {tStartMs: 2000, dDurationMs: 1000, segs: [{utf8: 'Sea otters have strong teeth.'}]},
  {tStartMs: 8000, dDurationMs: 1000, segs: [{utf8: 'The same beginning belongs to a future sentence.'}]},
  {tStartMs: 10000, dDurationMs: 1000, segs: [{utf8: 'Slow translation belongs here.'}]},
  {tStartMs: 11000, dDurationMs: 1000, segs: [{utf8: 'The next caption is ready.'}]},
];
const check = (name, pass, details) => report.checks.push({name, pass: Boolean(pass), details});
(async () => {
  session = await helper.launchFocusSafePersistentContext({chromium, profileDir,
    browserPath: arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
    headless: false, background: true, displayTarget: 'secondary', viewport: {width: 1280, height: 900},
    browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check'],
  });
  const {context} = session;
  Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
  const worker = context.serviceWorkers().find(candidate => candidate.url().endsWith('/background.js'))
    || await context.waitForEvent('serviceworker', {predicate: candidate => candidate.url().endsWith('/background.js')});
  await worker.evaluate(mapping => {
    const originalFetch = globalThis.fetch;
    globalThis.fixturePending = [];
    globalThis.fixtureRequests = [];
    globalThis.fetch = async (input, init) => {
      if (!String(input?.url || input).startsWith('https://edge.microsoft.com/translate/translatetext')) return originalFetch(input, init);
      const body = JSON.parse(init?.body || '[]');
      const source = String(body[0]?.Text ?? body[0] ?? '');
      globalThis.fixtureRequests.push(source);
      if (source === 'Slow translation belongs here.') await new Promise(resolve => globalThis.fixturePending.push(resolve));
      return new Response(JSON.stringify([{translations: [{text: mapping[source] || `译文：${source}`}]}]), {status: 200, headers: {'content-type': 'application/json'}});
    };
  }, translations);
  const control = await helper.newPageWithoutForeground(context);
  await control.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  let sequence = 0;
  const patchConfig = async patch => {
    const result = await control.evaluate(async ({patch, sequence}) => {
      const read = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      const current = typeof read.value === 'string' ? JSON.parse(read.value) : read.value || {};
      return chrome.runtime.sendMessage({type: 'persistConfig', clientId: 'youtube-sync-proof', sequence,
        config: {...current, ...patch}, ...(Number.isSafeInteger(current.__fluentConfigRevision) ? {baseRevision: current.__fluentConfigRevision} : {})});
    }, {patch, sequence: ++sequence});
    assert.equal(result.success, true);
  };
  await patchConfig({on: true, uiLanguage: 'zh-CN', from: 'en', to: 'zh-Hans', videoTranslationEnabled: true,
    videoSubtitleVisible: true, videoSubtitleDisplayMode: 'bilingual', videoService: 'microsoft', videoServiceDefaultMigrated: true});
  const url = 'https://www.youtube.com/watch?v=fluentread-sync-fixture';
  await context.route(url, route => route.fulfill({contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><title>YouTube fullscreen and subtitle synchronization fixture</title><style>
    html{height:0}body{margin:0;background:#eef2f8;font:18px Arial}#movie_player{position:fixed;left:40px;top:80px;width:960px;height:540px;overflow:hidden;background:#123044;color:white}
    video{position:absolute;width:100%;height:100%;inset:0}.ytp-right-controls{position:absolute;right:16px;bottom:8px;display:flex;gap:8px;height:40px;z-index:30}.ytp-right-controls button{min-width:36px;height:36px}
    #ytp-caption-window-container{position:absolute;left:0;right:0;bottom:64px;text-align:center}.ytp-caption-segment{font-size:28px;background:#111}
    html:fullscreen #movie_player{inset:0;width:100vw;height:100vh}html:fullscreen{height:0!important}
    </style></head><body><h1>字幕全屏与时间同步回归</h1><div id="movie_player" class="html5-video-player"><video class="html5-main-video" muted src="data:video/mp4;base64,${fs.readFileSync(mediaFile).toString('base64')}"></video><div id="ytp-caption-window-container"><span class="ytp-caption-segment"></span></div><div class="ytp-right-controls"><button id="fullscreen">全屏</button><button aria-label="Settings">设置</button></div></div>
    <script>document.getElementById('fullscreen').onclick=()=>document.documentElement.requestFullscreen();</script></body></html>`}));
  page = await helper.newPageWithoutForeground(context);
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(url);
  await helper.activateExtensionTabWithoutForeground({serviceWorkers: () => [worker]}, page);
  await page.locator('#fluent-read-video-subtitle-button').waitFor();
  await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
  const setCaption = async (time, text) => {
    await page.evaluate(({time, text}) => {
      document.querySelector('.ytp-caption-segment').textContent = text;
      document.querySelector('video').currentTime = time;
    }, {time, text});
    await page.waitForFunction(() => !document.querySelector('video').seeking);
  };
  const sample = () => page.evaluate(() => {
    const original = document.querySelector('#fluent-read-video-subtitle-original');
    const translation = document.querySelector('#fluent-read-video-subtitle');
    const panel = document.querySelector('#fluent-read-video-subtitle-panel');
    const layer = document.querySelector('#fluent-read-video-subtitle-layer');
    const native = document.querySelector('.ytp-caption-segment');
    return {time: document.querySelector('video').currentTime, original: original?.textContent || '', translation: translation?.textContent || '', native: native.textContent,
      nativeVisibility: getComputedStyle(native).visibility, panel: panel?.getBoundingClientRect().toJSON(), layerParent: layer?.parentElement?.id,
      panelDisplay: panel && getComputedStyle(panel).display};
  });
  const waitTranslation = text => page.waitForFunction(text => document.querySelector('#fluent-read-video-subtitle')?.textContent === text, text, {timeout: 10000});
  await page.evaluate(events => window.postMessage({source: 'fluent-read', type: 'fluent-read-youtube-timedtext',
    url: 'https://www.youtube.com/api/timedtext?v=fluentread-sync-fixture&lang=en', responseText: JSON.stringify({events})}, location.origin), cues);
  await setCaption(.5, 'Sea otters have strong teeth.');
  await waitTranslation(translations['Sea otters have strong teeth.']);
  const first = await sample();
  check('Whole native cue uses one bilingual panel', first.original === first.native && first.nativeVisibility === 'hidden', first);
  await page.locator('#fluent-read-video-subtitle-button').click();
  await page.evaluate(() => window.fixtureMenu = document.querySelector('#fluent-read-video-subtitle-menu'));
  // Enter fullscreen without an outside click, as with YouTube's F shortcut.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Runtime.evaluate', {expression: 'document.documentElement.requestFullscreen()', userGesture: true, awaitPromise: true});
  await cdp.detach();
  await page.waitForFunction(() => Boolean(document.fullscreenElement));
  await page.waitForTimeout(250);
  const fullscreen = await page.evaluate(() => {
    const menu = document.querySelector('#fluent-read-video-subtitle-menu');
    const layer = document.querySelector('#fluent-read-video-subtitle-layer');
    const r = menu.getBoundingClientRect();
    return {root: document.fullscreenElement.tagName, menuParent: menu.parentElement.id, layerParent: layer?.parentElement.id,
      sameMenu: menu === window.fixtureMenu, hidden: menu.hidden, menuRect: r.toJSON(), layerHeight: layer?.getBoundingClientRect().height,
      hit: Boolean(menu.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)))};
  });
  check('Document fullscreen preserves an open, visible, clickable menu and full-height subtitle layer', fullscreen.menuParent === 'movie_player'
    && fullscreen.layerParent === 'movie_player' && fullscreen.sameMenu && !fullscreen.hidden && fullscreen.hit && fullscreen.layerHeight > 300, fullscreen);
  await page.screenshot({path: path.join(artifacts, 'fullscreen.png')});
  if (fullscreen.hit) {
    await page.locator('[data-mode="translation-only"]').click();
    check('Fullscreen menu switches display mode', await page.locator('[data-mode="translation-only"]').getAttribute('aria-checked') === 'true');
    await page.locator('[data-mode="bilingual"]').click();
  }
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.waitForTimeout(150);
  await page.locator('#movie_player').click({position: {x: 20, y: 20}});
  await setCaption(.5, 'Sea otters');
  await waitTranslation(translations['Sea otters have strong teeth.']);
  const partial = await sample();
  check('Partial and whole captions share stable geometry', partial.original === first.native && Math.abs(partial.panel.bottom - first.panel.bottom) < 1.5, partial);
  await setCaption(1.2, 'Sea otters have strong teeth.');
  await page.waitForTimeout(80);
  const stale = await sample();
  check('A late native DOM update never reveals the next unrelated cue or retains its previous translation', stale.translation === '' && stale.original === '', stale);
  await setCaption(1.2, 'They open the shell.');
  await waitTranslation(translations['They open the shell.']);
  await setCaption(2.2, 'Sea otters have strong teeth.');
  await waitTranslation(translations['Sea otters have strong teeth.']);
  check('A repeated sentence is allowed in its own later interval', (await sample()).original === 'Sea otters have strong teeth.');
  await setCaption(3.2, 'Sea otters have strong teeth.');
  await page.waitForTimeout(80);
  check('Expired cues disappear at their end, including a repeated sentence', (await sample()).translation === '', await sample());
  await setCaption(4, 'The same beginning');
  await page.waitForTimeout(550);
  check('A matching prefix does not borrow a future full sentence', !(await sample()).original.includes('future') && (await sample()).translation === '', await sample());
  await setCaption(10.2, 'Slow translation belongs here.');
  await page.waitForTimeout(150);
  await setCaption(11.2, 'The next caption is ready.');
  await waitTranslation(translations['The next caption is ready.']);
  await worker.evaluate(() => globalThis.fixturePending.splice(0).forEach(resolve => resolve()));
  await page.waitForTimeout(250);
  check('A delayed translation cannot overwrite a newer caption', (await sample()).translation === translations['The next caption is ready.'], await sample());
  const seeking = await page.evaluate(() => new Promise(resolve => {
    const video = document.querySelector('video');
    video.addEventListener('seeking', () => resolve({original: document.querySelector('#fluent-read-video-subtitle-original')?.textContent || '',
      translation: document.querySelector('#fluent-read-video-subtitle')?.textContent || ''}), {once: true});
    video.currentTime = .5;
  }));
  check('Seeking immediately clears both extension lines', !seeking.original && !seeking.translation, seeking);
  await setCaption(.5, 'Sea otters have strong teeth.', 'seeked');
  await waitTranslation(translations['Sea otters have strong teeth.']);
  check('Seeking back restores the current cached cue', (await sample()).original === 'Sea otters have strong teeth.');
  await setCaption(.6, '');
  await page.waitForTimeout(80);
  check('Empty native captions clear the translation without a grace-period tail', !(await sample()).original && !(await sample()).translation, await sample());
  await setCaption(20, 'A native sentence without a timed track.');
  await waitTranslation(translations['A native sentence without a timed track.']);
  await setCaption(21, 'Another native sentence.');
  await page.waitForTimeout(80);
  const replacing = await sample();
  check('Untracked native changes invalidate the previous translation before waiting for stability', replacing.original === replacing.native && replacing.translation === '', replacing);
  await waitTranslation(translations['Another native sentence.']);
  await page.screenshot({path: path.join(artifacts, 'bilingual.png')});
  await patchConfig({videoSubtitleDisplayMode: 'original-only'});
  await page.waitForTimeout(150);
  check('Original-only restores native captions', (await sample()).nativeVisibility === 'visible');
  await patchConfig({on: false});
  await page.waitForFunction(() => !document.querySelector('#fluent-read-video-subtitle-layer'));
  check('Disabling removes menu, layer and native hiding', !await page.locator('#fluent-read-video-subtitle-menu').count()
    && await page.locator('.ytp-caption-segment').evaluate(e => getComputedStyle(e).visibility === 'visible'));
  report.requests = await worker.evaluate(() => globalThis.fixtureRequests);
  report.success = report.checks.every(c => c.pass) && report.errors.length === 0;
  assert.equal(report.success, true, JSON.stringify(report.checks.filter(c => !c.pass)));
})().catch(error => {report.failure = error.stack; process.exitCode = 1;}).finally(async () => {
  if (page) fs.writeFileSync(path.join(artifacts, 'last.html'), await page.content().catch(() => ''));
  fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  if (session) await session.close();
  fs.rmSync(profileDir, {recursive: true, force: true});
  console.log(JSON.stringify(report, null, 2));
});

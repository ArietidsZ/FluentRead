#!/usr/bin/env node
// Production extension on an isolated Home fixture: real MSE video/HLS decode, controlled ASR and translation replies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {createRequire} = require('node:module');
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1]; };
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifacts = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-x-home-recovery'));
const runtime = arg('playwright-root');
const helperPath = arg('focus-safe-helper');
if (!runtime || !helperPath) throw new Error('Explicit Playwright runtime and focus-safe helper are required');
const {chromium} = createRequire(path.join(runtime, 'x-home-proof.cjs'))('playwright');
const helper = require(path.resolve(helperPath));
fs.mkdirSync(artifacts, {recursive: true});
const runFfmpeg = args => { const result = spawnSync(arg('ffmpeg', '/opt/homebrew/bin/ffmpeg'), ['-y', ...args], {encoding: 'utf8'}); assert.equal(result.status, 0, result.stderr); };
runFfmpeg(['-f', 'lavfi', '-i', 'color=c=0x123044:s=320x180:r=20', '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=48000',
  '-t', '2', '-c:v', 'libx264', '-profile:v', 'baseline', '-level:v', '3.0', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
  '-movflags', 'frag_keyframe+empty_moov+default_base_moof', path.join(artifacts, 'mse.mp4')]);
runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=48000', '-t', '2', '-c:a', 'aac', '-f', 'hls',
  '-hls_segment_type', 'fmp4', '-hls_time', '1', '-hls_list_size', '0', path.join(artifacts, 'audio.m3u8')]);
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-x-home-profile-'));
const report = {success: false, url: 'https://x.com/home', evidence: 'Production extension; two real MSE videos; real HLS recovery and PCM decode; simulated Base ASR and Microsoft translation', checks: [], errors: [], mediaRequests: []};
const check = (name, pass, details) => { report.checks.push({name, pass: Boolean(pass), details}); assert.ok(pass, name); };
let session, page, probe;
const state = () => page.evaluate(() => ({
  label: document.querySelector('[data-action="toggle-ai-subtitle"] .fluent-read-video-menu-label')?.textContent || '',
  detail: document.querySelector('[data-action="toggle-ai-subtitle"] [data-state]')?.textContent || '',
  original: document.querySelector('#fluent-read-video-subtitle-original')?.textContent || '',
  translation: document.querySelector('#fluent-read-video-subtitle')?.textContent || '',
}));
(async () => {
  session = await helper.launchFocusSafePersistentContext({chromium, profileDir,
    browserPath: arg('browser-path', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    headless: false, background: true, displayTarget: 'secondary', viewport: {width: 1280, height: 900},
    browserArgs: ['--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check'],
  });
  Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
  const {context} = session;
  const install = await context.browser().newBrowserCDPSession();
  const {id} = await install.send('Extensions.loadUnpacked', {path: extensionDir});
  await install.detach();
  context.on('page', candidate => candidate.on('pageerror', error => report.errors.push(error.message)));
  const worker = context.serviceWorkers().find(candidate => new URL(candidate.url()).host === id)
    || await context.waitForEvent('serviceworker', {predicate: candidate => new URL(candidate.url()).host === id});
  await worker.evaluate(() => {
    const original = fetch;
    globalThis.fetch = async (input, init) => {
      if (!String(input?.url || input).startsWith('https://edge.microsoft.com/translate/translatetext')) return original(input, init);
      const source = String(JSON.parse(init.body)[0]);
      await new Promise(resolve => setTimeout(resolve, 500));
      return new Response(JSON.stringify([{translations: [{text: `译文：${source}`}]}]), {headers: {'content-type': 'application/json'}});
    };
  });
  const control = await helper.newPageWithoutForeground(context);
  await control.goto(`chrome-extension://${id}/popup.html`);
  const configured = await control.evaluate(async () => {
    const read = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
    const current = typeof read.value === 'string' ? JSON.parse(read.value) : read.value || {};
    return chrome.runtime.sendMessage({type: 'persistConfig', clientId: 'x-home-recovery-proof', sequence: 1,
      config: {...current, on: true, from: 'en', to: 'zh-Hans', videoSourceLanguage: 'auto', videoLocalModel: 'base',
        videoTranslationEnabled: true, videoSubtitleVisible: true, videoSubtitleDisplayMode: 'bilingual', videoSubtitleOffsetMs: 0,
        videoService: 'microsoft', videoServiceDefaultMigrated: true, useCache: false},
      ...(Number.isSafeInteger(current.__fluentConfigRevision) ? {baseRevision: current.__fluentConfigRevision} : {})});
  });
  assert.equal(configured.success, true);
  await context.route('https://video.twimg.com/**', route => {
    const url = new URL(route.request().url());
    report.mediaRequests.push(url.href);
    const filename = path.basename(url.pathname);
    const file = path.join(artifacts, filename);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({contentType: filename.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4',
      headers: {'access-control-allow-origin': '*', 'timing-allow-origin': '*'}, body: fs.readFileSync(file)});
  });
  await context.route(report.url, route => route.fulfill({contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><title>X Home audio recovery</title></head><body style="margin:20px;background:#eef2f8;font:18px Arial">
    <h1>X Home: independent video states</h1>${['333', '111'].map((mediaId, i) => `<article id="post-${i}" style="margin-bottom:20px"><a href="/proof/status/${i + 101}">Video ${i === 0 ? 'A: unavailable audio' : 'B: recoverable HLS'}</a><div data-testid="videoPlayer" style="position:relative;width:520px;height:290px;background:#123044"><video muted poster="https://pbs.twimg.com/ext_tw_video_thumb/${mediaId}/pu/img/proof.jpg" style="width:100%;height:100%"></video><div style="position:absolute;right:8px;bottom:8px"><button aria-label="Volume">Volume</button><button aria-label="Settings">Settings</button></div></div></article>`).join('')}
    </body></html>`}));
  page = await helper.newPageWithoutForeground(context);
  await page.goto(report.url);
  await page.evaluate(async () => {
    const bytes = await (await fetch('https://video.twimg.com/ext_tw_video/999/pu/mse.mp4')).arrayBuffer();
    for (const video of document.querySelectorAll('video')) {
      await new Promise((resolve, reject) => {
        const media = new MediaSource();
        video.src = URL.createObjectURL(media);
        media.addEventListener('sourceopen', () => {
          const buffer = media.addSourceBuffer('video/mp4; codecs="avc1.42c01e, mp4a.40.2"');
          buffer.addEventListener('error', reject);
          buffer.addEventListener('updateend', () => { media.endOfStream(); resolve(); }, {once: true});
          buffer.appendBuffer(bytes.slice(0));
        }, {once: true});
      });
    }
    await Promise.all(['111', '222'].map(id => new Promise(resolve => {
      const request = new XMLHttpRequest();
      request.open('GET', 'https://video.twimg.com/ext_tw_video/' + id + '/pu/pl/audio.m3u8');
      request.responseType = 'arraybuffer';
      request.onload = resolve;
      request.send();
    })));
  });
  await page.waitForFunction(() => [...document.querySelectorAll('video')].every(video => video.readyState >= 2));
  probe = await context.newCDPSession(page);
  const contexts = [];
  probe.on('Runtime.executionContextCreated', event => contexts.push(event.context));
  await probe.send('Runtime.enable');
  const isolated = contexts.find(candidate => candidate.auxData?.isDefault === false
    && (candidate.origin === `chrome-extension://${id}` || String(candidate.name).includes(id)));
  assert.ok(isolated, 'the extension isolated context is present');
  const inject = expression => probe.send('Runtime.evaluate', {contextId: isolated.id, expression, returnByValue: true, awaitPromise: true});
  await inject(`(() => {
    globalThis.homeProofCalls=[];globalThis.homeProofEmpty=false;
    const runtime=chrome.runtime,send=runtime.sendMessage;
    runtime.sendMessage=function(...args){const message=args[0];let result;
      if(message?.type==='fluentReadGetLocalVideoModelState')result={success:true,models:['base']};
      else if(message?.type==='fluentReadPrepareLocalVideoModel'||message?.type==='fluentReadCancelLocalVideoTranscription')result={success:true};
      else if(message?.type==='fluentReadTranscribeLocalVideoAudio')result={success:true,model:'base',text:globalThis.homeProofEmpty?'':'Home audio recovered for video B.',segments:globalThis.homeProofEmpty?[]:[{startMs:0,endMs:1500,text:'Home audio recovered for video B.'}]};
      else return send.apply(runtime,args);
      globalThis.homeProofCalls.push({type:message.type,model:message.model});
      const callback=args.at(-1);if(typeof callback==='function'){queueMicrotask(()=>callback(result));return;}return Promise.resolve(result);
    };return true;
  })()`);
  // A initially exposes only its MSE blob. Poster enrichment must not reset its own failure.
  await page.evaluate(() => {
    document.querySelector('#post-0 video').removeAttribute('poster');
    document.querySelector('#post-0 a').removeAttribute('href');
  });
  await page.locator('#post-0 video').hover();
  await page.waitForSelector('#post-0 #fluent-read-video-subtitle-button');
  await page.locator('#fluent-read-video-subtitle-button').click();
  await page.locator('[data-action="toggle-ai-subtitle"]').click();
  await page.waitForFunction(() => document.querySelector('[data-action="toggle-ai-subtitle"] [data-state]')?.textContent.includes('刷新页面'), null, {timeout: 15000});
  report.videoA = await state();
  check('Unreadable MSE audio gives an actionable refresh hint and preserves the model', /刷新页面/.test(report.videoA.detail) && /无需重新下载模型/.test(report.videoA.detail), report.videoA);
  await page.locator('#post-0 video').evaluate(video => {video.poster = 'https://pbs.twimg.com/ext_tw_video_thumb/333/pu/img/proof.jpg';});
  await page.waitForTimeout(500);
  report.videoAEnriched = await state();
  check('Poster enrichment of the same blob video retains its own failure', report.videoAEnriched.detail === report.videoA.detail
    && report.videoAEnriched.label === report.videoA.label, report.videoAEnriched);
  await page.screenshot({path: path.join(artifacts, 'home-video-a-recovery-hint.png')});
  await page.locator('#post-1 video').hover();
  await page.waitForSelector('#post-1 #fluent-read-video-subtitle-button');
  report.videoBInitial = await state();
  check('Switching to video B clears video A error and restores the generate action', !/刷新|失败|重试/.test(report.videoBInitial.detail) && !/重试/.test(report.videoBInitial.label), report.videoBInitial);
  if (await page.locator('#fluent-read-video-subtitle-menu').isHidden()) await page.locator('#fluent-read-video-subtitle-button').click();
  const before = await page.locator('#post-1 video').evaluate(video => ({time: video.currentTime, paused: video.paused, rate: video.playbackRate, volume: video.volume, muted: video.muted}));
  const startRequests = report.mediaRequests.length;
  await page.locator('[data-action="toggle-ai-subtitle"]').click();
  await page.waitForFunction(() => document.querySelector('[data-action="toggle-ai-subtitle"] [data-state]')?.textContent.includes('已就绪'), null, {timeout: 15000});
  await page.waitForFunction(() => document.querySelector('#fluent-read-video-subtitle')?.textContent === '译文：Home audio recovered for video B.');
  report.videoB = await state();
  report.recoveryRequests = report.mediaRequests.slice(startRequests);
  check('Home identifies and reloads B HLS among two resource groups', report.recoveryRequests.some(url => /\/111\/.*m3u8/.test(url))
    && report.recoveryRequests.every(url => url.includes('/111/')), report.recoveryRequests);
  check('Home generates matching bilingual captions without opening a post', page.url() === report.url && report.videoB.original === 'Home audio recovered for video B.', report.videoB);
  const after = await page.locator('#post-1 video').evaluate(video => ({time: video.currentTime, paused: video.paused, rate: video.playbackRate, volume: video.volume, muted: video.muted}));
  assert.deepEqual(after, before, 'recognition preserves visible playback state');
  await page.screenshot({path: path.join(artifacts, 'home-video-b-bilingual.png')});
  // Base's empty result is independent of the provider and must not recommend Base again.
  if (await page.locator('#fluent-read-video-subtitle-menu').isHidden()) await page.locator('#fluent-read-video-subtitle-button').click();
  await page.locator('[data-action="open-subtitle-tools"]').click();
  await inject('globalThis.homeProofEmpty=true');
  await page.locator('[data-action="regenerate-ai-subtitle"]').click();
  await page.waitForFunction(() => document.querySelector('[data-action="toggle-ai-subtitle"] [data-state]')?.textContent.includes('清晰人声'), null, {timeout: 15000});
  assert.equal(await page.locator('[data-action="toggle-ai-subtitle"]').isVisible(), true, 'recognition failure is visible after returning from subtitle tools');
  report.emptyBase = await state();
  check('Base empty transcription suggests speech and language checks', /视频原语言/.test(report.emptyBase.detail)
    && !/换用 Base|翻译失败/.test(report.emptyBase.detail), report.emptyBase);
  await page.screenshot({path: path.join(artifacts, 'base-empty-transcription.png')});
  report.rpcCalls = (await inject('globalThis.homeProofCalls')).result.value;
  check('Configured Base is used without another model download', report.rpcCalls.filter(call => call.type === 'fluentReadTranscribeLocalVideoAudio').every(call => call.model === 'base'));
  check('No unhandled browser errors', report.errors.length === 0, report.errors);
  check('Test browser stays in the background', report.launchMode === 'macos-background-cdp'
    && report.focusPolicy === 'launchservices-no-foreground' && report.windowPlacement.browserFrontmost === false);
  report.success = true;
})().catch(async error => {report.failure = error.stack; process.exitCode = 1; if (page) {report.failureState = await state().catch(() => null); await page.screenshot({path: path.join(artifacts, 'failure.png')}).catch(() => {});}}).finally(async () => {
  if (probe) await probe.detach().catch(() => {});
  if (session) await session.close();
  fs.rmSync(profileDir, {recursive: true, force: true});
  fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({success: report.success, checks: report.checks, failure: report.failure, artifacts}, null, 2));
});

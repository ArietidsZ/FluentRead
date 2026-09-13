'use strict';

// 在独立扩展副本与临时 profile 中运行真实 Kokoro/Whisper；故障注入只改变测试 Worker 的 GPU API。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const {createHash} = require('node:crypto');
const {execFileSync} = require('node:child_process');
function arg(name, fallback) {const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1];}
const root = path.resolve(__dirname, '../..');
const source = path.resolve(arg('extension-dir', path.join(root, '.output/chrome-mv3')));
const artifacts = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-local-audio-gpu'));
const kinds = arg('kinds', 'tts,whisper').split(',');
const installWithCdp = arg('extension-install', 'flags') === 'cdp';
const {chromium} = require(path.join(arg('playwright-root', '/Users/thinkstu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'), 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground} = require(arg('focus-safe-helper', '/Users/thinkstu/.codex/skills/fluentread-browser-translation-test/scripts/focus-safe-browser.cjs'));
const {measureBrowser} = require('./local-model-browser-helpers.cjs');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-audio-gpu-extension-'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-audio-gpu-profile-'));
fs.mkdirSync(artifacts, {recursive: true});
fs.cpSync(source, fixture, {recursive: true});
execFileSync('/usr/bin/say', ['-v', 'Samantha', '-o', path.join(fixture, 'speech.aiff'), 'Hello world. This is a local speech test.']);
execFileSync('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16', path.join(fixture, 'speech.aiff'), path.join(fixture, 'speech.wav')]);
fs.writeFileSync(path.join(fixture, 'audio-probe.html'), '<!doctype html><meta charset="utf-8"><title>本地音频 GPU 验证</title><h1>本地音频 GPU 验证</h1><pre id="result">正在下载并验证模型…</pre>');
const report = {source, cases: [], errors: [], injectedFaultErrors: [], workerSha256: {}, evidence: 'Real production Kokoro FP32 and Whisper Tiny q4 workers; controlled synthesized speech, plus explicitly injected GPU initialization/device-loss faults. Does not cover live website audio capture.'};
for (const worker of ['localTtsWorker', 'videoTranscriptionWorker']) {
  report.workerSha256[worker] = createHash('sha256').update(fs.readFileSync(path.join(source, `${worker}.js`))).digest('hex');
  for (const fault of ['unavailable', 'init-failure', 'device-loss']) {
    fs.writeFileSync(path.join(fixture, `${worker}-${fault}.mjs`), `
const queuedMessages = [];
const queueEarlyMessage = event => queuedMessages.push(event);
self.addEventListener('message', queueEarlyMessage);
const fault = ${JSON.stringify(fault)};
const gpu = navigator.gpu;
let probes = 0;
const devices = [];
if (fault === 'unavailable') Object.defineProperty(navigator, 'gpu', {value: undefined});
else if (gpu) {
  const requestAdapter = gpu.requestAdapter.bind(gpu);
  Object.defineProperty(gpu, 'requestAdapter', {value: async options => {
    if (fault === 'init-failure' && ++probes > 1) throw new Error('Injected GPU initialization failure');
    const adapter = await requestAdapter(options);
    if (adapter && fault === 'device-loss') {
      const requestDevice = adapter.requestDevice.bind(adapter);
      Object.defineProperty(adapter, 'requestDevice', {value: async options => {
        const device = await requestDevice(options); devices.push(device); return device;
      }});
    }
    return adapter;
  }});
}
const post = self.postMessage.bind(self);
self.postMessage = (message, ...args) => {
  if (fault === 'device-loss' && message.requestId === 1 && message.backend === 'webgpu') {
    devices.forEach(device => device.destroy());
    message.injectedDeviceLoss = devices.length;
  }
  post(message, ...args);
};
await import('./${worker}.js');
self.removeEventListener('message', queueEarlyMessage);
for (const event of queuedMessages) self.onmessage?.(event);
self.postMessage({probeReady: true});`);
  }
}

(async () => {
  let session;
  try {
    await createRequire(require.resolve('vite'))('esbuild').build({stdin: {contents: `export {cacheLocalTtsModelFiles} from './src/features/local-tts/offscreen/modelCache'; export {cacheVideoAiQ4ModelFiles} from './src/features/video-subtitle/offscreen/modelCache'; export {prepareLocalVideoTranscriptionModel, transcribeLocalVideoAudio, cancelLocalVideoTranscription} from './src/features/video-subtitle/offscreen/transcription';`, resolveDir: root}, alias: {'@': root}, bundle: true, platform: 'browser', format: 'esm', outfile: path.join(fixture, 'audio-cache.mjs')});
    session = await launchFocusSafePersistentContext({chromium, profileDir: profile,
      browserPath: arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'), headless: false, background: true,
      displayTarget: 'secondary', viewport: {width: 1100, height: 800},
      browserArgs: ['--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', ...(installWithCdp ? ['--enable-unsafe-extension-debugging'] : [`--disable-extensions-except=${fixture}`, `--load-extension=${fixture}`])]});
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    const {context} = session;
    report.browserVersion = context.browser().version();
    let origin;
    if (installWithCdp) {
      const cdp = await context.browser().newBrowserCDPSession();
      const {id} = await cdp.send('Extensions.loadUnpacked', {path: fixture});
      await cdp.detach();
      origin = `chrome-extension://${id}`;
    } else {
      const isProduct = async w => w.url().startsWith('chrome-extension://') && w.url().endsWith('/background.js')
        && await w.evaluate(() => chrome.runtime.getManifest().name).then(name=>name.includes('FluentRead')).catch(()=>false);
      let background;
      for(const candidate of context.serviceWorkers()) if(await isProduct(candidate)) {background=candidate;break;}
      background ||= await context.waitForEvent('serviceworker', {predicate:isProduct, timeout:30000});
      origin = background.url().match(/^chrome-extension:\/\/[^/]+/)[0];
    }
    const page = await newPageWithoutForeground(context);
    let activeCase = '';
    page.on('pageerror', e => {
      if (activeCase.endsWith('device-loss') && /device.*lost/i.test(e.message)) report.injectedFaultErrors.push({case:activeCase, message:e.message});
      else report.errors.push(e.message);
    });
    page.on('console', m => {if (m.type() === 'error') fs.appendFileSync(path.join(artifacts, 'console.log'), `${m.text()}\n`);});
    await page.goto(`${origin}/audio-probe.html`);
    report.adapter = await page.evaluate(async () => {const a = await navigator.gpu?.requestAdapter({powerPreference:'high-performance'}); return a ? {vendor:a.info?.vendor, architecture:a.info?.architecture, device:a.info?.device, description:a.info?.description} : null;});
    console.log(JSON.stringify({phase:'download', adapter:report.adapter}));
    await page.evaluate(async kinds => {const cache = await import('./audio-cache.mjs'); if(kinds.includes('tts'))await cache.cacheLocalTtsModelFiles(); if(kinds.includes('whisper'))await cache.cacheVideoAiQ4ModelFiles('tiny');}, kinds);
    console.log(JSON.stringify({phase:'models-ready'}));
    for (const mode of arg('modes', 'gpu,cpu,unavailable,init-failure,device-loss').split(',')) {
      for (const kind of kinds) {
        const name = `${kind}-${mode}`;
        activeCase = name;
        console.log(JSON.stringify({phase:'inference', name}));
        const measured = await measureBrowser(context, name, artifacts, () => page.evaluate(async ({kind, mode}) => {
          if (kind === 'whisper' && mode === 'device-loss') {
            // Run the actual owner source for a lost device: ORT may hang rather than reject.
            const owner = await import('./audio-cache.mjs');
            const NativeWorker = window.Worker;
            let workersCreated = 0;
            let injectedDeviceLoss = 0;
            window.Worker = class extends NativeWorker {
              constructor(url, options) {
                super(new URL('videoTranscriptionWorker-device-loss.mjs', location.href), options);
                workersCreated++;
                this.addEventListener('message', e => {injectedDeviceLoss += e.data.injectedDeviceLoss || 0;});
              }
            };
            try {
              const prepared = await owner.prepareLocalVideoTranscriptionModel('tiny', {keepWarm:true, streamId:'gpu-probe'});
              if (!injectedDeviceLoss) throw new Error('Owner GPU device-loss injection missing');
              const speech = window.audioProbeWav || await (await fetch('./speech.wav')).arrayBuffer();
              const decoded = await new OfflineAudioContext(1,16000,16000).decodeAudioData(speech.slice(0));
              const samples = decoded.getChannelData(0);
              const bytes = new Uint8Array(samples.length*2);
              const view = new DataView(bytes.buffer);
              for(let i=0;i<samples.length;i++)view.setInt16(i*2,Math.round(Math.max(-1,Math.min(1,samples[i]))*32767),true);
              let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
              const result = await owner.transcribeLocalVideoAudio({model:'tiny', sourceLanguage:'auto', streamId:'gpu-probe', audioPcm16Base64:btoa(binary)});
              return {prepared, outputs:[result], cpuRebuilds:workersCreated-1, injectedDeviceLoss, ownerSourceHarness:true};
            } finally {await owner.cancelLocalVideoTranscription('gpu-probe');window.Worker=NativeWorker;}
          }
          const base = kind === 'tts' ? 'localTtsWorker' : 'videoTranscriptionWorker';
          const suffix = ['gpu','cpu'].includes(mode) ? '.js' : `-${mode}.mjs`;
          let worker = new Worker(new URL(base + suffix, location.href), {type:'module'});
          let forceCpu = mode === 'cpu';
          let cpuRebuilds = 0;
          let seq = 0;
          function request(payload) {
            const requestId = ++seq;
            return new Promise((resolve,reject) => {
              const timer = setTimeout(() => {worker.terminate(); reject(new Error('audio worker timeout'));}, 120000);
              worker.onerror = e => {clearTimeout(timer); reject(new Error(e.message));};
              worker.onmessage = e => {
                if(e.data.requestId!==requestId)return; clearTimeout(timer);
                if(!e.data.success && e.data.retryWithCpu && !forceCpu) {
                  worker.terminate(); forceCpu=true; cpuRebuilds++;
                  worker=new Worker(new URL(base+'.js',location.href),{type:'module'});
                  resolve(request(payload)); return;
                }
                e.data.success ? resolve(e.data) : reject(new Error(e.data.error));
              };
              worker.postMessage({...payload, requestId, ...(forceCpu?{device:'wasm'}:{})});
            });
          }
          try {
            if (!['gpu','cpu'].includes(mode)) await new Promise((resolve,reject) => {
              const timer=setTimeout(()=>reject(new Error('GPU fault wrapper handshake timeout')),15000);
              worker.onmessage=e=>{if(e.data.probeReady){clearTimeout(timer);resolve();}};
              worker.onerror=e=>{clearTimeout(timer);reject(new Error(e.message));};
            });
            const prepared = await request({type:'prepare', model:'tiny'});
            if (mode==='device-loss' && !(prepared.injectedDeviceLoss > 0)) throw new Error('Device-loss fault was not injected into a GPU session');
            const outputs = [];
            for (const language of kind==='tts' ? ['en','zh'] : ['en']) {
              if (kind==='tts') {
                const result = await request({type:'synthesize', text:language==='zh'?'你好，欢迎使用流畅阅读。':'Hello world. This is a local speech test.', voice:language==='zh'?'zf_001':'af_maple', speed:1});
                const view = new DataView(result.audio);
                const count = (result.audio.byteLength-44)/2;
                let peak = 0; for(let i=0;i<count;i++) peak=Math.max(peak, Math.abs(view.getInt16(44+i*2,true)));
                if (language==='en' && mode==='gpu') window.audioProbeWav = result.audio.slice(0);
                outputs.push({backend:result.backend, language, audioBytes:result.audio.byteLength, samples:count, peak, samplingRate:result.samplingRate});
              } else {
                const speech = window.audioProbeWav || await (await fetch('./speech.wav')).arrayBuffer();
                const audioContext = new OfflineAudioContext(1,16000,16000);
                const audio = await audioContext.decodeAudioData(speech.slice(0));
                const result = await request({type:'transcribe', model:'tiny', sourceLanguage:'auto', languageSessionKey:'probe', audio:audio.getChannelData(0)});
                outputs.push(result);
              }
            }
            return {prepared, outputs, cpuRebuilds};
          } finally {worker.terminate();}
        }, {kind,mode}));
        report.cases.push(measured);
        if(measured.error) {report.errors.push(`${name}: ${measured.error}`); continue;}
        const expected = mode==='gpu'?'webgpu':'wasm';
        assert.equal(measured.result.outputs[0].backend, expected, name);
        for(const output of measured.result.outputs) {
          if(kind==='tts') assert.ok(output.audioBytes>1000 && output.peak>0, name);
          else assert.match(output.text, /hello|world|speech|test/i, name);
        }
      }
    }
    activeCase = '';
    report.ok = report.errors.length === 0;
    await page.evaluate(r => {document.getElementById('result').textContent=JSON.stringify(r,null,2);}, {adapter:report.adapter, cases:report.cases.map(c=>({name:c.name, result:c.result, error:c.error})), ok:report.ok});
    await page.screenshot({path:path.join(artifacts,'result.png'), fullPage:true});
    const options = await newPageWithoutForeground(context);
    await options.goto(`${origin}/options.html#settings-translation`, {waitUntil:'domcontentloaded'});
    const modelRow = options.locator('[data-testid="local-tts-model-row"]');
    await modelRow.waitFor({state:'visible',timeout:30000});
    if(kinds.includes('tts'))await modelRow.getByText(/可离线使用|Available offline/).waitFor({state:'visible',timeout:30000});
    report.settingsModelText = await modelRow.innerText();
    assert.match(report.settingsModelText, /343/);
    await modelRow.scrollIntoViewIfNeeded();
    await options.screenshot({path:path.join(artifacts,'settings-model.png')});
    if(!report.ok)process.exitCode=1;
    console.log(JSON.stringify({ok:report.ok, cases:report.cases.map(c=>({name:c.name, elapsedMs:c.elapsedMs, error:c.error, result:c.result}))}));
  } catch(error) {report.ok=false; report.failure=error.stack; console.error(error); process.exitCode=1;}
  finally {
    fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify(report,null,2));
    if(session)await session.close();
    fs.rmSync(profile,{recursive:true,force:true});
    fs.rmSync(fixture,{recursive:true,force:true});
  }
})();

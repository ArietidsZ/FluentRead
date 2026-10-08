#!/usr/bin/env node
// Real local Whisper benchmark: synthetic Chinese speech, CER, time and owned-browser CPU/RSS.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {createRequire} = require('node:module');
const {createHash} = require('node:crypto');
const {guardBrowserClose} = require('./testing/owned-browser-close.cjs');
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1]; };
const runtime = arg('playwright-root');
const helperPath = arg('focus-safe-helper');
if (!runtime || !helperPath) throw new Error('Explicit isolated Playwright runtime and focus-safe helper are required');
const {chromium} = createRequire(path.join(runtime, 'asr-benchmark.cjs'))('playwright');
const helper = require(path.resolve(helperPath));
const artifacts = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-asr-benchmark'));
fs.mkdirSync(artifacts, {recursive: true});
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-asr-benchmark-'));
const profileDir = path.join(temporary, 'profile');
const stagedExtension = path.join(temporary, 'extension');
const versions = [{name: arg('version-label', 'baseline'), source: path.resolve(arg('extension-dir', '.output/chrome-mv3'))}];
if (arg('next-extension-dir')) versions.push({name: 'fixed', source: path.resolve(arg('next-extension-dir'))});
const models = arg('models', 'tiny,base').split(',');
assert.ok(models.every(model => ['tiny', 'base'].includes(model)), 'Supported models are tiny and base');
const languages = arg('languages', 'zh-Hans,auto').split(',');
const cacheDir = arg('model-cache-dir') ? path.resolve(arg('model-cache-dir')) : null;
const exportCacheDir = arg('export-model-cache-dir') ? path.resolve(arg('export-model-cache-dir')) : null;
const installWithCdp = arg('extension-install', 'flags') === 'cdp';
const prepareTimeoutMs = Number(arg('prepare-timeout-ms', '120000'));
const inferenceTimeoutMs = Number(arg('inference-timeout-ms', '45000'));
const audioPaddingMs = Number(arg('audio-padding-ms', '0'));
const silenceProbe = process.argv.includes('--silence-probe');
const assertSilenceGate = process.argv.includes('--assert-silence-gate');
const assertPaddingOffset = process.argv.includes('--assert-padding-offset');
assert.ok(Number.isSafeInteger(audioPaddingMs) && audioPaddingMs >= 0 && audioPaddingMs <= 10000, 'Audio padding must be between 0 and 10000ms');
for (const timeout of [prepareTimeoutMs, inferenceTimeoutMs]) assert.ok(Number.isSafeInteger(timeout) && timeout > 0, 'Timeouts must be positive integers');
const texts = [
  {reference: '我挟天子以令诸侯，天下都给我让道。', rate: '190'},
  {reference: '我们正在测试中文视频字幕，识别结果应该保持完整，不要重复。', rate: '190'},
  {reference: '今天我们测试自动生成视频字幕。中文识别需要正确判断语言，完整保留每一句对白，遇到背景音乐也不要输出大量重复文字。', rate: '260'},
];
function command(program, args, options = {}) {
  const result = spawnSync(program, args, options);
  if (result.status !== 0) throw new Error(`${program}: ${String(result.stderr)}`);
  return result.stdout;
}
const clips = texts.map(({reference, rate}, index) => {
  const file = path.join(artifacts, `chinese-${index}.aiff`);
  command('/usr/bin/say', ['-v', arg('voice', 'Tingting'), '-r', rate, '-o', file, reference]);
  const spokenBytes = command(arg('ffmpeg', '/opt/homebrew/bin/ffmpeg'), ['-v', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-f', 's16le', '-']);
  const padding = Buffer.alloc(audioPaddingMs * 32);
  const bytes = audioPaddingMs ? Buffer.concat([padding, spokenBytes, padding]) : spokenBytes;
  return {reference, audioPcm16Base64: bytes.toString('base64'), audioSeconds: bytes.length / 32000, spokenAudioSeconds: spokenBytes.length / 32000};
});
const normalize = text => String(text).replace(/[\s\p{P}\p{S}]/gu, '');
function cer(reference, actual) {
  const a = Array.from(normalize(reference)), b = Array.from(normalize(actual));
  let row = Array.from({length: b.length + 1}, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + Number(a[i - 1] !== b[j - 1]));
    row = next;
  }
  return {errors: row[b.length], characters: a.length, rate: row[b.length] / a.length};
}
const modelPrefix = 'https://modelscope.cn/models/onnx-community/whisper-';
const modelFiles = new Set(['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/encoder_model_q4.onnx', 'onnx/decoder_model_merged_q4.onnx', 'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx']);
function knownModelFile(url) {
  if (!url.startsWith(modelPrefix)) return null;
  const match = url.slice(modelPrefix.length).match(/^(tiny|base)\/resolve\/master\/(.+)$/);
  return match && modelFiles.has(match[2]) ? {model: match[1], name: match[2]} : null;
}
function loadModelCache(directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  assert.ok(Array.isArray(manifest.entries), 'Model cache manifest must contain entries');
  return manifest.entries.map(entry => {
    const known = knownModelFile(entry.url);
    assert.ok(known, 'Only registered public Whisper model files may be imported');
    assert.equal(entry.file, path.join(known.model, known.name), 'Model cache filenames must match their registered URLs');
    const file = path.resolve(directory, entry.file);
    assert.ok(file.startsWith(directory + path.sep), 'Model cache file must remain inside its directory');
    assert.ok(fs.realpathSync(file).startsWith(fs.realpathSync(directory) + path.sep), 'Model cache files may not escape through symlinks');
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.length, entry.bytes, 'Model cache byte length changed');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, 'Model cache digest changed');
    return {...entry, localFile: file};
  });
}
const report = {success: false, evidence: 'Real Whisper on three synthetic Mandarin clips; raw CER excludes punctuation but counts simplified/traditional differences; no live X audio', models, languages, audioPaddingMs, silenceProbe, prepareTimeoutMs, inferenceTimeoutMs, extensionInstall: installWithCdp ? 'cdp' : 'flags', modelCache: cacheDir ? {source: cacheDir, entries: loadModelCache(cacheDir).map(({localFile, ...entry}) => entry)} : null, results: []};
let session;
let launchAttempted = false;
let cacheManifest = exportCacheDir && fs.existsSync(path.join(exportCacheDir, 'manifest.json'))
  ? {entries: loadModelCache(exportCacheDir).map(({localFile, ...entry}) => entry)} : {entries: []};
async function importModelCache(control, context) {
  if (!cacheDir) return;
  const entries = loadModelCache(cacheDir).filter(entry => models.includes(knownModelFile(entry.url).model));
  await context.route('https://fluentread-asr-cache.invalid/**', route => {
    const index = Number(new URL(route.request().url()).pathname.slice(1));
    const entry = entries[index];
    assert.ok(entry, 'Unexpected private model cache request');
    return route.fulfill({body: fs.readFileSync(entry.localFile), contentType: entry.contentType || 'application/octet-stream'});
  });
  await control.evaluate(async entries => {
    const cache = await caches.open('transformers-cache');
    for (let index = 0; index < entries.length; index++) {
      const response = await fetch('https://fluentread-asr-cache.invalid/' + index);
      if (!response.ok) throw new Error('Private model cache import failed');
      await cache.put(entries[index].url, response);
    }
  }, entries.map(({url}) => ({url})));
}
async function exportModelCache(control) {
  if (!exportCacheDir) return;
  fs.mkdirSync(exportCacheDir, {recursive: true});
  const urls = await control.evaluate(async () => (await (await caches.open('transformers-cache')).keys()).map(request => request.url));
  for (const url of urls) {
    const known = knownModelFile(url);
    if (!known || !models.includes(known.model) || cacheManifest.entries.some(entry => entry.url === url)) continue;
    const value = await control.evaluate(async url => {
      const response = await (await caches.open('transformers-cache')).match(url);
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
      return {data: btoa(binary), contentType: response.headers.get('content-type') || 'application/octet-stream'};
    }, url);
    const bytes = Buffer.from(value.data, 'base64');
    const file = path.join(known.model, known.name);
    fs.mkdirSync(path.dirname(path.join(exportCacheDir, file)), {recursive: true});
    fs.writeFileSync(path.join(exportCacheDir, file), bytes);
    cacheManifest.entries.push({url, file, contentType: value.contentType, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')});
    fs.writeFileSync(path.join(exportCacheDir, 'manifest.json'), JSON.stringify(cacheManifest, null, 2));
  }
}
async function main() {
  for (const version of versions) {
    fs.rmSync(stagedExtension, {recursive: true, force: true});
    fs.cpSync(version.source, stagedExtension, {recursive: true});
    launchAttempted = true;
    session = await helper.launchFocusSafePersistentContext({chromium, profileDir,
      browserPath: arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
      headless: false, background: true, displayTarget: 'secondary', viewport: {width: 1280, height: 900},
      browserArgs: [...(installWithCdp ? ['--enable-unsafe-extension-debugging'] : [`--disable-extensions-except=${stagedExtension}`, `--load-extension=${stagedExtension}`]), '--no-first-run', '--no-default-browser-check']});
    guardBrowserClose(session, profileDir);
    report[version.name] = {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement};
    const {context} = session;
    report[version.name].extensionWorkerSha256 = createHash('sha256').update(fs.readFileSync(path.join(version.source, 'videoTranscriptionWorker.js'))).digest('hex');
    report[version.name].extensionSource = version.source;
    report[version.name].browserVersion = context.browser().version();
    let extensionId;
    if (installWithCdp) {
      const install = await context.browser().newBrowserCDPSession();
      try {extensionId = (await install.send('Extensions.loadUnpacked', {path: stagedExtension})).id;} finally {await install.detach();}
    }
    const isProduct = worker => worker.url().endsWith('/background.js') && (!extensionId || new URL(worker.url()).host === extensionId);
    const worker = context.serviceWorkers().find(isProduct) || await context.waitForEvent('serviceworker', {predicate: isProduct});
    const control = await helper.newPageWithoutForeground(context);
    await control.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    await importModelCache(control, context);
    const cdp = await context.browser().newBrowserCDPSession();
    const cpu = async () => (await cdp.send('SystemInfo.getProcessInfo')).processInfo;
    const browserPid = (await cpu()).find(process => process.type === 'browser').id;
    const assertBackground = () => {
      const current = JSON.parse(command('/usr/bin/osascript', ['-l', 'JavaScript', '-e', "ObjC.import('AppKit');const a=$.NSWorkspace.sharedWorkspace.frontmostApplication;JSON.stringify({pid:Number(a.processIdentifier)});"], {encoding: 'utf8'}));
      assert.notEqual(current.pid, browserPid, 'Owned benchmark browser must stay behind the user application');
      (report[version.name].focusChecks ||= []).push(current);
    };
    for (const model of models) {
      if (silenceProbe) {
        const started = Date.now();
        const result = await control.evaluate(({model, audioPcm16Base64, inferenceTimeoutMs}) => Promise.race([
          chrome.runtime.sendMessage({type: 'fluentReadTranscribeLocalVideoAudio', model, streamId: 'benchmark-silence-' + model, generation: 1, sourceLanguage: 'auto', audioPcm16Base64}),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Silence probe timed out')), inferenceTimeoutMs)),
        ]), {model, audioPcm16Base64: Buffer.alloc(6 * 32000).toString('base64'), inferenceTimeoutMs});
        assert.equal(result?.success, true, JSON.stringify(result));
        if (assertSilenceGate) {
          assert.equal(result.text, '', 'Digital silence must not produce subtitles');
          assert.deepEqual(result.segments, [], 'Digital silence must not produce timed segments');
          assert.equal(result.inferenceMs, 0, 'Digital silence must avoid model inference');
        }
        (report.silenceProbes ||= []).push({version: version.name, model, audioSeconds: 6, wallMs: Date.now() - started, result});
        console.log(JSON.stringify({phase: 'silence', ...report.silenceProbes.at(-1)}));
        await control.evaluate(model => chrome.runtime.sendMessage({type: 'fluentReadCancelLocalVideoTranscription', streamId: 'benchmark-silence-' + model, generation: 1, reason: 'complete'}), model);
      }
      console.log(JSON.stringify({phase: 'prepare', version: version.name, model}));
      const prepareAt = Date.now();
      const prepared = await control.evaluate(({model, prepareTimeoutMs}) => Promise.race([
        chrome.runtime.sendMessage({type: 'fluentReadPrepareLocalVideoModel', model}),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Model preparation timed out')), prepareTimeoutMs))
      ]), {model, prepareTimeoutMs});
      assert.equal(prepared?.success, true, JSON.stringify(prepared));
      const modelReport = {version: version.name, model, prepareMs: Date.now() - prepareAt, prepared, runs: []};
      report.results.push(modelReport);
      await exportModelCache(control);
      for (const sourceLanguage of languages) {
        assertBackground();
        const streamId = `asr-benchmark-${model}-${sourceLanguage}`;
        const before = await cpu();
        const rss = processes => Number(command('/bin/ps', ['-o', 'rss=', '-p', processes.map(x => x.id).join(',')], {encoding: 'utf8'}).trim().split(/\s+/).reduce((sum, value) => sum + (Number(value) || 0), 0));
        const initialRssKb = rss(before);
        let peakRssKb = initialRssKb;
        const sample = setInterval(async () => { try { peakRssKb = Math.max(peakRssKb, rss(await cpu())); } catch {} }, 500);
        try {
          for (let index = 0; index < clips.length; index++) {
            const clip = clips[index], started = Date.now();
            const result = await control.evaluate(({message, inferenceTimeoutMs}) => Promise.race([
              chrome.runtime.sendMessage(message),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Transcription timed out')), inferenceTimeoutMs))
            ]), {message: {type: 'fluentReadTranscribeLocalVideoAudio', streamId, generation: 1, model, sourceLanguage, audioPcm16Base64: clip.audioPcm16Base64}, inferenceTimeoutMs});
            assert.equal(result?.success, true, JSON.stringify(result));
            const wallMs = Date.now() - started;
            if (audioPaddingMs && assertPaddingOffset && result.segments?.length) {
              assert.ok(result.segments.every(segment => segment.startMs >= audioPaddingMs - 200 && segment.endMs <= (clip.audioSeconds * 1000 - audioPaddingMs + 200)), 'Padded speech timestamps must restore the original audio offset');
            }
            modelReport.runs.push({sourceLanguage, reference: clip.reference, text: result.text, audioSeconds: clip.audioSeconds, spokenAudioSeconds: clip.spokenAudioSeconds,
              wallMs, realTimeFactor: wallMs / 1000 / clip.audioSeconds, inferenceMs: result.inferenceMs, decodeMs: result.decodeMs, backend: result.backend, dtype: result.dtype, segments: result.segments,
              cer: cer(clip.reference, result.text)});
            assertBackground();
            console.log(JSON.stringify({version: version.name, model, ...modelReport.runs.at(-1)}));
          }
        } finally {
          clearInterval(sample);
          await control.evaluate(streamId => chrome.runtime.sendMessage({type: 'fluentReadCancelLocalVideoTranscription', streamId, generation: 1, reason: 'complete'}), streamId);
        }
        const after = await cpu();
        const beforeCpu = new Map(before.map(x => [x.id, x.cpuTime]));
        (modelReport.resources ||= []).push({sourceLanguage, initialBrowserRssMb: initialRssKb / 1024, peakBrowserRssMb: peakRssKb / 1024,
          cpuSeconds: after.reduce((sum, x) => sum + Math.max(0, x.cpuTime - (beforeCpu.get(x.id) || 0)), 0)});
      }
    }
    await cdp.detach();
    await session.close();
    session = null;
    launchAttempted = false;
  }
  report.success = true;
}
main().catch(error => {report.error = {message: error.message, stack: error.stack}; process.exitCode = 1;}).finally(async () => {
  let closed = !launchAttempted;
  try {if (session) {await session.close(); closed = true;}} catch (error) {report.success = false; report.cleanupError = error.stack || String(error); process.exitCode = 1;}
  if (closed) fs.rmSync(temporary, {recursive: true, force: true});
  else report.retainedTemporaryDirectory = temporary;
  if (exportCacheDir) report.exportedModelCache = {directory: exportCacheDir, entries: cacheManifest.entries.map(entry => ({...entry}))};
  fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({success: report.success, error: report.error, artifacts}));
});

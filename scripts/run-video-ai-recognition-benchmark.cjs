#!/usr/bin/env node
// Real local Whisper benchmark: synthetic Chinese speech, CER, time and owned-browser CPU/RSS.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {createRequire} = require('node:module');
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
const versions = [{name: 'baseline', source: path.resolve(arg('extension-dir', '.output/chrome-mv3'))}];
if (arg('next-extension-dir')) versions.push({name: 'fixed', source: path.resolve(arg('next-extension-dir'))});
const models = arg('models', 'tiny,base').split(',');
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
  const bytes = command(arg('ffmpeg', '/opt/homebrew/bin/ffmpeg'), ['-v', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-f', 's16le', '-']);
  return {reference, audioPcm16Base64: bytes.toString('base64'), audioSeconds: bytes.length / 32000};
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
const report = {success: false, evidence: 'Real Whisper on three synthetic Mandarin clips; raw CER excludes punctuation but counts simplified/traditional differences; no live X audio', results: []};
let session;
async function main() {
  for (const version of versions) {
    fs.rmSync(stagedExtension, {recursive: true, force: true});
    fs.cpSync(version.source, stagedExtension, {recursive: true});
    session = await helper.launchFocusSafePersistentContext({chromium, profileDir,
      browserPath: arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
      headless: false, background: true, displayTarget: 'secondary', viewport: {width: 1280, height: 900},
      browserArgs: [`--disable-extensions-except=${stagedExtension}`, `--load-extension=${stagedExtension}`, '--no-first-run', '--no-default-browser-check']});
    report[version.name] = {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement};
    const {context} = session;
    const worker = context.serviceWorkers().find(x => x.url().endsWith('/background.js')) || await context.waitForEvent('serviceworker');
    const control = await helper.newPageWithoutForeground(context);
    await control.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    const cdp = await context.browser().newBrowserCDPSession();
    const cpu = async () => (await cdp.send('SystemInfo.getProcessInfo')).processInfo;
    for (const model of models) {
      const prepareAt = Date.now();
      const prepared = await control.evaluate(model => Promise.race([
        chrome.runtime.sendMessage({type: 'fluentReadPrepareLocalVideoModel', model}),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Model preparation exceeded 120 seconds')), 120000))
      ]), model);
      assert.equal(prepared?.success, true, JSON.stringify(prepared));
      const modelReport = {version: version.name, model, prepareMs: Date.now() - prepareAt, runs: []};
      report.results.push(modelReport);
      for (const sourceLanguage of ['zh-Hans', 'auto']) {
        const streamId = `asr-benchmark-${model}-${sourceLanguage}`;
        const before = await cpu();
        const rss = processes => Number(command('/bin/ps', ['-o', 'rss=', '-p', processes.map(x => x.id).join(',')], {encoding: 'utf8'}).trim().split(/\s+/).reduce((sum, value) => sum + (Number(value) || 0), 0));
        const initialRssKb = rss(before);
        let peakRssKb = initialRssKb;
        const sample = setInterval(async () => { try { peakRssKb = Math.max(peakRssKb, rss(await cpu())); } catch {} }, 500);
        try {
          for (let index = 0; index < clips.length; index++) {
            const clip = clips[index], started = Date.now();
            const result = await control.evaluate(message => Promise.race([
              chrome.runtime.sendMessage(message),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Transcription exceeded 45 seconds')), 45000))
            ]), {type: 'fluentReadTranscribeLocalVideoAudio', streamId, generation: 1, model, sourceLanguage, audioPcm16Base64: clip.audioPcm16Base64});
            assert.equal(result?.success, true, JSON.stringify(result));
            modelReport.runs.push({sourceLanguage, reference: clip.reference, text: result.text, audioSeconds: clip.audioSeconds,
              wallMs: Date.now() - started, inferenceMs: result.inferenceMs, decodeMs: result.decodeMs, backend: result.backend, dtype: result.dtype,
              cer: cer(clip.reference, result.text)});
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
  }
  report.success = true;
}
main().catch(error => {report.error = {message: error.message, stack: error.stack}; process.exitCode = 1;}).finally(async () => {
  fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({success: report.success, error: report.error, artifacts}));
  await session?.close();
  fs.rmSync(temporary, {recursive: true, force: true});
});

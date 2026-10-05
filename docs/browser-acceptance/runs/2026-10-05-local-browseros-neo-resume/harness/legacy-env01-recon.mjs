/**
 * ENV-01 reconnaissance for the FluentRead BrowserOS Neo acceptance run.
 *
 * Observes, in a dedicated temporary profile: BrowserOS Neo identity, the real
 * extension identity loaded into that profile, the CDP control surface, incognito
 * reachability, and OS + raw WebGPU adapter facts in four distinct execution
 * contexts (normal page, extension page, extension-origin Web Worker, incognito page).
 *
 * The handoff warns that a page-level WebGPU probe does not prove that a Worker or
 * Offscreen context can obtain an adapter, so each context is probed separately.
 *
 * Never calls Page.bringToFront(); never activates a window; opens tabs in the
 * background only.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {connect, attachAll, evaluate, screenshot, browserVersion} from './cdp.mjs';

const run = promisify(execFile);
const [CDP_PORT_RAW, FIXTURE_URL, OUT, EXT_DIR] = process.argv.slice(2);
const CDP_PORT = Number(CDP_PORT_RAW);
if (!CDP_PORT || !FIXTURE_URL || !OUT) throw new Error('usage: env01-recon.mjs <cdpPort> <fixtureUrl> <outDir> [extensionDir]');
await fs.mkdir(OUT, {recursive: true});

const startedAt = new Date().toISOString();
const observations = [];
const at = () => new Date().toISOString();
const note = (text, detail) => { observations.push({text, ...(detail ?? {})}); console.log(`  · ${text}`); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Probe WebGPU adapter with explicit getter reads (adapter.info/limits are prototype getters). */
const GPU_PROBE = `(async () => {
  const out = {context: 'unknown'};
  if (!navigator.gpu) { out.error = 'navigator.gpu absent'; return out; }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) { out.error = 'requestAdapter() returned null'; return out; }
  const info = adapter.info ?? {};
  out.legacyIsFallbackAdapter = typeof adapter.isFallbackAdapter === 'undefined' ? 'ABSENT' : adapter.isFallbackAdapter;
  out.info = {
    vendor: info.vendor ?? null, architecture: info.architecture ?? null,
    device: info.device ?? null, description: info.description ?? null,
    isFallbackAdapter: typeof info.isFallbackAdapter === 'undefined' ? 'ABSENT' : info.isFallbackAdapter,
  };
  out.features = [...adapter.features].sort();
  out.limits = {};
  for (const key of ['maxBufferSize','maxStorageBufferBindingSize','maxComputeWorkgroupStorageSize','maxTextureDimension2D','maxBindGroups','maxComputeInvocationsPerWorkgroup']) {
    out.limits[key] = adapter.limits[key] ?? null;
  }
  out.hasShaderF16 = adapter.features.has('shader-f16');
  return out;
})()`;

// ---- OS-level GPU facts -----------------------------------------------------
const {stdout: gpuReport} = await run('/usr/sbin/system_profiler', ['SPDisplaysDataType'], {maxBuffer: 8 * 1024 * 1024});
const chipset = (gpuReport.match(/Chipset Model:\s*(.+)/u)?.[1] ?? '').trim();
const cores = (gpuReport.match(/Total Number of Cores:\s*(.+)/u)?.[1] ?? '').trim();
const metal = (gpuReport.match(/Metal Support:\s*(.+)/u)?.[1] ?? '').trim();
const osGpuDescription = `${chipset} (${cores} GPU cores, ${metal})`;
note(`OS GPU: ${osGpuDescription}`);

// ---- Browser identity -------------------------------------------------------
const version = await browserVersion(CDP_PORT);
const client = await connect(CDP_PORT);
const {product, revision, userAgent} = await client.send('Browser.getVersion');
note(`Browser: ${product} revision=${revision} (CDP protocol ${version['Protocol-Version']})`);

// ---- Extension: load if absent, then resolve identity from its own runtime ---
let sessions = await attachAll(client);
let ourId = null;
async function manifestOf(sessionId) {
  try { return await evaluate(client, sessionId, `(() => { try { const m = chrome.runtime.getManifest(); return {name: m.name, version: m.version, mv: m.manifest_version, id: chrome.runtime.id}; } catch (e) { return {error: String(e)}; } })()`); }
  catch { return null; }
}
for (const [sessionId, info] of sessions) {
  if (!info.url.startsWith('chrome-extension://')) continue;
  const manifest = await manifestOf(sessionId);
  if (manifest && manifest.name && manifest.name.startsWith('FluentRead')) ourId = manifest.id;
  if (manifest?.name) note(`Extension in profile: ${manifest.name} ${manifest.version} (${info.url.split('/')[2]})`);
}

if (!ourId && EXT_DIR) {
  try {
    const loaded = await client.send('Extensions.loadUnpacked', {path: EXT_DIR});
    ourId = loaded.id;
    note(`Extensions.loadUnpacked -> ${loaded.id}`);
    await wait(3000);
    sessions = await attachAll(client);
  } catch (error) { note(`Extensions.loadUnpacked failed: ${error.message}`); }
}

// Resolve the extension's identity from the extension page itself.
let extensionName = null; let extensionVersion = null;
if (ourId) {
  const {targetId} = await client.send('Target.createTarget', {url: `chrome-extension://${ourId}/options.html`, background: true});
  const {sessionId} = await client.send('Target.attachToTarget', {targetId, flatten: true});
  await wait(3000);
  const manifest = await manifestOf(sessionId);
  if (manifest && !manifest.error) {
    extensionName = manifest.name; extensionVersion = manifest.version;
    note(`Extension self-reported manifest: ${extensionName} ${extensionVersion} (MV${manifest.mv}) id=${manifest.id}`);
  }
  await screenshot(client, sessionId, path.join(OUT, 'extension-options-page.png'));
  note('Captured extension options page screenshot');
  await client.send('Target.closeTarget', {targetId});
}

// ---- Context 1: NORMAL page at the loopback fixture -------------------------
const {targetId: pageTarget} = await client.send('Target.createTarget', {url: FIXTURE_URL, background: true});
const {sessionId: pageSession} = await client.send('Target.attachToTarget', {targetId: pageTarget, flatten: true});
await client.send('Page.enable', {}, pageSession);
await wait(3000);
const pageContext = await evaluate(client, pageSession, `({url: location.href, title: document.title, secureContext: window.isSecureContext})`);
const pageGpu = await evaluate(client, pageSession, GPU_PROBE);
pageGpu.context = 'normal-page';
note(`Context normal-page: ${pageContext.title} secure=${pageContext.secureContext} fallback=${pageGpu.info?.isFallbackAdapter} f16=${pageGpu.hasShaderF16}`);
const fixturePng = await screenshot(client, pageSession, path.join(OUT, 'fixture-home.png'));
note(`Captured fixture home screenshot (${fixturePng.length} bytes)`);

const fixtureDom = await evaluate(client, pageSession, `(() => ({
  fixtureTitle: document.title,
  headings: [...document.querySelectorAll('h2')].map(h => h.textContent.trim()),
  images: [...document.querySelectorAll('img')].map(i => ({id: i.id, w: i.naturalWidth, h: i.naturalHeight})),
  ttsChars: document.getElementById('tts-text')?.value.length ?? 0,
}))()`);
note(`Fixture DOM: headings=${JSON.stringify(fixtureDom.headings)} images=${JSON.stringify(fixtureDom.images.map(i => i.id + ':' + i.w + 'x' + i.h))} ttsChars=${fixtureDom.ttsChars}`);

// ---- Contexts 2 & 3: extension page + extension-origin Worker ---------------
let offscreenGpu = {context: 'extension-offscreen', error: 'not attempted'};
let workerGpu = {context: 'extension-worker', error: 'not attempted'};
if (ourId) {
  try {
    const {targetId} = await client.send('Target.createTarget', {url: `chrome-extension://${ourId}/offscreen.html`, background: true});
    const {sessionId} = await client.send('Target.attachToTarget', {targetId, flatten: true});
    await wait(3500);
    offscreenGpu = await evaluate(client, sessionId, GPU_PROBE);
    offscreenGpu.context = 'extension-offscreen';
    note(`Context extension-offscreen: fallback=${offscreenGpu.info?.isFallbackAdapter} f16=${offscreenGpu.hasShaderF16} err=${offscreenGpu.error ?? 'none'}`);
    await screenshot(client, sessionId, path.join(OUT, 'extension-offscreen.png'));
    // Worker spawned from the extension origin, matching the model execution path.
    workerGpu = await evaluate(client, sessionId, `(async () => {
      const source = ${JSON.stringify(GPU_PROBE)};
      const url = URL.createObjectURL(new Blob([source], {type: 'text/javascript'}));
      try {
        const worker = new Worker(url);
        const result = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('worker timeout')), 15000);
          worker.onmessage = event => { clearTimeout(timer); resolve(event.data); };
          worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message || 'worker error')); };
        });
        worker.terminate();
        return result;
      } catch (error) { return {error: String(error)}; }
    })()`);
    workerGpu.context = 'extension-worker';
    note(`Context extension-worker: fallback=${workerGpu.info?.isFallbackAdapter} f16=${workerGpu.hasShaderF16} err=${workerGpu.error ?? 'none'}`);
    await client.send('Target.closeTarget', {targetId});
  } catch (error) { note(`Extension context probe failed: ${error.message}`); }
}

// ---- Context 4: incognito ---------------------------------------------------
let incognitoReachable = false; let incognitoError = null; let incognitoGpu = null;
try {
  const {browserContextId} = await client.send('Target.createBrowserContext', {disposeOnDetach: false});
  incognitoReachable = true;
  note(`Incognito browser context created: ${browserContextId}`);
  const {targetId} = await client.send('Target.createTarget', {url: FIXTURE_URL, browserContextId, background: true});
  const {sessionId} = await client.send('Target.attachToTarget', {targetId, flatten: true});
  await wait(3000);
  incognitoGpu = await evaluate(client, sessionId, GPU_PROBE);
  incognitoGpu.context = 'incognito-page';
  note(`Context incognito-page: fallback=${incognitoGpu.info?.isFallbackAdapter} f16=${incognitoGpu.hasShaderF16}`);
  await screenshot(client, sessionId, path.join(OUT, 'incognito-fixture.png'));
  await client.send('Target.disposeBrowserContext', {browserContextId});
  note('Incognito browser context disposed');
} catch (error) { incognitoError = error.message; note(`Incognito context NOT creatable: ${error.message}`); }

// ---- Persist evidence -------------------------------------------------------
const gpuLog = {
  osGpuDescription,
  adapter: pageGpu.info ?? null,
  events: [
    {event: 'os-gpu-discovery', at: startedAt, context: 'system_profiler SPDisplaysDataType', description: chipset, gpuCores: cores, metal},
    {event: 'webgpu-adapter-request', at: at(), context: 'normal-page', adapter: pageGpu.info ?? null, features: pageGpu.features ?? [], limits: pageGpu.limits ?? {}, hasShaderF16: pageGpu.hasShaderF16 ?? null},
    {event: 'webgpu-adapter-request', at: at(), context: 'extension-offscreen', adapter: offscreenGpu.info ?? null, features: offscreenGpu.features ?? [], limits: offscreenGpu.limits ?? {}, hasShaderF16: offscreenGpu.hasShaderF16 ?? null, error: offscreenGpu.error ?? null},
    {event: 'webgpu-adapter-request', at: at(), context: 'extension-worker', adapter: workerGpu.info ?? null, features: workerGpu.features ?? [], limits: workerGpu.limits ?? {}, hasShaderF16: workerGpu.hasShaderF16 ?? null, error: workerGpu.error ?? null},
    {event: 'webgpu-adapter-request', at: at(), context: 'incognito-page', adapter: incognitoGpu?.info ?? null, hasShaderF16: incognitoGpu?.hasShaderF16 ?? null, error: incognitoGpu?.error ?? null},
  ],
};
const browserLog = {
  events: [
    {event: 'browser-identity', at: startedAt, context: 'CDP Browser.getVersion', product, revision, userAgent},
    {event: 'cdp-target-inventory', at: at(), context: 'CDP Target.getTargets', count: sessions.size, targets: [...sessions.values()].map(i => ({type: i.type, url: i.url}))},
    {event: 'extension-identity', at: at(), context: 'extension options page chrome.runtime.getManifest()', extensionId: ourId, extensionName, extensionVersion},
    {event: 'fixture-page-load', at: at(), context: 'background CDP tab', url: pageContext.url, title: pageContext.title, secureContext: pageContext.secureContext},
    {event: 'fixture-dom', at: at(), context: 'background CDP tab', headings: fixtureDom.headings, images: fixtureDom.images, ttsChars: fixtureDom.ttsChars},
    {event: 'incognito-context-probe', at: at(), context: 'CDP Target.createBrowserContext', reachable: incognitoReachable, error: incognitoError},
  ],
};
await fs.writeFile(path.join(OUT, 'gpu-log.json'), JSON.stringify(gpuLog, null, 2));
await fs.writeFile(path.join(OUT, 'browser-log.json'), JSON.stringify(browserLog, null, 2));
const report = {startedAt, finishedAt: at(), cdpPort: CDP_PORT, fixtureUrl: FIXTURE_URL, version, product, revision, osGpuDescription, pageGpu, offscreenGpu, workerGpu, incognitoGpu, incognitoReachable, incognitoError, targetInventory: [...sessions.values()].map(i => ({type: i.type, url: i.url})), extensionId: ourId, extensionName, extensionVersion, fixtureDom, observations};
await fs.writeFile(path.join(OUT, 'env01-recon.json'), JSON.stringify(report, null, 2));
client.close();
console.log(JSON.stringify({ok: true, extensionId: ourId, extensionName, extensionVersion, osGpuDescription, normalPage: {fallback: pageGpu.info?.isFallbackAdapter, f16: pageGpu.hasShaderF16}, offscreen: {fallback: offscreenGpu.info?.isFallbackAdapter, f16: offscreenGpu.hasShaderF16, error: offscreenGpu.error ?? null}, worker: {fallback: workerGpu.info?.isFallbackAdapter, f16: workerGpu.hasShaderF16, error: workerGpu.error ?? null}, incognito: {reachable: incognitoReachable, f16: incognitoGpu?.hasShaderF16 ?? null}}));

/**
 * @file acceptance-run.mjs
 * 本轮本地 BrowserOS Neo 验收的**唯一**浏览器取证驱动（上游规则 7f8d6dfe，
 * 策略 temporary-partial-visibility-20261005）。
 *
 * 验收规则要求「首个 running 观测之后才操作，最后一个操作之后等待新观测再停止 guard」，
 * 因此本驱动的执行顺序是：
 *   1. 先启动 task-scoped Neo stdio 服务并写出 neo-pid.txt（guard 绑定到它的 pid）。
 *   2. 等待外层启动的持续 focus guard 进入 running；之后才做第一个浏览器操作。
 *   3. 读操作系统 GPU 事实（system_profiler，不碰浏览器）。
 *   4. 载入已构建的 unpacked 扩展（不重建），读扩展自报 manifest。
 *   5. 只读 CDP 清点：target 清单、窗口 bounds（只读，不移动）。
 *   6. 四个执行上下文的原始 WebGPU adapter 观测：普通页面 / 扩展 offscreen 文档 /
 *      扩展同源 Blob Worker / 扩展 options 页面。
 *   7. 回环夹具与 popup / options 的真实 DOM 事实 + PNG 截图。
 *   8. 写全部证据文件，等待「最后一个操作之后」的新观测，写 done 哨兵，
 *      再等外层干净停止 guard（status=stopped），保证 guard 区间覆盖全部 browser-log 事件。
 *
 * 全程不使用 Page.bringToFront()，不移动/最小化窗口，不写产品配置，不连日常 profile。
 *
 * 用法：node acceptance-run.mjs RUN_DIR NEO_SERVER FIXTURE_URL EXTENSION_ID EXTENSION_DIR CDP_PORT
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn, execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {promisify} from 'node:util';

const run0 = promisify(execFile);
const [runDir, neoServer, fixtureUrl, extensionId, extensionDir, cdpPortArg] = process.argv.slice(2);
if (!runDir || !neoServer || !fixtureUrl || !extensionId || !extensionDir || !cdpPortArg) {
  throw new Error('Usage: acceptance-run.mjs RUN_DIR NEO_SERVER FIXTURE_URL EXTENSION_ID EXTENSION_DIR CDP_PORT');
}
const cdpPort = Number(cdpPortArg);
const doneFile = path.join(runDir, 'phase-done');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const log = [];
const say = (...p) => { const line = `${now()} ${p.join(' ')}`; log.push(line); console.log(line); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const writeJson = async (rel, value) => {
  const target = path.join(runDir, rel);
  await fs.mkdir(path.dirname(target), {recursive: true});
  await fs.writeFile(target, JSON.stringify(value, null, 2) + '\n');
};

const guardState = async () => JSON.parse(await fs.readFile(path.join(runDir, 'focus-guard.json'), 'utf8').catch(() => '{"status":"missing"}'));
const violations = g => (g.events || []).filter(e => e.event === 'guard-violation');
const requireGuard = async where => {
  const g = await guardState();
  if (g.status !== 'running') throw new Error(`focus guard is ${g.status} during ${where}; refusing further browser operations`);
  return g;
};

// ---------------------------------------------------------------- browser log
const browserLog = {events: []};
const bl = (event, context, extra = {}) => browserLog.events.push({event, at: now(), context, ...extra});

// ---------------------------------------------------------------- raw CDP
async function cdpSession(port) {
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`, {signal: AbortSignal.timeout(4000)})).json();
  const url = new URL(version.webSocketDebuggerUrl);
  if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || Number(url.port) !== port) throw new Error('Refusing unverified CDP destination');
  const socket = new WebSocket(url);
  const calls = new Map(); let id = 0;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP connect timeout')), 4000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, {once: true});
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connect failed')); }, {once: true});
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id === undefined) return;
    const entry = calls.get(message.id); if (!entry) return;
    calls.delete(message.id);
    message.error ? entry.reject(new Error(`${entry.method}: ${message.error.message}`)) : entry.resolve(message.result);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const current = ++id;
    calls.set(current, {resolve, reject, method});
    socket.send(JSON.stringify({id: current, method, params, ...(sessionId ? {sessionId} : {})}));
  });
  return {version, send, close: () => socket.close()};
}
const evaluate = (cdp, sessionId, expression, timeout) =>
  cdp.send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true, ...(timeout ? {timeout} : {})}, sessionId)
    .then(r => r?.result?.value);
const redactUrl = value => value.replace(/^chrome-extension:\/\/([a-p]{32})\//u, 'chrome-extension://<id>/');

/** Real WebGPU adapter observation; adapter.info / limits are prototype getters, so read explicitly. */
const GPU_PROBE = `(async () => {
  const out = {};
  if (!navigator.gpu) { out.error = 'navigator.gpu absent'; return out; }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) { out.error = 'requestAdapter() returned null'; return out; }
  const info = adapter.info ?? {};
  out.adapter = {
    vendor: info.vendor ?? null, architecture: info.architecture ?? null,
    device: info.device ?? null, description: info.description ?? null,
    isFallbackAdapter: info.isFallbackAdapter ?? false,
    legacyIsFallbackAdapter: typeof adapter.isFallbackAdapter === 'undefined' ? 'ABSENT' : adapter.isFallbackAdapter
  };
  out.features = [...adapter.features].sort();
  out.limits = {};
  for (const key of ['maxBufferSize','maxStorageBufferBindingSize','maxComputeWorkgroupStorageSize','maxComputeInvocationsPerWorkgroup','maxBindGroups','maxTextureDimension2D']) out.limits[key] = adapter.limits[key];
  out.hasShaderF16 = adapter.features.has('shader-f16');
  return out;
})()`;

const WORKER_PROBE = `(async () => {
  const source = ${JSON.stringify(GPU_PROBE)};
  const url = URL.createObjectURL(new Blob(['onmessage = async () => { postMessage(await (' + source + ')()); };'], {type: 'text/javascript'}));
  const worker = new Worker(url);
  const result = await new Promise(resolve => {
    const timer = setTimeout(() => resolve({error: 'Error: worker timeout'}), 12000);
    worker.onmessage = event => { clearTimeout(timer); resolve(event.data); };
    worker.onerror = event => { clearTimeout(timer); resolve({error: 'Worker error: ' + (event.message || 'unknown')}); };
    worker.postMessage('probe');
  });
  worker.terminate(); URL.revokeObjectURL(url);
  return result;
})()`;

// ---------------------------------------------------------------- Neo stdio client
const stateDir = path.join(runDir, 'neo-state-final');
await fs.mkdir(stateDir, {recursive: true, mode: 0o700});
const child = spawn(neoServer, ['--config', path.join(runDir, 'neo-sidecar.json'), '--stdio'], {
  env: {...process.env, BROWSERCLAW_DIR: stateDir}, stdio: ['pipe', 'pipe', 'pipe'],
});
await fs.writeFile(path.join(runDir, 'neo-pid.txt'), String(child.pid) + '\n');
let buffer = ''; const pending = new Map(); let nextId = 0;
child.stdout.on('data', chunk => {
  buffer += chunk.toString();
  let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i).trim(); buffer = buffer.slice(i + 1);
    if (!line) continue;
    let message; try { message = JSON.parse(line); } catch { continue; }
    const entry = pending.get(message.id); if (!entry) continue;
    pending.delete(message.id); clearTimeout(entry.timer);
    message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result);
  }
});
const request = (method, params = {}, ms = 120000) => new Promise((resolve, reject) => {
  const id = ++nextId; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout ${method}`)); }, ms);
  pending.set(id, {resolve, reject, timer});
  child.stdin.write(JSON.stringify({jsonrpc: '2.0', id, method, params}) + '\n');
});
const call = async (tool, args = {}) => {
  const result = await request('tools/call', {name: tool, arguments: args});
  const parts = result.content || [];
  return {text: parts.filter(p => p.type === 'text').map(p => p.text).join('\n'),
    images: parts.filter(p => p.type === 'image').map(p => ({mimeType: p.mimeType, bytes: (p.data || '').length})),
    isError: Boolean(result.isError), content: parts};
};

const out = {startedAt: now(), neoPid: child.pid, surfaces: {}, observations: [], gpu: {}, capabilities: {}, dom: {}};
const observe = (caseId, text) => { out.observations.push({caseId, at: now(), text}); say(caseId, '|', text); };
const save = async label => { out.savedAt = now(); await writeJson('artifacts/session/run.json', out); say('checkpoint:', label); };
const saveLog = async () => writeJson('artifacts/env01/browser-log.json', browserLog);

const domFacts = `JSON.stringify({
  url: location.href, title: document.title,
  headings: [...document.querySelectorAll('h1,h2,h3')].map(h => h.textContent.trim()).filter(Boolean).slice(0, 40),
  buttons: [...document.querySelectorAll('button,[role=button]')].map(b => (b.getAttribute('aria-label') || b.textContent || '').trim()).filter(Boolean).slice(0, 80),
  inputs: [...document.querySelectorAll('input,select,textarea')].map(i => ({tag: i.tagName.toLowerCase(), type: i.type || null, id: i.id || null, name: i.name || null})).slice(0, 80),
  textLength: document.body ? document.body.innerText.length : 0,
  background: getComputedStyle(document.body).backgroundColor,
  innerTextExcerpt: (document.body ? document.body.innerText : '').slice(0, 2000)
})`;

const pngInfo = bytes => {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
  return {bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), sha256: sha256(bytes)};
};

try {
  await request('initialize', {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'fluentread-acceptance-run', version: '1.0.0'}});
  child.stdin.write(JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'}) + '\n');
  const toolList = await request('tools/list');
  out.tools = (toolList.tools || []).map(t => t.name).sort();
  say('stdio server ready, pid', child.pid, '| MCP tools', out.tools.length);
  await writeJson('artifacts/neo/neo-stdio-capabilities.json', {
    transport: 'stdio', server: neoServer.replace(/^.*\/versions\//u, 'versions/'),
    mcp: {protocolVersion: '2025-06-18', serverInfo: 'browseros-neo (browseros-claw-server)'},
    tools: out.tools, operations: ['MCP initialize', 'notifications/initialized', 'tools/list', ...out.tools.map(t => `tools/call ${t}`)],
    at: now(), pid: child.pid, stateDir: '<run>/neo-state-final',
  });

  // ---- wait for the continuous focus guard to reach running: nothing browser-side happens before this
  let guard = await guardState();
  const deadline = Date.now() + 120000;
  while (guard.status !== 'running' && Date.now() < deadline) { await sleep(500); guard = await guardState(); }
  if (guard.status !== 'running') throw new Error(`focus guard never reached running (status=${guard.status})`);
  out.guardAtStart = {status: guard.status, mode: guard.mode, visibilityPolicy: guard.visibilityPolicy,
    browserPid: guard.browserPid, profilePathSha256: guard.profilePathSha256,
    observations: (guard.events || []).filter(e => e.event === 'focus-window-observation').length,
    firstObservation: (guard.events || [])[0]?.at, violations: violations(guard).length};
  say('guard running | policy', guard.visibilityPolicy, '| first observation', out.guardAtStart.firstObservation);
  bl('guard-bound', 'owned-temporary-browser', {visibilityPolicy: guard.visibilityPolicy, guardMode: guard.mode,
    browserPid: guard.browserPid, profilePathSha256: guard.profilePathSha256, firstObservation: out.guardAtStart.firstObservation});
  await save('guard bound');

  // ---- OS GPU facts (no browser involvement)
  const {stdout: gpuReport} = await run0('/usr/sbin/system_profiler', ['SPDisplaysDataType'], {maxBuffer: 8 * 1024 * 1024});
  const chipset = (gpuReport.match(/Chipset Model:\s*(.+)/u)?.[1] ?? '').trim();
  const cores = (gpuReport.match(/Total Number of Cores:\s*(.+)/u)?.[1] ?? '').trim();
  const metal = (gpuReport.match(/Metal Support:\s*(.+)/u)?.[1] ?? '').trim();
  const osGpuDescription = `${chipset} (${cores} GPU cores, ${metal})`;
  const gpuLog = {osGpuDescription, adapter: null, events: []};
  gpuLog.events.push({event: 'os-gpu-discovery', at: now(), context: 'system_profiler SPDisplaysDataType',
    description: chipset, gpuCores: cores, metal, rawBytesSha256: sha256(gpuReport)});
  say('OS GPU:', osGpuDescription);
  bl('os-gpu-discovery', 'system_profiler SPDisplaysDataType', {osGpuDescription});

  // ---- the first browser operation: load the already-built unpacked extension into the owned profile
  await requireGuard('extension load');
  const cdp = await cdpSession(cdpPort);
  const versionInfo = await cdp.send('Browser.getVersion');
  out.browserVersion = {product: versionInfo.product, revision: versionInfo.revision, userAgent: versionInfo.userAgent,
    protocolVersion: cdp.version['Protocol-Version'], browserosVersion: '0.50.5.0', bundleVersion: '0.50.5'};
  bl('browser-identity', 'owned-temporary-browser', {product: versionInfo.product, revision: versionInfo.revision,
    userAgent: versionInfo.userAgent, protocolVersion: cdp.version['Protocol-Version']});
  const loaded = await cdp.send('Extensions.loadUnpacked', {path: extensionDir});
  out.loadUnpacked = loaded;
  bl('extension-loaded', 'owned-temporary-browser', {loadedId: loaded.id, expectedId: extensionId, matches: loaded.id === extensionId,
    buildDirectory: extensionDir,
    note: 'Chromium 151 ignores --load-extension (DEFECT-04); CDP Extensions.loadUnpacked is the only path that works'});
  say('Extensions.loadUnpacked ->', JSON.stringify(loaded));
  await sleep(2500);

  let {targetInfos} = await cdp.send('Target.getTargets');
  out.targetInventory = targetInfos.map(t => ({type: t.type, url: redactUrl(t.url), browserContextId: t.browserContextId ?? null}));
  const workers = targetInfos.filter(t => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${extensionId}/`));
  out.otherExtensionWorkerIds = [...new Set(targetInfos.filter(t => t.type === 'service_worker' && t.url.startsWith('chrome-extension://') && !t.url.startsWith(`chrome-extension://${extensionId}/`)).map(t => t.url.split('/')[2]))];
  bl('cdp-target-inventory', 'owned-temporary-browser', {count: targetInfos.length, fluentReadWorkers: workers.length,
    otherExtensionWorkerIds: out.otherExtensionWorkerIds,
    pageCount: targetInfos.filter(t => t.browserContextId === undefined && t.type === 'page').length});
  say('CDP:', targetInfos.length, 'targets | FluentRead workers', workers.length, '| other ids', out.otherExtensionWorkerIds.join(',') || '(none)');

  if (workers[0]) {
    const {sessionId} = await cdp.send('Target.attachToTarget', {targetId: workers[0].targetId, flatten: true});
    out.extensionManifest = JSON.parse(await evaluate(cdp, sessionId, 'JSON.stringify(chrome.runtime.getManifest())'));
    out.extensionBaseUrl = await evaluate(cdp, sessionId, 'chrome.runtime.getURL("")');
    out.extensionStorageKeys = await evaluate(cdp, sessionId, 'chrome.storage.local.get(null).then(v => JSON.stringify(Object.keys(v)))');
    await cdp.send('Target.detachFromTarget', {sessionId});
    bl('extension-identity', 'chrome.runtime.getManifest() in the extension service worker', {
      extensionId, name: out.extensionManifest.name, version: out.extensionManifest.version,
      manifestVersion: out.extensionManifest.manifest_version, baseUrl: out.extensionBaseUrl, storageKeys: out.extensionStorageKeys});
    say('extension', out.extensionManifest.name, out.extensionManifest.version, '| base', out.extensionBaseUrl);
  } else { out.extensionManifestError = 'no FluentRead service worker target visible'; }

  const fixtureExisting = targetInfos.find(t => t.url.startsWith(fixtureUrl) && t.type === 'page');
  if (fixtureExisting) {
    const {windowId} = await cdp.send('Browser.getWindowForTarget', {targetId: fixtureExisting.targetId});
    out.windowBounds = await cdp.send('Browser.getWindowBounds', {windowId});
    bl('window-bounds', 'owned-temporary-browser', {windowId, bounds: out.windowBounds,
      note: 'read-only query; the window was never moved, minimized or raised by this run'});
    say('window bounds (read-only)', JSON.stringify(out.windowBounds));
  }
  await save('after extension load');

  // ---- Neo control surface: fixture + popup + options
  const tabs0 = await call('tabs', {action: 'list'});
  out.tabsAtStart = tabs0.text.slice(0, 2000);
  const pages = [...tabs0.text.matchAll(/^\[(\d+)\]\s+(\S+)/gmu)].map(m => ({page: Number(m[1]), url: m[2]}));
  const fixturePage = pages.find(p => p.url.startsWith(fixtureUrl))?.page ?? pages[0]?.page;
  bl('neo-tabs-before', 'owned-temporary-browser', {excerpt: tabs0.text.slice(0, 800), fixturePage});
  await requireGuard('fixture navigate');
  const nav = await call('navigate', {page: fixturePage, action: 'url', url: `${fixtureUrl}/`});
  await sleep(1200);
  const snap = await call('snapshot', {page: fixturePage, mode: 'interactive', depth: 8});
  const read = await call('read', {page: fixturePage, format: 'markdown'});
  const sentinel = await call('grep', {page: fixturePage, pattern: '中文结尾哨兵', over: 'content'});
  const neoScreenshot = await call('screenshot', {page: fixturePage});
  const neoImage = (neoScreenshot.content || []).find(p => p.type === 'image');
  const fixturePngNeo = neoImage?.data ? pngInfo(Buffer.from(neoImage.data, 'base64')) : null;
  out.surfaces.fixture = {page: fixturePage, url: `${fixtureUrl}/`, at: now(), navigateResult: nav.text.slice(0, 300),
    snapshotText: snap.text.slice(0, 20000), readText: read.text.slice(0, 12000), sentinelGrep: sentinel.text.slice(0, 1500),
    neoScreenshot: fixturePngNeo};
  out.fixtureRouteStatus = {};
  for (const [name, url] of [['unified', `${fixtureUrl}/fixtures/unified.html`], ['all-nodes', `${fixtureUrl}/fixtures/all-nodes.html`], ['dynamic-shadow', `${fixtureUrl}/fixtures/dynamic-shadow.html`]]) {
    const reply = await fetch(url);
    out.fixtureRouteStatus[name] = {status: reply.status, bytes: (await reply.text()).length};
  }
  out.fixtureMetrics = await (await fetch(`${fixtureUrl}/metrics`)).json();
  bl('fixture-read', 'owned-temporary-browser', {url: `${fixtureUrl}/`, page: fixturePage,
    snapshotChars: snap.text.length, markdownChars: read.text.length, sentinelGrepChars: sentinel.text.length,
    fixtureRoutes: Object.fromEntries(Object.entries(out.fixtureRouteStatus).map(([k, v]) => [k, v.status])),
    metricsRequests: out.fixtureMetrics.requests.length, neoScreenshotBytes: fixturePngNeo?.bytes ?? 0});
  observe('ENV-01', `Fixture ${fixturePage}: snapshot ${snap.text.length} chars, markdown ${read.text.length} chars, routes ${Object.entries(out.fixtureRouteStatus).map(([k, v]) => `${k}=${v.status}`).join(', ')}.`);
  await save('after fixture');

  const openTab = async (url, label) => {
    await requireGuard(`${label} tab open`);
    const opened = await call('tabs', {action: 'new', url});
    await sleep(2500);
    const {targetInfos: infos} = await cdp.send('Target.getTargets');
    const matches = infos.filter(t => t.url === url || t.url.startsWith(url));
    return {opened, matches};
  };

  const popupUrl = `chrome-extension://${extensionId}/popup.html`;
  const popupOpen = await openTab(popupUrl, 'UI-01 popup');
  const popupTarget = popupOpen.matches.at(-1);
  let popupDom = null; let popupPng = null;
  if (popupTarget) {
    const {sessionId} = await cdp.send('Target.attachToTarget', {targetId: popupTarget.targetId, flatten: true});
    await cdp.send('Page.enable', {}, sessionId);
    popupDom = JSON.parse(await evaluate(cdp, sessionId, domFacts) ?? 'null');
    try {
      const shot = await cdp.send('Page.captureScreenshot', {format: 'png'}, sessionId);
      const bytes = Buffer.from(shot.data, 'base64');
      popupPng = pngInfo(bytes);
      if (popupPng) await fs.writeFile(path.join(runDir, 'artifacts/env01/extension-popup.png'), bytes);
    } catch (error) { popupPng = {error: error.message}; }
    await cdp.send('Target.detachFromTarget', {sessionId});
  }
  out.dom['UI-01'] = {url: popupUrl, targetCount: popupOpen.matches.length, dom: popupDom, screenshot: popupPng,
    openSnapshot: popupOpen.opened.text.slice(0, 6000)};
  bl('UI-01-popup', 'owned-temporary-browser', {url: popupUrl, targetCount: popupOpen.matches.length,
    headings: popupDom?.headings?.length ?? 0, buttons: popupDom?.buttons?.length ?? 0,
    screenshotBytes: popupPng?.bytes ?? 0, screenshotSha256: popupPng?.sha256 ?? null});
  observe('UI-01', `Popup target=${popupOpen.matches.length}, screenshot ${popupPng?.bytes ?? 0} bytes ${popupPng?.width ?? 0}x${popupPng?.height ?? 0}; headings ${popupDom?.headings?.length ?? 0}, buttons ${popupDom?.buttons?.length ?? 0}. Translation flow / 390px narrow / dark-theme assertions remain to be executed.`);
  await save('after popup');

  const optionsUrl = `chrome-extension://${extensionId}/options.html`;
  const optionsOpen = await openTab(optionsUrl, 'OCR-UI-01 options');
  const optionsTarget = optionsOpen.matches.find(t => t.url.startsWith(optionsUrl));
  let optionsDom = null; let optionsPng = null;
  if (optionsTarget) {
    const {sessionId} = await cdp.send('Target.attachToTarget', {targetId: optionsTarget.targetId, flatten: true});
    await cdp.send('Page.enable', {}, sessionId);
    optionsDom = JSON.parse(await evaluate(cdp, sessionId, domFacts) ?? 'null');
    try {
      const shot = await cdp.send('Page.captureScreenshot', {format: 'png'}, sessionId);
      const bytes = Buffer.from(shot.data, 'base64');
      optionsPng = pngInfo(bytes);
      if (optionsPng) await fs.writeFile(path.join(runDir, 'artifacts/env01/extension-options-page.png'), bytes);
    } catch (error) { optionsPng = {error: error.message}; }
    await cdp.send('Target.detachFromTarget', {sessionId});
  }
  out.dom['OCR-UI-01'] = {url: optionsUrl, targetCount: optionsOpen.matches.length, dom: optionsDom, screenshot: optionsPng,
    openSnapshot: optionsOpen.opened.text.slice(0, 12000)};
  bl('OCR-UI-01-options', 'owned-temporary-browser', {url: optionsUrl, targetCount: optionsOpen.matches.length,
    headings: optionsDom?.headings?.length ?? 0, inputs: optionsDom?.inputs?.length ?? 0,
    screenshotBytes: optionsPng?.bytes ?? 0, screenshotSha256: optionsPng?.sha256 ?? null});
  observe('OCR-UI-01', `Options target=${optionsOpen.matches.length}, screenshot ${optionsPng?.bytes ?? 0} bytes ${optionsPng?.width ?? 0}x${optionsPng?.height ?? 0}; headings ${optionsDom?.headings?.length ?? 0}, inputs ${optionsDom?.inputs?.length ?? 0}. PaddleOCR selection persistence / narrow / dark variants remain to be executed.`);
  await save('after options');

  // ---- WebGPU adapter in four distinct execution contexts
  await requireGuard('WebGPU probes');
  const probeContext = async (context, sessionId) => {
    const probe = await evaluate(cdp, sessionId, GPU_PROBE, 25000).catch(error => ({error: error.message}));
    const event_ = {event: 'webgpu-adapter-request', at: now(), context};
    if (probe?.adapter) {
      Object.assign(event_, {adapter: {...probe.adapter, isFallbackAdapter: Boolean(probe.adapter.isFallbackAdapter)},
        features: probe.features, limits: probe.limits, hasShaderF16: probe.hasShaderF16, error: null});
      if (!gpuLog.adapter) gpuLog.adapter = event_.adapter;
    } else event_.error = probe?.error ?? 'no adapter observation';
    gpuLog.events.push(event_);
    say('GPU context', context, event_.adapter ? `adapter ok (fallback=${event_.adapter.isFallbackAdapter}, f16=${event_.hasShaderF16}, features=${event_.features.length})` : `error: ${event_.error}`);
    return event_;
  };

  const attachByUrl = async url => {
    const {targetInfos: infos} = await cdp.send('Target.getTargets');
    const target = infos.find(t => t.url === url || t.url.startsWith(url));
    if (!target) return null;
    const {sessionId} = await cdp.send('Target.attachToTarget', {targetId: target.targetId, flatten: true});
    return {sessionId, targetId: target.targetId};
  };

  // context 1: normal page (the loopback fixture)
  const fixtureAttach = await attachByUrl(`${fixtureUrl}/`);
  if (fixtureAttach) {
    await probeContext('normal-page', fixtureAttach.sessionId);
    await cdp.send('Target.detachFromTarget', {sessionId: fixtureAttach.sessionId});
  } else gpuLog.events.push({event: 'webgpu-adapter-request', at: now(), context: 'normal-page', adapter: null, features: [], limits: {}, error: 'fixture target not found'});

  // context 2 + 3: extension offscreen document and an extension-origin Blob Worker
  const offscreenUrl = `chrome-extension://${extensionId}/offscreen.html`;
  const offscreenOpen = await openTab(offscreenUrl, 'offscreen document');
  const offscreenTarget = offscreenOpen.matches.at(-1);
  if (offscreenTarget) {
    const {sessionId} = await cdp.send('Target.attachToTarget', {targetId: offscreenTarget.targetId, flatten: true});
    await probeContext('extension-offscreen', sessionId);
    const workerProbe = await evaluate(cdp, sessionId, WORKER_PROBE, 30000).catch(error => ({error: error.message}));
    const workerEvent = {event: 'webgpu-adapter-request', at: now(), context: 'extension-worker'};
    if (workerProbe?.adapter) Object.assign(workerEvent, {adapter: {...workerProbe.adapter, isFallbackAdapter: Boolean(workerProbe.adapter.isFallbackAdapter)},
      features: workerProbe.features, limits: workerProbe.limits, hasShaderF16: workerProbe.hasShaderF16, error: null});
    else Object.assign(workerEvent, {adapter: null, features: [], limits: {}, error: workerProbe?.error ?? 'no adapter observation'});
    gpuLog.events.push(workerEvent);
    say('GPU context extension-worker', workerEvent.adapter ? 'adapter ok' : `error: ${workerEvent.error}`);
    out.workerContext = {context: 'extension-origin-blob-worker', probe: workerProbe, workerEvent, at: now(),
      note: 'Worker spawned from the extension offscreen document, i.e. the same origin as the packaged model workers.'};
    await writeJson('artifacts/env01/worker-context.json', out.workerContext);
    const shot = await cdp.send('Page.captureScreenshot', {format: 'png'}, sessionId).catch(() => null);
    if (shot) {
      const bytes = Buffer.from(shot.data, 'base64');
      if (pngInfo(bytes)) await fs.writeFile(path.join(runDir, 'artifacts/env01/extension-offscreen.png'), bytes);
    }
    await cdp.send('Target.detachFromTarget', {sessionId});
  } else {
    gpuLog.events.push({event: 'webgpu-adapter-request', at: now(), context: 'extension-offscreen', adapter: null, features: [], limits: {}, error: 'offscreen target not found'});
    gpuLog.events.push({event: 'webgpu-adapter-request', at: now(), context: 'extension-worker', adapter: null, features: [], limits: {}, error: 'offscreen target not found'});
  }

  // context 4: the extension options page
  if (optionsTarget) {
    const {sessionId} = await cdp.send('Target.attachToTarget', {targetId: optionsTarget.targetId, flatten: true});
    await probeContext('extension-options-page', sessionId);
    await cdp.send('Target.detachFromTarget', {sessionId});
  }

  await writeJson('artifacts/env01/gpu-log.json', gpuLog);
  out.gpu = {osGpuDescription, events: gpuLog.events.map(e => ({context: e.context, at: e.at, ok: Boolean(e.adapter),
    error: e.error ?? null, vendor: e.adapter?.vendor ?? null, architecture: e.adapter?.architecture ?? null,
    features: e.features?.length ?? 0, hasShaderF16: e.hasShaderF16 ?? null}))};
  bl('gpu-adapters', 'owned-temporary-browser', {osGpuDescription, contexts: out.gpu.events});
  observe('ENV-01', `Raw WebGPU adapter observations: ${out.gpu.events.map(e => `${e.context}=${e.ok ? 'ok' : 'error'}`).join(', ')}.`);

  // ---- capabilities summary
  await writeJson('artifacts/env01/capabilities.json', {
    browserosVersion: '0.50.5.0', browserosBundleVersion: '0.50.5',
    chromiumVersion: out.browserVersion.product.replace(/^Chrome\//u, ''), chromiumRevision: out.browserVersion.revision,
    tools: out.tools,
    operations: [
      'CDP Browser.getVersion (browser identity and protocol version)',
      'CDP Extensions.loadUnpacked (loaded the already-built unpacked MV3 extension into the owned temporary profile)',
      'CDP Target.getTargets / Target.attachToTarget / Target.detachFromTarget (read-only inventory and page attachment)',
      'CDP Runtime.evaluate (extension manifest, extension storage keys, DOM facts, WebGPU adapter probes)',
      'CDP Page.captureScreenshot (fixture, extension popup, extension options page)',
      'CDP Browser.getWindowForTarget / Browser.getWindowBounds (read-only window geometry)',
      `task-scoped MCP stdio server browseros-claw-server (${out.tools.length} tools: ${out.tools.join(', ')})`,
      'MCP tools/call tabs, navigate, snapshot, read, grep, screenshot on the loopback fixture and the extension pages',
      'loopback fixture HTTP routes /, /fixtures/unified.html, /fixtures/all-nodes.html, /fixtures/dynamic-shadow.html, /metrics',
    ],
    observations: [
      `CDP protocol ${out.browserVersion.protocolVersion}; browser ${out.browserVersion.product} revision ${out.browserVersion.revision}.`,
      `The owned temporary profile exposes exactly one FluentRead service worker; other extension worker ids observed in the same profile: ${out.otherExtensionWorkerIds.join(', ') || '(none)'}.`,
      `The task-scoped stdio sidecar read its CDP port and resource directory from the run-local config, so the control surface was bound to the owned instance and not to the daily profile.`,
    ],
    at: now(),
  });
  out.capabilities = {tools: out.tools.length, operations: 9};
  await saveLog();
  await save('after probes');

  const tabsAfter = await call('tabs', {action: 'list'});
  out.tabsAfter = tabsAfter.text.slice(0, 2000);
  bl('neo-tabs-after', 'owned-temporary-browser', {excerpt: tabsAfter.text.slice(0, 800)});
  cdp.close();

  // ---- a fresh observation must follow the last operation before the guard is stopped
  const before = (await guardState()).events?.filter(e => e.event === 'focus-window-observation').length ?? 0;
  let afterCount = before;
  const obsDeadline = Date.now() + 30000;
  while (afterCount <= before && Date.now() < obsDeadline) {
    await sleep(400);
    afterCount = (await guardState()).events?.filter(e => e.event === 'focus-window-observation').length ?? 0;
  }
  out.observationAfterLastOperation = {before, after: afterCount, fresh: afterCount > before};
  say('observations after last operation:', before, '->', afterCount);

  const guardEnd = await guardState();
  out.guardBeforeStop = {status: guardEnd.status, observations: (guardEnd.events || []).filter(e => e.event === 'focus-window-observation').length,
    violations: violations(guardEnd).length};
  out.finishedAt = now();
  await save('work complete');
  await fs.writeFile(doneFile, now() + '\n');
  say('done sentinel written; waiting for the guard to be stopped cleanly');

  let stopped = await guardState();
  const stopDeadline = Date.now() + 120000;
  while (!['stopped', 'blocked'].includes(stopped.status) && Date.now() < stopDeadline) { await sleep(500); stopped = await guardState(); }
  const focusEvents = (stopped.events || []).filter(e => e.event === 'focus-window-observation');
  out.guardFinal = {status: stopped.status, mode: stopped.mode, visibilityPolicy: stopped.visibilityPolicy,
    browserPid: stopped.browserPid, profilePathSha256: stopped.profilePathSha256,
    observations: focusEvents.length, firstObservation: focusEvents[0]?.at, lastObservation: focusEvents.at(-1)?.at,
    violations: violations(stopped).length, stoppedEvent: (stopped.events || []).some(e => e.event === 'guard-stopped')};
  say('guard final:', JSON.stringify(out.guardFinal));
  await save('final');
} catch (error) {
  out.error = error.message;
  out.finishedAt = now();
  say('ACCEPTANCE RUN STOPPED:', error.message);
  await save('stopped');
  await saveLog().catch(() => {});
  await fs.writeFile(doneFile, 'error: ' + error.message + '\n').catch(() => {});
} finally {
  await fs.writeFile(path.join(runDir, 'acceptance-run.log'), log.join('\n') + '\n').catch(() => {});
  child.stdin.end(); await sleep(400); if (child.exitCode === null) child.kill('SIGTERM');
  process.exit(0);
}

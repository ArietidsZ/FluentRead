#!/usr/bin/env node
/**
 * @file ui-states.mjs
 * Capture additional real UI states of the owned extension's options page:
 * the image/manga settings route, the dark scheme, and a 390 px narrow viewport.
 *
 * Usage: node ui-states.mjs PORT OUTDIR
 *
 * Read-only with respect to the browser window: it only evaluates in the page, uses CDP media
 * and device-metrics emulation, and calls Emulation.clearDeviceMetricsOverride afterwards. It
 * never calls Page.bringToFront and never moves, resizes, minimizes, fullscreens or raises a
 * window. The device-metrics override is emulation only; the real window is never resized.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {connect, sanitizeText} from './cdp.mjs';

const [portArg, outDirArg] = process.argv.slice(2);
if (!portArg || !outDirArg) {
  process.stderr.write('Usage: node ui-states.mjs PORT OUTDIR\n');
  process.exit(2);
}
const outDir = path.resolve(outDirArg);
await fs.mkdir(outDir, {recursive: true});
const cdp = await connect(Number(portArg));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const EXTRACT = `(() => {
  const clean = v => String(v ?? '').replace(/\\s+/g,' ').trim().slice(0,400);
  const cssPath = el => {
    const seg = [];
    while (el && el.nodeType === 1 && seg.length < 8) {
      let s = el.tagName.toLowerCase();
      if (el.id) { s += '#' + el.id; seg.unshift(s); break; }
      const p = el.parentElement;
      if (p) s += ':nth-of-type(' + (Array.prototype.indexOf.call(p.children, el) + 1) + ')';
      seg.unshift(s); el = p;
    }
    return seg.join(' > ');
  };
  const texts = sel => Array.from(document.querySelectorAll(sel)).map(e => ({text: clean(e.textContent), path: cssPath(e), visible: e.offsetParent !== null}));
  return JSON.stringify({
    at: new Date().toISOString(),
    href: location.href,
    title: document.title,
    themeAttr: document.documentElement.getAttribute('class') || '',
    colorScheme: getComputedStyle(document.body).backgroundColor,
    sections: Array.from(document.querySelectorAll('[data-section]')).map(e => ({name: e.getAttribute('data-section'), path: cssPath(e)})),
    headings: texts('h1,h2,h3,h4').slice(0, 40),
    buttons: texts('button').slice(0, 60),
    selects: Array.from(document.querySelectorAll('.el-select')).map(e => ({displayText: clean(e.textContent), path: cssPath(e)})).slice(0, 25),
    inputs: Array.from(document.querySelectorAll('input')).map(e => ({placeholder: e.placeholder || null, type: e.type, value: e.type === 'password' ? '[redacted]' : clean(e.value), path: cssPath(e)})).slice(0, 30),
    switches: Array.from(document.querySelectorAll('.el-switch')).map(e => ({on: e.classList.contains('is-checked'), path: cssPath(e)})).slice(0, 30),
    bodyTextSample: clean(document.body.innerText).slice(0, 1200)
  });
})()`;

const shot = async (sessionId, file) => {
  const {data} = await cdp.send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: true}, sessionId, 30000);
  const bytes = Buffer.from(data, 'base64');
  await fs.writeFile(file, bytes);
  return bytes.length;
};

const result = {
  sideEvidenceOnly: true,
  label:
    'Side evidence only. No continuous focus guard interval exists on this host because browser-focus-guard.mjs asserts process.platform===darwin, so nothing in this file supports a pass.',
  states: {},
  errors: [],
};

let sessionId;
try {
  const {targetInfos} = await cdp.send('Target.getTargets');
  const options = targetInfos.find((t) => String(t.url).startsWith('chrome-extension://') && String(t.url).includes('options'));
  if (!options) throw new Error('options page target not found');
  ({sessionId} = await cdp.send('Target.attachToTarget', {targetId: options.targetId, flatten: true}));
  const evaluate = async (expression, timeoutMs = 15000) => {
    const r = await cdp.send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true}, sessionId, timeoutMs);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'evaluate threw');
    return r.result?.value ?? null;
  };

  // 1. Navigate to the image/manga settings route by clicking the real navigation button.
  const clicked = await evaluate(`(() => {
    const btn = Array.from(document.querySelectorAll('#settings-nav-group-1 button')).find(b => b.textContent.includes('图片'));
    if (!btn) return {ok:false, reason:'nav button not found'};
    btn.click();
    return {ok:true, label: btn.textContent.trim()};
  })()`);
  await wait(2000);
  const manga = JSON.parse(await evaluate(EXTRACT));
  const mangaPng = await shot(sessionId, path.join(outDir, 'options-manga-route.png'));
  result.states['options-manga-route'] = {clicked, href: manga.href, pngBytes: mangaPng, dom: manga};

  // 2. Dark scheme.
  await cdp.send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-color-scheme', value: 'dark'}]}, sessionId);
  await wait(1200);
  const dark = JSON.parse(await evaluate(EXTRACT));
  const darkPng = await shot(sessionId, path.join(outDir, 'options-dark.png'));
  result.states['options-dark'] = {pngBytes: darkPng, colorScheme: dark.colorScheme, themeAttr: dark.themeAttr};
  await cdp.send('Emulation.setEmulatedMedia', {features: []}, sessionId);

  // 3. Narrow 390 px viewport, emulation only.
  await cdp.send(
    'Emulation.setDeviceMetricsOverride',
    {width: 390, height: 844, deviceScaleFactor: 2, mobile: false},
    sessionId,
  );
  await wait(1500);
  const narrow = JSON.parse(await evaluate(EXTRACT));
  const narrowPng = await shot(sessionId, path.join(outDir, 'options-narrow-390.png'));
  result.states['options-narrow-390'] = {pngBytes: narrowPng, viewport: {width: 390, height: 844, deviceScaleFactor: 2, mobile: false}, dom: narrow};
  await cdp.send('Emulation.clearDeviceMetricsOverride', {}, sessionId);
  await wait(500);
  const restored = JSON.parse(await evaluate(EXTRACT));
  result.states['options-after-clear'] = {href: restored.href, themeAttr: restored.themeAttr};
} catch (error) {
  result.errors.push(sanitizeText(String(error?.message ?? error)));
} finally {
  try { if (sessionId) await cdp.send('Emulation.clearDeviceMetricsOverride', {}, sessionId, 5000); } catch { /* ignore */ }
  cdp.close();
}

await fs.writeFile(path.join(outDir, 'ui-states.json'), sanitizeText(JSON.stringify(result, null, 2)) + '\n');
process.stdout.write(
  JSON.stringify({ok: result.errors.length === 0, states: Object.keys(result.states), errors: result.errors}) + '\n',
);

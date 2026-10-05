#!/usr/bin/env node
/**
 * @file capture-dom.mjs
 * Read-only DOM capture for the options and popup pages of the owned extension.
 *
 * Usage: node capture-dom.mjs PORT OUTDIR [TARGET_SUBSTR]
 *   PORT           CDP port of the owned browser (loopback only)
 *   OUTDIR         output directory (created if needed)
 *   TARGET_SUBSTR  optional substring of the target URL to capture; when omitted, extension
 *                  pages whose URL looks like an options or popup page are captured
 *
 * For every selected page this writes OUTDIR/<label>.json with the title, href and a
 * structured extraction (data-section elements, h1-h4 headings, label texts, button texts,
 * visible .el-select / select display texts, input placeholders, each with a stable CSS path)
 * and OUTDIR/<label>.png as a full-page screenshot. It never calls Page.bringToFront.
 *
 * Prints a JSON summary on stdout; exit code 0 only when at least one page was captured and
 * no selected page failed.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {connect, sanitizeText} from './cdp.mjs';

const [portArg, outDirArg, targetSubstr] = process.argv.slice(2);
if (!portArg || !outDirArg) {
  process.stderr.write('Usage: node capture-dom.mjs PORT OUTDIR [TARGET_SUBSTR]\n');
  process.exit(2);
}
const port = Number(portArg);
const outDir = path.resolve(outDirArg);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const EXTRACTION = `(() => {
  const MAX_TEXT = 400;
  const clean = value => String(value ?? '').replace(/\\s+/g, ' ').trim().slice(0, MAX_TEXT);
  const escapeIdent = value => (window.CSS && typeof CSS.escape === 'function')
    ? CSS.escape(value)
    : String(value).replace(/[^a-zA-Z0-9_-]/g, ch => '\\\\' + ch);
  const cssPath = element => {
    const segments = [];
    let node = element;
    while (node && node.nodeType === 1) {
      if (node.id) { segments.unshift('#' + escapeIdent(node.id)); break; }
      let selector = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(child => child.tagName === node.tagName);
        if (siblings.length > 1) selector += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      }
      segments.unshift(selector);
      if (node === document.documentElement) break;
      node = node.parentElement;
    }
    return segments.join(' > ').slice(0, 1000);
  };
  const visible = element => {
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const textOf = element => clean(element.innerText ?? element.textContent);
  const selectDisplay = element => {
    if (element.tagName.toLowerCase() === 'select') {
      return Array.from(element.selectedOptions).map(option => clean(option.textContent)).join(', ');
    }
    const input = element.querySelector('input');
    if (input && typeof input.value === 'string' && input.value) return clean(input.value);
    const chip = element.querySelector('.el-select__selected-item, .el-select__tags-text, .el-input__inner');
    return clean(chip ? (chip.value ?? chip.textContent) : element.textContent);
  };
  return {
    title: document.title,
    href: String(location.href),
    readyState: document.readyState,
    viewport: {width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio},
    sections: Array.from(document.querySelectorAll('[data-section]')).map(element => ({
      tag: element.tagName.toLowerCase(),
      dataSection: element.getAttribute('data-section'),
      text: textOf(element),
      path: cssPath(element),
      visible: visible(element),
    })),
    headings: Array.from(document.querySelectorAll('h1, h2, h3, h4')).map(element => ({
      level: Number(element.tagName.slice(1)),
      text: textOf(element),
      path: cssPath(element),
    })),
    labels: Array.from(document.querySelectorAll('label')).map(element => ({
      text: textOf(element),
      htmlFor: element.getAttribute('for'),
      path: cssPath(element),
    })),
    buttons: Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]')).map(element => ({
      text: textOf(element) || clean(element.getAttribute('value')) || clean(element.getAttribute('aria-label')),
      type: element.getAttribute('type'),
      path: cssPath(element),
      visible: visible(element),
    })),
    selects: Array.from(document.querySelectorAll('.el-select, select')).filter(element => visible(element)).map(element => ({
      kind: element.tagName.toLowerCase() === 'select' ? 'select' : 'el-select',
      displayText: selectDisplay(element),
      path: cssPath(element),
      disabled: element.matches('[disabled], .is-disabled'),
    })),
    placeholders: Array.from(document.querySelectorAll('input[placeholder], textarea[placeholder]')).map(element => ({
      tag: element.tagName.toLowerCase(),
      placeholder: element.getAttribute('placeholder'),
      value: element.value,
      readonly: element.readOnly === true || element.hasAttribute('readonly'),
      path: cssPath(element),
      visible: visible(element),
    })),
  };
})()`;

const attachToTarget = async (cdp, targetId) => {
  const {sessionId} = await cdp.send('Target.attachToTarget', {targetId, flatten: true}, undefined, 10000);
  if (!sessionId) throw new Error(`Target.attachToTarget returned no sessionId for ${targetId}`);
  return sessionId;
};

const evaluate = async (cdp, sessionId, expression, timeoutMs = 15000) => {
  const result = await cdp.send(
    'Runtime.evaluate',
    {expression, returnByValue: true, awaitPromise: true, timeout: timeoutMs},
    sessionId,
    timeoutMs + 2000,
  );
  if (result?.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'exception';
    throw new Error(`evaluation failed: ${detail}`);
  }
  return result?.result?.value;
};

const DOM_TARGET_TYPES = new Set(['page', 'other']);

const pickTargets = (targets, sub) => {
  const pages = targets.filter(target => DOM_TARGET_TYPES.has(target.type));
  if (sub) return pages.filter(target => (target.url ?? '').includes(sub));
  const extensionPages = pages.filter(target => (target.url ?? '').startsWith('chrome-extension://'));
  const named = extensionPages.filter(target => /options|popup/i.test(target.url ?? ''));
  return named.length > 0 ? named : extensionPages;
};

const selectTargets = async (cdp, sub) => {
  const deadline = Date.now() + 15000;
  let allTargets = [];
  for (;;) {
    const {targetInfos} = await cdp.send('Target.getTargets', {}, undefined, 10000);
    allTargets = targetInfos ?? [];
    const selected = pickTargets(allTargets, sub);
    if (selected.length > 0) return selected;
    if (Date.now() > deadline) break;
    await wait(500);
  }
  const available = allTargets.map(target => `${target.type} ${sanitizeText(target.url ?? '')}`).join('\n  ');
  throw new Error(
    `no DOM target matched ${sub ? `"${sub}"` : 'an options/popup URL'}; available targets:\n  ${available || '(none)'}`,
  );
};

const labelFor = (target, index) => {
  const url = target.url ?? '';
  if (/options/i.test(url)) return 'options';
  if (/popup/i.test(url)) return 'popup';
  return `page-${index + 1}`;
};

const waitForReady = async (cdp, sessionId, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if ((await evaluate(cdp, sessionId, 'document.readyState', 5000)) === 'complete') return;
    } catch {
      // The page may still be navigating; keep polling until the deadline.
    }
    if (Date.now() > deadline) return;
    await wait(250);
  }
};

const captureFullPage = async (cdp, sessionId) => {
  let width = 1280;
  let height = 900;
  try {
    const metrics = await cdp.send('Page.getLayoutMetrics', {}, sessionId, 10000);
    const size = metrics?.cssContentSize ?? metrics?.contentSize ?? {};
    width = Math.max(1, Math.ceil(size.width ?? width));
    height = Math.max(1, Math.ceil(size.height ?? height));
  } catch {
    // Fall back to the viewport-sized screenshot below.
  }
  width = Math.min(width, 8192);
  height = Math.min(height, 8192);
  try {
    const shot = await cdp.send(
      'Page.captureScreenshot',
      {format: 'png', fromSurface: true, captureBeyondViewport: true, clip: {x: 0, y: 0, width, height, scale: 1}},
      sessionId,
      30000,
    );
    if (shot?.data) return Buffer.from(shot.data, 'base64');
  } catch {
    // Older builds may not accept clip + captureBeyondViewport; retry with a plain capture.
  }
  const fallback = await cdp.send('Page.captureScreenshot', {format: 'png', fromSurface: true}, sessionId, 30000);
  return Buffer.from(fallback.data, 'base64');
};

const cdp = await connect(port);
const captured = [];
const failures = [];
try {
  const targets = await selectTargets(cdp, targetSubstr);
  await fs.mkdir(outDir, {recursive: true});
  const usedLabels = new Set();
  for (const [index, target] of targets.entries()) {
    let label = labelFor(target, index);
    while (usedLabels.has(label)) label = `${label}-${usedLabels.size + 1}`;
    usedLabels.add(label);
    try {
      const sessionId = await attachToTarget(cdp, target.targetId);
      await cdp.send('Page.enable', {}, sessionId, 10000).catch(() => {});
      await cdp.send('Runtime.enable', {}, sessionId, 10000).catch(() => {});
      await waitForReady(cdp, sessionId, 15000);
      await wait(500); // let the extension UI framework finish its first render
      const extraction = await evaluate(cdp, sessionId, EXTRACTION, 20000);
      const record = {
        capturedAt: new Date().toISOString(),
        name: label,
        target: {id: target.targetId, type: target.type, url: sanitizeText(target.url ?? '')},
        ...extraction,
      };
      const jsonPath = path.join(outDir, `${label}.json`);
      const pngPath = path.join(outDir, `${label}.png`);
      await fs.writeFile(jsonPath, `${sanitizeText(JSON.stringify(record, null, 2))}\n`);
      const png = await captureFullPage(cdp, sessionId);
      await fs.writeFile(pngPath, png);
      captured.push({
        name: label,
        targetId: target.targetId,
        url: sanitizeText(target.url ?? ''),
        title: extraction?.title ?? null,
        href: sanitizeText(extraction?.href ?? ''),
        jsonPath,
        pngPath,
        pngBytes: png.length,
      });
    } catch (error) {
      failures.push({
        name: label,
        targetId: target.targetId,
        url: sanitizeText(target.url ?? ''),
        error: sanitizeText(String(error?.message ?? error)),
      });
    }
  }
} catch (error) {
  failures.push({name: null, targetId: null, url: null, error: sanitizeText(String(error?.message ?? error))});
} finally {
  cdp.close();
}

const summary = {
  ok: captured.length > 0 && failures.length === 0,
  outDir: sanitizeText(outDir),
  captured,
  failures,
  capturedCount: captured.length,
  failureCount: failures.length,
};
process.stdout.write(`${sanitizeText(JSON.stringify(summary, null, 2))}\n`);
if (!summary.ok) process.exitCode = 1;

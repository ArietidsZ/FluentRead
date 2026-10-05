#!/usr/bin/env node
/**
 * @file dropdown-recon.mjs
 * Open Element Plus selects on the owned extension options page just far enough to read the
 * REAL option list from the page DOM, then close them without choosing anything.
 *
 * Usage: node dropdown-recon.mjs PORT OUTJSON
 *
 * Read-only: it dispatches a mousedown on the select wrapper, reads the visible dropdown items,
 * then presses Escape. It never selects an option, never saves a setting, never calls
 * Page.bringToFront, and never moves, resizes, minimizes, fullscreens or raises a window.
 */
import fs from 'node:fs/promises';
import {connect, sanitizeText} from './cdp.mjs';

const [portArg, outArg] = process.argv.slice(2);
if (!portArg || !outArg) {
  process.stderr.write('Usage: node dropdown-recon.mjs PORT OUTJSON\n');
  process.exit(2);
}
const cdp = await connect(Number(portArg));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {
  sideEvidenceOnly: true,
  label:
    'Side evidence only. No continuous focus guard interval exists on this host because browser-focus-guard.mjs asserts process.platform===darwin, so nothing in this file supports a pass. No option was selected and no setting was saved.',
  at: new Date().toISOString(),
  probes: [],
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

  const targets = [
    {name: 'ocr-engine-select', route: '#settings-image-translation', selector: 'section#settings-image-translation .el-select'},
    {name: 'global-service-select', route: '#settings-general', selector: '#settings-general .el-select'},
    {name: 'per-feature-service-select', route: '#settings-services', selector: '#feature-services .el-select'},
  ];

  for (const target of targets) {
    const probe = {name: target.name, selector: target.selector};
    try {
      await evaluate(`(() => { if (location.hash !== ${JSON.stringify(target.route)}) location.hash = ${JSON.stringify(target.route)}; return location.hash; })()`);
      await wait(1500);
      probe.opened = await evaluate(`(() => {
        const sel = document.querySelector(${JSON.stringify(target.selector)});
        if (!sel) return {ok:false, reason:'select not found'};
        const wrapper = sel.querySelector('.el-select__wrapper') || sel;
        const before = sel.textContent.replace(/\\s+/g,' ').trim().slice(0,120);
        wrapper.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, cancelable:true, view:window}));
        wrapper.dispatchEvent(new MouseEvent('mouseup', {bubbles:true, cancelable:true, view:window}));
        wrapper.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, view:window}));
        return {ok:true, currentDisplayText: before};
      })()`);
      await wait(1200);
      probe.items = await evaluate(`(() => {
        const items = Array.from(document.querySelectorAll('.el-select-dropdown__item'))
          .filter(e => e.offsetParent !== null)
          .map(e => ({text: e.textContent.replace(/\\s+/g,' ').trim().slice(0,160), selected: e.classList.contains('is-selected'), disabled: e.classList.contains('is-disabled')}));
        return items;
      })()`);
      await evaluate(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', keyCode:27, bubbles:true})); document.body.click(); return true; })()`);
      await wait(600);
      probe.afterEscapeDisplayText = await evaluate(`(() => { const sel = document.querySelector(${JSON.stringify(target.selector)}); return sel ? sel.textContent.replace(/\\s+/g,' ').trim().slice(0,120) : null; })()`);
    } catch (error) {
      probe.error = sanitizeText(String(error?.message ?? error));
      out.errors.push({name: target.name, error: probe.error});
    }
    out.probes.push(probe);
  }
} catch (error) {
  out.errors.push({name: 'session', error: sanitizeText(String(error?.message ?? error))});
} finally {
  cdp.close();
}

await fs.writeFile(outArg, sanitizeText(JSON.stringify(out, null, 2)) + '\n');
process.stdout.write(
  JSON.stringify({ok: out.errors.length === 0, probes: out.probes.map((p) => ({name: p.name, itemCount: p.items?.length ?? null, items: (p.items ?? []).map((i) => i.text).slice(0, 14)}))}) + '\n',
);

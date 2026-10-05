#!/usr/bin/env node
/**
 * @file select-by-text.mjs
 * Open exactly one Element Plus select on the owned options page, chosen by the text it
 * currently displays, read the real option list, then close it without choosing anything.
 *
 * Usage: node select-by-text.mjs PORT OUTJSON TEXT_FILTER [ROUTE_HASH]
 * Read-only: never selects an option, never saves a setting, never calls Page.bringToFront.
 */
import fs from 'node:fs/promises';
import {connect, sanitizeText} from './cdp.mjs';

const [portArg, outArg, filter, route = ''] = process.argv.slice(2);
if (!portArg || !outArg || !filter) {
  process.stderr.write('Usage: node select-by-text.mjs PORT OUTJSON TEXT_FILTER [ROUTE_HASH]\n');
  process.exit(2);
}
const cdp = await connect(Number(portArg));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {
  sideEvidenceOnly: true,
  label:
    'Side evidence only. No continuous focus guard interval exists on this host because browser-focus-guard.mjs asserts process.platform===darwin, so nothing in this file supports a pass. No option was selected and no setting was saved.',
  at: new Date().toISOString(),
  filter,
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
  if (route) {
    await evaluate(`(() => { if (location.hash !== ${JSON.stringify(route)}) location.hash = ${JSON.stringify(route)}; return location.hash; })()`);
    await wait(1500);
  }
  const found = await evaluate(`(() => {
    const clean = e => String(e.textContent||'').replace(/\\s+/g,' ').trim();
    const all = Array.from(document.querySelectorAll('.el-select'));
    const matches = all.filter(e => clean(e).includes(${JSON.stringify(filter)}));
    if (!matches.length) return {ok:false, count: all.length, texts: all.map(e=>clean(e).slice(0,80))};
    const sel = matches[0];
    const wrapper = sel.querySelector('.el-select__wrapper') || sel;
    for (const type of ['mousedown','mouseup','click']) wrapper.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,view:window}));
    return {ok:true, currentText: clean(sel).slice(0,160), matchIndex: all.indexOf(sel), totalSelects: all.length};
  })()`);
  out.probes.push({step: 'open', found});
  await wait(1200);
  const items = await evaluate(`(() => Array.from(document.querySelectorAll('.el-select-dropdown__item'))
    .filter(e => e.offsetParent !== null)
    .map(e => ({text: e.textContent.replace(/\\s+/g,' ').trim().slice(0,160), selected: e.classList.contains('is-selected'), disabled: e.classList.contains('is-disabled')})))()`);
  out.probes.push({step: 'items', count: items.length, items});
  await evaluate(`(() => { document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',keyCode:27,bubbles:true})); document.body.click(); return true; })()`);
  await wait(600);
  out.probes.push({step: 'closed', hash: await evaluate('location.hash')});
} catch (error) {
  out.errors.push(sanitizeText(String(error?.message ?? error)));
} finally {
  cdp.close();
}
await fs.writeFile(outArg, sanitizeText(JSON.stringify(out, null, 2)) + '\n');
const items = out.probes.find((p) => p.step === 'items')?.items ?? [];
process.stdout.write(JSON.stringify({ok: out.errors.length === 0, itemCount: items.length, items: items.map((i) => i.text), errors: out.errors}) + '\n');

#!/usr/bin/env node
/** worker-probe.mjs PORT TARGET_SUBSTR OUTJSON [TIMEOUT_MS] */
import fs from 'node:fs/promises';
import {connect, sanitizeText} from './cdp.mjs';

const [portArg, substr, outArg, timeoutArg] = process.argv.slice(2);
if (!portArg || !substr || !outArg) {
  process.stderr.write('Usage: node worker-probe.mjs PORT TARGET_SUBSTR OUTJSON [TIMEOUT_MS]\n');
  process.exit(2);
}
const timeoutMs = Number(timeoutArg ?? 12000);
const cdp = await connect(Number(portArg));
const out = {
  sideEvidenceOnly: true,
  label:
    'Side evidence only. No continuous focus guard interval exists on this host because browser-focus-guard.mjs asserts process.platform===darwin, so nothing in this file supports a pass.',
  at: new Date().toISOString(),
  context: 'same-origin Blob Worker created inside an extension page',
  timeoutMs,
  ok: false,
  error: null,
  adapter: null,
  isFallbackAdapter: null,
  features: [],
  limits: {},
  elapsedMs: null,
};
let sessionId;
try {
  const {targetInfos} = await cdp.send('Target.getTargets');
  const page = targetInfos.find((t) => t.type === 'page' && String(t.url).includes(substr));
  if (!page) throw new Error(`no page target matching ${substr}`);
  out.target = {id: page.targetId, url: sanitizeText(String(page.url))};
  ({sessionId} = await cdp.send('Target.attachToTarget', {targetId: page.targetId, flatten: true}));
  const started = Date.now();
  const source = 'self.onmessage=async()=>{const raw=v=>(v===undefined||v===null)?null:String(v);try{if(!navigator.gpu){self.postMessage({ok:false,error:"navigator.gpu is absent in this worker context"});return;}const a=await navigator.gpu.requestAdapter();if(!a){self.postMessage({ok:false,error:"requestAdapter() returned null"});return;}const i=a.info||{};self.postMessage({ok:true,adapter:{vendor:raw(i.vendor),architecture:raw(i.architecture),device:raw(i.device),description:raw(i.description)},isFallbackAdapter:a.isFallbackAdapter===true,features:Array.from(a.features||[]).sort(),limits:Object.fromEntries(Object.entries(a.limits||{}).filter(([,v])=>typeof v==="number"))});}catch(e){self.postMessage({ok:false,error:String((e&&e.message)||e)});}};';
  const expression = `(async () => {
    const url = URL.createObjectURL(new Blob([${JSON.stringify(source)}], {type:'text/javascript'}));
    const worker = new Worker(url);
    const result = await new Promise(resolve => {
      const timer = setTimeout(() => resolve({ok:false, error:'worker probe timed out after ' + ${timeoutMs} + ' ms'}), ${timeoutMs});
      worker.onmessage = e => { clearTimeout(timer); resolve(e.data); };
      worker.onerror = e => { clearTimeout(timer); resolve({ok:false, error:'worker error: ' + (e.message || 'unknown')}); };
      worker.postMessage('go');
    });
    try { worker.terminate(); } catch {}
    URL.revokeObjectURL(url);
    return JSON.stringify(result);
  })()`;
  const r = await cdp.send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true}, sessionId, timeoutMs + 8000);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'evaluate threw');
  Object.assign(out, JSON.parse(r.result.value));
  out.elapsedMs = Date.now() - started;
} catch (error) {
  out.error = sanitizeText(String(error?.message ?? error));
} finally {
  cdp.close();
}
await fs.writeFile(outArg, sanitizeText(JSON.stringify(out, null, 2)) + '\n');
process.stdout.write(JSON.stringify({ok: out.ok, error: out.error, elapsedMs: out.elapsedMs, vendor: out.adapter?.vendor ?? null, features: out.features.length}) + '\n');
process.exitCode = out.ok ? 0 : 1;

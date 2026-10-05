#!/usr/bin/env node
/**
 * @file webgpu-probe.mjs
 * Raw WebGPU adapter probe for one target of the owned browser (page or worker).
 *
 * Usage: node webgpu-probe.mjs PORT TARGET_SUBSTR OUTJSON
 *   PORT           CDP port of the owned browser (loopback only)
 *   TARGET_SUBSTR  substring of the target URL to probe; use "-" to pick the first page target
 *   OUTJSON        output file (parent directories are created)
 *
 * Writes {ok, context, at, timeoutMs, elapsedMs, target, adapter, isFallbackAdapter, features,
 * limits} with the raw adapter info strings exactly as the target returned them, the fallback
 * flag, the sorted feature set and the numeric limits. On any failure the real error is written
 * and the process exits non-zero; a synthetic success is never produced.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {connect, sanitizeText} from './cdp.mjs';

const [portArg, targetSubstr, outJsonArg] = process.argv.slice(2);
if (!portArg || !targetSubstr || !outJsonArg) {
  process.stderr.write('Usage: node webgpu-probe.mjs PORT TARGET_SUBSTR OUTJSON\n');
  process.exit(2);
}
const port = Number(portArg);
const outJson = path.resolve(outJsonArg);
const PROBE_TIMEOUT_MS = 20000;
const TARGET_TIMEOUT_MS = 15000;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const PROBE = `(async () => {
  const raw = value => (value === undefined || value === null) ? null : String(value);
  const output = {ok: false, error: null, adapter: null, features: [], limits: {}};
  if (!navigator.gpu) {
    output.error = 'navigator.gpu is absent in this context';
    return output;
  }
  let adapter;
  try {
    adapter = await navigator.gpu.requestAdapter();
  } catch (error) {
    output.error = 'requestAdapter() threw: ' + (error && error.message ? error.message : String(error));
    return output;
  }
  if (!adapter) {
    output.error = 'requestAdapter() returned null';
    return output;
  }
  let info = adapter.info;
  if (!info && typeof adapter.requestAdapterInfo === 'function') {
    try { info = await adapter.requestAdapterInfo(); } catch (error) { info = null; }
  }
  info = info || {};
  const fallback = adapter.isFallbackAdapter !== undefined ? adapter.isFallbackAdapter : info.isFallbackAdapter;
  output.ok = true;
  output.adapter = {
    vendor: raw(info.vendor),
    architecture: raw(info.architecture),
    device: raw(info.device),
    description: raw(info.description),
  };
  output.isFallbackAdapter = typeof fallback === 'boolean' ? fallback : null;
  output.features = Array.from(adapter.features).slice().sort();
  for (const key in adapter.limits) {
    try {
      const value = adapter.limits[key];
      if (typeof value === 'number' && Number.isFinite(value)) output.limits[key] = value;
    } catch {
      // A throwing limit getter is skipped, not invented.
    }
  }
  return output;
})()`;

const pickTarget = (targets, sub) => {
  if (sub === '-') return targets.find(target => target.type === 'page') ?? null;
  const matches = targets.filter(target => (target.url ?? '').includes(sub));
  if (matches.length === 0) return null;
  return matches.find(target => target.type === 'page')
    ?? matches.find(target => ['worker', 'service_worker', 'shared_worker'].includes(target.type))
    ?? matches[0];
};

const findTarget = async cdp => {
  const deadline = Date.now() + TARGET_TIMEOUT_MS;
  let targets = [];
  for (;;) {
    const {targetInfos} = await cdp.send('Target.getTargets', {}, undefined, 10000);
    targets = targetInfos ?? [];
    const match = pickTarget(targets, targetSubstr);
    if (match) return match;
    if (Date.now() > deadline) break;
    await wait(500);
  }
  const available = targets.map(target => `${target.type} ${sanitizeText(target.url ?? '')}`).join('\n  ');
  throw new Error(`no target matched "${targetSubstr}"; available targets:\n  ${available || '(none)'}`);
};

const writeRecord = async record => {
  await fs.mkdir(path.dirname(outJson), {recursive: true});
  await fs.writeFile(outJson, `${sanitizeText(JSON.stringify(record, null, 2))}\n`);
};

const startedAt = Date.now();
const contextParts = [];
let cdp;
let target = null;
try {
  cdp = await connect(port);
  target = await findTarget(cdp);
  const {sessionId} = await cdp.send('Target.attachToTarget', {targetId: target.targetId, flatten: true}, undefined, 10000);
  if (!sessionId) throw new Error(`Target.attachToTarget returned no sessionId for ${target.targetId}`);
  const probeStart = Date.now();
  const result = await cdp.send(
    'Runtime.evaluate',
    {expression: PROBE, returnByValue: true, awaitPromise: true, timeout: PROBE_TIMEOUT_MS},
    sessionId,
    PROBE_TIMEOUT_MS + 2000,
  );
  const probeElapsedMs = Date.now() - probeStart;
  const context = `${target.type} ${sanitizeText(target.url ?? '')}`;
  contextParts.push(context);
  if (result?.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'exception';
    throw new Error(`probe evaluation failed: ${detail}`);
  }
  const value = result?.result?.value ?? null;
  const record = {
    ok: value?.ok === true,
    context,
    at: new Date().toISOString(),
    timeoutMs: PROBE_TIMEOUT_MS,
    elapsedMs: Date.now() - startedAt,
    probeElapsedMs,
    target: {id: target.targetId, type: target.type, url: sanitizeText(target.url ?? '')},
    adapter: value?.adapter ?? null,
    isFallbackAdapter: value?.isFallbackAdapter ?? null,
    features: value?.features ?? [],
    limits: value?.limits ?? {},
    error: value?.ok === true ? null : (value?.error ?? 'probe did not return adapter data'),
  };
  await writeRecord(record);
  process.stdout.write(`${sanitizeText(JSON.stringify(record))}\n`);
  if (!record.ok) process.exitCode = 1;
} catch (error) {
  const record = {
    ok: false,
    context: contextParts[0] ?? (target ? `${target.type} ${sanitizeText(target.url ?? '')}` : 'no target'),
    at: new Date().toISOString(),
    timeoutMs: PROBE_TIMEOUT_MS,
    elapsedMs: Date.now() - startedAt,
    target: target ? {id: target.targetId, type: target.type, url: sanitizeText(target.url ?? '')} : null,
    adapter: null,
    isFallbackAdapter: null,
    features: [],
    limits: {},
    error: sanitizeText(String(error?.message ?? error)),
  };
  try {
    await writeRecord(record);
  } catch (writeError) {
    process.stderr.write(`webgpu-probe: failed to write ${outJson}: ${writeError.message}\n`);
  }
  process.stderr.write(`${sanitizeText(JSON.stringify(record))}\n`);
  process.exitCode = 1;
} finally {
  cdp?.close();
}

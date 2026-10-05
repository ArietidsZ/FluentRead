/**
 * Probe whether a Worker spawned from the extension origin can obtain a WebGPU
 * adapter. The handoff explicitly warns that a page-level probe does not prove
 * Worker or Offscreen success, so this is measured separately.
 *
 * The worker source is passed as a data string and run via a Blob URL, which the
 * extension's MV3 CSP (script-src 'self' 'wasm-unsafe-eval') permits.
 */
import fs from 'node:fs/promises';
import {connect, evaluate} from './cdp.mjs';

const [CDP_PORT, EXT_ID, OUT] = process.argv.slice(2);
const client = await connect(Number(CDP_PORT));
const {targetId} = await client.send('Target.createTarget', {url: `chrome-extension://${EXT_ID}/offscreen.html`, background: true});
const {sessionId} = await client.send('Target.attachToTarget', {targetId, flatten: true});
await new Promise(resolve => setTimeout(resolve, 3000));

const workerSource = [
  'self.onmessage = async () => {',
  '  try {',
  '    if (!self.navigator || !navigator.gpu) { self.postMessage({error: "navigator.gpu absent in worker"}); return; }',
  '    const adapter = await navigator.gpu.requestAdapter();',
  '    if (!adapter) { self.postMessage({error: "requestAdapter returned null"}); return; }',
  '    const info = adapter.info || {};',
  '    self.postMessage({',
  '      vendor: info.vendor, architecture: info.architecture, device: info.device,',
  '      isFallbackAdapter: info.isFallbackAdapter,',
  '      hasShaderF16: adapter.features.has("shader-f16"),',
  '      featureCount: [...adapter.features].length,',
  '      maxBufferSize: adapter.limits.maxBufferSize,',
  '      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,',
  '    });',
  '  } catch (error) { self.postMessage({error: String(error)}); }',
  '};',
].join('\n');

const probe = await evaluate(client, sessionId, `(async () => {
  const url = URL.createObjectURL(new Blob([${JSON.stringify(workerSource)}], {type: 'text/javascript'}));
  const worker = new Worker(url);
  return await new Promise(resolve => {
    const timer = setTimeout(() => resolve({error: 'timeout after 25s'}), 25000);
    worker.onmessage = event => { clearTimeout(timer); resolve(event.data); };
    worker.onerror = event => { clearTimeout(timer); resolve({error: 'worker error: ' + (event.message || 'unknown')}); };
    worker.postMessage('go');
  });
})()`);

console.log('worker WebGPU ->', JSON.stringify(probe));
const ok = probe && !probe.error;
const record = {
  at: new Date().toISOString(),
  context: 'extension-origin-blob-worker',
  probe,
  note: 'Worker spawned from the extension offscreen document, i.e. the same origin as the packaged model workers.',
  events: [{
    event: 'webgpu-adapter-request',
    at: new Date().toISOString(),
    context: 'extension-worker',
    adapter: ok ? probe : null,
    features: [],
    limits: ok ? {maxBufferSize: probe.maxBufferSize, maxStorageBufferBindingSize: probe.maxStorageBufferBindingSize} : {},
    hasShaderF16: ok ? probe.hasShaderF16 : null,
    error: ok ? null : probe.error,
  }],
};
await fs.writeFile(OUT, JSON.stringify(record, null, 2));
client.close();

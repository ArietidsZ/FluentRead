'use strict';

// 在独立产物副本中用真实 ORT 执行微型 ONNX 图，验证压缩 WASM 的 CPU/GPU 加载与算子。
// 只附加测试页/Worker，保留被测扩展的 CSP；不下载模型、不修改生产产物。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {createRequire} = require('node:module');
const {gzipSync} = require('node:zlib');
const {createHash} = require('node:crypto');
const assert = require('node:assert/strict');
function arg(name, fallback) { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1]; }
const source = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifacts = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-ort-smoke'));
const prototype = process.argv.includes('--prototype');
const diagnostics = process.argv.includes('--diagnostics');
const {chromium} = require(path.join(arg('playwright-root', '/Users/thinkstu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'), 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground} = require(arg('focus-safe-helper', '/Users/thinkstu/.codex/skills/fluentread-extension-ui-test/scripts/focus-safe-browser.cjs'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-ort-smoke-profile-'));
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-ort-smoke-extension-'));
fs.mkdirSync(artifacts, {recursive: true});
fs.cpSync(source, fixture, {recursive: true});
const report = {source, prototype, diagnostics, cases: [], errors: [], evidence: 'Real ONNX Identity session in an owned extension Worker; this does not claim full translation, speech synthesis or transcription quality.'};
const expectedDigests = {};

// ONNX ModelProto: Identity(float32[1]) with opset 13, generated without a model download.
const varint = value => { const bytes = []; do { let byte = value & 127; value >>>= 7; if (value) byte |= 128; bytes.push(byte); } while (value); return Buffer.from(bytes); };
const scalar = (field, value) => Buffer.concat([varint(field * 8), varint(value)]);
const message = (field, data) => { const bytes = typeof data === 'string' ? Buffer.from(data) : data; return Buffer.concat([varint(field * 8 + 2), varint(bytes.length), bytes]); };
const valueInfo = name => message(name === 'input' ? 11 : 12, Buffer.concat([
  message(1, name), message(2, message(1, Buffer.concat([scalar(1, 1), message(2, message(1, scalar(1, 1)))]))),
]));
// 未使用的 initializer 会让真实 ORT 在建会话时发出 WARNING，验证打包 glue 的实际分级。
const unused = diagnostics ? message(5, Buffer.concat([scalar(1, 1), scalar(2, 1), message(8, 'unused_diagnostic_probe'), message(9, Buffer.from([0, 0, 128, 63]))])) : Buffer.alloc(0);
const graph = Buffer.concat([message(1, Buffer.concat([message(1, 'input'), message(2, 'output'), message(4, 'Identity')])), message(2, 'identity'), valueInfo('input'), valueInfo('output'), unused]);
const model = Buffer.concat([scalar(1, 8), message(7, graph), message(8, scalar(2, 13))]);
fs.writeFileSync(path.join(fixture, 'probe-model.onnx'), model);
fs.writeFileSync(path.join(fixture, 'probe.html'), '<!doctype html><title>ORT packaged runtime verification</title><h1>ORT packaged runtime verification</h1>');

for (const [name, label, prefix] of [['@huggingface/transformers', 'opus-whisper', ''], ['@huggingface/transformers-kokoro', 'kokoro', 'tts-']]) {
  const runtimeName = label === 'kokoro' ? 'ort-wasm-simd-threaded.asyncify' : 'ort-wasm-simd-threaded.jsep';
  const packageRoot = fs.realpathSync(path.resolve('node_modules', name));
  const req = createRequire(path.join(packageRoot, 'package.json'));
  const dist = path.dirname(req.resolve('onnxruntime-web'));
  expectedDigests[label] = createHash('sha256').update(fs.readFileSync(path.join(dist, `${runtimeName}.wasm`))).digest('hex');
  fs.copyFileSync(path.join(dist, 'ort.webgpu.bundle.min.mjs'), path.join(fixture, `probe-${label}-ort.mjs`));
  if (prototype) {
    fs.copyFileSync(path.join(dist, `${runtimeName}.mjs`), path.join(fixture, `fluent-read-ai/${prefix}${runtimeName}.mjs`));
    fs.writeFileSync(path.join(fixture, `fluent-read-ai/${prefix}${runtimeName}.wasm.gz`), gzipSync(fs.readFileSync(path.join(dist, `${runtimeName}.wasm`)), {level: 9}));
  }
  fs.writeFileSync(path.join(fixture, `probe-${label}.mjs`), `
import {env, InferenceSession, Tensor} from './probe-${label}-ort.mjs';
self.onmessage = async ({data: {backend}}) => {
  try {
    const started = performance.now();
    const response = await fetch(new URL('./fluent-read-ai/${prefix}${runtimeName}.wasm.gz', self.location.href));
    if (!response.ok || !response.body) throw new Error('Packaged gzip missing');
    const binary = new Uint8Array(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    const decompressedMs = performance.now() - started;
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', binary))].map(x => x.toString(16).padStart(2, '0')).join('');
    env.wasm.numThreads = 1;
    env.wasm.proxy = false;
    env.wasm.wasmPaths = {mjs: new URL('./fluent-read-ai/${prefix}${runtimeName}.mjs', self.location.href).href};
    env.wasm.wasmBinary = binary;
    const session = await InferenceSession.create(new Uint8Array(await (await fetch('./probe-model.onnx')).arrayBuffer()), {executionProviders: [backend]});
    delete env.wasm.wasmBinary;
    const result = await session.run({input: new Tensor('float32', new Float32Array([42]), [1])});
    const output = [...result.output.data];
    await session.release();
    const nextSession = await InferenceSession.create(new Uint8Array(await (await fetch('./probe-model.onnx')).arrayBuffer()), {executionProviders: [backend]});
    const nextResult = await nextSession.run({input: new Tensor('float32', new Float32Array([-7]), [1])});
    const reusedOutput = [...nextResult.output.data];
    await nextSession.release();
    self.postMessage({ok: true, output, reusedOutput, binaryBytes: binary.byteLength, digest, decompressedMs, totalMs: performance.now() - started});
  } catch (error) { self.postMessage({ok: false, error: String(error), stack: error.stack}); }
};`);
}

(async () => {
  let session;
  try {
    session = await launchFocusSafePersistentContext({chromium, profileDir: profile,
      browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: false, background: true,
      viewport: {width: 1100, height: 800}, browserArgs: ['--no-first-run', '--no-default-browser-check', `--disable-extensions-except=${fixture}`, `--load-extension=${fixture}`]});
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    const {context} = session;
    const background = context.serviceWorkers().find(worker => worker.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker', {timeout: 30000});
    const origin = background.url().match(/^chrome-extension:\/\/[^/]+/)[0];
    const page = await newPageWithoutForeground(context);
    const consoleLogs = [];
    page.on('console', message => consoleLogs.push({type: message.type(), text: message.text()}));
    page.on('pageerror', error => report.errors.push(error.message));
    await page.goto(`${origin}/probe.html`);
    for (const label of ['opus-whisper', 'kokoro']) {
      for (const backend of ['wasm', 'webgpu']) {
      const logStart = consoleLogs.length;
      const result = await page.evaluate(({label, backend}) => new Promise((resolve, reject) => {
        const worker = new Worker(new URL(`probe-${label}.mjs`, location.href), {type: 'module'});
        const timer = setTimeout(() => {worker.terminate(); reject(new Error('ORT initialization timed out'));}, 45000);
        worker.onerror = event => {clearTimeout(timer); worker.terminate(); reject(new Error(event.message));};
        worker.onmessage = event => {clearTimeout(timer); worker.terminate(); resolve(event.data);};
        worker.postMessage({backend});
      }), {label, backend});
      report.cases.push({label, backend, ...result});
      assert.equal(result.ok, true, result.error);
      assert.deepEqual(result.output, [42]);
      assert.deepEqual(result.reusedOutput, [-7]);
      assert.equal(result.digest, expectedDigests[label], '解压结果必须逐字节等于锁定依赖中的 WASM');
      if (diagnostics) {
        const logs = consoleLogs.slice(logStart);
        report.cases.at(-1).logs = logs;
        assert.ok(logs.some(entry => entry.type === 'warning' && entry.text.includes('unused_diagnostic_probe')), '真实 ORT 警告必须以 warning 输出');
        assert.ok(!logs.some(entry => entry.type === 'error'), '正常推理不能把警告记录为 error');
      }
      }
    }
    assert.deepEqual(report.errors, []);
    report.ok = true;
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {report.ok = false; report.failure = error.stack; console.error(error); process.exitCode = 1;}
  finally {
    fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    if (session) await session.close();
    fs.rmSync(profile, {recursive: true, force: true});
    fs.rmSync(fixture, {recursive: true, force: true});
  }
})();

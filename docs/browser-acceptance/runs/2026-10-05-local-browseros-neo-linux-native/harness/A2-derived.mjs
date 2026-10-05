#!/usr/bin/env node
/** A2: derived structured artifacts (source.json, gpu-log.json) appended to the index. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const S = '<HOME>/.cache/fluentread-acceptance/linux-native-20261005';
const RECORD = '<WORKSPACE>/FluentRead/docs/browser-acceptance/runs/2026-10-05-local-browseros-neo-linux-native';
const WORKSPACE = '<WORKSPACE>';
const HOME = '<HOME>';
const sanitize = (t) => t.split(WORKSPACE).join('<WORKSPACE>').split(HOME).join('<HOME>');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const idx = JSON.parse(fs.readFileSync(path.join(S, 'artifact-index.json'), 'utf8'));
const provenance = JSON.parse(fs.readFileSync(path.join(S, 'recon/provenance.json'), 'utf8'));

const write = (dest, role, mediaType, value) => {
  const bytes = Buffer.from(sanitize(typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'), 'utf8');
  const to = path.join(RECORD, dest);
  fs.mkdirSync(path.dirname(to), {recursive: true});
  fs.writeFileSync(to, bytes);
  idx.artifacts.push({path: dest, sha256: sha256(bytes), mediaType, role, bytes: bytes.length, source: 'derived this round'});
  return sha256(bytes);
};

const sourceRecord = {
  sideEvidenceOnly: true,
  note: 'Structured source/provenance evidence for this round, derived from this round own read-only git measurements on this host.',
  publishedSourceCommit: 'c68a53af300b33109375665197951331e45ae18a',
  checkoutCommit: provenance.headCommit,
  observedSourceTree: provenance.c68Tree,
  expectedSourceTree: '50e12ecc7f4c72448f03e714a585814eb9476622',
  worktreeCleanBeforeLocaleGeneration: provenance.worktreeClean,
  lockfileSha256: provenance.lockfileSha256,
  productWorktreeGitBroken: provenance.productWorktreeGitBroken,
  testedLocalHeadPresentInThisClone: false,
  testedLocalHeadNote:
    'The schema constant testedLocalHead 7212af1f9da08324963e38973c7f477aabfffb0b is absent from this clone and from origin, so it could not be corroborated on this host. It is carried in result.json only because the checked-in schema fixes it as a constant.',
  at: new Date().toISOString(),
};
write('artifacts/source.json', 'source', 'application/json', sourceRecord);

const events = [];
for (const [file, context] of [
  ['live/webgpu-fixture-page.json', 'page: loopback fixture page'],
  ['live/webgpu-options-page.json', 'page: extension options page'],
  ['live/webgpu-extension-worker.json', 'worker: same-origin Blob Worker inside the extension options page'],
]) {
  const raw = JSON.parse(fs.readFileSync(path.join(S, file), 'utf8'));
  events.push({
    event: raw.ok ? 'webgpu-adapter-observation' : 'webgpu-adapter-observation-failed',
    at: raw.at,
    context,
    rawArtifact: 'artifacts/env01/' + path.basename(file),
    ok: raw.ok,
    error: raw.error ?? null,
    adapter: raw.adapter ?? null,
    isFallbackAdapter: raw.isFallbackAdapter ?? null,
    features: raw.features ?? [],
    limits: raw.limits ?? {},
    timeoutMs: raw.timeoutMs ?? null,
    elapsedMs: raw.elapsedMs ?? null,
    sideEvidenceOnly: true,
    label: 'Side evidence only: no continuous guard interval exists on this host, so this observation supports no pass.',
  });
}
write('artifacts/env01/gpu-log.json', 'gpu-log', 'application/json', {
  sideEvidenceOnly: true,
  at: new Date().toISOString(),
  note: 'Structured view of the raw WebGPU probes captured this round. Every event names the raw artifact it was derived from.',
  osGpuDescription: 'NVIDIA GeForce RTX 5090, driver 595.91.07, CUDA 13.2 (from nvidia-smi on this host)',
  events,
});

fs.writeFileSync(path.join(S, 'artifact-index.json'), JSON.stringify(idx, null, 2) + '\n');
process.stdout.write(JSON.stringify({artifacts: idx.artifacts.length, events: events.length, shaderF16: events.map((e) => e.features.includes('shader-f16'))}) + '\n');

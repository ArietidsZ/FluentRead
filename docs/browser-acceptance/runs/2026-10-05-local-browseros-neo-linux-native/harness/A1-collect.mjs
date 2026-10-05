#!/usr/bin/env node
/** A1: copy, sanitize and hash this round's artifact set. Sanitize BEFORE hashing. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const S = '<HOME>/.cache/fluentread-acceptance/linux-native-20261005';
const RECORD = '<WORKSPACE>/FluentRead/docs/browser-acceptance/runs/2026-10-05-local-browseros-neo-linux-native';
const WORKSPACE = '<WORKSPACE>';
const HOME = '<HOME>';

const ARTIFACTS = [
  ['live/guard-attempt-once.txt', 'artifacts/focus/guard-attempt-once.txt', 'focus-guard', 'text/plain'],
  ['live/guard-attempt-continuous.txt', 'artifacts/focus/guard-attempt-continuous.txt', 'focus-guard', 'text/plain'],
  ['live/guard-report-status.txt', 'artifacts/focus/guard-report-status.txt', 'focus-guard', 'text/plain'],
  ['live/guard-preconditions.txt', 'artifacts/focus/guard-preconditions.txt', 'focus-guard', 'text/plain'],
  ['live/guard-command.txt', 'artifacts/focus/guard-command.txt', 'focus-guard', 'text/plain'],
  ['logs/guard-block-transcripts.txt', 'artifacts/focus/guard-block-transcripts.txt', 'focus-guard', 'text/plain'],
  ['recon/guard-block.json', 'artifacts/focus/guard-block.json', 'focus-guard', 'application/json'],
  ['live/window-bounds.json', 'artifacts/focus/window-bounds.json', 'focus-guard', 'application/json'],
  ['live/profile-record.json', 'artifacts/focus/profile-record.json', 'focus-guard', 'application/json'],
  ['live/cdp-version.json', 'artifacts/env01/cdp-version.json', 'capabilities', 'application/json'],
  ['live/ext-session.json', 'artifacts/env01/extension-identity.json', 'capabilities', 'application/json'],
  ['live/webgpu-fixture-page.json', 'artifacts/env01/webgpu-fixture-page.json', 'gpu-log', 'application/json'],
  ['live/webgpu-options-page.json', 'artifacts/env01/webgpu-options-page.json', 'gpu-log', 'application/json'],
  ['live/webgpu-extension-worker.json', 'artifacts/env01/webgpu-extension-worker.json', 'gpu-log', 'application/json'],
  ['live/dom/options.json', 'artifacts/env01/dom-options.json', 'browser-log', 'application/json'],
  ['live/dom/popup.json', 'artifacts/env01/dom-popup.json', 'browser-log', 'application/json'],
  ['live/dom/page-1.json', 'artifacts/env01/dom-fixture-page.json', 'browser-log', 'application/json'],
  ['live/dom/ui-states.json', 'artifacts/env01/dom-ui-states.json', 'browser-log', 'application/json'],
  ['live/dropdown-recon.json', 'artifacts/env01/dom-dropdown-recon.json', 'browser-log', 'application/json'],
  ['live/ocr-engine-options.json', 'artifacts/env01/dom-ocr-engine-options.json', 'browser-log', 'application/json'],
  ['live/fixture-metrics.json', 'artifacts/env01/fixture-metrics.json', 'network', 'application/json'],
  ['live/cleanup-proof.json', 'artifacts/hygiene/cleanup-proof.json', 'source', 'application/json'],
  ['live/control-plane-probe.txt', 'artifacts/neo/control-plane-probe.txt', 'source', 'text/plain'],
  ['live/commands.json', 'artifacts/build/commands.json', 'browser-log', 'application/json'],
  ['recon/build-files.json', 'artifacts/build/build-files.json', 'build-manifest', 'application/json'],
  ['live/generated-locales.json', 'artifacts/build/generated-locales.json', 'locale-manifest', 'application/json'],
  ['recon/browser-binary.json', 'artifacts/host/browser-binary.json', 'source', 'application/json'],
  ['recon/host-facts.json', 'artifacts/host/host-facts.json', 'source', 'application/json'],
  ['recon/hygiene.json', 'artifacts/host/hygiene.json', 'source', 'application/json'],
  ['recon/selfchecks.json', 'artifacts/tools/selfchecks.json', 'source', 'application/json'],
  ['logs/selfchecks-raw.txt', 'artifacts/tools/selfchecks-raw.txt', 'source', 'text/plain'],
  ['logs/host-facts-raw.txt', 'artifacts/host/host-facts-raw.txt', 'source', 'text/plain'],
  ['live/dom/options.png', 'artifacts/env01/options-light.png', 'screenshot', 'image/png'],
  ['live/dom/popup.png', 'artifacts/env01/popup.png', 'screenshot', 'image/png'],
  ['live/dom/page-1.png', 'artifacts/env01/fixture-page.png', 'screenshot', 'image/png'],
  ['live/dom/options-manga-route.png', 'artifacts/env01/options-manga-route.png', 'screenshot', 'image/png'],
  ['live/dom/options-dark.png', 'artifacts/env01/options-dark.png', 'screenshot', 'image/png'],
  ['live/dom/options-narrow-390.png', 'artifacts/env01/options-narrow-390.png', 'screenshot', 'image/png'],
];

const sanitize = (t) => t.split(WORKSPACE).join('<WORKSPACE>').split(HOME).join('<HOME>');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
fs.rmSync(RECORD, {recursive: true, force: true});
const index = [];
const problems = [];
for (const [src, dest, role, mediaType] of ARTIFACTS) {
  const from = path.join(S, src);
  const to = path.join(RECORD, dest);
  if (!fs.existsSync(from)) { problems.push({src, problem: 'missing source'}); continue; }
  fs.mkdirSync(path.dirname(to), {recursive: true});
  let bytes;
  if (mediaType === 'image/png') {
    bytes = fs.readFileSync(from);
    if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') problems.push({src, problem: 'not a PNG'});
  } else {
    bytes = Buffer.from(sanitize(fs.readFileSync(from, 'utf8')), 'utf8');
  }
  fs.writeFileSync(to, bytes);
  index.push({path: dest, sha256: sha256(bytes), mediaType, role, bytes: bytes.length, source: src});
}
fs.writeFileSync(path.join(S, 'artifact-index.json'), JSON.stringify({record: RECORD, artifacts: index, problems}, null, 2) + '\n');
process.stdout.write(JSON.stringify({artifacts: index.length, problems, totalBytes: index.reduce((s, a) => s + a.bytes, 0)}) + '\n');

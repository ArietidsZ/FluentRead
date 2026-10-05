#!/usr/bin/env node
/** F2: machine-checkable side-evidence manifest, plus a digest for every file in the record. */
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

const rawCaptures = [
  'artifacts/env01/cdp-version.json',
  'artifacts/env01/dom-options.json',
  'artifacts/env01/dom-popup.json',
  'artifacts/env01/dom-fixture-page.json',
  'artifacts/env01/webgpu-fixture-page.json',
  'artifacts/env01/webgpu-options-page.json',
];
const labelled = idx.artifacts
  .filter((a) => a.path.endsWith('.json') && !rawCaptures.includes(a.path))
  .map((a) => {
    let flag = null;
    let sentence = false;
    try {
      const body = fs.readFileSync(path.join(RECORD, a.path), 'utf8');
      flag = JSON.parse(body).sideEvidenceOnly ?? null;
      sentence = /no continuous guard interval exists on this host/i.test(body);
    } catch { /* keep nulls */ }
    return {path: a.path, role: a.role, sideEvidenceOnly: flag, noGuardSentence: sentence};
  });

const manifest = {
  sideEvidenceOnly: true,
  purpose: 'Machine-checkable labelling status for every registered artifact of this round. Because no continuous focus guard interval can exist on this host, every browser-derived observation is side evidence and supports no pass.',
  globalDeclaration: 'No continuous guard interval exists on this host, because browser-focus-guard.mjs asserts process.platform===darwin; therefore nothing in this record supports a pass.',
  rawCapturesWithoutInlineLabel: rawCaptures,
  rawCaptureExplanation: 'These six files are verbatim captures (one CDP version document, three DOM extractions, two WebGPU probe results). Their bytes are kept exactly as the browser returned them, so no field was injected into them; they are covered by the global declaration above and by this manifest.',
  labelledArtifacts: labelled,
  labelledCount: labelled.filter((l) => l.sideEvidenceOnly === true).length,
  artifactsChecked: labelled.length + rawCaptures.length,
  at: new Date().toISOString(),
};
const manifestBytes = Buffer.from(sanitize(JSON.stringify(manifest, null, 2)) + '\n', 'utf8');
fs.mkdirSync(path.join(RECORD, 'artifacts/env01'), {recursive: true});
fs.writeFileSync(path.join(RECORD, 'artifacts/env01/side-evidence-manifest.json'), manifestBytes);
const entry = {path: 'artifacts/env01/side-evidence-manifest.json', sha256: sha256(manifestBytes), mediaType: 'application/json', role: 'source', bytes: manifestBytes.length, source: 'generated after adversarial review'};
const existing = idx.artifacts.find((a) => a.path === entry.path);
if (existing) Object.assign(existing, entry); else idx.artifacts.push(entry);
fs.writeFileSync(path.join(S, 'artifact-index.json'), JSON.stringify(idx, null, 2) + '\n');

const all = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.isFile()) {
      const rel = path.relative(RECORD, full).split(path.sep).join('/');
      if (rel === 'record-index.json') continue;
      const bytes = fs.readFileSync(full);
      all.push({path: rel, bytes: bytes.length, sha256: sha256(bytes), registered: idx.artifacts.some((a) => a.path === rel)});
    }
  }
};
walk(RECORD);
all.sort((a, b) => a.path.localeCompare(b.path, 'en'));
fs.writeFileSync(path.join(RECORD, 'record-index.json'), JSON.stringify({
  note: 'SHA-256 for every file in this record, including unregistered meta deliverables. Registered artifacts are the subset referenced by result.json.',
  fileCount: all.length,
  registeredCount: all.filter((f) => f.registered).length,
  files: all,
}, null, 2) + '\n');
process.stdout.write(JSON.stringify({artifacts: idx.artifacts.length, recordFiles: all.length, labelled: manifest.labelledCount, rawCaptures: rawCaptures.length}) + '\n');

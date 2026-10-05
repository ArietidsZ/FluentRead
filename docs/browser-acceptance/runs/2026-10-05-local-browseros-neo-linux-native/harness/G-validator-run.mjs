#!/usr/bin/env node
/** G: capture the verbatim validator transcript into a registered artifact. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

const S = '<HOME>/.cache/fluentread-acceptance/linux-native-20261005';
const REPO = '<WORKSPACE>/FluentRead';
const RECORD = REPO + '/docs/browser-acceptance/runs/2026-10-05-local-browseros-neo-linux-native';
const idx = JSON.parse(fs.readFileSync(path.join(S, 'artifact-index.json'), 'utf8'));

const cmd = 'node scripts/testing/browser-acceptance.mjs validate docs/browser-acceptance/runs/2026-10-05-local-browseros-neo-linux-native/result.json';
let output = '';
let exitCode = 0;
try {
  output = execFileSync('bash', ['-c', `${cmd}; echo "exit=$?"`], {cwd: REPO, encoding: 'utf8'}).trim();
} catch (error) {
  output = String((error.stdout || '') + (error.stderr || '')).trim();
  exitCode = error.status ?? 1;
}
const lines = output.split('\n');
const body = [
  '# Verbatim validator run for this round record.',
  '# Command: ' + cmd,
  '# Working directory: <WORKSPACE>/FluentRead',
  '# Validator: the checked-in scripts/testing/browser-acceptance.mjs at the pinned tools revision.',
  '',
  ...lines,
  '',
  '# This file is regenerated whenever result.json changes. The exit code line is the real one.',
].join('\n') + '\n';

const dest = path.join(RECORD, 'artifacts/tools/validator-run.txt');
fs.writeFileSync(dest, body);
const bytes = fs.readFileSync(dest);
const entry = {path: 'artifacts/tools/validator-run.txt', sha256: crypto.createHash('sha256').update(bytes).digest('hex'), mediaType: 'text/plain', role: 'source', bytes: bytes.length, source: 'verbatim validator transcript'};
const existing = idx.artifacts.find((a) => a.path === entry.path);
if (existing) Object.assign(existing, entry); else idx.artifacts.push(entry);
fs.writeFileSync(path.join(S, 'artifact-index.json'), JSON.stringify(idx, null, 2) + '\n');
process.stdout.write(JSON.stringify({validatorOutput: lines, exitCode}) + '\n');

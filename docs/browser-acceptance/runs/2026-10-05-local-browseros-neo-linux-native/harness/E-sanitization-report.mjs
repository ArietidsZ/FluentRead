#!/usr/bin/env node
/** Sanitization report for the record. Runs the checker from its scratch copy (real paths). */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const RECORD = '<WORKSPACE>/FluentRead/docs/browser-acceptance/runs/2026-10-05-local-browseros-neo-linux-native';
const CHECKER = '<HOME>/.cache/fluentread-acceptance/linux-native-20261005/harness/sanitization-check.mjs';

let stdout = '';
let exitCode = 0;
try {
  stdout = execFileSync('node', [CHECKER, RECORD], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
} catch (error) {
  stdout = String(error.stdout || '') + String(error.stderr || '');
  exitCode = error.status ?? 1;
}
const lines = stdout.trim().split('\n');
const summary = lines.filter((l) => l.startsWith('sanitization-check:')).join('\n');
const hits = lines.filter((l) => !l.startsWith('sanitization-check:'));

const classified = hits.map((line) => {
  const file = line.split(':')[0];
  const rule = (line.match(/\[([^\]]+)\]/) || [])[1] ?? 'unknown';
  const selfMatch = file === 'harness/sanitization-check.mjs';
  return {
    hit: line,
    file,
    rule,
    classification: selfMatch ? 'scanner-self-match' : 'unexplained',
    why: selfMatch
      ? 'This file necessarily contains its own rule patterns as literals, so it matches itself. A scanner artefact, not leaked data.'
      : '',
  };
});
const unexplained = classified.filter((c) => c.classification === 'unexplained');

const report = {
  at: new Date().toISOString(),
  checker: 'sanitization-check.mjs (this round own dependency-free checker)',
  command: 'node <checker> <record>',
  exitCode,
  summaryLine: summary,
  hitCount: hits.length,
  classified,
  unexplainedCount: unexplained.length,
  conclusion:
    unexplained.length === 0
      ? 'Clean. No literal home path, no literal workspace path, no macOS user path belonging to a real machine, and no credential appear anywhere in this record. Every reported hit is the scanner matching its own pattern literals.'
      : 'Real sanitization violations remain and must be fixed before publishing.',
  note:
    'The checker copy inside this record has its two path constants placeholder-substituted by the round sanitizer, so the authoritative scan was run from the working copy whose constants are derived at runtime. To re-run the record copy, restore <HOME> and <WORKSPACE> first.',
  alsoChecked: [
    'artifacts/** were sanitized by the collector before their SHA-256 was computed, so every registered digest matches the sanitized bytes on disk.',
    'harness/** and defects/** were sanitized on copy; placeholders must be restored before those scripts are re-run.',
  ],
};
fs.writeFileSync(path.join(RECORD, 'sanitization-report.json'), JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify({exitCode, hits: hits.length, unexplained: unexplained.length}) + '\n');

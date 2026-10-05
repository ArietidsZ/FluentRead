#!/usr/bin/env node
/**
 * C-counterfactual.mjs — counterfactual checks for this round record.
 *
 * Derives its own location from import.meta.url, so it runs in place from the record directory
 * and survives the record's path sanitizer unchanged. Each mutant is validated by the real
 * upstream validator and its real message is recorded. result.json itself is never modified.
 *
 * Usage: node <record>/harness/C-counterfactual.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const RECORD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(RECORD, '../../../..');
const original = JSON.parse(fs.readFileSync(path.join(RECORD, 'result.json'), 'utf8'));
const tempFiles = [];

const run = (file) => {
  try {
    return {accepted: true, output: execFileSync('node', ['scripts/testing/browser-acceptance.mjs', 'validate', file], {cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim()};
  } catch (error) {
    return {accepted: false, output: (String(error.stdout || '') + String(error.stderr || '')).trim()};
  }
};

const results = [];
const check = (name, mutation, note) => {
  const mutant = structuredClone(original);
  mutation(mutant);
  const file = path.join(RECORD, 'counterfactual-' + name + '.json');
  tempFiles.push(file);
  fs.writeFileSync(file, JSON.stringify(mutant, null, 2));
  const outcome = run(file);
  results.push({name, note, accepted: outcome.accepted, validatorOutput: outcome.output});
};

check('00-baseline', () => {}, 'Unmodified copy of the round record.');
check('01-one-case-pass', (m) => {
  m.provenance.checkoutCommit = m.provenance.publishedSourceCommit;
  m.cases[0].status = 'pass';
}, 'Flip ENV-01 to pass and satisfy the checkout provenance gate, so the next gate is the real one.');
check('02-overall-pass', (m) => { m.overall = 'pass'; }, 'Claim the whole round passed while every case stays blocked.');
check('03-wrong-digest', (m) => { m.artifacts[0].sha256 = '0'.repeat(64); }, 'Register an artifact digest that does not match the bytes on disk.');
check('04-kind-swap', (m) => { m.cases[6].kind = 'deterministic-browser'; }, 'Change a case evidence class away from the checked-in template.');
check('05-guard-transcript-as-evidence', (m) => {
  m.provenance.checkoutCommit = m.provenance.publishedSourceCommit;
  m.environment.focusGuardEvidence = 'artifacts/focus/guard-attempt-once.txt';
  m.cases[0].status = 'pass';
}, 'Point focusGuardEvidence at the raw guard refusal transcript, with the checkout gate satisfied.');
check('06-guard-block-json-as-evidence', (m) => {
  m.provenance.checkoutCommit = m.provenance.publishedSourceCommit;
  m.environment.focusGuardEvidence = 'artifacts/focus/guard-block.json';
  m.cases[0].status = 'pass';
}, 'Point focusGuardEvidence at the structured guard-block record, which is not a completed continuous guard report.');
check('07-fabricated-guard-report', (m) => {
  m.provenance.checkoutCommit = m.provenance.publishedSourceCommit;
  const fake = {
    status: 'stopped', mode: 'continuous', visibilityPolicy: 'temporary-partial-visibility-20261005',
    browserPid: m.environment.browserPid, profilePathSha256: m.environment.profilePathSha256,
    events: [{event: 'focus-window-observation', at: '2026-10-05T11:00:00.000Z', frontmostPidBefore: 1, frontmostPidAfter: 1,
      windows: [{left: 2400, top: 120, width: 1200, height: 900, windowState: 'normal'}], displays: [{left: 0, top: 0, width: 2560, height: 1440}]}],
  };
  const bytes = Buffer.from(JSON.stringify(fake));
  fs.writeFileSync(path.join(RECORD, 'artifacts/focus/guard-report.json'), bytes);
  m.artifacts.push({path: 'artifacts/focus/guard-report.json', sha256: crypto.createHash('sha256').update(bytes).digest('hex'), mediaType: 'application/json', role: 'focus-guard'});
  m.environment.focusGuardEvidence = 'artifacts/focus/guard-report.json';
  m.cases[0].status = 'pass';
}, 'Promote a fabricated one-observation guard report into pass evidence.');

fs.rmSync(path.join(RECORD, 'artifacts/focus/guard-report.json'), {force: true});
for (const file of tempFiles) fs.rmSync(file, {force: true});

fs.writeFileSync(path.join(RECORD, 'counterfactual-pass.json'), JSON.stringify({
  note: 'Counterfactual checks run by harness/C-counterfactual.mjs, exactly as shipped in this record, against the real upstream validator. The record itself is unchanged by this run.',
  producedBy: 'harness/C-counterfactual.mjs (runs in place; derives its own paths)',
  validator: 'node scripts/testing/browser-acceptance.mjs validate <mutant>',
  results,
}, null, 2) + '\n');
process.stdout.write(JSON.stringify(results.map((r) => ({name: r.name, accepted: r.accepted, output: r.validatorOutput.slice(0, 120)}))) + '\n');

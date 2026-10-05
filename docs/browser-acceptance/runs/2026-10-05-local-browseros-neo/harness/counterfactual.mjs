/**
 * Counterfactual proof of DEFECT-01.
 *
 * Takes the real, validating result.json and changes exactly one thing: ENV-01's
 * status from "blocked" to "pass", with the observations and evidence that were
 * actually collected for it. Everything else (environment, provenance, hardware,
 * artifacts, all other cases) is left untouched.
 *
 * If the frozen contract were satisfiable, this report would validate. Instead it
 * must fail at the generated-locales check with "Generated locale missing: zh-CN",
 * which proves that no honest pass can ever be certified by this handoff.
 *
 * The mutated report is written to /tmp and never replaces result.json.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

// Local absolute path redacted before publication; see FR_ACCEPTANCE_BASE in assemble.mjs.
const ACC = path.join(process.env.FR_ACCEPTANCE_BASE ?? path.resolve(process.cwd(), '../../../../../../..'), 'acceptance');
const report = JSON.parse(await fs.readFile(path.join(ACC, 'result.json'), 'utf8'));

const target = report.cases.find(item => item.id === 'ENV-01');
target.status = 'pass';
target.backend = 'hardware-webgpu';
target.observations = report.cases.find(item => item.id === 'ENV-01').observations.length
  ? report.cases.find(item => item.id === 'ENV-01').observations
  : ['Counterfactual: status raised to pass to exercise the frozen pass-evidence contract.'];
target.evidence = [
  'artifacts/env01/capabilities.json',
  'artifacts/env01/browser-log.json',
  'artifacts/env01/gpu-log.json',
  'artifacts/env01/fixture-home.png',
];
report.overall = 'blocked';

const out = '/tmp/fluentread-counterfactual-pass.json';
await fs.writeFile(out, JSON.stringify(report, null, 2));
console.log(out);

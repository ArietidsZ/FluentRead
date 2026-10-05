/**
 * @file counterfactual.mjs
 * 反证：说明本轮 ENV-01 的 `pass` 不是校验器放水，而是真的满足了通过契约。
 *
 * 两个反例都在**同一个真实记录**上做最小改动，并调用同一条校验路径：
 *   A. 把 focus guard 记录的状态从 `stopped` 改回 `running`（即「guard 没有完整结束」）
 *      → 期望被拒。
 *   B. 走「严格策略」：删掉 guard 与报告里的 `visibilityPolicy`，让契约按 fully-offscreen 解释，
 *      即本次获批的部分可见窗口不再被承认 → 期望被拒。
 *
 * 两者都**不得**写回原记录：所有改动只发生在临时目录里的副本上。
 *
 * 用法：node counterfactual.mjs RUN_DIR TOOLS_ROOT
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const [runDirArg, toolsRoot] = process.argv.slice(2);
if (!runDirArg || !toolsRoot) throw new Error('Usage: counterfactual.mjs RUN_DIR TOOLS_ROOT');
const runDir = path.resolve(runDirArg);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const results = {};

// browser-acceptance.mjs is a CLI, so drive its real validator through a child process:
// importing it would execute the CLI entry and print usage instead of validating.
const {execFile} = await import('node:child_process');
const {promisify} = await import('node:util');
const run = promisify(execFile);

const copyRun = async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'fluentread-counterfactual-'));
  await fs.cp(runDir, scratch, {recursive: true});
  return scratch;
};

const validate = async dir => {
  try {
    const {stdout} = await run(process.execPath, [path.join(toolsRoot, 'scripts/testing/browser-acceptance.mjs'), 'validate', path.join(dir, 'result.json')], {maxBuffer: 8 * 1024 * 1024});
    return {accepted: true, result: JSON.parse(stdout.trim())};
  } catch (error) {
    const text = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim().split('\n').filter(Boolean);
    return {accepted: false, rejected: text.filter(line => !line.includes('at ')).slice(-3).join(' | ')};
  }
};

/** Rewrite result.json (and its artifact registry entry) so the digests stay consistent. */
const rewrite = async (dir, mutateReport, mutateFiles = async () => {}) => {
  const reportPath = path.join(dir, 'result.json');
  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  await mutateFiles(dir, report);
  await mutateReport(report);
  for (const artifact of report.artifacts) {
    artifact.sha256 = sha256(await fs.readFile(path.join(dir, artifact.path)));
  }
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
};

// ---- baseline: the untouched record must validate
{
  const dir = await copyRun();
  results.baseline = await validate(dir);
  await fs.rm(dir, {recursive: true, force: true});
}

// ---- A. the focus guard did not finish: flip its status back to `running`
{
  const dir = await copyRun();
  await rewrite(dir, () => {}, async scratch => {
    const file = path.join(scratch, 'artifacts/focus/focus-guard.json');
    const guard = JSON.parse(await fs.readFile(file, 'utf8'));
    guard.status = 'running';
    await fs.writeFile(file, JSON.stringify(guard, null, 2) + '\n');
  });
  results.guardNotStopped = await validate(dir);
  await fs.rm(dir, {recursive: true, force: true});
}

// ---- B. the partial-visibility exception is withdrawn: the strict policy must reject it
{
  const dir = await copyRun();
  await rewrite(dir, report => { delete report.environment.visibilityPolicy; }, async scratch => {
    const file = path.join(scratch, 'artifacts/focus/focus-guard.json');
    const guard = JSON.parse(await fs.readFile(file, 'utf8'));
    delete guard.visibilityPolicy;
    delete guard.samplePolicy;
    for (const event of guard.events) delete event.visibilityPolicy;
    await fs.writeFile(file, JSON.stringify(guard, null, 2) + '\n');
  });
  results.strictPolicyWithoutException = await validate(dir);
  await fs.rm(dir, {recursive: true, force: true});
}

// ---- C. no executed evidence at all: the pass must not survive as a claim
{
  const dir = await copyRun();
  await rewrite(dir, report => {
    const env01 = report.cases.find(c => c.id === 'ENV-01');
    env01.status = 'blocked';
    env01.evidence = [];
    env01.observations = [];
    env01.reason = 'Counterfactual: the pass claim is withdrawn.';
    report.overall = 'blocked';
  });
  results.passWithdrawn = await validate(dir);
  await fs.rm(dir, {recursive: true, force: true});
}

const expected = {baseline: true, guardNotStopped: false, strictPolicyWithoutException: false, passWithdrawn: true};
for (const [key, want] of Object.entries(expected)) {
  assert.equal(results[key].accepted, want, `counterfactual ${key}: expected accepted=${want}, got ${JSON.stringify(results[key])}`);
}
console.log(JSON.stringify({ok: true, expected, results}, null, 2));
await fs.writeFile(path.join(runDir, 'counterfactual-pass.json'), JSON.stringify({ok: true, expected, results}, null, 2) + '\n');

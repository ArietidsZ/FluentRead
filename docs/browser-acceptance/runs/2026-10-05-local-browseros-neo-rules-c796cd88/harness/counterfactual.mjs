/**
 * @file counterfactual.mjs
 * 本文件是 cf541253 契约的反证工具：读取本次运行真实且通过校验的 result.json，
 * 只把 ENV-01 的状态从 blocked 改成 pass，并沿用它实际采集到的证据，
 * 其余内容（环境、来源、硬件、artifacts、其他用例）一律不动。
 * 目的：证明在「焦点守卫 + 原始 GPU 事件绑定」这套新契约下，一个诚实的
 * ENV-01 pass 会停在哪一条断言上——预期停在焦点守卫断言，而不是语言清单或 GPU 断言。
 * 输出写成本运行目录内的 counterfactual-pass.json（不覆盖 result.json），
 * 然后调用同一套校验器并打印被拒绝的原因。
 * 用法：node counterfactual.mjs <RUN_DIR> <TOOLS_WORKTREE_DIR>
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec = promisify(execFile);
const run = path.resolve(process.argv[2] ?? '.');
const tools = process.argv[3];
if (!tools) throw new Error('Usage: counterfactual.mjs RUN_DIR TOOLS_WORKTREE_DIR');

const report = JSON.parse(await fs.readFile(path.join(run, 'result.json'), 'utf8'));
const target = report.cases.find(item => item.id === 'ENV-01');
target.status = 'pass';
target.backend = 'hardware-webgpu';
target.observations = [...target.observations, 'Counterfactual: only the status was raised to pass; every observation and artifact below is the real collected evidence.'];
target.evidence = [
  'artifacts/env01/capabilities.json',
  'artifacts/env01/browser-log.json',
  'artifacts/env01/gpu-log.json',
  'artifacts/env01/fixture-home.png',
  'artifacts/focus/focus-preflight.json',
  'artifacts/neo/capabilities-neo-stdio.json',
];
report.overall = 'blocked';

const output = path.join(run, 'counterfactual-pass.json');
await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');

const validator = path.join(tools, 'scripts/testing/browser-acceptance.mjs');
let rejected = null;
try {
  await exec(process.execPath, [validator, 'validate', output], {timeout: 120000});
} catch (error) {
  rejected = String(error.stderr || error.message).trim().split('\n').find(line => line && !line.startsWith('    at ')) || String(error.message);
}
console.log(JSON.stringify({output, rejected}, null, 2));

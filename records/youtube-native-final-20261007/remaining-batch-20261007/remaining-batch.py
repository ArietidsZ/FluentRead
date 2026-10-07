import json
import pathlib
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parent
worktree = pathlib.Path(sys.argv[1]).resolve()
matrix = json.loads((worktree / 'tests/test-matrix.json').read_text())
for group in ['unit', 'functional', 'regression']:
    files = matrix['groups'][group]
    (root / (group + '-files.json')).write_text(json.dumps(files, indent=2) + '\n')
    command = ['node', 'scripts/testing/run-resource-safe.mjs', '--', 'node', 'node_modules/vitest/vitest.mjs',
        'run', *files, '--reporter=default', '--reporter=json',
        '--outputFile=' + str(root / ('group-' + group + '-pure.results.json')), '--no-cache']
    subprocess.run([sys.executable, str(root / 'run-recorded.py'), 'group-' + group + '-pure', str(worktree), *command])
stages = [
    ('prepare-pure', ['node','scripts/testing/run-resource-safe.mjs','--','node','node_modules/wxt/bin/wxt.mjs','prepare']),
    ('chrome-build-pure', ['node','scripts/testing/run-resource-safe.mjs','--','node','node_modules/wxt/bin/wxt.mjs','build']),
    ('firefox-build-pure', ['node','scripts/testing/run-resource-safe.mjs','--','node','node_modules/wxt/bin/wxt.mjs','build','-b','firefox']),
    ('userscript-build-pure', ['node','scripts/testing/run-resource-safe.mjs','--','node','node_modules/vite/bin/vite.js','build','--config','userscript/vite.config.ts']),
    ('userscript-verifier-pure', ['node','scripts/verify-userscript-build.mjs']),
    ('docs-build-pure', ['node','scripts/testing/run-resource-safe.mjs','--','node','node_modules/vitepress/bin/vitepress.js','build','docs']),
    ('docs-verifier-pure', ['node','scripts/verify-docs-build.mjs']),
]
for label,command in stages:
    subprocess.run([sys.executable, str(root / 'run-recorded.py'), label, str(worktree), *command])
print('PURE_BATCH_COMPLETE', flush=True)

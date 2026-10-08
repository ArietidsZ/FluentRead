import hashlib
import json
import pathlib
import subprocess

raw = pathlib.Path(__file__).resolve().parent
repo = raw.parent / 'FluentRead-incognito-route-20261008'
files = ['src/app/document-translation/DocumentApp.vue', 'src/app/document-translation/runtime.ts', 'src/app/document-translation/index.ts']
saved = {name: (raw / 'working-source' / name).read_bytes() for name in files}
record = {}
try:
    for name in files:
        assert (repo / name).read_bytes() == saved[name]
        blob = subprocess.check_output(['git', 'show', f'HEAD:{name}'], cwd=repo)
        record[name] = {'baselineGitBlob': subprocess.check_output(['git', 'rev-parse', f'HEAD:{name}'], cwd=repo, text=True).strip(),
                        'baselineSha256': hashlib.sha256(blob).hexdigest(), 'workingSha256': hashlib.sha256(saved[name]).hexdigest()}
        (repo / name).write_bytes(blob)
    (raw / 'BASELINE-SOURCE-CONTROL.json').write_text(json.dumps({'baselineHead': 'd8e4091beb9113451cedf8052f54c22edc5ca80f', 'files': record,
        'scope': 'Restore all three production document app files; new offline tests and registration remain. -t selects eleven behavior controls; filtered tests are not acceptance skips.'}, indent=2) + '\n')
    command = ['python3', str(raw / 'run-recorded.py'), 'document-baseline-red', str(repo), 'node', 'scripts/testing/run-resource-safe.mjs', '--',
        'node', 'node_modules/vitest/vitest.mjs', 'run', 'tests/documentPrivacyRoute.test.ts', '--no-cache', '-t',
        'shows and prechecks|dedicated AI routing|real normalized|export route save|saving the route', '--reporter=json', f'--outputFile={raw}/document-baseline-red.results.json']
    result = subprocess.run(command, cwd=repo)
    print('baseline control exit', result.returncode, flush=True)
    assert result.returncode != 0
finally:
    for name, data in saved.items():
        (repo / name).write_bytes(data)
        assert (repo / name).read_bytes() == data
    print('All three working production files restored byte-for-byte.', flush=True)

import os, pathlib, subprocess, sys
raw = pathlib.Path(__file__).resolve().parent
repo = raw.parent / 'FluentRead-incognito-route-20261008'
for label in ['full-strict-final', 'architecture-final', 'test-audit-complete']:
    assert not (raw / (label + '.command.json')).exists(), label
    env = os.environ.copy()
    if label == 'full-strict-final':
        env['FLUENTREAD_DICTIONARY_OBSERVATIONS'] = str(raw / 'full-strict-observations.jsonl')
    result = subprocess.run(['python3', str(raw / 'run-gate.py'), label], cwd=repo, env=env)
    if result.returncode: sys.exit(result.returncode)
result = subprocess.run(['python3', str(raw / 'run-build-gates.py')], cwd=repo)
sys.exit(result.returncode)

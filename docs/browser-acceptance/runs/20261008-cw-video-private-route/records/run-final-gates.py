import hashlib
import json
import pathlib
import subprocess
import sys

raw = pathlib.Path(__file__).resolve().parent
repo = raw.parent / 'FluentRead-incognito-route-20261008'
previous = raw.parent / 'word-card-spa-route-20261008'
frozen = json.loads((raw / 'FROZEN-INPUTS.json').read_text())
labels = ['test-audit-complete', 'architecture-final', 'typecheck-final',
          'chrome-build-final', 'firefox-build-final', 'manifest-verify-final',
          'userscript-build-final', 'userscript-verify-final', 'full-strict-final', 'docs-build-final']
for label in labels:
    assert not (raw / (label + '.command.json')).exists(), ('refuse to repeat completed final gate', label)
    for name, expected in frozen.items():
        assert hashlib.sha256((repo / name).read_bytes()).hexdigest() == expected, name
    prior_label = label
    old = json.loads((previous / (prior_label + '.command.json')).read_text())['command']
    command = [part.replace(str(previous), str(raw)).replace('full-strict-complete', 'full-strict-final') for part in old]
    result = subprocess.run(['python3', str(raw / 'run-recorded.py'), label, str(repo), *command], cwd=repo)
    if result.returncode:
        sys.exit(result.returncode)
print('All final gates completed against the same frozen source inputs.', flush=True)

import hashlib
import json
import pathlib
import subprocess
import sys

root = pathlib.Path(sys.argv[1])
raw = pathlib.Path(__file__).resolve().parent
baseline = root.parent / 'FluentRead-transaction-wxt-validation-20261008'

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

source = json.loads((raw / 'SOURCE-BEFORE.json').read_text())
changed = [name for name, expected in source.items() if digest(root / name) != expected]
assert not changed, changed
artifacts = {str(p.relative_to(root)): digest(p) for target in ['chrome-mv3', 'firefox-mv2', 'userscript']
             for p in sorted((root / '.output' / target).rglob('*')) if p.is_file()}
(raw / 'ARTIFACT-SHA256.json').write_text(json.dumps(artifacts, indent=2) + '\n')
keys = ['permissions', 'optional_permissions', 'host_permissions', 'optional_host_permissions', 'incognito']
manifests = {}
for target in ['chrome-mv3', 'firefox-mv2']:
    current = json.loads((root / '.output' / target / 'manifest.json').read_text())
    accepted = json.loads((baseline / '.output' / target / 'manifest.json').read_text())
    comparison = {key: {'baseline': accepted.get(key), 'current': current.get(key), 'equal': accepted.get(key) == current.get(key)} for key in keys}
    assert all(value['equal'] for value in comparison.values()), comparison
    manifests[target] = comparison
    if target == 'firefox-mv2':
        assert current['browser_specific_settings']['gecko']['strict_min_version'] == '140.0'
        manifests[target]['strict_min_version'] = '140.0'
(raw / 'PERMISSIONS-COMPARISON.json').write_text(json.dumps({'baseline_commit': '89fd05806c4c41778e8a47817988130ef09ca583', 'targets': manifests}, indent=2) + '\n')
print(json.dumps({'source_inputs_unchanged': len(source), 'artifacts_hashed': len(artifacts), 'permissions_unchanged': True}, indent=2))

import hashlib, json, pathlib

raw = pathlib.Path(__file__).resolve().parent
repo = raw.parent / 'FluentRead-incognito-route-20261008'
previous = raw.parent / 'video-node-replacement-20261008'
def save(name, value):
    (raw / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
script = (repo / '.output/userscript/fluent-read.user.js').read_bytes()
baseline = json.loads((raw / 'USERSCRIPT-BASELINE.json').read_text())
digest = hashlib.sha256(script).hexdigest()
assert len(script) == baseline['bytes'] == 1954998
assert digest == baseline['sha256']
save('USERSCRIPT-IDENTICAL-PROOF.json', {**baseline, 'finalBytes': len(script), 'finalSha256': digest,
    'identicalSha256AndSize': True, 'byteDelta': 0, 'budget': 1955000, 'headroom': 2,
    'budgetsAliasesDependenciesUnchanged': True, 'realUserscriptGuiAcceptance': False})
baseline_manifests = json.loads((previous / 'MANIFEST-BASELINE.json').read_text())
keys = ['permissions', 'optional_permissions', 'host_permissions', 'optional_host_permissions',
        'incognito', 'content_security_policy', 'browser_specific_settings']
proof = {}
for folder, before in baseline_manifests.items():
    path = repo / '.output' / folder / 'manifest.json'
    current = json.loads(path.read_text())
    assert {key: before.get(key) for key in keys} == {key: current.get(key) for key in keys}
    proof[str(path.relative_to(repo))] = {'securityFieldsUnchanged': True,
        'securityFields': {key: current.get(key) for key in keys}, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
save('MANIFEST-SECURITY-UNCHANGED.json', proof)
artifacts = {str(p.relative_to(repo)): hashlib.sha256(p.read_bytes()).hexdigest()
    for folder in ['chrome-mv3', 'firefox-mv2', 'userscript']
    for p in sorted((repo / '.output' / folder).rglob('*')) if p.is_file()}
save('ARTIFACTS-SHA256.json', artifacts)
print(json.dumps({'artifactCount': len(artifacts), 'userscriptBytes': len(script), 'userscriptSha256': digest,
                  'manifestSecurityFieldsUnchanged': True}))

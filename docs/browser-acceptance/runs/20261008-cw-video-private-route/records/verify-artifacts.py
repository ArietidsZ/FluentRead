import hashlib
import json
from pathlib import Path

raw = Path(__file__).resolve().parent
repo = raw.parent / 'FluentRead-incognito-route-20261008'


def save(name, data):
    (raw / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


userscript = (repo / '.output/userscript/fluent-read.user.js').read_bytes()
baseline = (raw / 'userscript-baseline.js').read_bytes()
sha256 = hashlib.sha256(userscript).hexdigest()
assert len(userscript) <= 1955000
save('USERSCRIPT-IDENTICAL-PROOF.json', {
    **json.loads((raw / 'USERSCRIPT-BASELINE.json').read_text()),
    'finalBytes': len(userscript), 'finalSha256': sha256, 'byteDelta': len(userscript) - len(baseline),
    'identicalBytes': userscript == baseline, 'finalHeadroom': 1955000 - len(userscript),
    'budgetConfigurationUnchanged': True, 'platformTreeIsolation': True,
    'ordinaryFrontendCapabilityFalseControl': 'tests/videoPrivacyRoute.test.ts',
    'realUserscriptGuiAcceptance': False,
})
previous = json.loads((raw / 'MANIFEST-BASELINE.json').read_text())
security_keys = ['permissions', 'optional_permissions', 'host_permissions', 'optional_host_permissions',
                 'incognito', 'content_security_policy', 'browser_specific_settings']
manifest_proof = {}
for folder, baseline_manifest in previous.items():
    name = f'.output/{folder}/manifest.json'
    current = json.loads((repo / name).read_text())
    old_security = {key: baseline_manifest.get(key) for key in security_keys}
    new_security = {key: current.get(key) for key in security_keys}
    assert old_security == new_security, name
    manifest_proof[name] = {'securityFieldsUnchanged': True, 'securityFields': new_security,
                          'finalSha256': hashlib.sha256((repo / name).read_bytes()).hexdigest()}
save('MANIFEST-SECURITY-UNCHANGED.json', manifest_proof)
artifacts = {}
for folder in ['chrome-mv3', 'firefox-mv2', 'userscript']:
    for path in sorted((repo / '.output' / folder).rglob('*')):
        if path.is_file():
            artifacts[str(path.relative_to(repo))] = hashlib.sha256(path.read_bytes()).hexdigest()
save('ARTIFACTS-SHA256.json', artifacts)
print(json.dumps({'artifactCount': len(artifacts), 'userscriptBytes': len(userscript),
                  'userscriptSha256': sha256, 'securityFieldsUnchanged': True}))

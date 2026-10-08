import hashlib, json, pathlib, subprocess, sys

raw = pathlib.Path(__file__).resolve().parent
repo = raw.parent / 'FluentRead-incognito-route-20261008'
baseline = '09814056290d5b805717851b5a0244fdc97333d6'
label = sys.argv[1] if len(sys.argv) > 1 else 'baseline-control'
names = ['src/core/config/visionProbe.ts', 'src/services/translation/visionProbe.ts',
         'src/app/background/handlers/visionProbe.ts', 'src/features/settings/ui/services/ModelVisionSettings.vue',
         'src/features/settings/ui/services/useVisionProbeStatus.ts']
working = {name: (repo / name).read_bytes() for name in names}
proof = {}
try:
    for name in names:
        original = subprocess.check_output(['git', 'show', baseline + ':' + name], cwd=repo)
        proof[name] = {'baselineSha256': hashlib.sha256(original).hexdigest(),
                       'workingSha256': hashlib.sha256(working[name]).hexdigest()}
        (repo / name).write_bytes(original)
    command = ['node', 'scripts/testing/run-resource-safe.mjs', '--', 'node', 'node_modules/vitest/vitest.mjs',
               'run', 'tests/settingsVisionPrivacyRoute.test.ts', '--no-cache', '-t',
               'actual UI refuses private mismatched|actual UI unknown hint|frontend false cannot elevate|unknown configured source cannot return|cancelled standalone publication',
               '--reporter=json', '--outputFile=' + str(raw / (label + '.results.json'))]
    result = subprocess.run(['python3', str(raw / 'run-recorded.py'), label, '--', *command], cwd=repo)
    proof['baselineExitCode'] = result.returncode
finally:
    for name, content in working.items():
        (repo / name).write_bytes(content)
        assert (repo / name).read_bytes() == content
    proof['baselineCommit'] = baseline
    proof['testSha256'] = hashlib.sha256((repo / 'tests/settingsVisionPrivacyRoute.test.ts').read_bytes()).hexdigest()
    proof['restoredBytesIdentical'] = True
    (raw / ('BASELINE-SOURCE-CONTROL-' + label + '.json')).write_text(json.dumps(proof, indent=2) + '\n')
print('Baseline control completed and all working source bytes restored.')

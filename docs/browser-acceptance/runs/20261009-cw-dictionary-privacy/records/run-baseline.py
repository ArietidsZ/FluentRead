import hashlib, json, pathlib, subprocess, sys

raw = pathlib.Path(__file__).resolve().parent
repo = raw.parent / 'FluentRead-incognito-route-20261008'
baseline = 'ed980ba087946ee6477bdeb5968166a3dca5bbfd'
label = sys.argv[1] if len(sys.argv) > 1 else 'baseline-control'
names = ['src/features/selection-translation/background/wordLookupHandler.ts', 'src/features/selection-translation/services/wordDictionary.ts', 'src/features/selection-translation/services/ecdictAsset.ts', 'src/features/selection-translation/ui/SelectionTranslator.vue', 'src/services/translation/documentChannel.ts', 'src/app/background/messageRuntime.ts']
working = {name: (repo / name).read_bytes() for name in names}
proof = {}
try:
    for name in names:
        original = subprocess.check_output(['git', 'show', baseline + ':' + name], cwd=repo)
        proof[name] = {'baselineSha256': hashlib.sha256(original).hexdigest(),
                       'workingSha256': hashlib.sha256(working[name]).hexdigest()}
        (repo / name).write_bytes(original)
    command = ['node', 'scripts/testing/run-resource-safe.mjs', '--', 'node', 'node_modules/vitest/vitest.mjs',
               'run', 'tests/wordCardPrivacyRoute.test.ts', '--no-cache', '-t',
               'actual non-model dictionary',
               '--reporter=json', '--outputFile=' + str(raw / (label + '.results.json'))]
    result = subprocess.run(['env', 'FLUENTREAD_DICTIONARY_OBSERVATIONS=' + str(raw / (label + '-observations.jsonl')), 'python3', str(raw / 'run-recorded.py'), label, '--', *command], cwd=repo)
    proof['baselineExitCode'] = result.returncode
finally:
    for name, content in working.items():
        (repo / name).write_bytes(content)
        assert (repo / name).read_bytes() == content
    proof['baselineCommit'] = baseline
    proof['testSha256'] = hashlib.sha256((repo / 'tests/wordCardPrivacyRoute.test.ts').read_bytes()).hexdigest()
    proof['restoredBytesIdentical'] = True
    (raw / ('BASELINE-SOURCE-CONTROL-' + label + '.json')).write_text(json.dumps(proof, indent=2) + '\n')
print('Baseline control completed and all working source bytes restored.')

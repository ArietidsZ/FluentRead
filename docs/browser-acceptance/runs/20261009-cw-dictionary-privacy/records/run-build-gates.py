import pathlib, subprocess, sys

raw = pathlib.Path(__file__).resolve().parent
for label in ['typecheck-final', 'chrome-build-final', 'firefox-build-final', 'manifest-verify-final',
              'userscript-build-final', 'userscript-verify-final', 'docs-build-final']:
    assert not (raw / (label + '.command.json')).exists(), label
    result = subprocess.run(['python3', str(raw / 'run-gate.py'), label], cwd=raw.parent / 'FluentRead-incognito-route-20261008')
    if result.returncode:
        sys.exit(result.returncode)
print('All type, build, manifest, userscript and documentation gates completed.')

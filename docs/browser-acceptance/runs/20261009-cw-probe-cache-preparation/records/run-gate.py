import hashlib, json, pathlib, subprocess, sys

raw = pathlib.Path(__file__).resolve().parent
repo = raw.parent / 'FluentRead-incognito-route-20261008'
previous = raw.parent / 'video-node-replacement-20261008'
label = sys.argv[1]
lookup = sys.argv[2] if len(sys.argv) > 2 else label
command = json.loads((previous / (lookup + '.command.json')).read_text())['command']
command = [part.replace(str(previous), str(raw)).replace(lookup, label) for part in command]
frozen = raw / 'FROZEN-INPUTS.json'
if frozen.exists():
    for name, expected in json.loads(frozen.read_text()).items():
        assert hashlib.sha256((repo / name).read_bytes()).hexdigest() == expected, name
result = subprocess.run(['python3', str(raw / 'run-recorded.py'), label, '--', *command], cwd=repo)
sys.exit(result.returncode)

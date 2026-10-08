import hashlib
import json
from pathlib import Path

raw = Path(__file__).resolve().parent
repo = raw.parent / 'FluentRead-incognito-route-20261008'
destination = repo / 'docs/browser-acceptance/runs/20261008-cw-video-private-route'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def save(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


command = json.loads((raw / 'docs-build-with-evidence.command.json').read_text())
assert command['exit_code'] == 0
binding = json.loads((destination / 'RAW-PUBLIC-BINDING.json').read_text())
for path in sorted(raw.glob('docs-build-with-evidence.*')):
    before = path.read_bytes()
    text = before.decode('utf-8').replace(str(raw), '<CW-EVIDENCE>').replace(str(repo), '<CW-REPO>')
    text = text.replace('<CW-DEPS>', '<CW-DEPS>')
    after = ('\n'.join(line.rstrip() for line in text.splitlines()).rstrip('\n') + '\n').encode()
    target = destination / 'records' / path.name
    target.write_bytes(after)
    binding['records'][path.name] = {'rawSha256': digest(before), 'publicSha256': digest(after),
                                   'rawBytes': len(before), 'publicBytes': len(after)}
save(destination / 'RAW-PUBLIC-BINDING.json', binding)
summary = json.loads((raw / 'SUMMARY.json').read_text())
summary['docsBuildIncludingEvidence'] = command
save(raw / 'SUMMARY.json', summary)
before = (raw / 'SUMMARY.json').read_bytes()
text = before.decode('utf-8').replace(str(raw), '<CW-EVIDENCE>').replace(str(repo), '<CW-REPO>')
text = text.replace('<CW-DEPS>', '<CW-DEPS>')
after = ('\n'.join(line.rstrip() for line in text.splitlines()).rstrip('\n') + '\n').encode()
(destination / 'records/SUMMARY.json').write_bytes(after)
binding['records']['SUMMARY.json'] = {'rawSha256': digest(before), 'publicSha256': digest(after),
                                    'rawBytes': len(before), 'publicBytes': len(after)}
save(destination / 'RAW-PUBLIC-BINDING.json', binding)
readme = destination / 'README.md'
readme.write_text(readme.read_text() + '\n证据目录加入后再次构建文档，`docs-build-with-evidence` 退出 0；源码和扩展/userscript 产物未改变。\n')
frozen = json.loads((raw / 'FROZEN-INPUTS.json').read_text())
artifacts = json.loads((raw / 'ARTIFACTS-SHA256.json').read_text())
assert all(digest((repo / n).read_bytes()) == h for n, h in frozen.items())
assert all(digest((repo / n).read_bytes()) == h for n, h in artifacts.items())
lines = [f'{digest(path.read_bytes())}  {path.relative_to(destination)}'
         for path in sorted(destination.rglob('*')) if path.is_file() and path.name != 'SHA256SUMS']
(destination / 'SHA256SUMS').write_text('\n'.join(lines) + '\n')
for name, record in binding['records'].items():
    assert digest((raw / name).read_bytes()) == record['rawSha256'], name
    assert digest((destination / 'records' / name).read_bytes()) == record['publicSha256'], name
for path in destination.rglob('*.json'):
    json.loads(path.read_text())
print(json.dumps({'evidenceFiles': len(lines) + 1, 'checksumEntries': len(lines),
                  'publicRecords': len(binding['records']), 'frozenInputs': len(frozen),
                  'artifacts': len(artifacts), 'allBindingsAndJsonVerified': True}))

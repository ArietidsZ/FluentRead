import hashlib, json, pathlib
raw=pathlib.Path(__file__).resolve().parent
repo=raw.parent/'FluentRead-incognito-route-20261008'
destination=repo/'docs/browser-acceptance/runs/20261009-cw-probe-cache-preparation'
digest=lambda value:hashlib.sha256(value).hexdigest()
binding=json.loads((destination/'RAW-PUBLIC-BINDING.json').read_text())
for name in ['docs-build-with-evidence.command.json','docs-build-with-evidence.log', 'EXECUTION-APPROVAL-OBSERVATIONS.json', 'remote-pre-push.command.json', 'remote-pre-push.log']:
    path=raw/name;before=path.read_bytes();text=before.decode().replace(str(raw),'<CW-EVIDENCE>').replace(str(repo),'<CW-REPO>').replace('<CW-DEPS>','<CW-DEPS>')
    after=('\n'.join(line.rstrip() for line in text.splitlines()).rstrip('\n')+'\n').encode()
    (destination/'records'/name).write_bytes(after)
    binding['records'][name]={'rawSha256':digest(before),'publicSha256':digest(after),'rawBytes':len(before),'publicBytes':len(after)}
assert json.loads((raw/'docs-build-with-evidence.command.json').read_text())['exitCode']==0
(destination/'RAW-PUBLIC-BINDING.json').write_text(json.dumps(binding,ensure_ascii=False,indent=2)+'\n')
readme=destination/'README.md';readme.write_text(readme.read_text()+'\n证据目录加入后再次构建文档，`docs-build-with-evidence` 退出 0；源码及扩展/油猴产物未改变。\n')
(destination/'SHA256SUMS').write_text('\n'.join(f'{digest(p.read_bytes())}  {p.relative_to(destination)}' for p in sorted(destination.rglob('*')) if p.is_file() and p.name!='SHA256SUMS')+'\n')
for name,expected in json.loads((raw/'FROZEN-INPUTS.json').read_text()).items():assert digest((repo/name).read_bytes())==expected
for name,expected in json.loads((raw/'ARTIFACTS-SHA256.json').read_text()).items():assert digest((repo/name).read_bytes())==expected
print(json.dumps({'publicRecords':len(binding['records']),'archiveShaEntries':len((destination/'SHA256SUMS').read_text().splitlines()),'sourceAndArtifactsUnchanged':True}))

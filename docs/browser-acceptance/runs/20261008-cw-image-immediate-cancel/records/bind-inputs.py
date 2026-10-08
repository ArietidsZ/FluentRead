import hashlib, json, pathlib, subprocess
root=pathlib.Path.cwd()
raw=pathlib.Path(__file__).resolve().parent
read=lambda p: json.loads(p.read_text())
digest=lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
frozen=read(raw/'FINAL-INPUTS.json')
paths=sorted(p for p in subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z']).decode().split('\0') if p and not p.startswith('docs/browser-acceptance/runs/'))
assert paths==[p['path'] for p in frozen['files']], 'input paths changed'
changed=[p['path'] for p in frozen['files'] if digest(root/p['path'])!=p['sha256']]
assert not changed, changed
artifacts={str(p.relative_to(root)):digest(p) for target in ['chrome-mv3','firefox-mv2','userscript'] for p in sorted((root/'.output'/target).rglob('*')) if p.is_file()}
(raw/'ARTIFACT-SHA256.json').write_text(json.dumps(artifacts,indent=2)+'\n')
baseline=read(root/'docs/browser-acceptance/runs/20261008-cw-reader-private-route/records/PERMISSIONS-COMPARISON.json')
comparison={'baseline_commit':baseline['baseline_commit'],'prior_application_source':'1fb8c69773df0de8fd35ddf723d7c995ed760731','targets':{}}
for target in ['chrome-mv3','firefox-mv2']:
 manifest=read(root/'.output'/target/'manifest.json')
 comparison['targets'][target]={k:{'baseline':v['current'],'current':manifest.get(k),'equal':v['current']==manifest.get(k)} for k,v in baseline['targets'][target].items() if k in ['permissions','optional_permissions','host_permissions','optional_host_permissions','incognito']}
 assert all(x['equal'] for x in comparison['targets'][target].values()), comparison
 comparison['targets'][target]['manifest_sha256']=digest(root/'.output'/target/'manifest.json')
 comparison['targets'][target]['manifest_version']=manifest['manifest_version']
 if target=='firefox-mv2': comparison['firefox_minimum']=manifest['browser_specific_settings']['gecko']['strict_min_version'];assert comparison['firefox_minimum']=='140.0'
 else: comparison['chrome_effective_incognito']=manifest.get('incognito','spanning');assert comparison['chrome_effective_incognito']=='spanning'
(raw/'PERMISSIONS-COMPARISON.json').write_text(json.dumps(comparison,ensure_ascii=False,indent=2)+'\n')
script=root/'.output/userscript/fluent-read.user.js';prior=read(root/'docs/browser-acceptance/runs/20261008-cw-reader-private-route/records/ARTIFACT-SHA256.json')
result={'input_files':len(paths),'unchanged_frozen_inputs':True,'input_manifest_sha256':digest(raw/'FINAL-INPUTS.json'),'artifacts':len(artifacts),'artifact_manifest_sha256':digest(raw/'ARTIFACT-SHA256.json'),'userscript_bytes':script.stat().st_size,'userscript_budget':1955000,'userscript_sha256':digest(script),'userscript_identical_to_866a1258_baseline':digest(script)==prior['.output/userscript/fluent-read.user.js'],'permissions_match':True,'firefox_minimum':comparison['firefox_minimum'],'chrome_effective_incognito':comparison['chrome_effective_incognito']}
assert result['userscript_bytes']<=result['userscript_budget']
(raw/'FINAL-BINDING.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False,indent=2))

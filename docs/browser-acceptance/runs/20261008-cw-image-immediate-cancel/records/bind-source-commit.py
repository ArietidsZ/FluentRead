import hashlib,json,pathlib,subprocess
root=pathlib.Path.cwd();raw=pathlib.Path(__file__).resolve().parent
r=json.loads((raw/'FINAL-INPUTS.json').read_text());commit=subprocess.check_output(['git','rev-parse','HEAD']).decode().strip();tree=subprocess.check_output(['git','rev-parse','HEAD^{tree}']).decode().strip()
paths=sorted(p for p in subprocess.check_output(['git','ls-tree','-r','--name-only','-z','HEAD']).decode().split('\0') if p and not p.startswith('docs/browser-acceptance/runs/'))
assert paths==[x['path'] for x in r['files']], 'committed input paths mismatch'
for x in r['files']:
 data=subprocess.check_output(['git','show',f"HEAD:{x['path']}"])
 assert hashlib.sha256(data).hexdigest()==x['sha256'], x['path']
changed=subprocess.check_output(['git','diff','--name-only',r['base_head'],'HEAD']).decode().splitlines()
assert all(not p.startswith('docs/browser-acceptance/runs/') for p in changed), 'historical evidence changed'
binding=json.loads((raw/'FINAL-BINDING.json').read_text());out={'source_commit':commit,'source_tree':tree,'base_head':r['base_head'],'accepted_base_application':'1fb8c69773df0de8fd35ddf723d7c995ed760731','input_scope':r['scope'],'input_files':len(paths),'all_git_blob_sha256_match_frozen_inputs':True,'historical_evidence_unchanged':True,'changed_source_paths':changed,'frozen_inputs_sha256':hashlib.sha256((raw/'FINAL-INPUTS.json').read_bytes()).hexdigest(),'artifact_manifest_sha256':binding['artifact_manifest_sha256']}
(raw/'SOURCE-COMMIT.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(json.dumps(out,ensure_ascii=False,indent=2))

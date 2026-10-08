import hashlib,json,pathlib,subprocess
raw=pathlib.Path(__file__).resolve().parent;repo=raw.parent/'FluentRead-incognito-route-20261008'
name='src/features/selection-translation/ui/SelectionTranslator.vue';working=(repo/name).read_bytes()
baseline=subprocess.check_output(['git','show',f'HEAD:{name}'],cwd=repo)
pattern='enriches actual|effective frontend pair before ordinary|actual save/subscriber|cancels both'
(raw/'BASELINE-SOURCE-CONTROL.json').write_text(json.dumps({'baselineHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo).decode().strip(),'module':name,'baselineSha256':hashlib.sha256(baseline).hexdigest(),'workingSha256':hashlib.sha256(working).hexdigest(),'selectedPattern':pattern,'onlySfcRestored':True},indent=2)+'\n')
try:
 (repo/name).write_bytes(baseline)
 command=['node','scripts/testing/run-resource-safe.mjs','--','node','node_modules/vitest/vitest.mjs','run','tests/wordCardPrivacyRoute.test.ts','--no-cache','-t',pattern,'--reporter=json',f'--outputFile={raw}/word-card-baseline-red.results.json']
 result=subprocess.run(['python3',str(raw/'run-recorded.py'),'word-card-baseline-red',str(repo),*command],cwd=repo)
 print('Baseline exit',result.returncode)
finally:
 (repo/name).write_bytes(working)
 assert (repo/name).read_bytes()==working
 print('SFC restored byte-for-byte')

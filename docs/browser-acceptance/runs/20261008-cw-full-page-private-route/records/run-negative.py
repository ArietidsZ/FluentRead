import hashlib,json,pathlib,subprocess
raw=pathlib.Path(__file__).resolve().parent;repo=raw.parent/'FluentRead-incognito-route-20261008'
files=['src/app/content/runtime.ts','src/app/document-translation/runtime.ts','src/features/full-page-translation/content/runtime.ts','src/features/full-page-translation/content/translationRequest.ts','src/services/translation/requestPrivacy.ts','userscript/incognitoRoute.ts']
working={name:(repo/name).read_bytes() for name in files};record={}
for name,data in working.items():
 p=raw/'working-source'/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
 baseline=subprocess.check_output(['git','show',f'HEAD:{name}'],cwd=repo)
 record[name]={'baselineGitBlob':subprocess.check_output(['git','rev-parse',f'HEAD:{name}'],cwd=repo).decode().strip(),'baselineSha256':hashlib.sha256(baseline).hexdigest(),'workingSha256':hashlib.sha256(data).hexdigest()}
(raw/'BASELINE-SOURCE-CONTROL.json').write_text(json.dumps({'baselineHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo).decode().strip(),'files':record,'selectedPattern':'before ordinary missing-model|prompt/context|before ordinary Microsoft|dedicated machine route|actual save/subscriber|title and body|route ends old generation'},indent=2)+'\n')
try:
 for name in files:(repo/name).write_bytes(subprocess.check_output(['git','show',f'HEAD:{name}'],cwd=repo))
 command=['node','scripts/testing/run-resource-safe.mjs','--','node','node_modules/vitest/vitest.mjs','run','tests/fullPagePrivacyRoute.test.ts','--no-cache','-t','before ordinary missing-model|prompt/context|before ordinary Microsoft|dedicated machine route|actual save/subscriber|title and body|route ends old generation','--reporter=json',f'--outputFile={raw}/full-page-baseline-red-browser-final.results.json']
 result=subprocess.run(['python3',str(raw/'run-recorded.py'),'full-page-baseline-red-browser-final',str(repo),*command],cwd=repo)
 print('Baseline control exit',result.returncode)
finally:
 for name,data in working.items():(repo/name).write_bytes(data)
 for name,data in working.items():assert (repo/name).read_bytes()==data,name
 print('All six source files restored byte-for-byte.')

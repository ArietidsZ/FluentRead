import json,pathlib,subprocess,sys
root=pathlib.Path(__file__).resolve().parent
worktree=root.parent/'FluentRead-quality-integration'
files=list(dict.fromkeys(f for v in json.loads((root/'group-suites.json').read_text()).values() for f in v))
stages=[
 ('integration-targets',['node','scripts/testing/run-resource-safe.mjs','--','node','node_modules/vitest/vitest.mjs','run',*files,'--reporter=default','--reporter=json','--outputFile='+str(root/'integration-targets.results.json'),'--no-cache']),
 ('integration-typecheck',['node','scripts/testing/run-resource-safe.mjs','--','node','node_modules/vue-tsc/bin/vue-tsc.js','--noEmit']),
 ('integration-audit',['node','scripts/testing/audit-test-suite.mjs']),
 ('integration-diffcheck',['git','diff','--check','83deca40091415666fc8fe5a45579b6b80487dcb','HEAD']),
 ('integration-full-strict',['node','scripts/testing/run-resource-safe.mjs','--','node','node_modules/vitest/vitest.mjs','run','--coverage','--config','vitest.coverage.config.ts','--coverage.reportsDirectory='+str(root/'integration-full-strict-coverage'),'--coverage.reporter=json-summary','--coverage.reporter=text','--reporter=default','--reporter=json','--outputFile='+str(root/'integration-full-strict.results.json'),'--no-cache']),
]
for label,args in stages:
    subprocess.run([sys.executable,str(root/'run-recorded.py'),label,str(worktree),*args])
print('INTEGRATION_CHECKS_COMPLETE',flush=True)

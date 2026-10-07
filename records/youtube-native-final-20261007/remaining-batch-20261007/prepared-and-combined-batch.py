import json,pathlib,subprocess,sys
root=pathlib.Path(__file__).resolve().parent
pure=pathlib.Path(sys.argv[1]).resolve()
combo=pathlib.Path(sys.argv[2]).resolve()
def recorded(label,cwd,args):
    return subprocess.run([sys.executable,str(root/'run-recorded.py'),label,str(cwd),*args]).returncode
matrix=json.loads((pure/'tests/test-matrix.json').read_text())
for group in ['unit','functional','regression']:
    recorded('group-'+group+'-pure-prepared',pure,['node','scripts/testing/run-resource-safe.mjs','--','node','node_modules/vitest/vitest.mjs','run',*matrix['groups'][group],'--reporter=default','--reporter=json','--outputFile='+str(root/('group-'+group+'-pure-prepared.results.json')),'--no-cache'])
stages=[
 ('prepare-combined',['node','scripts/testing/run-resource-safe.mjs','--','node','node_modules/wxt/bin/wxt.mjs','prepare']),
 ('compile-combined',['node','scripts/testing/run-resource-safe.mjs','--','node','node_modules/vue-tsc/bin/vue-tsc.js','--noEmit']),
 ('metadata-contract-combined',['node','scripts/testing/run-resource-safe.mjs','--','node','node_modules/vitest/vitest.mjs','run','tests/extensionManifestContract.test.ts','--no-cache']),
 ('chrome-build-combined',['node','scripts/testing/run-resource-safe.mjs','--','node','node_modules/wxt/bin/wxt.mjs','build']),
 ('firefox-build-combined',['node','scripts/testing/run-resource-safe.mjs','--','node','node_modules/wxt/bin/wxt.mjs','build','-b','firefox']),
 ('firefox-zip-combined',['node','scripts/testing/run-resource-safe.mjs','--','node','node_modules/wxt/bin/wxt.mjs','zip','-b','firefox']),
 ('extension-manifests-combined',['node','scripts/testing/verify-extension-manifests.mjs','--require-firefox-archives']),
]
for label,args in stages:recorded(label,combo,args)
print('PREPARED_AND_COMBINED_BATCH_COMPLETE',flush=True)

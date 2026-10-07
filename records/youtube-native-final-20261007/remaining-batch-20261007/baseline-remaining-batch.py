import json,pathlib,subprocess,sys
root=pathlib.Path(__file__).resolve().parent
base=pathlib.Path(sys.argv[1]).resolve()
matrix=json.loads((base/'tests/test-matrix.json').read_text())
def recorded(label,args):
    return subprocess.run([sys.executable,str(root/'run-recorded.py'),label,str(base),*args]).returncode
for group in ['unit','functional','regression']:
    recorded('group-'+group+'-baseline',['node','scripts/testing/run-resource-safe.mjs','--','node','node_modules/vitest/vitest.mjs','run',*matrix['groups'][group],'--reporter=default','--reporter=json','--outputFile='+str(root/('group-'+group+'-baseline.results.json')),'--no-cache'])
for label,args in [
 ('prepare-baseline',['node','scripts/testing/run-resource-safe.mjs','--','node','node_modules/wxt/bin/wxt.mjs','prepare']),
 ('chrome-build-baseline',['node','scripts/testing/run-resource-safe.mjs','--','node','node_modules/wxt/bin/wxt.mjs','build']),
 ('firefox-build-baseline',['node','scripts/testing/run-resource-safe.mjs','--','node','node_modules/wxt/bin/wxt.mjs','build','-b','firefox']),
 ('docs-build-baseline',['node','scripts/testing/run-resource-safe.mjs','--','node','node_modules/vitepress/bin/vitepress.js','build','docs']),
 ('docs-verifier-baseline',['node','scripts/verify-docs-build.mjs']),
]: recorded(label,args)
print('BASELINE_REMAINING_BATCH_COMPLETE',flush=True)

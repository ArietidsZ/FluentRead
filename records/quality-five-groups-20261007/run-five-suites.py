import json,pathlib,subprocess,sys
root=pathlib.Path(__file__).resolve().parent
for group,files in json.loads((root/'group-suites.json').read_text()).items():
    worktree=root.parent/('FluentRead-quality-'+group)
    args=['node','scripts/testing/run-resource-safe.mjs','--','node','node_modules/vitest/vitest.mjs','run',*files,'--reporter=default','--reporter=json','--outputFile='+str(root/('group-'+group+'.results.json')),'--no-cache']
    subprocess.run([sys.executable,str(root/'run-recorded.py'),'group-'+group,str(worktree),*args])
print('FIVE_SUITES_COMPLETE',flush=True)

import json,pathlib,subprocess,sys
raw=pathlib.Path(__file__).resolve().parent
root=pathlib.Path(sys.argv[1]);record=str(raw/'run-recorded.py')
def run(label,args):
 result=subprocess.run([sys.executable,record,label,str(root),*args]);
 if result.returncode:sys.exit(result.returncode)
run('audit-final',['node','scripts/testing/audit-test-suite.mjs'])
files=json.loads((root/'tests/test-matrix.json').read_text())['groups']['architecture']
run('architecture-final',['node','scripts/testing/run-resource-safe.mjs','--','node','node_modules/vitest/vitest.mjs','run',*files,'--no-cache','--reporter=json','--outputFile='+str(raw/'architecture-final.results.json')])
run('full-coverage-final',['node','scripts/testing/run-resource-safe.mjs','--','node','node_modules/vitest/vitest.mjs','run','--config','vitest.coverage.config.ts','--no-cache','--reporter=json','--outputFile='+str(raw/'full-coverage-final.results.json'),'--coverage.reporter=json','--coverage.reporter=json-summary','--coverage.reportsDirectory='+str(raw/'full-coverage-final')])

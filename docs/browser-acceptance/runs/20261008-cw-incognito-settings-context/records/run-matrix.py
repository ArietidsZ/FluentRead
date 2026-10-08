import json,pathlib,subprocess,sys
root=pathlib.Path(__file__).resolve().parent
cwd=sys.argv[1]
files=json.loads((pathlib.Path(cwd)/'tests/test-matrix.json').read_text())['groups']['architecture']
cmd=['node','scripts/testing/run-resource-safe.mjs','--','node','node_modules/vitest/vitest.mjs','run','--cache','false',*files]
sys.exit(subprocess.call([sys.executable,str(root/'run-recorded.py'),'architecture-final',cwd,*cmd]))

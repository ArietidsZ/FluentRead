import pathlib,subprocess,sys
raw=pathlib.Path(__file__).resolve().parent;root=sys.argv[1];record=str(raw/'run-recorded.py')
def run(label,args):
 result=subprocess.run([sys.executable,record,label,root,*args]);
 if result.returncode:sys.exit(result.returncode)
base=['node','scripts/testing/run-resource-safe.mjs','--']
run('build-chrome',base+['node_modules/.bin/wxt','build'])
run('build-firefox',base+['node_modules/.bin/wxt','build','-b','firefox'])
run('build-userscript',base+['node_modules/.bin/vite','build','--config','userscript/vite.config.ts'])
run('verify-extension-manifests',['node','scripts/testing/verify-extension-manifests.mjs'])
run('verify-userscript',['node','scripts/verify-userscript-build.mjs'])
run('docs-source-build',base+['node_modules/.bin/vitepress','build','docs'])

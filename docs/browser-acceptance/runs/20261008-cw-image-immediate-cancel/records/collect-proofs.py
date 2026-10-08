import hashlib,json,pathlib,subprocess,difflib
root=pathlib.Path.cwd();raw=pathlib.Path(__file__).resolve().parent
read=lambda p:json.loads(p.read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
write=lambda name,value:(raw/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
base=read(raw/'FINAL-INPUTS.json')['base_head']
listed=set((raw/'typecheck-list.stdout.txt').read_text().splitlines());scope={'tsconfig_changed':False,'archive_exclusion':'existing docs/browser-acceptance/runs/** only','archive_inputs_in_compiler':[p for p in listed if '/docs/browser-acceptance/runs/' in p],'roots':{}}
assert not subprocess.check_output(['git','diff',base,'--','tsconfig.json']).strip()
paths=[p for p in subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z']).decode().split('\0') if p]
for folder in ['src','tests','entrypoints']:
 items=[p for p in paths if p.startswith(folder+'/') and p.endswith(('.ts','.vue'))];missing=[p for p in items if str(root/p) not in listed]
 scope['roots'][folder]={'files':len(items),'missing':missing};assert not missing,missing
assert not scope['archive_inputs_in_compiler'];write('TYPECHECK-SCOPE-PROOF.json',scope)
files=['src/app/background/imageGlossaryContext.ts','src/app/background/areaRuntime.ts','src/features/image-translation/content/runtime.ts','src/features/image-translation/background/documentSession.ts','src/features/image-translation/documentChannel.ts','src/features/image-translation/background/handlers.ts','src/platform/browser/incognitoSource.ts','src/services/translation/broker.ts','src/services/translation/requestScheduler.ts','src/services/translation/requestRegistry.ts','src/services/config/store.ts','src/core/config/model.ts','src/core/translation/prompts.ts','package.json','pnpm-lock.yaml','wxt.config.ts','userscript/vite.config.ts','scripts/verify-userscript-build.mjs','tsconfig.json']
contracts={}
for p in files:
 before=subprocess.check_output(['git','show',base+':'+p]);assert before==(root/p).read_bytes(),p
 contracts[p]={'sha256':sha(root/p),'unchanged_from':base}
write('UNCHANGED-CONTRACTS.json',contracts)
print(json.dumps({'type_roots':scope['roots'],'unchanged_contracts':len(contracts)},ensure_ascii=False))

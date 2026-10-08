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
files=['src/app/background/areaRuntime.ts','src/features/image-translation/content/runtime.ts','src/features/image-translation/background/documentSession.ts','src/features/image-translation/documentChannel.ts','src/features/image-translation/background/handlers.ts','src/platform/browser/incognitoSource.ts','src/services/translation/broker.ts','src/services/translation/requestScheduler.ts','src/services/translation/requestRegistry.ts','src/services/config/store.ts','src/core/config/model.ts','src/core/translation/prompts.ts','package.json','pnpm-lock.yaml','wxt.config.ts','userscript/vite.config.ts','scripts/verify-userscript-build.mjs','tsconfig.json']
contracts={}
for p in files:
 before=subprocess.check_output(['git','show',base+':'+p]);assert before==(root/p).read_bytes(),p
 contracts[p]={'sha256':sha(root/p),'unchanged_from':base}
write('UNCHANGED-CONTRACTS.json',contracts)
diagnostic=read(raw/'branches-final-diagnostic/coverage-final.json');prior=pathlib.Path('<CW_TASK>/image-private-route-20261008/targeted-coverage-final/coverage-final.json')
prior_data=read(prior);branches={}
for name,v in diagnostic.items():
 relative=name.split(str(root)+'/')[-1]
 if not relative.endswith(('areaRuntime.ts','content/runtime.ts')):continue
 before=subprocess.check_output(['git','show','20e10b095e1b37bea62ac02e6d2a1aafadc34131:'+relative]).decode().splitlines();after=(root/relative).read_text().splitlines()
 added=set()
 for tag,a,b,c,d in difflib.SequenceMatcher(None,before,after,autojunk=False).get_opcodes():
  if tag in ['insert','replace']:added.update(range(c+1,d+1))
 old=next((x for p,x in prior_data.items() if p.endswith('/'+relative)),None)
 rows=[]
 for k,m in v['branchMap'].items():
  line=m['loc']['start']['line']
  if line in added:
   old_rows=[] if old is None else [{'location':loc['loc'],'counts':old['b'][i]} for i,loc in old['branchMap'].items() if loc['loc']['start']['line']==line]
   rows.append({'id':k,'location':m['loc'],'counts':v['b'][k],'prior_diagnostic_same_line':old_rows})
 assert all(all(n>0 for n in row['counts']) for row in rows),rows
 branches[relative]={'added_lines_against_pre_image_source':sorted(added),'new_branch_location_start_records':rows,'all_recorded_added_start_branches_visited':True}
write('NEW-BRANCH-PROOF.json',{'correction':'Prior three-module diagnostic included new area/content branches. Earlier attribution of all omissions to pre-existing branches was incorrect; historical records are preserved.','prior_record':'20261008-cw-image-private-route/records/targeted-coverage-final/coverage-final.json','prior_raw_sha256':sha(prior),'current_diagnostic_exit_code':read(raw/'branches-final-diagnostic.command.json')['exit_code'],'current_diagnostic_thresholds':'original 100% unchanged; exit 1 for unowned whole-module gaps, not an acceptance pass','current_modules':read(raw/'branches-final-diagnostic/coverage-summary.json'),'new_branch_evidence':branches})
assert read(raw/'branches-final-diagnostic.command.json')['exit_code']==1
assert read(raw/'branches-final-diagnostic.results.json')['success']
assert all(read(raw/'strict-targeted-final/coverage-summary.json')['total'][m]['pct']==100 for m in ['statements','lines','functions','branches'])
print(json.dumps({'type_roots':scope['roots'],'new_branch_counts':{p:len(v['new_branch_location_start_records']) for p,v in branches.items()}},ensure_ascii=False))

import pathlib,subprocess,sys,json,hashlib,difflib
root=pathlib.Path(__file__).resolve().parent
cases=[
 ('stats-separator','stats-i18n','src/features/settings/model/navigation.ts',"' + ' · ' + '","' + '",['tests/translationStatsI18n.test.ts'],None),
 ('harness-selection-gate','harness-contracts','src/features/selection-translation/content/runtime.ts',"(config.disableSelectionTranslator || config.selectionTranslatorMode === 'disabled')",'false',['tests/contentFeatureMounting.test.ts'],'划词关闭时'),
 ('harness-range-session','harness-contracts','src/features/selection-translation/content/runtime.ts','        if (requestId !== mountRequestId) return;','        // negative control: stale range callback allowed',['tests/contentFeatureMounting.test.ts'],'Harness 共享实例'),
 ('glossary-protected-origin-and-drain','glossary-fixture','tests/imageGlossaryContext.test.ts',"expect(started).toEqual([protectedApi, 'other', 'third']);","expect(started).toEqual(['API', 'other', 'third']);",['tests/imageGlossaryContext.test.ts'],'重复OCR文本'),
 ('ime-composition','ime-loader','src/features/settings/ui/services/PromptTemplateEditor.vue','if ((event as InputEvent).isComposing === true)','if (false)', ['tests/settingsCompositionAutosave.test.ts'],'原生提示词'),
 ('ime-external-value-sync','ime-loader','src/features/settings/ui/services/PromptTemplateEditor.vue','if (!isComposing.value) lastEmittedValue.value = value','if (false) lastEmittedValue.value = value',['tests/settingsCompositionAutosave.test.ts'],'外部 modelValue'),
 ('page-read-listener-cleanup','page-read-fixture','src/features/image-translation/content/sourceAuthorization.ts','const cleanup = () => browser.runtime.onMessage.removeListener(listener);','const cleanup = () => {};',['tests/imageTranslationPageRead.test.ts'],'页面 CORS 被拒绝'),
]
records=[]
for label,group,filename,old,new,files,pattern in cases:
    worktree=root.parent/('FluentRead-quality-'+group)
    file=worktree/filename;original=file.read_text();assert old in original,label
    mutated=original.replace(old,new)
    if label=='ime-composition':mutated=mutated.replace('if (isComposing.value) {','if (false) {')
    (root/(label+'.mutation.patch')).write_text(''.join(difflib.unified_diff(original.splitlines(True),mutated.splitlines(True),fromfile=filename,tofile=filename)))
    try:
        file.write_text(mutated)
        command=['node','scripts/testing/run-resource-safe.mjs','--','node','node_modules/vitest/vitest.mjs','run',*files,'--reporter=default','--reporter=json','--outputFile='+str(root/('negative-'+label+'.results.json')),'--no-cache']
        if pattern:command += ['--testNamePattern',pattern]
        result=subprocess.run([sys.executable,str(root/'run-recorded.py'),'negative-'+label,str(worktree),*command])
        assert result.returncode==1, (label,'negative control did not fail',result.returncode)
        report=json.loads((root/('negative-'+label+'.results.json')).read_text())
        assert report['numFailedTests']>0,label
        assert 'Unhandled Errors' not in (root/('negative-'+label+'.stdout.txt')).read_text(),label
        records.append({'label':label,'group':group,'file':filename,'expected_exit_code':1,'actual_exit_code':result.returncode,'failed_tests':report['numFailedTests'],'unhandled_errors':0,'original_sha256':hashlib.sha256(original.encode()).hexdigest(),'mutated_sha256':hashlib.sha256(mutated.encode()).hexdigest(),'restored':True})
    finally:
        file.write_text(original)
        assert file.read_text()==original
(root/'negative-controls.json').write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n')
for group,files in [('stats-i18n',['tests/translationStatsI18n.test.ts']),('harness-contracts',['tests/contentFeatureMounting.test.ts','tests/harnessConversation.test.ts'])]:
    worktree=root.parent/('FluentRead-quality-'+group)
    result=subprocess.run([sys.executable,str(root/'run-recorded.py'),'restored-'+group,str(worktree),'node','scripts/testing/run-resource-safe.mjs','--','node','node_modules/vitest/vitest.mjs','run',*files,'--no-cache'])
    assert result.returncode==0,group
print('SEVEN_NEGATIVE_CONTROLS_AND_RESTORATIONS_COMPLETE',flush=True)

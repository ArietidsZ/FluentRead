import os,pathlib,subprocess,json
raw=pathlib.Path(__file__).resolve().parent
paths=['src/app/background/imageGlossaryContext.ts','src/features/image-translation/background/operationRegistry.ts','tests/imagePreparationCancellation.test.ts','tests/imagePrivacyRoute.test.ts','tests/imageTranslationRuntime.test.ts','tests/test-matrix.json','vitest.coverage.config.ts','docs/testing.md','docs/architecture.md','docs/incognito-route-first-batch.md']
assert subprocess.check_output(['git','rev-parse','HEAD']).decode().strip()=='f6b37c924cc49649fb87c1fdaaf83c53066ace11'
for label in ['full-coverage-final','architecture-final','preparation-strict-final','typecheck-complete','typecheck-list','final-build-chrome','final-build-firefox','final-build-userscript','final-verify-extension-manifests','final-verify-userscript','final-docs-source-build','audit-final','bindings-complete','proofs-complete']:
 assert json.loads((raw/(label+'.command.json')).read_text())['exit_code']==0,label
changed=subprocess.check_output(['git','diff','--name-only']).decode().splitlines();assert sorted(changed)==sorted(p for p in paths if p!='tests/imagePreparationCancellation.test.ts'),changed
new=subprocess.check_output(['git','ls-files','--others','--exclude-standard']).decode().splitlines();assert new==['tests/imagePreparationCancellation.test.ts'],new
subprocess.run(['git','diff','--check'],check=True);subprocess.run(['git','add','--',*paths],check=True);subprocess.run(['git','diff','--cached','--check'],check=True)
env={**os.environ,'GIT_AUTHOR_NAME':'Arietids','GIT_AUTHOR_EMAIL':'69024461+ArietidsZ@users.noreply.github.com','GIT_COMMITTER_NAME':'Arietids','GIT_COMMITTER_EMAIL':'69024461+ArietidsZ@users.noreply.github.com'}
subprocess.run(['git','-c','commit.gpgsign=false','commit','-m','fix(image): cancel ready and source preparation before dispatch'],env=env,check=True)
subprocess.run(['git','show','--stat','--oneline','HEAD'],check=True)

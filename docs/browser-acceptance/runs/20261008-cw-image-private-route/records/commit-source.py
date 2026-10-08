import os,pathlib,subprocess,json
raw=pathlib.Path(__file__).resolve().parent
paths=['src/app/background/areaRuntime.ts','src/app/background/imageGlossaryContext.ts','src/features/image-translation/content/runtime.ts','tests/imagePrivacyRoute.test.ts','tests/imageTransactionIdentity.test.ts','tests/imageTranslationRuntime.test.ts','tests/test-matrix.json','vitest.coverage.config.ts','docs/testing.md','docs/architecture.md','docs/incognito-route-first-batch.md']
assert subprocess.check_output(['git','rev-parse','HEAD']).decode().strip()=='20e10b095e1b37bea62ac02e6d2a1aafadc34131'
for label in ['full-coverage-final','architecture-final','image-route-complete','typecheck-complete','final-build-chrome','final-build-firefox','final-build-userscript','final-verify-extension-manifests','final-verify-userscript','audit-final']:
 assert json.loads((raw/(label+'.command.json')).read_text())['exit_code']==0,label
changed=subprocess.check_output(['git','diff','--name-only']).decode().splitlines();assert sorted(changed)==sorted(p for p in paths if p!='tests/imagePrivacyRoute.test.ts')
new=subprocess.check_output(['git','ls-files','--others','--exclude-standard']).decode().splitlines();assert new==['tests/imagePrivacyRoute.test.ts'],new
subprocess.run(['git','diff','--check'],check=True);subprocess.run(['git','add','--',*paths],check=True);subprocess.run(['git','diff','--cached','--check'],check=True)
env={**os.environ,'GIT_AUTHOR_NAME':'Arietids','GIT_AUTHOR_EMAIL':'69024461+ArietidsZ@users.noreply.github.com','GIT_COMMITTER_NAME':'Arietids','GIT_COMMITTER_EMAIL':'69024461+ArietidsZ@users.noreply.github.com'}
subprocess.run(['git','-c','commit.gpgsign=false','commit','-m','fix(image): freeze native private route across OCR translation and caches'],env=env,check=True)
subprocess.run(['git','show','--stat','--oneline','HEAD'],check=True)

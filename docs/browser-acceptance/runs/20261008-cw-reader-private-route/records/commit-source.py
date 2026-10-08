import os,pathlib,subprocess
root=pathlib.Path.cwd()
paths=['src/app/background/harnessRuntime.ts','src/features/reading-assistant/background.ts','src/services/harness/runtime.ts','tests/harnessPrivacyRoute.test.ts','tests/harnessAppRuntime.test.ts','tests/test-matrix.json','vitest.coverage.config.ts','docs/testing.md','docs/architecture.md','docs/incognito-route-first-batch.md']
assert subprocess.check_output(['git','rev-parse','HEAD']).decode().strip()=='fc99d1fa8b4c3cb143f2c53bc51527a3802f6ed2'
changed=subprocess.check_output(['git','diff','--name-only']).decode().splitlines();assert all(p in paths for p in changed)
new=subprocess.check_output(['git','ls-files','--others','--exclude-standard']).decode().splitlines();assert new==['tests/harnessPrivacyRoute.test.ts'],new
subprocess.run(['git','diff','--check'],check=True)
subprocess.run(['git','add','--',*paths],check=True)
subprocess.run(['git','diff','--cached','--check'],check=True)
env={**os.environ,'GIT_AUTHOR_NAME':'Arietids','GIT_AUTHOR_EMAIL':'69024461+ArietidsZ@users.noreply.github.com','GIT_COMMITTER_NAME':'Arietids','GIT_COMMITTER_EMAIL':'69024461+ArietidsZ@users.noreply.github.com'}
subprocess.run(['git','-c','commit.gpgsign=false','commit','-m','fix(reading): bind private model route to native source and saved configuration'],env=env,check=True)
subprocess.run(['git','show','--stat','--oneline','HEAD'],check=True)

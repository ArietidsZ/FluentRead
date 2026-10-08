import os,pathlib,subprocess
root=pathlib.Path.cwd()
paths=['src/app/background/writingRuntime.ts','tests/writingSavedConfig.test.ts','tests/test-matrix.json','vitest.coverage.config.ts','docs/testing.md']
assert subprocess.check_output(['git','rev-parse','HEAD']).decode().strip()=='99d982b8539c76b2d50aeb10ee29f8abbc9c7677'
changed=subprocess.check_output(['git','diff','--name-only']).decode().splitlines()
assert all(p in paths for p in changed)
new=subprocess.check_output(['git','ls-files','--others','--exclude-standard']).decode().splitlines()
assert new==['tests/writingSavedConfig.test.ts'],new
subprocess.run(['git','diff','--check'],check=True)
subprocess.run(['git','add','--',*paths],check=True)
subprocess.run(['git','diff','--cached','--check'],check=True)
env={**os.environ,'GIT_AUTHOR_NAME':'Arietids','GIT_AUTHOR_EMAIL':'69024461+ArietidsZ@users.noreply.github.com','GIT_COMMITTER_NAME':'Arietids','GIT_COMMITTER_EMAIL':'69024461+ArietidsZ@users.noreply.github.com'}
subprocess.run(['git','-c','commit.gpgsign=false','commit','-m','fix(writing): cancel on saved credential and recovery policy changes'],env=env,check=True)
subprocess.run(['git','show','--stat','--oneline','HEAD'],check=True)

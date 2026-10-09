from pathlib import Path
import os,sys,json,subprocess,datetime,time
r=Path(sys.argv[1]);e=Path(__file__).resolve().parent;name=sys.argv[2];args=sys.argv[3:];pnpm='/tmp/fluentread-pnpm9-20261009-7fk3rsxw/package/bin/pnpm.cjs';env={**os.environ,'PATH':'/tmp/fluentread-906-pnpm-bin:'+os.environ['PATH']};start=datetime.datetime.now(datetime.timezone.utc).isoformat();t=time.monotonic()
with (e/(name+'.log.txt')).open('w') as log:
 p=subprocess.run(['node','scripts/testing/run-resource-safe.mjs','--cpu-target','60','--max-workers','1','--concurrency','1','--','node',pnpm,*args],cwd=r,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=300)
d={'stage':name,'startedAt':start,'durationSeconds':round(time.monotonic()-t,3),'exitCode':p.returncode,'checkout':str(r),'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=r,text=True).strip(),'arguments':args,'log':name+'.log.txt'};stage_file=e/'STAGES.json';stages=json.loads(stage_file.read_text()) if stage_file.exists() else [];stages.append(d);stage_file.write_text(json.dumps(stages,indent=2)+'\n');print(json.dumps(d),flush=True)
sys.exit(p.returncode)

import datetime
import json
import pathlib
import subprocess
import sys
import time

root = pathlib.Path(__file__).resolve().parent
label, cwd, *command = sys.argv[1:]
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
before = time.monotonic()
with (root / (label + '.stdout.txt')).open('w') as out, (root / (label + '.stderr.txt')).open('w') as err:
    result = subprocess.run(command, cwd=cwd, stdout=out, stderr=err)
record = {'label': label, 'command': command, 'cwd': cwd, 'started_at': started,
          'duration_seconds': round(time.monotonic() - before, 3), 'exit_code': result.returncode}
(root / (label + '.command.json')).write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({k: record[k] for k in ['label', 'cwd', 'duration_seconds', 'exit_code']}, ensure_ascii=False), flush=True)
print((root / (label + '.stdout.txt')).read_text()[-1200:], flush=True)
print((root / (label + '.stderr.txt')).read_text()[-800:], flush=True)
sys.exit(result.returncode)

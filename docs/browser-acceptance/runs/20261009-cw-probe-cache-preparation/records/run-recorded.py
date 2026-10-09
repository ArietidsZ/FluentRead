import datetime, json, os, pathlib, subprocess, sys, time

root = pathlib.Path(__file__).resolve().parent
repo = root.parent / 'FluentRead-incognito-route-20261008'
label, command = sys.argv[1], sys.argv[3:]
start = datetime.datetime.now(datetime.timezone.utc).isoformat()
clock = time.monotonic()
with (root / (label + '.log')).open('w') as output:
    result = subprocess.run(command, cwd=repo, stdout=output, stderr=subprocess.STDOUT)
record = {'command': command, 'cwd': str(repo), 'startedAt': start,
          'observationOutput': os.environ.get('FLUENTREAD_CACHE_PREPARATION_OBSERVATIONS'),
          'finishedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'durationSeconds': round(time.monotonic() - clock, 3), 'exitCode': result.returncode}
(root / (label + '.command.json')).write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(record, ensure_ascii=False))
sys.exit(result.returncode)

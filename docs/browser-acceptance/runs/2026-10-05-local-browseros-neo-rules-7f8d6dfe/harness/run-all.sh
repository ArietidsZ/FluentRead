#!/usr/bin/env bash
# Round orchestrator for the 7f8d6dfe / temporary-partial-visibility-20261005 rules.
# Order: partially-visible browser (already launched) -> task-scoped stdio server ->
# continuous focus guard -> single evidence driver -> clean guard stop.
set -euo pipefail

BASE=<WORKSPACE>
FR2="$BASE/run-partial"
NEO="$HOME/Library/Application Support/BrowserClaw/.browseros/BrowserClawServer/versions/0.0.66/resources/bin/browseros-claw-server"
EXT_DIR="$BASE/fluentread-acceptance-product/.output/chrome-mv3"
EXT_ID=djnlaiohfaaifbibleebjggkghlmcpcj
FIXTURE=http://127.0.0.1:62307
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"

rm -f "$FR2/focus-guard.json" "$FR2/neo-pid.txt" "$FR2/phase-done" "$FR2/guard-shell-pid.txt"
rm -rf "$FR2/neo-state-final"
mkdir -p "$FR2/artifacts/env01" "$FR2/artifacts/neo" "$FR2/artifacts/session" "$FR2/artifacts/focus"

PORT="$(cat "$FR2/cdp-port.txt")"

node "$FR2/harness/acceptance-run.mjs" "$FR2" "$NEO" "$FIXTURE" "$EXT_ID" "$EXT_DIR" "$PORT" &
DRIVER=$!
echo "driver pid $DRIVER"

for _ in $(seq 1 240); do
  [ -s "$FR2/neo-pid.txt" ] && break
  sleep 0.25
done
echo "stdio server pid $(cat "$FR2/neo-pid.txt")"

bash "$FR2/harness/run-guard.sh" &
GUARD=$!
echo "guard pid $GUARD"

for _ in $(seq 1 600); do
  [ -s "$FR2/phase-done" ] && break
  sleep 0.5
done
[ -s "$FR2/phase-done" ] || echo "driver never signalled completion"
cat "$FR2/phase-done" 2>/dev/null || true

GPID="$(cat "$FR2/guard-shell-pid.txt" 2>/dev/null || true)"
if [ -n "${GPID:-}" ] && ps -p "$GPID" -o command= | grep -q 'browser-focus-guard.mjs'; then
  kill -TERM "$GPID"
  echo "sent SIGTERM to guard $GPID"
else
  echo "guard process not found via guard-shell-pid.txt"
fi

wait "$DRIVER" || true
wait "$GUARD" 2>/dev/null || true
echo "orchestration finished"

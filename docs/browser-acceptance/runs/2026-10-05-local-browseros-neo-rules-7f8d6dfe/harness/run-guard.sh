#!/usr/bin/env bash
# Continuous focus guard for the approved temporary-partial-visibility-20261005 policy.
# It waits for the task-scoped Neo server pid, then observes until it receives SIGTERM.
# It never launches, moves, minimizes or focuses a window, and it owns the server shutdown.
set -euo pipefail

BASE=<WORKSPACE>
FR2="$BASE/run-partial"
TOOLS="$BASE/fluentread-acceptance-tools"
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"

FR_PROFILE="$(cat "$FR2/profile-path.txt")"
FR_BROWSER_PID="$(cat "$FR2/browser-pid.txt")"
FR_CDP_PORT="$(cat "$FR2/cdp-port.txt")"

echo $$ > "$FR2/guard-shell-pid.txt"
for _ in $(seq 1 200); do
  [ -s "$FR2/neo-pid.txt" ] && break
  sleep 0.25
done
FR_NEO_PID="$(cat "$FR2/neo-pid.txt")"

exec node "$TOOLS/scripts/testing/browser-focus-guard.mjs" \
  --profile "$FR_PROFILE" --pid "$FR_BROWSER_PID" --port "$FR_CDP_PORT" \
  --server-pid "$FR_NEO_PID" --server-config "$FR2/neo-sidecar.json" \
  --output "$FR2/focus-guard.json" \
  --allow-partial-visibility

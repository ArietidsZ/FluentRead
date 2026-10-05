#!/usr/bin/env bash
# guard-attempt.sh PROFILE BROWSER_PID CDP_PORT OUTDIR
#
# Records two attempts of the pinned upstream focus guard against an already-launched, owned
# temporary browser profile:
#   1. the exact guard command with --once --allow-partial-visibility;
#   2. continuous mode for about 4 seconds under `timeout`.
# It captures stdout/stderr/exit for both attempts, records whether OUTDIR/guard-report.json
# was ever created, and collects the read-only preconditions the guard would check.
#
# This script NEVER creates, edits or fakes OUTDIR/guard-report.json; it only passes the path
# to the guard and observes `test -e`/`stat` afterwards. Exit code 0 means "attempt recorded",
# even when the guard itself is blocked (for example by its macOS platform gate).
set -u -o pipefail

usage() {
  cat >&2 <<'EOF'
Usage: guard-attempt.sh PROFILE BROWSER_PID CDP_PORT OUTDIR

  PROFILE      user-data-dir of the owned temporary browser profile
  BROWSER_PID  PID of the owned browser process
  CDP_PORT     loopback CDP port of the owned browser
  OUTDIR       directory that receives guard-attempt-*.txt and guard-report-status.txt
EOF
}

is_uint() { case "$1" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }

quote_cmd() {
  local out='' arg
  for arg in "$@"; do out+="$(printf '%q' "$arg") "; done
  printf '%s' "${out% }"
}

if [ "$#" -ne 4 ]; then usage; exit 2; fi

PROFILE="$1"
BROWSER_PID="$2"
CDP_PORT="$3"
OUTDIR="$4"

is_uint "$BROWSER_PID" || { echo "guard-attempt: BROWSER_PID must be numeric" >&2; exit 2; }
is_uint "$CDP_PORT" || { echo "guard-attempt: CDP_PORT must be numeric" >&2; exit 2; }
[ "$BROWSER_PID" -gt 1 ] || { echo "guard-attempt: refusing BROWSER_PID $BROWSER_PID" >&2; exit 2; }
if ! { [ "$CDP_PORT" -gt 1023 ] && [ "$CDP_PORT" -lt 65536 ]; }; then
  echo "guard-attempt: CDP_PORT out of range" >&2
  exit 2
fi

# The unrelated BrowserOS instance is off limits for this round.
UNRELATED_PID="${FLUENTREAD_UNRELATED_PID:-98229}"
if [ "$BROWSER_PID" -eq "$UNRELATED_PID" ]; then
  echo "guard-attempt: refusing the unrelated BrowserOS PID $UNRELATED_PID" >&2
  exit 3
fi

mkdir -p "$OUTDIR"
OUTDIR="$(realpath "$OUTDIR")"
REPORT_FILE="$OUTDIR/guard-report.json"

record_cmd() {
  echo "## command: $(quote_cmd "$@")"
  local output code
  output="$("$@" 2>&1)"
  code=$?
  printf '%s\n' "$output"
  echo "## exit_code: $code"
  echo
}

collect_preconditions() {
  {
    echo "generated: $(date -Iseconds)"
    echo "profile_argument: $PROFILE"
    echo "browser_pid: $BROWSER_PID"
    echo "cdp_port: $CDP_PORT"
    echo
    echo "=== preconditions the guard would check ==="
    record_cmd ps -ww -p "$BROWSER_PID" -o command=
    record_cmd ps -p "$BROWSER_PID" -o lstart=
    record_cmd stat -c '%u %a' "$PROFILE"
    record_cmd realpath "$PROFILE"
    record_cmd lsof -nP -iTCP:"$CDP_PORT" -sTCP:LISTEN -FpFn
    echo "=== additional read-only identity/permission context ==="
    record_cmd ps -p "$BROWSER_PID" -o uid=,pid=,lstart=
    record_cmd test -d "$PROFILE"
    if [ -f "$PROFILE/.fluentread-acceptance-owner.json" ]; then
      record_cmd cat "$PROFILE/.fluentread-acceptance-owner.json"
    fi
  } > "$OUTDIR/guard-preconditions.txt"
}

# Resolve the pinned guard without baking any machine path: explicit env override, then
# FLUENTREAD_REPO, then the current directory, then the OUTDIR ancestor chain (the record
# directory normally lives inside the repository).
locate_guard() {
  if [ -n "${FLUENTREAD_GUARD_SCRIPT:-}" ]; then
    if [ -f "$FLUENTREAD_GUARD_SCRIPT" ]; then printf '%s\n' "$FLUENTREAD_GUARD_SCRIPT"; fi
    return 0
  fi
  local candidate dir
  for candidate in \
    "${FLUENTREAD_REPO:-}/scripts/testing/browser-focus-guard.mjs" \
    "$PWD/scripts/testing/browser-focus-guard.mjs"; do
    if [ -f "$candidate" ]; then printf '%s\n' "$candidate"; return 0; fi
  done
  dir="$OUTDIR"
  while [ -n "$dir" ] && [ "$dir" != "/" ]; do
    if [ -f "$dir/scripts/testing/browser-focus-guard.mjs" ]; then
      printf '%s\n' "$dir/scripts/testing/browser-focus-guard.mjs"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}

GUARD_SCRIPT="$(locate_guard || true)"
if [ -z "$GUARD_SCRIPT" ]; then
  {
    echo "error: could not locate scripts/testing/browser-focus-guard.mjs"
    echo "searched: \$FLUENTREAD_GUARD_SCRIPT, \$FLUENTREAD_REPO, \$PWD, ancestors of $OUTDIR"
    echo "set FLUENTREAD_GUARD_SCRIPT or FLUENTREAD_REPO to the repository root"
  } > "$OUTDIR/guard-command.txt"
  {
    echo "attempt: once"
    echo "error: guard script not found; no guard command was run"
  } > "$OUTDIR/guard-attempt-once.txt"
  {
    echo "attempt: continuous"
    echo "error: guard script not found; no guard command was run"
  } > "$OUTDIR/guard-attempt-continuous.txt"
  collect_preconditions
  {
    echo "report_file: $REPORT_FILE"
    echo "preexisting_before_attempt: unknown (guard script not found)"
    echo "present_after_once: $( [ -e "$REPORT_FILE" ] && echo yes || echo no )"
    echo "present_after_continuous: $( [ -e "$REPORT_FILE" ] && echo yes || echo no )"
    echo "created_during_attempt: no (guard never ran)"
  } > "$OUTDIR/guard-report-status.txt"
  echo "guard-attempt: guard script not found; attempt recorded without running the guard" >&2
  exit 4
fi
GUARD_SCRIPT="$(realpath "$GUARD_SCRIPT")"

REPORT_PREEXISTING="no"
[ -e "$REPORT_FILE" ] && REPORT_PREEXISTING="yes"

CMD_ONCE=(node "$GUARD_SCRIPT" --once --allow-partial-visibility --profile "$PROFILE" --pid "$BROWSER_PID" --port "$CDP_PORT" --output "$REPORT_FILE")
CMD_CONT=(node "$GUARD_SCRIPT" --allow-partial-visibility --profile "$PROFILE" --pid "$BROWSER_PID" --port "$CDP_PORT" --output "$REPORT_FILE")

{
  echo "guard_script: $GUARD_SCRIPT"
  echo "report_file: $REPORT_FILE"
  echo "command_once: $(quote_cmd "${CMD_ONCE[@]}")"
  echo "command_continuous: $(quote_cmd "${CMD_CONT[@]}")"
} > "$OUTDIR/guard-command.txt"

# ---------- attempt 1: --once ----------
ONCE_OUT="$OUTDIR/.guard-once.stdout"
ONCE_ERR="$OUTDIR/.guard-once.stderr"
ONCE_STARTED="$(date -Iseconds)"
"${CMD_ONCE[@]}" >"$ONCE_OUT" 2>"$ONCE_ERR"
ONCE_CODE=$?
ONCE_FINISHED="$(date -Iseconds)"
{
  echo "attempt: once"
  echo "started: $ONCE_STARTED"
  echo "finished: $ONCE_FINISHED"
  echo "command: $(quote_cmd "${CMD_ONCE[@]}")"
  echo "exit_code: $ONCE_CODE"
  echo "--- stdout ---"
  cat "$ONCE_OUT"
  echo "--- stderr ---"
  cat "$ONCE_ERR"
} > "$OUTDIR/guard-attempt-once.txt"
ONCE_REPORT_PRESENT="no"
[ -e "$REPORT_FILE" ] && ONCE_REPORT_PRESENT="yes"
rm -f "$ONCE_OUT" "$ONCE_ERR"

# ---------- attempt 2: continuous, bounded to ~4 seconds ----------
CONT_OUT="$OUTDIR/.guard-continuous.stdout"
CONT_ERR="$OUTDIR/.guard-continuous.stderr"
CONT_STARTED="$(date -Iseconds)"
timeout --signal=TERM --kill-after=3s 4s "${CMD_CONT[@]}" >"$CONT_OUT" 2>"$CONT_ERR"
CONT_CODE=$?
CONT_FINISHED="$(date -Iseconds)"
{
  echo "attempt: continuous (bounded by: timeout --signal=TERM --kill-after=3s 4s)"
  echo "started: $CONT_STARTED"
  echo "finished: $CONT_FINISHED"
  echo "command: $(quote_cmd "${CMD_CONT[@]}")"
  echo "exit_code: $CONT_CODE"
  echo "--- stdout ---"
  cat "$CONT_OUT"
  echo "--- stderr ---"
  cat "$CONT_ERR"
} > "$OUTDIR/guard-attempt-continuous.txt"
CONT_REPORT_PRESENT="no"
[ -e "$REPORT_FILE" ] && CONT_REPORT_PRESENT="yes"
rm -f "$CONT_OUT" "$CONT_ERR"

# ---------- report observation (never created or faked here) ----------
CREATED_DURING="no"
if [ "$REPORT_PREEXISTING" = "no" ] && { [ "$ONCE_REPORT_PRESENT" = "yes" ] || [ "$CONT_REPORT_PRESENT" = "yes" ]; }; then
  CREATED_DURING="yes"
fi
{
  echo "report_file: $REPORT_FILE"
  echo "preexisting_before_attempt: $REPORT_PREEXISTING"
  echo "present_after_once: $ONCE_REPORT_PRESENT"
  echo "present_after_continuous: $CONT_REPORT_PRESENT"
  echo "created_during_attempt: $CREATED_DURING"
  if [ -e "$REPORT_FILE" ]; then
    echo "--- stat ---"
    stat -c 'mode=%a size=%s mtime=%y' "$REPORT_FILE" 2>&1 || true
  fi
} > "$OUTDIR/guard-report-status.txt"

collect_preconditions

cat <<EOF
guard-attempt summary
  guard_script:              $GUARD_SCRIPT
  once_exit_code:            $ONCE_CODE
  continuous_exit_code:      $CONT_CODE
  report_preexisting:        $REPORT_PREEXISTING
  report_created_during:     $CREATED_DURING
  guard-attempt-once.txt:    $OUTDIR/guard-attempt-once.txt
  guard-attempt-continuous:  $OUTDIR/guard-attempt-continuous.txt
  guard-preconditions.txt:   $OUTDIR/guard-preconditions.txt
  guard-command.txt:         $OUTDIR/guard-command.txt
  guard-report-status.txt:   $OUTDIR/guard-report-status.txt
EOF

exit 0

#!/usr/bin/env bash
# teardown.sh BROWSER_PID FIXTURE_PID PROFILE_DIR CDP_PORT
#
# Stops the owned browser and fixture processes (SIGTERM, bounded wait, SIGKILL only if the
# PID identity is unchanged and the process is still present), removes the temporary profile
# and prints a final inventory proving that no owned process and no CDP listener remain.
#
# Safety:
#   - refuses to run against the unrelated BrowserOS instance PID (default 98229) or PID 1/$$;
#   - refuses to remove a profile that is not a fluentread-* directory unless
#     FLUENTREAD_ALLOW_ANY_PROFILE=1;
#   - never signals a PID whose start-time identity changed while waiting.
set -u -o pipefail

usage() {
  cat >&2 <<'EOF'
Usage: teardown.sh BROWSER_PID FIXTURE_PID PROFILE_DIR CDP_PORT

  BROWSER_PID  PID of the owned browser process
  FIXTURE_PID  PID of the owned fixture server process
  PROFILE_DIR  temporary user-data-dir of the owned browser
  CDP_PORT     loopback CDP port the owned browser was listening on
EOF
}

is_uint() { case "$1" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }

if [ "$#" -ne 4 ]; then usage; exit 2; fi

BROWSER_PID="$1"
FIXTURE_PID="$2"
PROFILE_DIR="$3"
CDP_PORT="$4"

is_uint "$BROWSER_PID" || { echo "teardown: BROWSER_PID must be numeric" >&2; exit 2; }
is_uint "$FIXTURE_PID" || { echo "teardown: FIXTURE_PID must be numeric" >&2; exit 2; }
is_uint "$CDP_PORT" || { echo "teardown: CDP_PORT must be numeric" >&2; exit 2; }
if ! { [ "$CDP_PORT" -gt 1023 ] && [ "$CDP_PORT" -lt 65536 ]; }; then
  echo "teardown: CDP_PORT out of range" >&2
  exit 2
fi

# The unrelated BrowserOS instance is off limits for this round.
UNRELATED_PID="${FLUENTREAD_UNRELATED_PID:-98229}"
for pid in "$BROWSER_PID" "$FIXTURE_PID"; do
  if [ "$pid" -eq "$UNRELATED_PID" ]; then
    echo "teardown: refusing to touch the unrelated BrowserOS PID $UNRELATED_PID" >&2
    exit 3
  fi
  if [ "$pid" -le 1 ] || [ "$pid" -eq "$$" ]; then
    echo "teardown: refusing to signal PID $pid" >&2
    exit 2
  fi
done

PROFILE_REAL="$(realpath -m "$PROFILE_DIR" 2>/dev/null || true)"
if [ -z "$PROFILE_REAL" ]; then
  echo "teardown: cannot resolve PROFILE_DIR: $PROFILE_DIR" >&2
  exit 2
fi
if [ "$PROFILE_REAL" = "/" ] || [ "$PROFILE_REAL" = "$HOME" ] || [ "$PROFILE_REAL" = "$PWD" ]; then
  echo "teardown: refusing unsafe PROFILE_DIR: $PROFILE_REAL" >&2
  exit 2
fi
case "$(basename "$PROFILE_REAL")" in
  fluentread-*) ;;
  *)
    if [ "${FLUENTREAD_ALLOW_ANY_PROFILE:-0}" != "1" ]; then
      echo "teardown: refusing to remove non-fluentread profile: $PROFILE_REAL" >&2
      echo "teardown: set FLUENTREAD_ALLOW_ANY_PROFILE=1 to override" >&2
      exit 2
    fi
    ;;
esac

TERM_TIMEOUT_SECONDS="${FLUENTREAD_TERM_TIMEOUT_SECONDS:-5}"
KILL_TIMEOUT_SECONDS="${FLUENTREAD_KILL_TIMEOUT_SECONDS:-3}"
POLL_INTERVAL_SECONDS="${FLUENTREAD_POLL_INTERVAL_SECONDS:-0.2}"

terminate() {
  local pid="$1" label="$2"
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "$label pid $pid: already exited"
    return 0
  fi
  local command_before lstart_before
  command_before="$(ps -ww -p "$pid" -o command= 2>/dev/null || true)"
  lstart_before="$(ps -p "$pid" -o lstart= 2>/dev/null || true)"
  echo "$label pid $pid: command before stop: ${command_before:-unavailable}"
  kill -TERM "$pid" 2>/dev/null || echo "$label pid $pid: SIGTERM failed"
  local deadline=$((SECONDS + TERM_TIMEOUT_SECONDS))
  while kill -0 "$pid" 2>/dev/null; do
    [ "$SECONDS" -ge "$deadline" ] && break
    sleep "$POLL_INTERVAL_SECONDS"
  done
  if kill -0 "$pid" 2>/dev/null; then
    local lstart_now
    lstart_now="$(ps -p "$pid" -o lstart= 2>/dev/null || true)"
    if [ -n "$lstart_now" ] && [ "$lstart_now" = "$lstart_before" ]; then
      echo "$label pid $pid: still present after ${TERM_TIMEOUT_SECONDS}s; sending SIGKILL"
      kill -KILL "$pid" 2>/dev/null || echo "$label pid $pid: SIGKILL failed"
      deadline=$((SECONDS + KILL_TIMEOUT_SECONDS))
      while kill -0 "$pid" 2>/dev/null; do
        [ "$SECONDS" -ge "$deadline" ] && break
        sleep "$POLL_INTERVAL_SECONDS"
      done
    else
      echo "$label pid $pid: start-time identity changed; refusing SIGKILL"
    fi
  fi
  if kill -0 "$pid" 2>/dev/null; then
    echo "$label pid $pid: STILL ALIVE after the bounded stop"
    return 1
  fi
  echo "$label pid $pid: stopped"
  return 0
}

STOP_OK=0
terminate "$BROWSER_PID" "browser" || STOP_OK=1
if [ "$FIXTURE_PID" != "$BROWSER_PID" ]; then
  terminate "$FIXTURE_PID" "fixture" || STOP_OK=1
else
  echo "fixture pid $FIXTURE_PID: identical to browser pid; not signalled twice"
fi

# ---------- remove the temporary profile ----------
PROFILE_EXISTED_BEFORE="no"
[ -e "$PROFILE_REAL" ] && PROFILE_EXISTED_BEFORE="yes"
PROFILE_REMOVAL="already absent"
if [ "$PROFILE_EXISTED_BEFORE" = "yes" ]; then
  if rm -rf -- "$PROFILE_REAL"; then
    PROFILE_REMOVAL="removed"
  else
    PROFILE_REMOVAL="removal failed"
    STOP_OK=1
  fi
fi
PROFILE_PRESENT_AFTER="no"
[ -e "$PROFILE_REAL" ] && { PROFILE_PRESENT_AFTER="yes"; STOP_OK=1; }

# ---------- listener + process inventory (read-only) ----------
LISTENER_SS="$(ss -H -ltnp "sport = :$CDP_PORT" 2>&1 || true)"
LISTENER_LSOF=""
if command -v lsof >/dev/null 2>&1; then
  LISTENER_LSOF="$(lsof -nP -iTCP:"$CDP_PORT" -sTCP:LISTEN 2>&1 || true)"
fi
LISTENER_PRESENT="no"
if [ -n "$LISTENER_SS" ] || [ -n "$LISTENER_LSOF" ]; then
  LISTENER_PRESENT="yes"
  STOP_OK=1
fi

# Exclude this script's own command line (and its command-substitution subshells), which
# necessarily mention PROFILE_DIR as an argument.
PROFILE_REFERENCES="$(ps -eo pid=,command= 2>/dev/null \
  | grep -F -- "$PROFILE_REAL" \
  | grep -v -F 'grep' \
  | grep -v -F 'teardown.sh' \
  || true)"
if [ -n "$PROFILE_REFERENCES" ]; then
  STOP_OK=1
fi

browser_state="DEAD"
if kill -0 "$BROWSER_PID" 2>/dev/null; then browser_state="ALIVE"; STOP_OK=1; fi
fixture_state="DEAD"
if kill -0 "$FIXTURE_PID" 2>/dev/null; then fixture_state="ALIVE"; STOP_OK=1; fi

cat <<EOF

==== teardown inventory ====
browser_pid:                 $BROWSER_PID ($browser_state)
fixture_pid:                 $FIXTURE_PID ($fixture_state)
cdp_listener ($CDP_PORT):    $( [ "$LISTENER_PRESENT" = "yes" ] && echo PRESENT || echo NONE )
profile_dir:                 $PROFILE_REAL
profile_existed_before:      $PROFILE_EXISTED_BEFORE
profile_removal:             $PROFILE_REMOVAL
profile_present_after:       $PROFILE_PRESENT_AFTER
profile_referencing_procs:   $( [ -n "$PROFILE_REFERENCES" ] && echo '' || echo none )
--- ss -H -ltnp "sport = :$CDP_PORT" ---
${LISTENER_SS:-(empty)}
--- lsof -nP -iTCP:$CDP_PORT -sTCP:LISTEN ---
${LISTENER_LSOF:-(empty)}
--- process lines mentioning the profile ---
${PROFILE_REFERENCES:-(none)}
==== result: $( [ "$STOP_OK" -eq 0 ] && echo CLEAN || echo NOT-CLEAN ) ====
EOF

exit "$STOP_OK"

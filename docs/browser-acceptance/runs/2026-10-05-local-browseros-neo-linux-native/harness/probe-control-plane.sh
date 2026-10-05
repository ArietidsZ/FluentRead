#!/usr/bin/env bash
set -u
S="<HOME>/.cache/fluentread-acceptance/linux-native-20261005"
CP="$S/live/control-plane-probe.txt"
B="/usr/lib/browseros/BrowserOSServer/default/resources/bin/browseros_server"
U="$HOME/.config/browser-os/.browseros/versions/0.0.162/resources/bin/browseros_server"
: > "$CP"
{
  echo "## generated $(date -Iseconds)"
  echo "## packaged copy: $B"
  timeout 20 "$B" --version 2>&1
  timeout 20 "$B" --help 2>&1
  echo "## user-level copy: $U"
  if [ -f "$U" ]; then timeout 20 "$U" --version 2>&1; timeout 20 "$U" --help 2>&1; else echo "absent"; fi
  for x in "$B" "$U"; do
    [ -f "$x" ] || continue
    echo "--- $x"
    printf 'stdio_flag_count=%s\n' "$(strings -a "$x" | grep -c -- '--stdio')"
    printf 'config_flag_count=%s\n' "$(strings -a "$x" | grep -c -- '--config')"
    printf 'sidecar_token_count=%s\n' "$(strings -a "$x" | grep -c 'sidecar')"
  done
  echo "## packaged resources layout"
  find /usr/lib/browseros/BrowserOSServer -maxdepth 3 | head -12
  echo "## helper processes still running now"
  pgrep -a -f 'browseros_server --config' | grep -v 'bash -c' || echo none
} >> "$CP" 2>&1
wc -l "$CP"

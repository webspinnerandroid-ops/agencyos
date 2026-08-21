#!/bin/bash
# High-frequency watcher (30s interval, 1 hour). Alerts via ntfy the moment the
# public site returns 000 or takes over 2s, and again when it recovers.
# State file prevents alert spam. Every curl is bounded so neither the site
# probe nor the ntfy push can wedge the loop. No root required.
HOME_DIR="${HOME:-$PWD}"
STATE="$HOME_DIR/.watch-hour-state"
LOG="$HOME_DIR/watch-hour.log"
URL="https://platform.blissmedialab.com/"
NTFY="https://ntfy.sh/agencyos-uptime"
TIMEOUT=8
DURATION_SECS=${1:-3600}
INTERVAL=${2:-30}
END=$(( $(date +%s) + DURATION_SECS ))

prev="ok"
[ -f "$STATE" ] && prev="$(cat "$STATE")"

echo "=== watch-hour started $(date '+%Y-%m-%d %H:%M:%S') for ${DURATION_SECS}s @ ${INTERVAL}s ===" >> "$LOG"

while [ "$(date +%s)" -lt "$END" ]; do
  result=$(curl -s -o /dev/null -w '%{http_code} %{time_total}' --max-time "$TIMEOUT" "$URL" 2>/dev/null)
  code=$(echo "$result" | awk '{print $1}')
  lat=$(echo "$result" | awk '{print $2}')
  [ -z "$code" ] && code=000
  [ -z "$lat" ] && lat=0

  ts=$(date '+%Y-%m-%d %H:%M:%S')
  note=""
  if [ "$code" = "000" ]; then
    if [ "$prev" != "down" ]; then
      echo "$ts DOWN (HTTP 000)" >> "$LOG"
      note="DOWN|5|rotating_light|platform.blissmedialab.com returned HTTP 000 (timeout). Check the server."
    fi
    prev="down"
  else
    slow=$(awk -v l="$lat" 'BEGIN{print (l > 2.0) ? 1 : 0}')
    if [ "$slow" = "1" ]; then
      if [ "$prev" != "slow" ] && [ "$prev" != "down" ]; then
        echo "$ts SLOW (HTTP $code, ${lat}s)" >> "$LOG"
        note="SLOW|4|warning|platform.blissmedialab.com took ${lat}s (HTTP $code)."
      fi
      prev="slow"
    else
      if [ "$prev" != "ok" ]; then
        echo "$ts RECOVERED (was $prev, now $code, ${lat}s)" >> "$LOG"
        note="RECOVERED|3|white_check_mark|platform.blissmedialab.com is back (HTTP $code, ${lat}s)."
      fi
      prev="ok"
    fi
  fi

  echo "$prev" > "$STATE"

  if [ -n "$note" ]; then
    title=$(echo "$note" | awk -F'|' '{print $1}')
    prio=$(echo "$note" | awk -F'|' '{print $2}')
    tag=$(echo "$note" | awk -F'|' '{print $3}')
    body=$(echo "$note" | cut -d'|' -f4-)
    curl -s -o /dev/null --max-time 8 \
      -H "Title: AgencyOS $title" -H "Priority: $prio" -H "Tags: $tag" \
      -d "$body" "$NTFY" &
  fi

  sleep "$INTERVAL"
done

echo "=== watch-hour finished $(date '+%Y-%m-%d %H:%M:%S'), final state: $prev ===" >> "$LOG"

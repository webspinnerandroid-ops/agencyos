#!/bin/bash
# AgencyOS watchdog (v2): if :3000 stops answering for two consecutive
# probes, kill ONLY the systemd unit's MainPID — systemd's Restart=always
# respawns it with the same unit (127.0.0.1 bind, logs, env). This replaces
# the old v1 which pkill-matched every next-server (killing other tenants'
# apps like onescoop.ca) and spawned a rogue manual `next start` that fought
# systemd for port 3000. No root required. Run every minute via cron.
HOME_DIR="${HOME:-$PWD}"
LOG="$HOME_DIR/watchdog.log"
STATE="$HOME_DIR/.watchdog-state"
NTFY="https://ntfy.sh/agencyos-uptime"

fail=0
for i in 1 2; do
  if curl -sf -o /dev/null --max-time 8 http://127.0.0.1:3000/; then
    fail=0
    break
  fi
  fail=1
  sleep 5
done
if [ "$fail" = "0" ]; then
  echo "ok" > "$STATE"
  exit 0
fi

PID=$(systemctl show -p MainPID --value agencyos 2>/dev/null)
prev=$(cat "$STATE" 2>/dev/null || echo ok)
if [ -n "$PID" ] && [ "$PID" != "0" ]; then
  kill "$PID" 2>/dev/null
  echo "$(date '+%Y-%m-%d %H:%M:%S') app unresponsive - signaled MainPID $PID (systemd auto-restarts)" >> "$LOG"
  if [ "$prev" != "down" ]; then
    curl -s -o /dev/null --max-time 8 \
      -H "Title: AgencyOS watchdog restart" -H "Priority: 4" -H "Tags: warning" \
      -d "AgencyOS :3000 unresponsive - auto-restarted via systemd (MainPID $PID)." "$NTFY"
  fi
  echo "down" > "$STATE"
else
  echo "$(date '+%Y-%m-%d %H:%M:%S') unit has no live MainPID - cannot restart" >> "$LOG"
fi

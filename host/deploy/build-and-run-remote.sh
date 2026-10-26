#!/bin/bash
set -o pipefail

# ---------------------------------------------------------------------------
# Deploy agency-os to the VPS (root on blissmedialab.com) and restart the
# production Next.js server.
#
# Assumes:
#  - ssh key ~/.ssh/agencyos_vps_new (or ./agency-os/.freebuff/ssh/agencyos_vps_new)
#      is present and has access to root@blissmedialab.com
#  - the remote working tree already exists at
#      /home/admin/web/platform.blissmedialab.com/agency-os
#  - the remote repo has node_modules installed (rsync skips node_modules so
#      the VPS keeps its own, already-installed copy).
# ---------------------------------------------------------------------------

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
REMOTE_DIR="/home/admin/web/platform.blissmedialab.com/agency-os"
HOST="blissmedialab.com"
SSH_KEY="$REPO_DIR/.freebuff/ssh/agencyos_vps_new"

if [ ! -f "$SSH_KEY" ]; then
  echo "ERROR: SSH key not found at $SSH_KEY" >&2
  exit 1
fi

log () { printf '[deploy] %s\n' "$*"; }

log "staging source into a temp tree (exclude node_modules/.next/.git/diags/freebuff)..."
STAGING=$(mktemp -d)
trap 'rm -rf "$STAGING"' EXIT

rsync -a --delete \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude '.git' \
  --exclude 'diag-*.txt' \
  --exclude 'diag-*.log' \
  --exclude 'health-*.txt' \
  --exclude 'health-*.cjs' \
  --exclude 'build-*.txt' \
  --exclude 'build-result.txt' \
  --exclude '.freebuff' \
  "$REPO_DIR/" "$STAGING/"

log "pushing staged tree to $REMOTE_DIR (root@HOST)..."
rsync -a --delete --chmod=Du=rwx,Dg=rx,Do=rx,Fu=rw,Fg=r,Fo=r \
  -e "ssh -i $SSH_KEY -o BatchMode=yes -o ConnectTimeout=12 -o StrictHostKeyChecking=no -o LogLevel=ERROR" \
  "$STAGING/" "root@$HOST:$REMOTE_DIR/"

log "stopping any process listening on :3000 on the VPS..."
ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=12 -o StrictHostKeyChecking=no -o LogLevel=ERROR \
  "root@$HOST" bash -s <<'REMOTE_STOP'
set -o pipefail
PID=$(ss -Hltpn 'sport = :3000' 2>/dev/null | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | sort -u | head -n 1)
if [ -n "$PID" ] && [ "$PID" != "1" ]; then
  echo "stopping pid $PID on :3000"
  kill "$PID" 2>/dev/null || true
  sleep 3
  if kill -0 "$PID" 2>/dev/null; then
    echo "kill soft failed, escalating to -9 for pid $PID"
    kill -9 "$PID" 2>/dev/null || true
    sleep 2
  fi
else
  echo "no pid on :3000 (or only pid 1)"
fi
REMOTE_STOP

log "running npm run build on the VPS..."
BUILD_EXIT=$(ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=12 -o StrictHostKeyChecking=no -o LogLevel=ERROR \
  "root@$HOST" bash -s <<'REMOTE_BUILD'
set -o pipefail
cd /home/admin/web/platform.blissmedialab.com/agency-os
export NODE_ENV=production
export PATH=/usr/bin:/usr/local/bin:/home/admin/web/platform.blissmedialab.com/agency-os/node_modules/.bin:$PATH
echo "[build] NODE_ENV=$NODE_ENV"
echo "[build] PATH=$PATH"
echo "[build] pwd=$(pwd)"
echo "[build] ls -d node_modules/.bin/next"
ls -ld node_modules/.bin/next 2>/dev/null || true
echo "[build] node --version"
node --version
echo "[build] npm version from package.json"
if [ -f package.json ]; then
  python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('version','?'))" /home/admin/web/platform.blissmedialab.com/agency-os/package.json 2>/dev/null || echo "?"
else
  echo "(no package.json)"
fi
echo "[build] running npm run build"
npm run build
echo "[build] build_exit=$?"
REMOTE_BUILD
)
echo "$BUILD_EXIT"
if echo "$BUILD_EXIT" | grep -q '\[build\] build_exit=0'; then
  log "build succeeded"
else
  log "build output above; exit code from remote build step:"
  echo "$BUILD_EXIT" | grep -E '^\[build\] build_exit=' || true
  exit 2
fi

log "starting next start in the background on the VPS..."
ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=12 -o StrictHostKeyChecking=no -o LogLevel=ERROR \
  "root@$HOST" bash -s <<'REMOTE_START'
set -o pipefail
cd /home/admin/web/platform.blissmedialab.com/agency-os
export NODE_ENV=production
export PATH=/usr/bin:/usr/local/bin:/home/admin/web/platform.blissmedialab.com/agency-os/node_modules/.bin:$PATH
nohup node_modules/.bin/next start >/home/admin/web/platform.blissmedialab.com/agency-os/.next/server.log 2>&1 &
echo "started next start pid=$!"
sleep 3
echo "validate: $(ss -Hltpn 'sport = :3000' 2>/dev/null | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | sort -u | head -n 1)"
REMOTE_START

log "waiting for :3000 to come up and curling the platform home..."
for i in $(seq 1 12); do
  if ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=12 -o StrictHostKeyChecking=no -o LogLevel=ERROR \
    "root@$HOST" ss -Hltpn 'sport = :3000' 2>/dev/null | grep -q ':3000'; then
    break
  fi
  sleep 3
done

RESP=$(curl -sS -o /dev/null -w '%{http_code} %{time_total}' --max-time 20 \
  -H 'Host: platform.blissmedialab.com' \
  http://152.53.93.139/ 2>/dev/null || echo "CONN_FAILED")
log "platform home via direct IP Host header: $RESP"

RESP2=$(curl -sS -o /dev/null -w '%{http_code} %{time_total}' --max-time 20 \
  https://platform.blissmedialab.com/ 2>/dev/null || echo "CONN_FAILED")
log "platform home via HTTPS name: $RESP2"

log "deploy complete."

#!/bin/bash
set -euo pipefail
SSH_KEY=".freebuff/ssh/agencyos_vps_new"
HOST="root@blissmedialab.com"
REMOTE_DIR="/home/admin/web/platform.blissmedialab.com/agency-os"

echo "### verifying remote tree ###"
ssh -i "$SSH_KEY" \
  -o BatchMode=yes \
  -o ConnectTimeout=12 \
  -o StrictHostKeyChecking=no \
  -o LogLevel=ERROR \
  "$HOST" bash -c "
set -euo pipefail
cd '$REMOTE_DIR'
echo PWD=\$(pwd)
echo NEXT_CONFIG=\$(ls -la next.config.ts)
echo PACKAGE_JSON=\$(ls -la package.json)
echo HEALTH_ROUTE=\$(ls -la src/app/api/health/route.ts)
echo NEXT_BIN=\$(ls -la node_modules/.bin/next)
echo NODE_VERSION=\$(node --version)
echo NPM_VERSION=\$(python3 -c 'import json,sys; d=json.load(open(\"package.json\")); print(d.get(\"version\",\"?\"))' 2>/dev/null || echo '?')
"

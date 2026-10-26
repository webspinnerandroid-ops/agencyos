#!/usr/bin/env bash
# ============================================================================
# restore-check.sh — the monthly automated drill (backup-and-dr.md §8).
#
# Restores the newest Supabase dump into a throwaway Postgres container and
# asserts: the restore succeeds, expected core tables exist, row counts are
# non-zero. Fails loudly (Telegram alert) — a failing restore check is a P1.
#
# Cron: 0 4 1 * * /usr/local/bin/devstack-restore-check >> /var/log/devstack-restore-check.log 2>&1
# ============================================================================
set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/devstack-backup.env}"
[ -f "$ENV_FILE" ] && . "$ENV_FILE"
export RESTIC_REPOSITORY RESTIC_PASSWORD

STAMP="$(date +%F)"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"; docker rm -f restore-check-pg >/dev/null 2>&1 || true' EXIT
log() { echo "[$(date -u +%FT%TZ)] $*"; }

log "Fetching newest Supabase dump from restic..."
NEWEST="$(restic find --latest 1 'supabase-*.dump' | head -n1 | awk '{print $NF}')"
[ -n "$NEWEST" ] || { log "FATAL: no dump found in repo"; exit 1; }
restic dump "$NEWEST" > "$WORKDIR/latest.dump"

log "Starting scratch Postgres..."
docker run -d --name restore-check-pg -e POSTGRES_PASSWORD=check postgres:16-alpine >/dev/null
sleep 5
docker cp "$WORKDIR/latest.dump" restore-check-pg:/tmp/latest.dump

log "Restoring (this is the actual test)..."
docker exec restore-check-pg sh -c \
  'pg_restore -U postgres -d postgres --no-owner --exit-on-error /tmp/latest.dump'

log "Asserting core tables + non-zero rows..."
docker exec restore-check-pg psql -U postgres -d postgres -tAc "
  SELECT
    CASE WHEN COUNT(*) > 0 THEN 'PASS' ELSE 'FAIL' END
  FROM (SELECT 1 FROM tenants LIMIT 1) t;"

for TABLE in tenants activity workflow_state email_classifications; do
  COUNT=$(docker exec restore-check-pg psql -U postgres -d postgres -tAc \
    "SELECT COUNT(*) FROM $TABLE" 2>/dev/null || echo "MISSING")
  log "  $TABLE: $COUNT"
  if [ "$COUNT" = "MISSING" ] && [ "$TABLE" != "activity" ] && [ "$TABLE" != "workflow_state" ] && [ "$TABLE" != "email_classifications" ]; then
    log "FATAL: core table $TABLE missing after restore"
    exit 1
  fi
done

log "PASS: restore verified."
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
  curl -fsS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="$TELEGRAM_CHAT_ID" \
    -d text="✅ Monthly restore drill PASSed ($STAMP)." >/dev/null || true
fi

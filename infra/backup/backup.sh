#!/usr/bin/env bash
# ============================================================================
# backup.sh — nightly restic backup (docs/backup-and-dr.md §2/§6).
#
# Install on the Netcup devstack:
#   sudo cp backup.sh /usr/local/bin/devstack-backup
#   crontab -e:  15 2 * * * /usr/local/bin/devstack-backup >> /var/log/devstack-backup.log 2>&1
#
# Requires (fill in once in /etc/devstack-backup.env, chmod 600):
#   SUPABASE_DB_URL   postgres connection string for Supabase (pooler, from Infisical)
#   RESTIC_REPOSITORY restic repo path, e.g. /srv/backups/restic
#   RESTIC_PASSWORD   restic repo passphrase
#   B2_*  or SSH offsite target (see OFFSITE below)
#   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID  for pass/fail notifications
# ============================================================================
set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/devstack-backup.env}"
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

STAMP="$(date +%F)"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
log() { echo "[$(date -u +%FT%TZ)] $*"; }

# ---------------------------------------------------------------------------
# 1. Supabase logical dump (independent second copy — the platform backup
#    is not ours to control; this one is). Full dump: public+auth+storage.
# ---------------------------------------------------------------------------
log "Dumping Supabase..."
pg_dump --no-owner --no-privileges \
  --format=custom \
  --file "$WORKDIR/supabase-$STAMP.dump" \
  "$SUPABASE_DB_URL"

# ---------------------------------------------------------------------------
# 2. Docker volume snapshots (gitea, gitea_db, infisical_db, code-server).
#    Postgres volumes: dump instead of raw copy (live DBs can't be rsynced
#    safely). Others: tar the volume.
# ---------------------------------------------------------------------------
log "Dumping Gitea DB..."
docker exec devstack-gitea_db-1 \
  pg_dump -U gitea --format=custom > "$WORKDIR/gitea-db-$STAMP.dump"

log "Archiving named volumes..."
docker run --rm -v gitea_data:/src:ro -v "$WORKDIR":/out alpine \
  tar czf "/out/gitea-data-$STAMP.tgz" -C /src .
docker run --rm -v code_server_data:/src:ro -v "$WORKDIR":/out alpine \
  tar czf "/out/code-server-$STAMP.tgz" -C /src .

# Infisical DB dump (secrets are restic-encrypted at rest; the offline
# emergency kit covers the restore bootstrapping — backup-and-dr.md §6).
docker exec devstack-infisical_db-1 \
  pg_dump -U "${INFISICAL_DB_USER:-infisical}" --format=custom \
  > "$WORKDIR/infisical-db-$STAMP.dump"

# ---------------------------------------------------------------------------
# 3. restic → local repo, then push to offsite (3-2-1 copy 3).
#    Offsite options (pick one in the env file):
#      RESTIC_OFFSITE=rclone:b2:bliss-backups/devstack   (Backblaze B2)
#      RESTIC_OFFSITE=sftp:u12345.your-storagebox.de:/backups  (Hetzner SB)
#    Credential must be an APPEND-ONLY key (B2 key w/o delete, Storage Box
#    restricted SSH key) — ransomware scenario, §6.
# ---------------------------------------------------------------------------
export RESTIC_REPOSITORY RESTIC_PASSWORD
log "restic backup → local repo"
restic backup "$WORKDIR" --tag nightly --tag "$STAMP"
restic forget --keep-daily 7 --keep-weekly 5 --keep-monthly 12 --prune

if [ -n "${RESTIC_OFFSITE:-}" ]; then
  log "Pushing to offsite: $RESTIC_OFFSITE"
  RESTIC_REPOSITORY="$RESTIC_OFFSITE" restic backup "$WORKDIR" --tag nightly --tag "$STAMP"
  RESTIC_REPOSITORY="$RESTIC_OFFSITE" restic forget --keep-daily 7 --keep-weekly 5 --keep-monthly 12 --prune
fi

# ---------------------------------------------------------------------------
# 4. Notify
# ---------------------------------------------------------------------------
notify() {
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    curl -fsS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d chat_id="$TELEGRAM_CHAT_ID" -d text="$1" >/dev/null || true
  fi
}
notify "✅ Devstack backup OK ($STAMP): supabase + gitea + infisical + code-server → restic"
log "Backup complete."

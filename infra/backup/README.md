# Backup & restore tooling

Implements `docs/backup-and-dr.md`. Two scripts, two crons, zero excuses.

## One-time setup (Netcup)

```bash
# 1. restic + pg_dump available
apt install -y restic postgresql-client

# 2. Create the env file (secrets stay out of git)
cat > /etc/devstack-backup.env <<'EOF'
SUPABASE_DB_URL=postgresql://...pooler-url-from-infisical...
RESTIC_REPOSITORY=/srv/backups/restic
RESTIC_PASSWORD=<long random passphrase>
RESTIC_OFFSITE=rclone:b2:bliss-backups/devstack   # or sftp:uXXXX.your-storagebox.de:/backups
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
EOF
chmod 600 /etc/devstack-backup.env

# 3. Init the repo
source /etc/devstack-backup.env && restic init

# 4. Install the crons
cp backup.sh /usr/local/bin/devstack-backup
cp restore-check.sh /usr/local/bin/devstack-restore-check
chmod +x /usr/local/bin/devstack-*
crontab -e
#   15 2 * * * /usr/local/bin/devstack-backup >> /var/log/devstack-backup.log 2>&1
#   0 4 1 * *  /usr/local/bin/devstack-restore-check >> /var/log/devstack-restore-check.log 2>&1
```

## Verification

- First nightly run → Telegram ✅ message.
- First restore-check run → `PASS: restore verified.` in the log.
- Offsite: `restic snapshots` against the offsite repo shows last night's tag.

**Append-only offsite credential:** the B2 application key must NOT have delete
permission (or the Storage Box SSH key must be restricted). That single setting
is what makes runbook R5 (ransomware) survivable.

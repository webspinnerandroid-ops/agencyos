# Runbooks — one page each, tested quarterly (backup-and-dr.md §7)

Each runbook: preconditions, steps, target RTO. Store the DNS inventory
(§7 prerequisite) in the Gitea `runbooks` repo next to these files — registrar
login lives in Infisical / the offline emergency kit, never here.

---

## R1 — Bad migration / accidental deletion (RTO 1h)

1. Stop writes: put the app in maintenance (`docker stop` on the VPS app or
   flip Plesk nginx to a static page).
2. If PITR is enabled on Supabase: restore to a new timestamped branch/project
   just before the bad event; else use last night's dump.
3. Restore into a SCRATCH project first; run the row-count assertions from
   `infra/backup/restore-check.sh` manually against it.
4. Repoint: update `NEXT_PUBLIC_SUPABASE_URL` / service key in the VPS
   `.env.local` → rebuild → smoke test (login, dashboard, one generation).
5. Run `reconcile()` (agency-reconcile-workflows) to re-present any approvals.
6. Remove maintenance mode. Log the incident in the activity ledger.

## R2 — Supabase project/account loss (RTO 4h)

1. Create a fresh Supabase project (or stand up self-hosted Postgres 16).
2. `pg_restore` the newest dump from restic (local or offsite repo).
3. Recreate auth admin user; rotate `SUPABASE_SERVICE_ROLE_KEY`, anon key,
   and every integration key that referenced the old project URL.
4. Update env on VPS → rebuild → full smoke checklist (Round 19 §5:
   two-browser isolation, admin gate, generation, Telegram).
5. Verify RLS: run the isolation matrix before declaring done.

## R3 — Contabo VPS total loss (RTO 4h)

1. New VPS, install Node 20 + nginx (or Plesk).
2. Clone agency-os from Gitea; `.env.local` values from Infisical.
3. `npm ci && npx next build`; systemd unit or the deploy script's start
   command; nginx proxy 443 → 3000 with `proxy_read_timeout 300s`.
4. DNS: switch A records (inventory in the runbooks repo).
5. Smoke: BUILD_ID endpoint, login, generate-content, images, brand profile.
6. Inngest: re-register the webhook URL (`/api/inngest`) in the Inngest
   dashboard/cloud if the app URL changed.

## R4 — Netcup devstack total loss (RTO 1 day)

1. Recreate from `infra/devstack/docker-compose.yml` + fresh `.env` from the
   offline emergency kit (NOT from the live Infisical — it's gone).
2. `restic restore latest` → pg_restore gitea + infisical DBs, untar volumes.
3. Re-verify Gitea mirrors; re-run `restore-check.sh` once to confirm.

## R5 — Compromise / ransomware (RTO 2 days)

1. Isolate: firewall off both servers; revoke all keys in Infisical
   (enumerable — that's why we have it); rotate Stripe/Resend/Telegram/OpenAI.
2. Fresh hosts (R3 + R4 procedures) — never reuse a compromised volume.
3. Restore from the OFFSITE repo only (append-only credential untouched).
4. Replay state: `reconcile()` for workflows; Stripe webhook replay from the
   dashboard for missed events; ledger reconciliation flags gaps.
5. Post-mortem in the runbooks repo; rotate every secret again after.

## R6 — Inngest state loss (RTO minutes)

1. Nothing to restore — Postgres is the truth (ADR-003).
2. Run `reconcile()` (agency-reconcile-workflows / manual trigger).
3. Waiting approvals are re-presented with the same tokens; approve once.

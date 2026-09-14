-- ============================================================================
-- 107 — ROLLBACK of 106_agency_ops_backbone (DESTRUCTIVE — read this first)
--
-- Drops everything migration 106 created:
--   machine_api_keys, email_rule_feedback, email_classifications,
--   approval_receipts, workflow_state, client_subsystems, activity
--   + the activity_block_rewrite() trigger function.
--
-- ⚠️  THIS PERMANENTLY DESTROYS THE ACTIVITY LEDGER — the append-only audit
--     trail is NOT reproducible from anywhere else. Receipts for decisions
--     already made are also destroyed. Any workflow_state rows that are
--     mid-flight (waiting_for_approval / running) will be orphaned: the
--     running Inngest functions will fail on next DB access.
--
-- Recommended sequence instead of a raw rollback:
--   1. Set every in-flight workflow to 'cancelled':
--        UPDATE workflow_state SET status='cancelled'
--        WHERE status IN ('pending','waiting_for_approval','running');
--   2. Export the ledger if you want history:
--        \copy (SELECT * FROM activity) TO 'activity-archive-$(date +%F).csv' CSV
--      (or SELECT ... and save from the SQL editor)
--   3. THEN run this file.
--
-- Dependency order matters: dependent rows reference clients/tenants, and
-- approval_receipts + email_rule_feedback reference workflow_state / clients.
-- Dropping leaf tables first keeps CASCADE behavior predictable.
-- Idempotent: DROP ... IF EXISTS, safe to re-run.
-- ============================================================================

-- 1. Machine API keys (leaf — no dependents)
DROP TABLE IF EXISTS machine_api_keys;

-- 2. Email rule feedback (references clients)
DROP TABLE IF EXISTS email_rule_feedback;

-- 3. Email classifications (references clients)
DROP TABLE IF EXISTS email_classifications;

-- 4. Approval receipts (references workflow_state + tenants)
DROP TABLE IF EXISTS approval_receipts;

-- 5. Workflow state (leaf once receipts are gone)
DROP TABLE IF EXISTS workflow_state;

-- 6. Client ↔ subsystem map (references clients)
DROP TABLE IF EXISTS client_subsystems;

-- 7. Activity ledger LAST — its trigger lives on this table; dropping the
--    table auto-drops the trigger, then we clean up the function.
DROP TABLE IF EXISTS activity;
DROP FUNCTION IF EXISTS activity_block_rewrite();

-- Note: the tenant_isolation RLS policies die with their tables. No other
-- migration objects (indexes, enums) are shared with the rest of the schema.

-- 055 — Lana (Reputation Manager) and Cyril (Legal Assistant) are now fully
-- built: both have expert personas (employee-personas.ts), eval-loop criteria
-- (src/lib/ai/eval.ts), and live background pipelines in team-task.ts
-- (reputation_draft / cyrilDraftDocument). Their catalog rows still say
-- 'partial' / 'planned' from the original 019 seed, which shows the wrong
-- "training" status in the AI Team page.

UPDATE ai_employees SET status = 'built' WHERE key IN ('juno', 'linda');

# Post-scheduling defaulting — design note

**Status:** decided (2026-10-27). Option A implemented, then reverted; Option B shipped.
**Scope:** how auto-generated / undated draft posts get dates on the Content Calendar.

---

## Problem

Content generation produces drafts with `scheduled_at IS NULL`. They are invisible to
the calendar grid (which renders a date window), the ICS export, and the scheduling
cron — an operator browsing the calendar sees a month that looks empty while ~178
drafts exist. Whenever planning runs ahead of the calendar, staff who never open the
backlog in another screen don't know those drafts exist.

## Option A — draft-date defaulting (implemented, then rejected)

*Auto-assign every generated draft a default date: the next day at 09:00 local time,
resolved for DST. A `lib/draft-date.ts` helper, four `generate-content` insertion
sites, and a dry-run backfill script stamped existing rows the same way.*

**Why it was reverted.** The date is *fabricated*, not decided:

- A chip with a real-looking date implies a schedule a human never chose — the same
  "busy-work stamping" failure mode the posts denorm trigger had over caption
  prefixes into titles (fixed earlier in migration 021).
- The 09:00 default interacts badly with everything downstream of `scheduled_at`:
  approved→scheduled gating semantics, `auto_publish_at`, the Inngest scheduling cron
  and token billing all treat a set `scheduled_at` as intent.
- Undoing a single wrong default is database surgery (`backfill-draft-dates.cjs`)
  rather than a drag. Real backfills of ~178 rows = a migration-like event every time
  the policy changes.
- Existing rows keep the fabricated stamps forever; there is no way to tell "the
  human picked this" from "the generator picked this".

Reverted completely: all four insertion sites back to `scheduled_at ?? null`,
`draft-date.ts` and the backfill script deleted. Undated drafts stay genuinely
undated — the fix went into the *view*, not the data.

## Option B — the Unscheduled backlog strip (shipped)

A strip above the month grid / week strip listing undated posts (the API does not
filter by status — the strip keeps the calendar's selected statuses client-side).
Datable without fabricating anything:

- **API** — `GET /api/posts?unscheduled=1` returns `scheduled_at IS NULL` posts
  of any status, newest first, cap 50, tenant-scoped — and narrowed to the
  selected client when the calendar's client filter is set (the route honors
  `clientId`; the strip applies the status filter client-side). Date-window
  params are skipped in this mode; a null column cannot be constrained by a
  date range.
- **Scheduling a strip chip** — dragging one onto any month cell or week row sets
  *that day's* 09:00 local slot (UTC offset resolved for the **target** date, so a
  DST-crossing move lands on a sane wall time). Optimistic transfer + re-fetch with
  PATCH rollback on failure, same duplicate-drop guard as grid moves. Drops never
  touch `status`, so the approved→scheduled gate and the cron are unaffected — the
  only thing that becomes real is the date, and only because a human placed it.
- **Undo** — the backlog banner generalizes the reschedule undo with a `kind`
  discriminator: scheduling-undo patches `scheduled_at` back to `null` (the update
  schema's documented "null = unschedule"), restore is the exact previous instant
  (no offset recomputation, so a DST-crossing undo is safe by construction).
- **Backlog chips** are desktop-draggable (HTML5 DnD), touch-draggable (same pointer
  gesture path as grid chips), and open the detail dialog on plain click.

The calendar's auto-jump was verified against this shape: a client whose only future
work is *proposed* campaign-plan items still gets the jump (the scan merges proposed
months from the `/api/campaign-plans` fetch, tenant- and workspace-scoped), while a
client with a scheduled post in the current month stays put — both cases, plus the
proposed-only case, lock in as `tests/e2e/calendar-auto-jump.spec.ts` (the review-time
probe it was first verified with is gone; the permanent spec replaced it).

## Why 09:00 as the drop-time default

Same rationale as Option A's default, but only applied at the moment of an explicit
human placement, where it can be overridden in the dialog and is visible as a
consequence of the drag rather than a silent property of generation.

## Known limitations / follow-ups

- **Cross-client proposed items** (fixed 2026-10-27). `ProposedItem` now carries the
  plan's `client_id`, and both the proposed chips (`proposedByDay`) and the auto-jump
  scan filter on `selectedClientId` — a client-filtered calendar only shows plans
  mapped out for THAT client, mirroring the posts query. The one exception: a plan with `client_id: null` is unattributable (cross-client), so it
  renders only on the all-clients view — the same treatment the posts query gives a
  `client_id IS NULL` row under a client filter.
- **Creator-side plan attribution (shipped for Malory's chat path, 2026-10-28;
  proposal path still unattributed).** The three pieces from the earlier plan:
  1. DONE. `CampaignPlanInput.clientId` exists and `createCampaignPlan` persists
     it (`null` stays legal — agency-internal plans remain cross-client by
     design, same as the posts query).
  2. DONE for `lib/ai/team-task.ts`: Malory's `plan_campaign` resolves the target
     client before planning — the chat's bound client wins (`room.client_id`),
     else a client name extracted from the message is matched against the
     tenant's clients table (exact name, then substring, e.g. labelled variants
     like "Acme Roasters Inc."); resolution never throws, it falls back to null.
     The stamp lands on `campaign_plans` AND the mirrored `seo_campaigns` row.
     NOT DONE: `lib/campaign-from-proposal.ts` still calls `createCampaignPlan`
     without `clientId`, so proposal-seeded plans write null and stay
     cross-client until that call passes the proposal's client.
  3. DONE. `tests/e2e/calendar-auto-jump.spec.ts` cases 4–5 write
     client-attributed fixtures: a scoped view with no posts jumps from a plan
     attributed to the selected client (case 4), and another client's proposed
     items are hidden and excluded from the jump scan (case 5).
- **Strip cap of 50.** Beyond that the strip truncates (server-sided cap); the API
  remains the durability point.
- ~~**Pre-existing drag flake** in the double-drop "last drop wins" test~~ —
  **mitigated since 2026-10-27**: the pointer fallback was extended to desktop
  drags, so a mouse runs the same gesture as a fallback when Chromium swallows
  an HTML5 `dragstart` (proven pre-existing on HEAD via stash A/B — the flake
  itself is a browser behavior, not app code). The two paths are mutually
  exclusive: when native DnD *does* initiate the UA fires `pointercancel` and
  the pointer handlers defer via `nativeDragActiveRef`, so exactly one path
  drops; a stale marker from a swallowed `dragend` is cleared on the next
  pointerdown instead of degrading every later mouse gesture to clicks.
- ~~**No regression coverage** for the auto-jump proposed-only case~~ — covered since
  2026-10-27 by `tests/e2e/calendar-auto-jump.spec.ts`: (1) a fresh load whose only
  scheduled posts sit in a future month jumps there, (2) a scheduled post in the
  current month stays put, and (3) with the tenant's posts swept empty, a single
  `proposed` `campaign_plan_items` row in month+2 gets the jump on its own and the
  dashed "Proposed" chip renders — written straight to the service-role client and
  read back through the live `/api/campaign-plans` route, so the
  item → `proposedItems` merge is exercised end to end, not just the scan math.

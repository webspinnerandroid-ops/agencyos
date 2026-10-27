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

A strip above the month grid / week strip listing undated drafts. Datable without
fabricating anything:

- **API** — `GET /api/posts?unscheduled=1` returns `scheduled_at IS NULL` posts
  (newest first, cap 50, tenant-scoped). Date-window params are skipped in this
  mode; a null column cannot be constrained by a date range.
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
months from the unbounded `/api/campaign-plans` fetch — see the probe note in the
calendar review), while a client with a scheduled post in the current month stays put.

## Why 09:00 as the drop-time default

Same rationale as Option A's default, but only applied at the moment of an explicit
human placement, where it can be overridden in the dialog and is visible as a
consequence of the drag rather than a silent property of generation.

## Known limitations / follow-ups

- **Cross-client proposed items.** `campaign_plans.client_id` is always null in the
  codebase; `ProposedItem` carries no client. Proposed chips (and the auto-jump scan)
  are tenant-wide. Giving `ProposedItem` the plan's client link and filtering
  `proposedByDay` + the jump scan on `selectedClientId` is the natural follow-up.
- **Strip cap of 50.** Beyond that the strip truncates (server-sided cap); the API
  remains the durability point.
- **Pre-existing drag flake.** The double-drop "last drop wins" test fails
  intermittently because a second HTML5 `dragstart` sometimes never fires — proven
  pre-existing on HEAD via stash A/B (fails at the same rate). Hardening idea:
  extend the pointer-fallback drop path to desktop drags.
- **No regression coverage** for the auto-jump proposed-only case; the probe used
  during review was disposable. Converting it into a permanent Playwright test is
  the next cheapest ratchet.

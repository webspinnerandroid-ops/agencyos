# Token-Based Billing & Add-Ons — Plan

**Status:** Planning (not built). This is the design doc for usage-based billing
on top of the existing monthly/yearly/lifetime subscriptions.

## 1. Concept

Every subscription tier already grants the standard product features. On top of
that, tenants get a **monthly token allowance** (replenished on each billing
cycle) that pays for *actual AI API usage* at the provider's real per-token
rates. When the allowance runs out, generation either pauses with a clear
"out of tokens" message or continues against **purchased add-on tokens**.

This means the platform never eats API costs on heavy usage — the tenant pays
exactly the API cost their usage creates, metered per token per model.

## 2. Metering granularity

- **Granularity:** per LLM, per token (input vs. output priced separately), in
  USD. This is the "calculated per token per llm rate" the owner specified —
  it is the most accurate possible and never subsidizes one model with another.
- **Why not per-request:** request-based pricing (e.g. $X per image) is simple
  but cannot cover text tasks of wildly different lengths. Token metering is
  fair and matches provider billing exactly.
- **Non-LLM assets** (images, video, voice) are **not** metered by token — they
  are metered by *asset* at the provider's per-call price (e.g. per image, per
  video second), converted to the same USD ledger. The ledger row stores
  `unit_type` (`token_in` / `token_out` / `asset`), `unit_qty`, and `rate`.

## 3. Reference per-1M-token rates (USD) — live API list

Rates are the provider's current published list prices; they live in a DB table
(`model_rates`) keyed by model so they can be updated without a deploy. Initial
seed (approximate, verify before launch):

| Provider / Model family | Input / 1M | Output / 1M | Notes |
|---|---|---|---|
| DeepSeek V4-Flash | ~$0.07 | ~$0.27 | Cheap default for text |
| DeepSeek V4-Pro | ~$0.28 | ~$0.42 | Heavy text work |
| OpenAI GPT-4o | ~$2.50 | ~$10.00 | Premium text |
| OpenAI GPT-Image / DALL·E | n/a | per image | Asset-priced |
| Google Gemini flash | ~$0.10 | ~$0.40 | Text + image in/out |
| Anthropic / others (when added) | per model | per model | Fetched from provider pricing |

**Enforcement of the rule "tokens are added according to their subscription":**
the monthly allowance per tier is a column on the plan (`monthly_token_allowance_usd`),
so a $X/month tier includes, say, $Y of API credit at list price. The allowance
is expressed in **USD of credit**, which sidesteps model-price drift: 10¢ of
credit buys different token counts on different models, but always exactly
10¢ of provider list cost.

## 4. Subscription allowances (proposed)

| Tier | Monthly credit (USD) | Rollover |
|---|---|---|
| Trial / Free | $0.50 | No |
| Starter | $5 | No |
| Growth | $25 | Up to 1 month |
| Pro | $60 | Up to 1 month |
| Lifetime | $0 (pay-as-you-go only) | n/a |

Lifetime plans have **no included allowance** — usage is billed strictly on
prepaid add-on tokens (see below) or a saved payment method.

## 5. Add-on token purchases

- **Minimum purchase:** $20 (hard floor — the owner's requirement). All prices
  in **USD**.
- **Denominations offered:** $20 / $50 / $100 / $250 / $500 / custom (≥$20).
- Add-on tokens never expire and are used **after** the monthly allowance is
  exhausted (allowance first, then add-on balance).
- Payment goes through the existing Stripe subscription flow as a **one-off
  invoice** or a top-up `Price` object; the purchase writes to the token
  ledger with `type: 'purchase'`.
- The user sees one number: **remaining USD credit**, with a token-equivalent
  estimate for the currently mapped models ("≈ 1.2M DeepSeek tokens").

## 6. Data model (new tables)

```sql
model_rates (
  model_id uuid PK,        -- FK ai_models
  input_per_1m_usd numeric,
  output_per_1m_usd numeric,
  asset_price_usd numeric, -- for image/video/voice (per call or per second)
  updated_at timestamptz
)

token_ledger (
  id uuid PK,
  tenant_id uuid, workspace_id uuid null,
  type text,                -- 'allowance' | 'purchase' | 'usage' | 'refund' | 'expiry'
  unit_type text,           -- 'token_in' | 'token_out' | 'asset'
  unit_qty numeric,
  rate_usd numeric,         -- per unit
  total_usd numeric,
  model_id uuid null,
  task text null,
  created_at timestamptz
)

tenant_balances (
  tenant_id uuid PK,
  monthly_allowance_usd numeric,
  used_this_cycle_usd numeric,
  cycle_start timestamptz,
  addon_balance_usd numeric
)
```

## 7. Metering hooks

1. **Text tasks:** every `generateText` / `generateStructuredOutput` call
   already receives `usage.total_tokens` from the provider — write
   `token_in`/`token_out` rows to the ledger with the model's rate. (No extra
   provider call; the data is already in the response.)
2. **Image/video/voice:** the orchestrator knows the model + output count →
   write one `asset` row at the model's asset price.
3. **Balance check** runs at the start of every generation route (same place
   `checkUsageLimit` runs today): if used + estimated cost > allowance +
   add-on balance, return 429 with a "Buy more tokens" link.
4. A **realtime balance line** on Profile & Usage and on every generation page.

## 8. Where it surfaces

- **Billing page:** current cycle usage vs. allowance bar, add-on purchase
  widget (min $20), ledger history with download.
- **Profile & Usage:** live credit readout.
- **Generation routes:** friendly "out of tokens" states instead of silent
  provider errors.
- **Admin:** tenant balance override/refund, rate-table editor (super admin).

## 9. Build order

1. `model_rates` + `token_ledger` + `tenant_balances` migration (076) + seed rates.
2. Metering in orchestrator (text tokens + asset prices).
3. Balance gate in generate routes (text/image/video) — 429 with upsell link.
4. Stripe top-up: one-off `Price` objects ($20 minimum enforced server-side).
5. UI: billing usage bar, purchase widget, ledger, admin rate editor.
6. Allowance refresh job (cron at cycle start) + lifetime-tier behavior.

## 10. Open questions

- Rollover policy (proposed: ≤1 month, capped at 1× monthly allowance).
- Team accounts: shared balance vs. per-member budgets.
- Per-workspace isolation of balances (aligns with the new `workspace_members`
  scoping work).

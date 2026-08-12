-- 048 — super-admin subscription & API-cost registry
-- ============================================================================
-- Tracks every external service the platform depends on: what it's used for,
-- what plan we're on, when it renews, what's owing, and how much credit is
-- left. Auto-check fills credit_remaining for providers with a usable API
-- (stripe → Stripe balance, resend → email quota remaining); the rest are
-- kept up to date manually from the provider portal.

CREATE TABLE IF NOT EXISTS subscription_registry (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider         TEXT NOT NULL UNIQUE,
    purpose          TEXT,
    plan             TEXT,
    cost_per_cycle   NUMERIC(12,2),
    billing_cycle    TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly','annual','payg')),
    cycle_day        INT CHECK (cycle_day BETWEEN 1 AND 31),
    renewal_date     DATE,
    amount_owing     NUMERIC(12,2),
    credit_remaining NUMERIC(12,2),
    portal_url       TEXT,
    account_email    TEXT,
    notes            TEXT,
    auto_check       TEXT CHECK (auto_check IN ('stripe','resend','manual')),
    last_checked_at  TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscription_registry_renewal ON subscription_registry (renewal_date);

ALTER TABLE subscription_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_direct_access" ON subscription_registry FOR ALL USING (false);

-- Seed the core stack the platform runs on (costs/plans to be filled in).
-- ON CONFLICT (provider) DO NOTHING so re-running is safe.
INSERT INTO subscription_registry (provider, purpose, billing_cycle, auto_check, portal_url) VALUES
  ('Supabase',        'Database, auth, storage, edge functions', 'payg', 'manual', 'https://supabase.com/dashboard'),
  ('Inngest',         'Background jobs & cron (content, publishing, inboxes)', 'payg', 'manual', 'https://app.inngest.com'),
  ('Stripe',          'Customer billing & subscription payments', 'payg', 'stripe', 'https://dashboard.stripe.com'),
  ('OpenAI',          'LLM + image generation', 'payg', 'manual', 'https://platform.openai.com/usage'),
  ('DeepSeek',        'LLM (cost-effective text)', 'payg', 'manual', 'https://platform.deepseek.com'),
  ('Google (Gemini/Imagen)', 'LLM + image generation (incl. Nano Banana)', 'payg', 'manual', 'https://ai.google.dev'),
  ('Anthropic',       'LLM (optional)', 'payg', 'manual', 'https://console.anthropic.com'),
  ('fal.ai',          'Video generation (Wan)', 'payg', 'manual', 'https://fal.ai/dashboard'),
  ('Alibaba DashScope', 'Video generation (Wan 2.x)', 'payg', 'manual', 'https://dashscope.console.aliyun.com'),
  ('Resend',          'Transactional & inbound email', 'payg', 'resend', 'https://resend.com/dashboard'),
  ('DocuSign',        'Proposal & contract e-signatures', 'payg', 'manual', 'https://app.docusign.com'),
  ('Bunny.net',       'Storage zone + CDN (site assets)', 'payg', 'manual', 'https://bunny.net/dashboard'),
  ('Ayrshare',        'Social publishing bridge (cost review — possibly dropping)', 'payg', 'manual', 'https://www.ayrshare.com'),
  ('VPS Hosting',     'Master site hosting (server)', 'monthly', 'manual', NULL),
  ('Domain',          'blissmedialab.com / platform.blissmedialab.com', 'annual', 'manual', NULL)
ON CONFLICT (provider) DO NOTHING;

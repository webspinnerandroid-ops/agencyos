-- 042 — platform coupon codes.
-- Issued ONLY by the super admin (created via /dashboard/admin/coupons) and
-- applied toward a subscription upgrade or new purchase at checkout.

CREATE TABLE IF NOT EXISTS coupon_codes (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code         TEXT NOT NULL UNIQUE,
    -- Percentage discount (1-100).
    percent_off  INT  NOT NULL CHECK (percent_off BETWEEN 1 AND 100),
    -- Optional: restrict to a single plan (Stripe product plan_id).
    plan_id      TEXT,
    -- Optional: expire the code after this date.
    expires_at   TIMESTAMPTZ,
    max_uses     INT,
    used_count   INT  NOT NULL DEFAULT 0,
    active       BOOLEAN NOT NULL DEFAULT true,
    created_by   UUID,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coupon_codes_active ON coupon_codes (code) WHERE active = true;

ALTER TABLE coupon_codes ENABLE ROW LEVEL SECURITY;

-- Super admin only (service-role paths validate admin explicitly; RLS blocks
-- anon/authenticated access outright).
CREATE POLICY "no_direct_access" ON coupon_codes
    FOR ALL USING (false);

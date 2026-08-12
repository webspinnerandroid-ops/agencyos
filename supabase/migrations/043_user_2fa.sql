-- 043 — two-factor authentication (authenticator app, TOTP).
-- Per-user enrollment; the secret is stored encrypted (ENCRYPTION_KEY).

CREATE TABLE IF NOT EXISTS user_2fa (
    user_id          UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    secret_encrypted TEXT NOT NULL,
    enrolled_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_verified_at TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_2fa_user ON user_2fa (user_id);

ALTER TABLE user_2fa ENABLE ROW LEVEL SECURITY;

-- No direct anon/authenticated table access — 2FA secrets only flow through
-- the authenticated API routes (which use the service role + session check).
CREATE POLICY "no_direct_access" ON user_2fa
    FOR ALL USING (false);

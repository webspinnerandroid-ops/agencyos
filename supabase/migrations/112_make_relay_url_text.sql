-- ============================================================================
-- Migration: 112_make_relay_url_text
--
-- Fix: supabase-js serializes a Node Buffer parameter as its JSON *text*
-- ({"type":"Buffer","data":[…]}) rather than raw bytes, which poisoned
-- make_relay_config.encrypted_url BYTEA — the ciphertext became
-- undecryptable and every relay call failed.
--
-- Store the encrypted payload as a plain TEXT hex string instead: exactly
-- the string encrypt() emits, no driver encoding layer in between. The
-- existing poisoned row (if any) is dropped; the user just re-saves the
-- webhook URL in Settings → Social.
-- ============================================================================

ALTER TABLE make_relay_config
  ALTER COLUMN encrypted_url TYPE TEXT USING encode(encrypted_url, 'escape');

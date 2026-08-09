-- Admin-managed provider configuration.
--
-- Keys live here encrypted rather than in .env, so an operator can rotate them
-- from a screen. The encryption key itself stays in the environment — storing
-- it alongside the ciphertext would be locking the vault and taping the key
-- to the door.

CREATE TABLE IF NOT EXISTS provider_credentials (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    TEXT NOT NULL,
  label       TEXT NOT NULL,
  -- AES-256-GCM payload: iv:authTag:ciphertext, all base64.
  secret      TEXT NOT NULL,
  -- Last four characters of the plaintext, so the UI can identify a key
  -- without ever decrypting or transmitting it.
  hint        TEXT NOT NULL,
  priority    INTEGER NOT NULL DEFAULT 0,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, label)
);

CREATE INDEX IF NOT EXISTS provider_credentials_provider_idx
  ON provider_credentials (provider, priority);

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every configuration change is recorded. Who swapped a key and when is the
-- first question asked after an outage.
CREATE TABLE IF NOT EXISTS admin_audit (
  id         BIGSERIAL PRIMARY KEY,
  action     TEXT NOT NULL,
  detail     JSONB NOT NULL DEFAULT '{}'::jsonb,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

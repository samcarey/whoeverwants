-- Push notification infrastructure: per-server VAPID keypair, browser
-- subscriptions (web push + APNS), and a config table for app-wide secrets.
--
-- Storage model:
--   `app_config`         — key/value singleton store. Bootstraps the
--                          server's VAPID keypair (generated lazily on
--                          first push-related request and persisted here
--                          so subsequent restarts reuse it). Per-tier
--                          keypair (canary vs prod vs each dev branch
--                          each get their own row in their own DB).
--   `push_subscriptions` — one row per (browser_id, endpoint) tuple. The
--                          same browser can have multiple endpoints if it
--                          subscribes from multiple devices (we don't try
--                          to dedupe — same browser_id installed on
--                          phone+desktop is two rows). `kind` discriminates
--                          'web_push' (Mozilla/FCM/Apple Web Push) from
--                          'apns' (Capacitor iOS native push tokens). For
--                          web_push the endpoint is the push service URL
--                          and p256dh/auth carry the encryption keys; for
--                          apns the endpoint is the device token and
--                          bundle_id distinguishes prod vs dev builds.

BEGIN;

CREATE TABLE app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  browser_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('web_push', 'apns')),
  endpoint TEXT NOT NULL,
  p256dh TEXT,
  auth TEXT,
  bundle_id TEXT,
  user_agent TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (browser_id, endpoint)
);

-- Fan-out reads come in two shapes: "all subscriptions for browser X"
-- (when checking if a member is reachable) and "all subscriptions for
-- group Y" (in the actual push). The browser_id index serves both —
-- group fan-out goes browser_ids → subscriptions in two steps.
CREATE INDEX push_subscriptions_browser_id_idx
  ON push_subscriptions (browser_id);

COMMIT;

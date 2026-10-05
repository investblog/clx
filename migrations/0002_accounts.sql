-- Plans, API keys, idempotency, operations and connected Cloudflare accounts (docs/spec.md §3, §15).
ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';

-- Only the SHA-256 of a key is kept; the key itself is shown once.
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  -- comma-separated: accounts, sites, links, reports
  scopes TEXT NOT NULL,
  -- comma-separated Cloudflare account ids / client IPs; NULL = any
  allow_accounts TEXT,
  allow_ips TEXT,
  created_at INTEGER NOT NULL,
  -- the UTC day of the last use: written at most once a day
  last_used_day INTEGER,
  -- the call that issued it (a hash of principal, path and Idempotency-Key): a retry of a call
  -- that died after the insert finds the key instead of issuing a second one
  idem_ref TEXT,
  revoked_at INTEGER
);
CREATE INDEX api_keys_user ON api_keys (user_id);
CREATE INDEX api_keys_idem ON api_keys (idem_ref);

-- A mutating call's first answer, for 24 hours (§15).
CREATE TABLE idempotency (
  principal TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  idem_key TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  -- the call that holds the record: only it may store the answer or drop the record
  claim TEXT NOT NULL,
  status INTEGER,
  answer TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (principal, method, path, idem_key)
);

-- An operation with Cloudflare side effects, recorded before its first call (§15).
CREATE TABLE operations (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  -- the Cloudflare account it acts on: its working tokens are named clx-<id>, so these ids are
  -- the only token names clx may treat as its own orphans
  cf_account_id TEXT NOT NULL,
  state TEXT NOT NULL,
  step TEXT NOT NULL,
  -- JSON: the ids of everything created so far, and the error if any
  data TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX operations_account ON operations (cf_account_id);

-- A connected Cloudflare account (§3), with its working token sealed (AES-GCM, src/lib/crypto.ts):
-- the ciphertext sits in the same row as its metadata, so a renewal swaps both in one statement.
CREATE TABLE edge_accounts (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  cf_account_id TEXT NOT NULL UNIQUE,
  cf_account_name TEXT NOT NULL DEFAULT '',
  -- pending, bootstrap_lost, connected, permission_error, revoked
  state TEXT NOT NULL,
  token_id TEXT,
  token_name TEXT,
  token_expires_at INTEGER,
  key_id TEXT,
  token_sealed TEXT,
  -- a renewal's new token, until it has proven itself
  next_sealed TEXT,
  error TEXT,
  operation_id TEXT,
  -- one operation at a time per account: the holder until this time (ms)
  lease_until INTEGER,
  lease_owner TEXT,
  -- the daily check works through accounts oldest-checked first
  token_checked_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX edge_accounts_user ON edge_accounts (user_id);

-- Every mutating Cloudflare API call made on a user's behalf, 90 days (§13 item 1).
CREATE TABLE cf_calls (
  id INTEGER PRIMARY KEY,
  edge_account_id TEXT NOT NULL,
  principal TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX cf_calls_account ON cf_calls (edge_account_id, at);

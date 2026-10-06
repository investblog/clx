-- Sign-up, e-mail confirmation and password reset (docs/spec.md §9).
-- Users made before sign-up (by scripts/user.mjs) count as confirmed.
ALTER TABLE users ADD COLUMN email_confirmed_at INTEGER;
UPDATE users SET email_confirmed_at = created_at;
-- The version of the user's sessions: every refresh session and access token carries the one it was
-- issued under; a password reset bumps it, and everything older is refused.
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;

-- One-time e-mail tokens: only the SHA-256 is kept; one DELETE … RETURNING consumes it.
CREATE TABLE email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- confirm (24 h), reset (1 h)
  kind TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX email_tokens_expiry ON email_tokens (expires_at);

-- E-mails per address: at most one per 10 minutes and 5 per UTC day — global, unlike the rate
-- limiting binding. Keyed by the address, so an unknown address is counted too.
CREATE TABLE email_sends (
  email TEXT PRIMARY KEY,
  day INTEGER NOT NULL,
  count INTEGER NOT NULL,
  last_at INTEGER NOT NULL
) WITHOUT ROWID;

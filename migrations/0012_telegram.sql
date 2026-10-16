-- The Telegram bot (docs/spec.md §17, ADR 0030).
-- One Telegram user to one account, both sides unique: the schema decides, not a check before the
-- insert. The chat to write to is the user's private chat (its id is the user's id in Telegram).
CREATE TABLE tg_identities (
  tg_user_id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  username TEXT,
  linked_at INTEGER NOT NULL
);

-- The dialog of a Telegram user: its step, what it gathered, and a mailed code — an HMAC with the
-- Worker secret TELEGRAM_CODE_KEY, bound to the purpose and to `nonce`, the dialog's instance. A
-- step lives two hours, a code 15 minutes and three tries.
CREATE TABLE tg_states (
  tg_user_id INTEGER PRIMARY KEY,
  step TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  nonce TEXT NOT NULL,
  code_hash TEXT,
  tries INTEGER NOT NULL DEFAULT 0,
  code_until INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);

CREATE INDEX tg_states_expiry ON tg_states (expires_at);

-- Updates claimed: an update_id is inserted before it is handled and marked done after. A delivery
-- that finds it done answers 200; one that finds it still running answers 500, so Telegram tries
-- again later, and takes it over once the claim is a minute old (the Worker that held it died). A
-- passing failure removes the claim, so Telegram's redelivery runs it once more. Kept two days.
CREATE TABLE tg_updates (
  update_id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  -- the claim's own mark: a Worker whose claim was taken over can neither finish nor drop the new one
  claim TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX tg_updates_at ON tg_updates (at);

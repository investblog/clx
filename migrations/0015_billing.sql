-- The balance and Pro (docs/spec.md §18, ADR 0034). Money is integer micro-USD; days are UTC days
-- since 1970 (floor(ms / 86,400,000)).

-- The journal: rows are only ever added, the balance is their sum. A charge is negative.
-- type: deposit | charge | bonus | adjustment | refund | partner_transfer
CREATE TABLE ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  -- the day a charge pays
  day INTEGER,
  -- the invoice a deposit credits (and a refund or a bonus comes from)
  invoice_id TEXT,
  -- one row per operation that may be retried (an operator's command, a bonus)
  op_key TEXT,
  note TEXT,
  -- the operator who wrote it: Telegram user id and their name then
  by_tg INTEGER,
  by_name TEXT,
  created_at INTEGER NOT NULL
);
-- One charge per user and day: a cron delivered twice, a switch racing the cron, charge once.
CREATE UNIQUE INDEX ledger_charge ON ledger (user_id, day) WHERE type = 'charge';
-- One deposit per invoice, whatever told us it was paid.
CREATE UNIQUE INDEX ledger_deposit ON ledger (invoice_id) WHERE type = 'deposit';
CREATE UNIQUE INDEX ledger_op ON ledger (op_key) WHERE op_key IS NOT NULL;
CREATE INDEX ledger_user ON ledger (user_id, id);

-- Pro is on while a period is open (end_day null). Days [start_day, end_day) are Pro's; a period is
-- closed at its first unpaid day when a grace runs out, so a closed period has every day paid.
CREATE TABLE pro_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  start_day INTEGER NOT NULL,
  end_day INTEGER,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX pro_periods_open ON pro_periods (user_id) WHERE end_day IS NULL;
CREATE INDEX pro_periods_user ON pro_periods (user_id, start_day);

-- A plan given by hand (/plan <email> api): never charged.
ALTER TABLE users ADD COLUMN plan_comp INTEGER NOT NULL DEFAULT 0;
-- When the first day Pro's balance did not cover was found; null when nothing is unpaid.
ALTER TABLE users ADD COLUMN grace_since INTEGER;
-- Set by a deletion that passed its money checks; every money writer requires it null.
ALTER TABLE users ADD COLUMN deleting_at INTEGER;
-- When the user was told the balance covers under 14 days of Pro; cleared when it is above again.
ALTER TABLE users ADD COLUMN low_mailed_at INTEGER;
-- Set before a delete or revoke on free, cleared once the plan is applied after it: a run that died
-- in between leaves the user to the hourly check, so the next paused object still gets to work.
ALTER TABLE users ADD COLUMN replan_at INTEGER;

-- What is beyond free's limits on free (ADR 0034): kept, withdrawn from the worker, refused.
ALTER TABLE edge_accounts ADD COLUMN paused_at INTEGER;
ALTER TABLE sites ADD COLUMN paused_at INTEGER;
ALTER TABLE links ADD COLUMN paused_at INTEGER;
ALTER TABLE api_keys ADD COLUMN paused_at INTEGER;

-- Users on `api` before billing — all given it by hand, before it had a price — get $9 and Pro
-- from today (ADR 0034); the cron charges the days and tells them 14 days before it runs out.
INSERT INTO ledger (user_id, type, amount, op_key, note, created_at)
  SELECT id, 'bonus', 9000000, 'pro-start:' || id, 'Pro for 30 days, from clx: the api plan has a price now', CAST(strftime('%s', 'now') AS INTEGER) * 1000
  FROM users WHERE plan = 'api';
INSERT INTO pro_periods (user_id, start_day, created_at)
  SELECT id, CAST(strftime('%s', 'now') AS INTEGER) / 86400, CAST(strftime('%s', 'now') AS INTEGER) * 1000
  FROM users WHERE plan = 'api';

-- A deleted user's money records, kept for accounting without the address (never under a user id
-- SQLite gives to the next user, ADR 0010).
CREATE TABLE billing_archive (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_created_at INTEGER NOT NULL,
  deleted_at INTEGER NOT NULL,
  data TEXT NOT NULL
);

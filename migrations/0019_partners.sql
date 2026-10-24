-- Partners and promo codes (docs/spec.md §19, ADR 0036). Money is integer micro-USD.

-- Every user is a partner: 8 lowercase letters and digits, made at sign-up (old users get theirs here).
ALTER TABLE users ADD COLUMN ref_code TEXT;
-- Distinct by construction: a multiplication by an odd number is a bijection modulo 2^32 (user ids
-- are far below 2^32; the product stays inside 64 bits).
UPDATE users SET ref_code = printf('%08x', (id * 2654435761) % 4294967296) WHERE ref_code IS NULL;
CREATE UNIQUE INDEX users_ref_code ON users (ref_code);
-- Who referred the user, written once when the account is made; cleared when that partner goes (a
-- user id SQLite may give to the next user, ADR 0010).
ALTER TABLE users ADD COLUMN referred_by INTEGER REFERENCES users (id) ON DELETE SET NULL;
CREATE INDEX users_referred_by ON users (referred_by);

-- kind: first_deposit | any_deposit (until `until`) | signup_credit. A fixed bonus.
CREATE TABLE promo_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  bonus INTEGER NOT NULL,
  max_uses INTEGER,
  -- a deposit after this (ms) earns nothing; null for none
  until INTEGER,
  by_tg INTEGER,
  by_name TEXT,
  created_at INTEGER NOT NULL
);
-- The promo code bound at sign-up; its bonus is granted later (a deposit, the e-mail confirmed).
ALTER TABLE users ADD COLUMN promo_id INTEGER REFERENCES promo_codes (id);

-- A use is counted when its bonus is granted: once per user and code.
CREATE TABLE promo_redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  promo_id INTEGER NOT NULL REFERENCES promo_codes (id),
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- the deposit it was granted on; null for a start credit
  invoice_id TEXT,
  amount INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX promo_redemptions_once ON promo_redemptions (promo_id, user_id);

-- The partner's wallet, its own journal. type: commission | clawback | transfer | payout | payout_return.
CREATE TABLE partner_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  -- the referral's deposit a commission or a clawback is about
  invoice_id TEXT,
  referral_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
  rate_bp INTEGER,
  -- a commission is not available before this (the deposit's time + 30 days)
  matures_at INTEGER,
  payout_id INTEGER,
  op_key TEXT,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX partner_ledger_commission ON partner_ledger (invoice_id) WHERE type = 'commission';
CREATE UNIQUE INDEX partner_ledger_op ON partner_ledger (op_key) WHERE op_key IS NOT NULL;
CREATE INDEX partner_ledger_user ON partner_ledger (user_id, id);

-- status: requested -> paid | rejected. Its money is reserved by a `payout` row in the same batch.
CREATE TABLE partner_payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested',
  txid TEXT,
  idem_ref TEXT UNIQUE,
  by_tg INTEGER,
  by_name TEXT,
  -- when the support group heard of the request; the cron tells it again until it has
  told_at INTEGER,
  created_at INTEGER NOT NULL,
  settled_at INTEGER
);
CREATE INDEX partner_payouts_user ON partner_payouts (user_id, created_at);

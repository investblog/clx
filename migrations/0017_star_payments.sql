-- Every Telegram Stars payment, written before anything else is done with it (docs/spec.md §18):
-- the stars are taken by then, so the charge id must outlive a lost support message, the invoice
-- and the user. No foreign keys on purpose — deleting an account must not take these with it.
-- state: received -> credited | review. A row still 'received' is one whose handling died: its
-- redelivery handles it again.
CREATE TABLE star_payments (
  charge_id TEXT PRIMARY KEY,
  tg_user_id INTEGER NOT NULL,
  -- the payload as Telegram sent it: our invoice id, or anything
  invoice_id TEXT,
  stars INTEGER,
  currency TEXT,
  state TEXT NOT NULL DEFAULT 'received',
  reason TEXT,
  -- one delivery handles it at a time; a claim a minute old is a Worker that died
  claim TEXT,
  claimed_at INTEGER,
  -- what the support group must hear of a payment in review, until it has
  message TEXT,
  told_at INTEGER,
  created_at INTEGER NOT NULL,
  settled_at INTEGER
);
CREATE INDEX star_payments_untold ON star_payments (state, told_at);

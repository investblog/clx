-- Refunds (docs/spec.md §18, ADR 0035): asked for by the user, made by an operator, each tied to one
-- deposit. status: requested -> pending -> done; requested -> declined. The journal row is written
-- when the request moves to pending, before any money leaves.
CREATE TABLE refunds (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  invoice_id TEXT NOT NULL,
  rail TEXT NOT NULL,
  -- crypto: where the user asked it to go, checked for the invoice's network
  address TEXT,
  status TEXT NOT NULL DEFAULT 'requested',
  -- micro-USD taken from the balance, set by the operator's /refund
  amount INTEGER,
  -- crypto: the transfer's hash, from /refunded
  txid TEXT,
  by_tg INTEGER,
  by_name TEXT,
  -- when the support group heard of the request; the cron tells it again until it has
  told_at INTEGER,
  created_at INTEGER NOT NULL,
  settled_at INTEGER
);
-- One open request per deposit.
CREATE UNIQUE INDEX refunds_open ON refunds (invoice_id) WHERE status IN ('requested', 'pending');
CREATE INDEX refunds_user ON refunds (user_id, created_at);
CREATE INDEX refunds_untold ON refunds (status, told_at);

-- Top-up invoices (docs/spec.md §18, ADR 0035). One deposit per invoice is held by ledger_deposit.
-- status: pending -> paid | expired | review; expired -> paid | review; review -> paid | void.
-- rail: crypto (Trybit) | stars (Telegram).
CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  rail TEXT NOT NULL,
  -- the nominal, micro-USD; what is credited is what arrived
  usd INTEGER NOT NULL,
  -- USDT_TRC20, USDT_BSC, USDT_ERC20, USDC_ERC20; XTR for Stars
  coin TEXT NOT NULL,
  stars INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  -- Trybit's invoice id (INV-…), or Telegram's telegram_payment_charge_id once paid
  processor_id TEXT UNIQUE,
  -- what the page shows for crypto: the address, the exact amount with fees, Trybit's own page
  address TEXT,
  amount_crypto TEXT,
  pay_url TEXT,
  review_reason TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  paid_at INTEGER,
  -- the Idempotency-Key's record: a retry of a call that died resumes this invoice
  idem_ref TEXT UNIQUE,
  -- when the reconcile run last asked Trybit about it
  reconciled_at INTEGER
);
CREATE INDEX invoices_user ON invoices (user_id, created_at);
CREATE INDEX invoices_open ON invoices (status, created_at);

-- Small facts of the billing runs that must outlive an invocation (Trybit's Retry-After).
CREATE TABLE billing_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

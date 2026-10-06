-- The upgrade advice of each connected Cloudflare account (docs/spec.md §8), computed once a day by
-- the hourly job from the account's analytics; advice_at is when it is due again.
ALTER TABLE edge_accounts ADD COLUMN advice TEXT;
ALTER TABLE edge_accounts ADD COLUMN advice_at INTEGER NOT NULL DEFAULT 0;

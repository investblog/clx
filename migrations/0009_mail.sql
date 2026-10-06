-- E-mails about a Cloudflare account (docs/spec.md §4, §8): the upgrade advice — `over` at once,
-- `upgrade_soon` at most weekly — remembers the last level it wrote about and when; back to `ok` or
-- `watch`, the level is cleared so a new rise is written about at once.
ALTER TABLE edge_accounts ADD COLUMN advice_mailed_level TEXT;
ALTER TABLE edge_accounts ADD COLUMN advice_mailed_at INTEGER NOT NULL DEFAULT 0;
-- "Renew the connection" 30 days before the working token expires (§3 item 6): when it went, so it
-- goes once per token — a renewed token expires a year later and is written about again then.
ALTER TABLE edge_accounts ADD COLUMN renew_mailed_at INTEGER;

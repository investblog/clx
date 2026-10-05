-- Totals pushed by clx-edge workers (docs/spec.md §7) and the heartbeat that comes with them (§4).
-- WITHOUT ROWID: D1 counts every index entry as a row written, so a keyed rowid table would double
-- the writes the §8 budget counts.
CREATE TABLE hourly (
  account_id TEXT NOT NULL,
  target TEXT NOT NULL,
  hour INTEGER NOT NULL,
  views INTEGER NOT NULL,
  bots INTEGER NOT NULL,
  PRIMARY KEY (account_id, target, hour)
) WITHOUT ROWID;

CREATE TABLE daily (
  account_id TEXT NOT NULL,
  target TEXT NOT NULL,
  day INTEGER NOT NULL,
  -- a running snapshot is as of the end of this hour; a final day has its last hour here
  as_of_hour INTEGER NOT NULL,
  final INTEGER NOT NULL,
  views INTEGER NOT NULL,
  bots INTEGER NOT NULL,
  visitors INTEGER NOT NULL,
  PRIMARY KEY (account_id, target, day)
) WITHOUT ROWID;

-- The last push: when, what the worker runs, its queue, its last error, its latest config commit
-- and its counters of dropped items (JSON).
ALTER TABLE edge_accounts ADD COLUMN last_push_at INTEGER;
ALTER TABLE edge_accounts ADD COLUMN push_bundle TEXT;
ALTER TABLE edge_accounts ADD COLUMN push_schema INTEGER;
ALTER TABLE edge_accounts ADD COLUMN push_queue INTEGER;
ALTER TABLE edge_accounts ADD COLUMN push_error TEXT;
ALTER TABLE edge_accounts ADD COLUMN push_revision INTEGER;
ALTER TABLE edge_accounts ADD COLUMN push_dropped TEXT;
-- The receiver's write budget (§8): writes counted on budget_day (a UTC day number).
ALTER TABLE edge_accounts ADD COLUMN budget_day INTEGER NOT NULL DEFAULT 0;
ALTER TABLE edge_accounts ADD COLUMN budget_used INTEGER NOT NULL DEFAULT 0;
-- When the config sync last finished: a heartbeat whose revision differs from it is trusted only
-- after 10 minutes (§6).
ALTER TABLE edge_accounts ADD COLUMN synced_at INTEGER;

-- Accounts disconnected: their totals stay 30 days (§4), then the hourly job deletes them.
CREATE TABLE departed (
  account_id TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);

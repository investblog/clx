-- The nightly backup of D1 `clx` to R2 (src/backup.ts, ADR 0040): one row a day, the run's place —
-- the table it is on and the key of the last row written — so the cron carries it on minute by
-- minute under a lease, and says when it is done or late.
CREATE TABLE backups (
  day TEXT PRIMARY KEY,           -- YYYY-MM-DD, UTC
  tables TEXT NOT NULL,           -- JSON array of the tables, in the order they are written
  table_idx INTEGER NOT NULL DEFAULT 0,
  cursor TEXT,                    -- JSON: the key of the last row written of tables[table_idx]
  seq INTEGER NOT NULL DEFAULT 0, -- the next chunk's number
  rows INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER,
  lease_owner TEXT,
  error TEXT,                     -- the last run's error, cleared by the next good one
  warned_at INTEGER,              -- the support chat was told it is late
  started_at INTEGER NOT NULL,
  done_at INTEGER,
  updated_at INTEGER NOT NULL
);

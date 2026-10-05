-- The install of clx-edge in a connected account (docs/spec.md §4).
-- An admin runs rollouts (§4) and reads the bundle info.
ALTER TABLE users ADD COLUMN admin INTEGER NOT NULL DEFAULT 0;

-- What clx created in the account, by ID: only recorded resources are ever deleted (§4 ownership).
ALTER TABLE edge_accounts ADD COLUMN d1_id TEXT;
-- 1 from the moment clx is about to upload clx-edge until it has deleted it: a script of that name
-- without this mark is someone else's (name_taken)
ALTER TABLE edge_accounts ADD COLUMN script_owned INTEGER NOT NULL DEFAULT 0;
-- the bundle running, its Workers version and the database schema it was checked with
ALTER TABLE edge_accounts ADD COLUMN bundle TEXT;
ALTER TABLE edge_accounts ADD COLUMN version_id TEXT;
ALTER TABLE edge_accounts ADD COLUMN schema INTEGER NOT NULL DEFAULT 0;
-- the worker key, SHA-256 only; after a reinstall the previous one is accepted for a day
ALTER TABLE edge_accounts ADD COLUMN edge_key_hash TEXT;
ALTER TABLE edge_accounts ADD COLUMN edge_key_prev_hash TEXT;
ALTER TABLE edge_accounts ADD COLUMN edge_key_prev_until INTEGER;
-- the deployment waiting for its setup_ok; single-use, cleared when it arrives
ALTER TABLE edge_accounts ADD COLUMN deployment_id TEXT;
ALTER TABLE edge_accounts ADD COLUMN installed_at INTEGER;
CREATE INDEX edge_accounts_edge_key ON edge_accounts (edge_key_hash);
CREATE INDEX edge_accounts_edge_key_prev ON edge_accounts (edge_key_prev_hash);

-- The per-minute runner resumes stalled operations and ends overdue self-checks.
CREATE INDEX operations_running ON operations (state, updated_at);

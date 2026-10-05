-- Sites and the config sync to the worker's database (docs/spec.md §5, §6).
-- The account's config revisions: the last one issued here, and the last one committed in the
-- worker's database. A change issues a revision in the same batch as the change itself.
ALTER TABLE edge_accounts ADD COLUMN config_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE edge_accounts ADD COLUMN synced_revision INTEGER NOT NULL DEFAULT 0;

CREATE TABLE sites (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES edge_accounts (id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- what the worker counts it under, unique in the account
  target TEXT NOT NULL,
  host TEXT NOT NULL,
  zone_id TEXT NOT NULL,
  -- the path, names and snippet all come from it (src/snippet.ts); a rotation replaces it
  seed TEXT NOT NULL,
  -- JSON list of excluded path prefixes
  excluded TEXT NOT NULL DEFAULT '[]',
  -- route_pending, active, route_conflict, deleted
  state TEXT NOT NULL,
  -- the route clx made for the current seed: the only one it deletes (§4 ownership)
  route_id TEXT,
  -- JSON list of past seeds still served after a rotation: {seed, route_id, until}
  retiring TEXT NOT NULL DEFAULT '[]',
  -- the earliest `until` in `retiring`: when the cron next has a route to remove
  retire_at INTEGER,
  -- the config revision of its last change
  revision INTEGER NOT NULL,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- one live site per host; a deleted one keeps its row (totals stay, §15) and frees the host
CREATE UNIQUE INDEX sites_host ON sites (host) WHERE state != 'deleted';
CREATE UNIQUE INDEX sites_target ON sites (account_id, target);
CREATE INDEX sites_account ON sites (account_id, revision);
CREATE INDEX sites_user ON sites (user_id);
CREATE INDEX sites_pending ON sites (state, updated_at);
CREATE INDEX sites_retire ON sites (retire_at);

-- Short links and the link host (docs/spec.md §6), synced to the worker like sites.
-- The link host of a Cloudflare account: a host in one of its zones routed whole (`<host>/*`) to
-- clx-edge. One live host per account; a replaced or removed one keeps its row as `deleted` until
-- its route is gone (route_id NULL), so the cron can finish a removal that failed.
CREATE TABLE link_hosts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES edge_accounts (id) ON DELETE CASCADE,
  host TEXT NOT NULL,
  zone_id TEXT NOT NULL,
  -- route_pending, active, route_conflict, deleted
  state TEXT NOT NULL,
  -- the route clx made: the only one it deletes (§4 ownership)
  route_id TEXT,
  -- the config revision of its last change
  revision INTEGER NOT NULL,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX link_hosts_live ON link_hosts (account_id) WHERE state != 'deleted';
CREATE UNIQUE INDEX link_hosts_host ON link_hosts (host) WHERE state != 'deleted';
CREATE INDEX link_hosts_account ON link_hosts (account_id, revision);
CREATE INDEX link_hosts_pending ON link_hosts (state, updated_at);

CREATE TABLE links (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES edge_accounts (id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- what the worker counts its clicks under, `l…`, unique in the account
  target TEXT NOT NULL,
  -- the path on the link host, unique among the account's live links
  code TEXT NOT NULL,
  url TEXT NOT NULL,
  -- the target's host: a link may not point at the link host (no loops)
  url_host TEXT NOT NULL,
  -- JSON list of {countries?, devices?, url}: the first match wins (§6)
  rules TEXT NOT NULL DEFAULT '[]',
  -- active, deleted; a deleted link keeps its row (totals stay) and frees its code
  state TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX links_code ON links (account_id, code) WHERE state != 'deleted';
CREATE UNIQUE INDEX links_target ON links (account_id, target);
CREATE INDEX links_account ON links (account_id, revision);
CREATE INDEX links_user ON links (user_id, state);

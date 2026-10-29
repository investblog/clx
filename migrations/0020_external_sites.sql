-- External sites (docs/spec.md §5, ADR 0037): a site whose host is in no zone of the account,
-- counted on a route of a collector host that is. `zone` for every site before.
ALTER TABLE sites ADD COLUMN kind TEXT NOT NULL DEFAULT 'zone';
-- the host its route is on; null for a zone site, whose route is on its own host
ALTER TABLE sites ADD COLUMN collector_host TEXT;

-- A live zone site's host stays unique across clx; an external site reserves its host for no one
-- else, and a user holds a host once, as either kind.
DROP INDEX sites_host;
CREATE UNIQUE INDEX sites_host ON sites (host) WHERE state != 'deleted' AND kind = 'zone';
CREATE UNIQUE INDEX sites_user_host ON sites (user_id, host) WHERE state != 'deleted';
CREATE INDEX sites_collector ON sites (account_id, collector_host) WHERE collector_host IS NOT NULL;

-- Link hosts per site (docs/spec.md §6, ADR 0024): many per account, each a Workers Custom Domain of
-- clx-edge rather than a route; a link belongs to a host, its code unique on that host.
--
-- Only for a database with no link hosts and no links yet (clx.cx had none on 11.10.2026): an old
-- host's route is not a custom domain and its links sit under the old config keys, so moving them is
-- not done here — such a database stops at this guard instead of breaking quietly. Remove the old
-- link hosts and links first (they are config: delete them in the app, then migrate).
CREATE TABLE migration_0011_guard (n INTEGER NOT NULL CHECK (n = 0));
INSERT INTO migration_0011_guard SELECT (SELECT count(*) FROM link_hosts) + (SELECT count(*) FROM links);
DROP TABLE migration_0011_guard;

DROP INDEX link_hosts_live;
DROP INDEX link_hosts_host;
ALTER TABLE link_hosts RENAME COLUMN route_id TO domain_id;
-- The site the host was made for ({site_id}); NULL for a host the user named.
ALTER TABLE link_hosts ADD COLUMN site_id TEXT;
-- A host stays taken while its custom domain exists, deleted or not: nothing new may claim a domain
-- clx is still to remove.
CREATE UNIQUE INDEX link_hosts_host ON link_hosts (host) WHERE state != 'deleted' OR domain_id IS NOT NULL;
CREATE INDEX link_hosts_site ON link_hosts (site_id);

ALTER TABLE links ADD COLUMN host_id TEXT;
DROP INDEX links_code;
CREATE UNIQUE INDEX links_code ON links (host_id, code) WHERE state != 'deleted';
CREATE INDEX links_host ON links (host_id, state);

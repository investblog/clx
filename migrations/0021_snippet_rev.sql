-- What wrote a site's config to its worker (src/snippet.ts SNIPPET_REV, ADR 0039): the snippet code
-- and the config revision, recorded by a sync of the Worker that knows the code, for the rows it
-- wrote. A synced site whose record does not match — every site before this migration, or one an
-- older Worker synced — is written again by the cron. Applied before that Worker: the one before
-- ignores both columns.
ALTER TABLE sites ADD COLUMN snippet_rev INTEGER;
ALTER TABLE sites ADD COLUMN written_rev INTEGER;

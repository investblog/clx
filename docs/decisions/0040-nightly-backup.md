---
title: The nightly backup of D1 clx to R2
type: decision
status: accepted
date: 2026-11-01
---

# 0040. The nightly backup of D1 `clx` to R2

**Context.** ADR 0006 put the backup off until after the release, when R2 would be switched on in
the clx.cx account. On 01.11.2026 R2 was found already on there (`r2_paid`, used by another project
of the owner's), so nothing had to be bought. 301's job — every table at once into one gzipped
NDJSON object — fits a small database; clx's totals can reach millions of rows (`daily`: up to 400
days for each site and link), beyond what one cron call may read, hold or query.

**Decision.** Supersedes 0006's "later":

- a bucket `clx-backups` of its own in the clx.cx account, with a lifecycle rule deleting objects
  after 30 days (set with the owner's Global API Key, like the other one-off setup);
- `src/backup.ts`, bound as `BACKUPS`, run by the minute cron from 03:00 UTC — except in the
  reconcile and hourly minutes, which need the call's time: a slice a minute (pages of 100 rows, at
  most about 40 queries, 8 MB of NDJSON counted row by row, or 10 s of reading) under a lease in a `backups` row
  (migration 0022), which also keeps the run's place — the table and the key of the last row
  written, read again once the lease is held. The oldest unfinished run goes first, so one cut
  short by midnight is finished before the next day's starts. Each table is read in
  the order of its key (rowid, or a WITHOUT ROWID table's primary key) from that key, so a row
  present throughout is written once; rows changed while the run goes may be either way — it is
  not a snapshot (D1's own Time Travel is, for 30 days, while the database exists);
- each slice is one gzipped NDJSON chunk, `clx/<day>/<seq>.ndjson.gz`, a `{"_table"}` line before a
  table's first rows; the run ends with `clx/<day>/manifest.json` (tables, chunks, rows);
- left out: D1's own tables, the run's state, and what is short-lived by design — `idempotency`,
  `tg_updates`, `tg_states`, and `email_sends` (a day's send counts, keyed by any address typed in);
- a run not done by 12:00 UTC of its day is told to the support chat — once it has gone, tried
  again each minute until then; the run's last error is kept in its row.

**Consequences.** A copy holds e-mail addresses, password hashes and the users' sealed working
tokens; the tokens open only with `MASTER_KEYS` (spec §13 item 1), and after a rotation (ADR 0038)
an older copy's tokens no longer open at all. What a user deletes stays in the copies until they
expire, 30 days — said on /privacy. Restoring is by hand: the chunks are read in order, table by
table.

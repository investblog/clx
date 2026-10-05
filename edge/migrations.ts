// The clx-edge database schema (docs/spec.md §4): one ordered list. D1 refuses `PRAGMA
// user_version` (SQLITE_AUTH, checked 05.10.2026), so the number of the last migration applied is
// kept in `meta` under the key `schema`. clx.cx applies them through the D1 REST API before it
// uploads new code. Each one is additive and re-runnable (IF NOT EXISTS) and is sent in one call
// with its number, so a call that stops halfway is safe to repeat.
import { ACCOUNT, HOUR_COLUMNS } from './contract';

export const MIGRATIONS: string[] = [
  // 1. The worker's own small state: the schema number, later its cursors and counters (§5, §7).
  'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value)',
  // 2. Config as immutable versions plus a commit log (§6): rows are only ever inserted; a sync
  //    becomes visible when its (revision, sync_id) is committed, in one statement.
  'CREATE TABLE IF NOT EXISTS cfg (key TEXT NOT NULL, revision INTEGER NOT NULL, sync_id TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, data TEXT, at INTEGER NOT NULL, PRIMARY KEY (key, revision, sync_id)); ' +
    'CREATE TABLE IF NOT EXISTS commits (revision INTEGER PRIMARY KEY, sync_id TEXT NOT NULL, at INTEGER NOT NULL)',
  // 3. Counting (§5). WITHOUT ROWID: D1 counts every index entry as a row written, so a new row of a
  //    keyed rowid table costs 2 writes, here 1 (docs/cloudflare-facts.md). The trigger keeps the
  //    per-hour row counters of the detail caps; it fires only on a row really inserted.
  `CREATE TABLE IF NOT EXISTS totals (target TEXT NOT NULL, day INTEGER NOT NULL, views INTEGER NOT NULL DEFAULT 0, bots INTEGER NOT NULL DEFAULT 0, ${HOUR_COLUMNS.map((c) => `${c} INTEGER NOT NULL DEFAULT 0`).join(', ')}, PRIMARY KEY (target, day)) WITHOUT ROWID; ` +
    'CREATE TABLE IF NOT EXISTS views_hourly (target TEXT NOT NULL, hour INTEGER NOT NULL, page TEXT NOT NULL, source TEXT NOT NULL, country TEXT NOT NULL, device TEXT NOT NULL, browser TEXT NOT NULL, os TEXT NOT NULL, views INTEGER NOT NULL, PRIMARY KEY (target, hour, page, source, country, device, browser, os)) WITHOUT ROWID; ' +
    'CREATE TABLE IF NOT EXISTS rows_hourly (scope TEXT NOT NULL, hour INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (scope, hour)) WITHOUT ROWID; ' +
    'CREATE TRIGGER IF NOT EXISTS views_hourly_rows AFTER INSERT ON views_hourly BEGIN ' +
    'INSERT INTO rows_hourly (scope, hour, n) VALUES (NEW.target, NEW.hour, 1) ON CONFLICT (scope, hour) DO UPDATE SET n = n + 1; ' +
    `INSERT INTO rows_hourly (scope, hour, n) SELECT '${ACCOUNT}', NEW.hour, 1 WHERE NEW.target != '${ACCOUNT}' ON CONFLICT (scope, hour) DO UPDATE SET n = n + 1; END; ` +
    'CREATE TABLE IF NOT EXISTS visitors_daily (target TEXT NOT NULL, day INTEGER NOT NULL, vhash TEXT NOT NULL, PRIMARY KEY (target, day, vhash)) WITHOUT ROWID; ' +
    'CREATE TABLE IF NOT EXISTS bots_hourly (target TEXT NOT NULL, hour INTEGER NOT NULL, category TEXT NOT NULL, hits INTEGER NOT NULL, PRIMARY KEY (target, hour, category)) WITHOUT ROWID; ' +
    'CREATE TABLE IF NOT EXISTS salts (day INTEGER PRIMARY KEY, salt TEXT NOT NULL)',
  // 4. The day close and the queue (§5, §7). A closed day's totals with its visitor count wait in
  //    final_days until clx.cx accepts them (new columns on totals could not be re-run: ALTER TABLE
  //    ADD COLUMN fails the second time). Drop counters of refused items live in sync_status.
  'CREATE TABLE IF NOT EXISTS views_daily (target TEXT NOT NULL, day INTEGER NOT NULL, page TEXT NOT NULL, source TEXT NOT NULL, country TEXT NOT NULL, device TEXT NOT NULL, browser TEXT NOT NULL, os TEXT NOT NULL, views INTEGER NOT NULL, PRIMARY KEY (target, day, page, source, country, device, browser, os)) WITHOUT ROWID; ' +
    'CREATE TABLE IF NOT EXISTS bots_daily (target TEXT NOT NULL, day INTEGER NOT NULL, category TEXT NOT NULL, hits INTEGER NOT NULL, PRIMARY KEY (target, day, category)) WITHOUT ROWID; ' +
    'CREATE TABLE IF NOT EXISTS final_days (target TEXT NOT NULL, day INTEGER NOT NULL, views INTEGER NOT NULL, bots INTEGER NOT NULL, visitors INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (target, day)) WITHOUT ROWID; ' +
    'CREATE TABLE IF NOT EXISTS closed_days (day INTEGER PRIMARY KEY); ' +
    'CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY, hour INTEGER NOT NULL, items TEXT NOT NULL); ' +
    'CREATE TABLE IF NOT EXISTS sync_status (reason TEXT PRIMARY KEY, n INTEGER NOT NULL)',
];

export const SCHEMA = MIGRATIONS.length;

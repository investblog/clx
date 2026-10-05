// The clx-edge database schema (docs/spec.md §4): one ordered list. D1 refuses `PRAGMA
// user_version` (SQLITE_AUTH, checked 05.10.2026), so the number of the last migration applied is
// kept in `meta` under the key `schema`. clx.cx applies them through the D1 REST API before it
// uploads new code. Each one is additive and re-runnable (IF NOT EXISTS) and is sent in one call
// with its number, so a call that stops halfway is safe to repeat.
export const MIGRATIONS: string[] = [
  // 1. The worker's own small state: the schema number, later its cursors and counters (§5, §7).
  'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value)',
  // 2. Config as immutable versions plus a commit log (§6): rows are only ever inserted; a sync
  //    becomes visible when its (revision, sync_id) is committed, in one statement.
  'CREATE TABLE IF NOT EXISTS cfg (key TEXT NOT NULL, revision INTEGER NOT NULL, sync_id TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, data TEXT, at INTEGER NOT NULL, PRIMARY KEY (key, revision, sync_id)); ' +
    'CREATE TABLE IF NOT EXISTS commits (revision INTEGER PRIMARY KEY, sync_id TEXT NOT NULL, at INTEGER NOT NULL)',
];

export const SCHEMA = MIGRATIONS.length;

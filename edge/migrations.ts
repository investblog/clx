// The clx-edge database schema (docs/spec.md §4): one ordered list. D1 refuses `PRAGMA
// user_version` (SQLITE_AUTH, checked 05.10.2026), so the number of the last migration applied is
// kept in `meta` under the key `schema`. clx.cx applies them through the D1 REST API before it
// uploads new code. Each one is additive and re-runnable (IF NOT EXISTS) and is sent in one call
// with its number, so a call that stops halfway is safe to repeat.
export const MIGRATIONS: string[] = [
  // 1. The worker's own small state: the schema number, later its cursors and counters (§5, §7).
  'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value)',
];

export const SCHEMA = MIGRATIONS.length;

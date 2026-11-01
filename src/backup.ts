// The nightly backup of D1 `clx` to R2 (docs/spec.md §13 item 12, ADR 0040). From 03:00 UTC the
// minute cron carries the run on, a slice at a time under a lease — the oldest unfinished run first,
// so one cut short by midnight is finished. Each table is read in the order of its key (rowid, or a
// WITHOUT ROWID table's primary key) from the last key written, so no row present throughout is
// lost or written twice; each slice is one gzipped NDJSON chunk, `clx/<day>/<seq>.ndjson.gz` (a
// `{"_table"}` line before a table's first rows), and the run ends with `clx/<day>/manifest.json`.
// Not a snapshot: rows changed while it runs may be either way. The bucket deletes objects after
// 30 days. A run not done by 12:00 UTC of its day is told to the support chat once.
import { sendMessage } from './tg/api';
import { supportChat } from './tg/support';
import type { Env } from './types';
import { newId } from './v1/http';

/** Left out: D1's own tables, the run's own state, and what is short-lived by design. */
const SKIP = new Set(['d1_migrations', 'backups', 'idempotency', 'tg_updates', 'tg_states', 'email_sends']);
const START_HOUR = 3;
const LATE_HOUR = 12;
const LEASE = 5 * 60_000;
const KEEP_DAYS = 40;
/** One slice: pages of `page` rows, at most `queries` queries, `bytes` of NDJSON and `ms` of reading
 *  — what is left of the call is for the gzip and the R2 write. */
const LIMITS = { page: 100, queries: 40, bytes: 8 * 1024 * 1024, ms: 10_000 };
const utf8 = new TextEncoder();

interface Run {
  day: string;
  tables: string;
  table_idx: number;
  cursor: string | null;
  seq: number;
  rows: number;
  warned_at: number | null;
}

/** How a table is walked: by rowid, or by its primary key's columns. */
async function keyOf(db: D1Database, table: string): Promise<string[]> {
  const sql = (await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").bind(table).first<string>('sql')) ?? '';
  if (!/WITHOUT\s+ROWID/iu.test(sql)) return ['rowid'];
  const cols = (await db.prepare(`PRAGMA table_info("${table}")`).all<{ name: string; pk: number }>()).results;
  return cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
}

/**
 * One minute's share of the backup. Returns what this call wrote, or null when it had nothing to do
 * (no bucket bound, before 03:00 with no run open, all done, or another call holds the run).
 */
export async function runBackup(env: Env, now = Date.now(), limits = LIMITS): Promise<{ day: string; chunk: string | null; rows: number; done: boolean } | null> {
  const db = env.DB;
  if (!env.BACKUPS) return null;
  const at = new Date(now);
  const today = at.toISOString().slice(0, 10);
  let day = await db.prepare('SELECT day FROM backups WHERE done_at IS NULL ORDER BY day LIMIT 1').first<string>('day');
  if (!day) {
    if (at.getUTCHours() < START_HOUR) return null;
    if (await db.prepare('SELECT 1 FROM backups WHERE day = ?').bind(today).first()) return null; // today's is done
    const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all<{ name: string }>()).results
      .map((t) => t.name)
      .filter((t) => !SKIP.has(t));
    await db.batch([
      db.prepare('INSERT OR IGNORE INTO backups (day, tables, started_at, updated_at) VALUES (?1, ?2, ?3, ?3)').bind(today, JSON.stringify(tables), now),
      db.prepare('DELETE FROM backups WHERE day < ?').bind(new Date(now - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10)),
    ]);
    day = today;
  }

  const owner = newId();
  const claimed = await db
    .prepare('UPDATE backups SET lease_until = ?2, lease_owner = ?3 WHERE day = ?1 AND done_at IS NULL AND (lease_until IS NULL OR lease_until < ?4)')
    .bind(day, now + LEASE, owner, now)
    .run();
  if (!claimed.meta.changes) return null;
  try {
    // Read under the lease: what another call wrote before it let go counts.
    const run = (await db.prepare('SELECT * FROM backups WHERE day = ? AND lease_owner = ?').bind(day, owner).first<Run>())!;
    const tables = JSON.parse(run.tables) as string[];
    if (!run.warned_at && now >= Date.parse(`${day}T${String(LATE_HOUR).padStart(2, '0')}:00:00Z`)) {
      const chat = supportChat(env);
      const sent =
        chat !== null && !!env.TELEGRAM_BOT_TOKEN &&
        (await sendMessage(env, chat, `🗄 The clx.cx backup of ${day} is not done yet: ${run.rows} rows so far, table ${run.table_idx + 1} of ${tables.length}.`).catch(() => false));
      if (sent) await db.prepare('UPDATE backups SET warned_at = ?3 WHERE day = ?1 AND lease_owner = ?2').bind(day, owner, now).run();
    }

    let idx = run.table_idx;
    let cursor = run.cursor ? (JSON.parse(run.cursor) as unknown[]) : null;
    const lines: string[] = [];
    let rows = 0;
    let bytes = 0;
    let queries = 0;
    const until = Date.now() + limits.ms;
    let full = false;
    while (!full && idx < tables.length && queries < limits.queries && Date.now() < until) {
      const table = tables[idx]!;
      const key = await keyOf(db, table);
      queries += 2;
      const header = cursor ? -1 : lines.push(JSON.stringify({ _table: table })) - 1;
      const cols = key.map((c) => (c === 'rowid' ? 'rowid' : `"${c}"`));
      const sel = `SELECT ${cols.map((c, i) => `${c} AS "_k${i}"`).join(', ')}, * FROM "${table}"`;
      const where = cursor ? ` WHERE (${cols.join(', ')}) > (${cols.map(() => '?').join(', ')})` : '';
      const page = (await db.prepare(`${sel}${where} ORDER BY ${cols.join(', ')} LIMIT ${limits.page}`).bind(...(cursor ?? [])).all<Record<string, unknown>>()).results;
      queries++;
      // Row by row up to the slice's bytes (one row always goes, however large): the cursor is the
      // last row taken.
      let taken: Record<string, unknown> | null = null;
      for (const row of page) {
        const out = { ...row };
        for (let i = 0; i < cols.length; i++) delete out[`_k${i}`];
        const line = JSON.stringify(out);
        const size = utf8.encode(line).length + 1;
        if (rows > 0 && bytes + size > limits.bytes) {
          full = true;
          break;
        }
        lines.push(line);
        bytes += size;
        rows++;
        taken = row;
      }
      if (taken) cursor = cols.map((_, i) => taken![`_k${i}`]);
      else if (full && header >= 0) lines.splice(header, 1); // the table starts in the next chunk
      if (!full && page.length < limits.page) {
        idx++;
        cursor = null;
      }
    }
    let chunk: string | null = null;
    if (lines.length) {
      chunk = `clx/${day}/${String(run.seq).padStart(4, '0')}.ndjson.gz`;
      const gz = await new Response(new Blob([`${lines.join('\n')}\n`]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
      await env.BACKUPS.put(chunk, gz, { httpMetadata: { contentType: 'application/gzip' } });
    }
    const done = idx >= tables.length;
    if (done) {
      await env.BACKUPS.put(`clx/${day}/manifest.json`, JSON.stringify({ day, tables, chunks: run.seq + (chunk ? 1 : 0), rows: run.rows + rows, done_at: new Date(Date.now()).toISOString() }), {
        httpMetadata: { contentType: 'application/json' },
      });
    }
    await db
      .prepare(
        'UPDATE backups SET table_idx = ?3, cursor = ?4, seq = seq + ?5, rows = rows + ?6, error = NULL, done_at = ?7, lease_until = NULL, lease_owner = NULL, updated_at = ?8 WHERE day = ?1 AND lease_owner = ?2',
      )
      .bind(day, owner, idx, cursor ? JSON.stringify(cursor) : null, chunk ? 1 : 0, rows, done ? Date.now() : null, Date.now())
      .run();
    return { day, chunk, rows, done };
  } catch (e) {
    await db.prepare('UPDATE backups SET error = ?3, lease_until = NULL, lease_owner = NULL, updated_at = ?4 WHERE day = ?1 AND lease_owner = ?2').bind(day, owner, e instanceof Error ? e.message : String(e), Date.now()).run();
    throw e;
  }
}

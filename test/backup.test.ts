// The nightly backup of D1 `clx` to R2 (ADR 0040): from 03:00 UTC a slice a minute under a lease,
// the oldest unfinished run first, each table in key order from the last key written, chunks of
// gzipped NDJSON and a manifest; late runs are told to the support chat once.
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runBackup } from '../src/backup';
import type { Env } from '../src/types';
import { testEnv } from './env';
import { fakeTg, useFakeCloudflare } from './fake-cf';

let env: Env;
let dispose: () => Promise<void>;
const GROUP = -100778;
const DAY = Date.UTC(2026, 10, 1);
const AT = (d: number, h: number, m = 0) => DAY + d * 86_400_000 + h * 3_600_000 + m * 60_000;
const SMALL = { page: 500, queries: 6, bytes: 1e9, ms: 60_000 };

beforeAll(async () => {
  ({ env, dispose } = await testEnv());
  env = { ...env, TELEGRAM_BOT_TOKEN: '123:bot', TELEGRAM_SUPPORT_CHAT: String(GROUP) };
  await env.DB.batch([
    // More users than one page; a WITHOUT ROWID table walked by its composite key; a table to leave out.
    env.DB.prepare("INSERT INTO users (id, email, password_hash, created_at) SELECT value, 'u' || value || '@example.com', 'x', 0 FROM json_each(?)").bind(JSON.stringify(Array.from({ length: 1201 }, (_, i) => i + 1))),
    env.DB.prepare('INSERT INTO hourly (account_id, target, hour, views, bots) SELECT ?1, value, 7, 1, 0 FROM json_each(?2)').bind('a1', JSON.stringify(Array.from({ length: 700 }, (_, i) => `t${String(i).padStart(4, '0')}`))),
    env.DB.prepare("INSERT INTO email_sends (email, day, count, last_at) VALUES ('nobody@example.com', 1, 1, 0)"),
    env.DB.prepare('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT)'),
  ]);
});
afterAll(() => dispose());
useFakeCloudflare();

const state = (day: string) => env.DB.prepare('SELECT tables, table_idx, cursor, seq, warned_at, done_at FROM backups WHERE day = ?').bind(day).first<{ tables: string; table_idx: number; cursor: string | null; seq: number; warned_at: number | null; done_at: number | null }>();

async function read(day: string) {
  const manifest = JSON.parse(await (await env.BACKUPS!.get(`clx/${day}/manifest.json`))!.text()) as { chunks: number; rows: number; tables: string[] };
  const lines: Record<string, unknown>[] = [];
  for (let i = 0; i < manifest.chunks; i++) {
    const o = (await env.BACKUPS!.get(`clx/${day}/${String(i).padStart(4, '0')}.ndjson.gz`))!;
    lines.push(...new TextDecoder().decode(gunzipSync(new Uint8Array(await o.arrayBuffer()))).trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>));
  }
  /** Rows by table, in the order written. */
  const byTable = new Map<string, Record<string, unknown>[]>();
  let current = '';
  for (const l of lines) {
    if ('_table' in l) byTable.set((current = l._table as string), []);
    else byTable.get(current)!.push(l);
  }
  return { manifest, byTable };
}

describe('backup', () => {
  it('nothing before 03:00 UTC, nor without the bucket', async () => {
    expect(await runBackup(env, AT(0, 2, 59), SMALL)).toBeNull();
    expect(await runBackup({ ...env, BACKUPS: undefined }, AT(0, 4), SMALL)).toBeNull();
  });

  it('carries the run on a slice at a time; rows present throughout are written once, changes between pages either way', async () => {
    let minute = 0;
    let last = await runBackup(env, AT(0, 3, minute++), SMALL);
    expect(last).toMatchObject({ day: '2026-11-01', chunk: 'clx/2026-11-01/0000.ndjson.gz', done: false });
    // On to the first page of users…
    for (let s = await state('2026-11-01'); !(JSON.parse(s!.tables)[s!.table_idx] === 'users' && s!.cursor); s = await state('2026-11-01')) last = await runBackup(env, AT(0, 3, minute++), SMALL);
    // …then, between its pages, a row already written goes and a row ahead comes.
    await env.DB.batch([env.DB.prepare('DELETE FROM users WHERE id = 1'), env.DB.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (5000, 'late@example.com', 'x', 0)")]);
    while (!last?.done && minute < 60) last = await runBackup(env, AT(0, 3, minute++), SMALL);
    expect(last?.done).toBe(true);
    const { manifest, byTable } = await read('2026-11-01');
    expect(manifest.chunks).toBeGreaterThan(2);
    const users = byTable.get('users')!.map((r) => r.id as number);
    expect(new Set(users).size).toBe(users.length);
    expect(users.slice(0, 500)).toEqual(Array.from({ length: 500 }, (_, i) => i + 1));
    for (let id = 2; id <= 1201; id++) expect(users).toContain(id);
    expect(users).toContain(5000);
    expect(byTable.get('hourly')!.map((r) => r.target)).toEqual(Array.from({ length: 700 }, (_, i) => `t${String(i).padStart(4, '0')}`));
    for (const t of ['email_sends', 'idempotency', 'tg_updates', 'tg_states', 'd1_migrations', 'backups']) expect(byTable.has(t)).toBe(false);
    expect(manifest.rows).toBe([...byTable.values()].reduce((n, rows) => n + rows.length, 0));
    expect(await runBackup(env, AT(0, 5), SMALL)).toBeNull();
  });

  it('one call at a time; a call after the lease goes reads the run as the last holder left it', async () => {
    const [a, b] = await Promise.all([runBackup(env, AT(1, 3), SMALL), runBackup(env, AT(1, 3), SMALL)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    // Another holder moved the run on and let go: the next call goes on from there.
    await env.DB.prepare("UPDATE backups SET seq = 7, lease_owner = NULL, lease_until = NULL WHERE day = '2026-11-02'").run();
    expect((await runBackup(env, AT(1, 3, 1), SMALL))?.chunk).toBe('clx/2026-11-02/0007.ndjson.gz');
  });

  it('a run cut short by midnight is finished first, told to the support chat once when late', async () => {
    fakeTg.reset();
    // 3 November, noon: the run of the 2nd is still open — it goes on, and it is late.
    const r = await runBackup(env, AT(2, 12), SMALL);
    expect(r?.day).toBe('2026-11-02');
    expect(fakeTg.said(GROUP)).toContain('backup of 2026-11-02 is not done yet');
    await runBackup(env, AT(2, 12, 1), SMALL);
    expect(fakeTg.sent.filter((m) => m.chat_id === GROUP)).toHaveLength(1);
    let last = r;
    for (let m = 2; m < 60 && !last?.done; m++) last = await runBackup(env, AT(2, 12, m), SMALL);
    expect((await state('2026-11-02'))!.done_at).not.toBeNull();
    // Then the day's own.
    expect((await runBackup({ ...env, TELEGRAM_BOT_TOKEN: undefined }, AT(2, 13), SMALL))?.day).toBe('2026-11-03');
  });

  it('a warning that does not go is tried again', async () => {
    fakeTg.reset();
    const quiet = { ...env, TELEGRAM_BOT_TOKEN: undefined };
    await runBackup(quiet, AT(2, 14), SMALL);
    expect((await state('2026-11-03'))!.warned_at).toBeNull();
    await runBackup(env, AT(2, 14, 1), SMALL);
    expect((await state('2026-11-03'))!.warned_at).toBe(AT(2, 14, 1));
  });

  it('a chunk stops at its bytes, mid-page, and the next goes on from the last row taken', async () => {
    const TIGHT = { page: 500, queries: 40, bytes: 20_000, ms: 60_000 };
    // Finish what is open, then a whole run of the 5th under the tight limit.
    for (let m = 0; m < 600 && (await env.DB.prepare('SELECT 1 FROM backups WHERE done_at IS NULL').first()); m++) await runBackup(env, AT(4, 3) + m * 60_000, TIGHT);
    let last = null;
    for (let m = 0; m < 600 && !last?.done; m++) last = await runBackup(env, AT(4, 13) + m * 60_000, TIGHT);
    expect(last).toMatchObject({ day: '2026-11-05', done: true });
    const { manifest, byTable } = await read('2026-11-05');
    for (let i = 0; i < manifest.chunks; i++) {
      const o = (await env.BACKUPS!.get(`clx/2026-11-05/${String(i).padStart(4, '0')}.ndjson.gz`))!;
      const text = new TextDecoder().decode(gunzipSync(new Uint8Array(await o.arrayBuffer())));
      // Its rows within the limit; a table's header line on top.
      const rowBytes = text.trim().split('\n').filter((l) => !l.startsWith('{"_table"')).reduce((n, l) => n + new TextEncoder().encode(l).length + 1, 0);
      expect(rowBytes).toBeLessThanOrEqual(TIGHT.bytes);
    }
    const users = byTable.get('users')!.map((r) => r.id as number);
    expect(new Set(users).size).toBe(users.length);
    expect(users).toHaveLength(1201);
    expect(byTable.get('hourly')).toHaveLength(700);
  });
});

// The worker's hourly run (docs/spec.md §5, §7) on a real SQLite with the worker's migrations: the
// day close with its caps, the queue of closed hours, expiry, and the query ledger.
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT, OTHER, type SiteConfig } from '../edge/contract';
import { MIGRATIONS } from '../edge/migrations';
import { d1 } from './d1';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const H = 3_600_000;
const D0 = Date.UTC(2026, 9, 5);
const DAY0 = D0 / (24 * H);
const site = (t: string): SiteConfig => ({ t, paths: [{ path: '/p', c: 'c', s: 's', script: '' }], excluded: [] });

let db: DatabaseSync;
let size = 0;
let count = { n: 0 };
let collect: typeof import('../edge/collect').collect;
let hourly: typeof import('../edge/cron').hourly;
beforeEach(async () => {
  db = new DatabaseSync(':memory:');
  for (const m of MIGRATIONS) db.exec(m);
  size = 0;
  vi.resetModules();
  ({ collect } = await import('../edge/collect'));
  ({ hourly } = await import('../edge/cron'));
});
const binding = () => d1(db, { size: () => size, count });
const all = (sql: string, ...args: (string | number)[]) => db.prepare(sql).all(...args).map((r) => ({ ...r }));
function view(at: number, o: { t?: string; page?: string; ip?: string; ua?: string } = {}) {
  const req = new Request('https://example.com/p/c', { method: 'POST', body: 'x', headers: { referer: `https://example.com${o.page ?? '/'}`, 'user-agent': o.ua ?? CHROME, 'cf-connecting-ip': o.ip ?? '10.0.0.1' } });
  return collect(binding(), req, '', 'example.com', site(o.t ?? 's1'), at);
}
// clx.cx is down here (503): the queue stays as it is, so these tests see what the steps left.
// Sending itself is tested in push.test.ts.
const WORKER = { HOOK_URL: 'https://clx.test/hook', EDGE_KEY: 'k'.repeat(43), BUNDLE: 'b'.repeat(64) };
let pushes: unknown[] = [];
beforeEach(() => {
  pushes = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => (pushes.push(JSON.parse(String(init.body))), new Response('{}', { status: 503 })));
  return () => vi.unstubAllGlobals();
});
const run = async (at: number) => {
  count = { n: 0 };
  const r = await hourly(binding(), at, WORKER);
  return { ...r, errors: r.errors.filter((e) => e !== 'push: 503') };
};
const outbox = () => all('SELECT hour, items FROM outbox ORDER BY id').map((r) => ({ hour: r.hour, items: JSON.parse(r.items as string) }));

describe('the queue', () => {
  it('queues each closed hour of a site once, with a running snapshot of the day', async () => {
    await view(D0 + 10.5 * H);
    await view(D0 + 10.6 * H, { ip: '10.0.0.2' });
    await view(D0 + 10.7 * H, { ua: 'curl/8' });
    const r = await run(D0 + 11 * H + 300_000);
    expect(r).toMatchObject({ closed: [], errors: [] });
    expect(outbox()).toEqual([
      { hour: DAY0 * 24 + 10, items: [{ target: 's1', hour: DAY0 * 24 + 10, views: 2, bots: 1 }] },
      { hour: DAY0 * 24 + 10, items: [{ target: 's1', day: DAY0, as_of_hour: DAY0 * 24 + 10, final: false, views: 2, bots: 1, visitors: 2 }] },
    ]);
    // The same run again queues nothing new; the next hour queues only that hour.
    await run(D0 + 11 * H + 600_000);
    expect(outbox()).toHaveLength(2);
    await view(D0 + 11.5 * H);
    await run(D0 + 12 * H + 300_000);
    expect(outbox().slice(2)).toEqual([
      { hour: DAY0 * 24 + 11, items: [{ target: 's1', hour: DAY0 * 24 + 11, views: 1, bots: 0 }] },
      { hour: DAY0 * 24 + 11, items: [{ target: 's1', day: DAY0, as_of_hour: DAY0 * 24 + 11, final: false, views: 3, bots: 1, visitors: 2 }] },
    ]);
  });

  it('a cron fired twice for the same hour queues it once', async () => {
    await view(D0 + 10.5 * H);
    await Promise.all([run(D0 + 11 * H + 300_000), run(D0 + 11 * H + 300_000)]);
    expect(outbox()).toHaveLength(2);
  });

  it('links are not queued by the hour; under storage backpressure only the cursor moves', async () => {
    await view(D0 + 10.5 * H, { t: 'l1' });
    await run(D0 + 11 * H + 300_000);
    expect(outbox()).toEqual([]);
    await view(D0 + 11.5 * H);
    size = 400 * 1024 * 1024;
    await run(D0 + 12 * H + 300_000);
    expect(outbox()).toEqual([]);
    expect(all("SELECT value FROM meta WHERE key = 'outboxed_through'")).toEqual([{ value: DAY0 * 24 + 11 }]);
  });
});

describe('the day close', () => {
  it('rolls the hours into the day, keeps the final totals with visitors, drops the open-day state', async () => {
    await view(D0 + 10.5 * H, { page: '/a' });
    await view(D0 + 13.5 * H, { page: '/a', ip: '10.0.0.2' });
    await view(D0 + 13.6 * H, { page: '/b' });
    await view(D0 + 13.7 * H, { ua: 'curl/8' });
    const r = await run(D0 + 24 * H + 300_000);
    expect(r.closed).toEqual([DAY0]);
    expect(all('SELECT target, page, views FROM views_daily ORDER BY page')).toEqual([
      { target: 's1', page: '/a', views: 2 },
      { target: 's1', page: '/b', views: 1 },
    ]);
    expect(all('SELECT category, hits FROM bots_daily')).toEqual([{ category: 'other', hits: 1 }]);
    expect(all('SELECT * FROM final_days')).toEqual([{ target: 's1', day: DAY0, views: 3, bots: 1, visitors: 2, attempts: 0 }]);
    for (const t of ['visitors_daily', 'salts', 'rows_hourly']) expect(all(`SELECT * FROM ${t}`)).toEqual([]);
    expect(all('SELECT day FROM closed_days')).toEqual([{ day: DAY0 }]);
    // The hours of the closed day are queued; no running snapshot for a closed day.
    expect(outbox().map((o) => o.items[0].hour ?? 'snapshot')).toEqual([DAY0 * 24 + 10, DAY0 * 24 + 13]);
    // A second run closes nothing again; even a repeated close batch keeps the first visitor count.
    expect((await run(D0 + 25 * H + 300_000)).closed).toEqual([]);
    db.prepare('DELETE FROM closed_days').run();
    expect((await run(D0 + 26 * H + 300_000)).closed).toEqual([DAY0]);
    expect(all('SELECT visitors FROM final_days')).toEqual([{ visitors: 2 }]);
  });

  const hourlyRows = (target: string, n: number, hour = DAY0 * 24 + 3) => {
    const ins = db.prepare("INSERT INTO views_hourly VALUES (?, ?, ?, '', '', 'desktop', 'chrome', 'windows', ?)");
    for (let i = 0; i < n; i++) ins.run(target, hour + (i % 2), `/p${i}`, i + 1);
    db.prepare('INSERT INTO totals (target, day, views) VALUES (?, ?, 1) ON CONFLICT DO NOTHING').run(target, DAY0);
  };
  const daily = (sql: string) => all(`SELECT ${sql} FROM views_daily`)[0];

  it('a target keeps its 298 busiest combinations of the day plus (other); nothing is lost', async () => {
    hourlyRows('s1', 400);
    await run(D0 + 24 * H + 300_000);
    expect(daily("count(*) AS n, sum(views) AS v, min(CASE WHEN page != '(other)' THEN views END) AS least")).toEqual({ n: 299, v: (400 * 401) / 2, least: 103 });
    expect(all(`SELECT views FROM views_daily WHERE page = '${OTHER}'`)).toEqual([{ views: (102 * 103) / 2 }]);
  });

  it('an account keeps 1,500 rows of the day; the rest go to the account-wide (other) row', async () => {
    for (let t = 1; t <= 6; t++) hourlyRows(`s${t}`, 299);
    await run(D0 + 24 * H + 300_000);
    expect(daily(`count(*) AS n FROM views_daily WHERE target != '${ACCOUNT}' UNION ALL SELECT sum(views)`)).toEqual({ n: 1500 });
    expect(all('SELECT sum(views) AS v FROM views_daily')).toEqual([{ v: 6 * ((299 * 300) / 2) }]);
    expect(all(`SELECT count(*) AS n FROM views_daily WHERE target = '${ACCOUNT}'`)).toEqual([{ n: 1 }]);
  });
});

describe('the query ledger', () => {
  it('after days of downtime a run closes 3 days and queues the backlog within the ledger', async () => {
    for (let d = 0; d < 4; d++) {
      await view(D0 + d * 24 * H + 9.5 * H, { page: `/d${d}` });
      await view(D0 + d * 24 * H + 15.5 * H, { page: `/d${d}`, ip: '10.0.0.9' });
    }
    // First run: the 4 days are past, so 3 close now; every hour of them is queued.
    const first = await run(D0 + 4 * 24 * H + 300_000);
    expect(first.closed).toEqual([DAY0, DAY0 + 1, DAY0 + 2]);
    // Of the 49 queries a run may make (§5 ledger): meta 1, find 1, 3 closes × 7, queue 3,
    // expire 2 — 28; then one push here (clx.cx answers 503) and the error mark.
    expect(first.statements).toBe(count.n);
    expect(count.n).toBeLessThanOrEqual(30);
    expect(outbox().filter((o) => o.items[0].hour !== undefined)).toHaveLength(8);
    const second = await run(D0 + 4 * 24 * H + H + 300_000);
    expect(second.closed).toEqual([DAY0 + 3]);
    expect(all('SELECT count(*) AS n FROM final_days')).toEqual([{ n: 4 }]);
  });
});

describe('expiry', () => {
  it('one table per run, in turn; old queue parts are counted before they go', async () => {
    const now = D0 + 60 * 24 * H + 300_000;
    const hour = Math.floor(now / H);
    db.prepare("INSERT INTO views_hourly VALUES ('s1', ?, '/', '', '', 'desktop', 'chrome', 'windows', 1)").run(hour - 32 * 24);
    db.prepare("INSERT INTO views_hourly VALUES ('s1', ?, '/', '', '', 'desktop', 'chrome', 'windows', 1)").run(hour - 2);
    db.prepare("INSERT INTO outbox (hour, items) VALUES (?, '[]'), (?, '[]')").run(hour - 8 * 24, hour - 2);
    db.prepare('INSERT INTO final_days VALUES (?, ?, 1, 0, 1, 0)').run('s1', DAY0);
    for (let i = 0; i < 7; i++) await run(now + i * 60_000);
    expect(all('SELECT hour FROM views_hourly').map((r) => r.hour)).toEqual([hour - 2]);
    expect(all('SELECT hour FROM outbox WHERE items = ?', '[]').map((r) => r.hour)).toEqual([hour - 2]);
    expect(all('SELECT reason, n FROM sync_status ORDER BY reason')).toEqual([{ reason: 'expired', n: 1 }, { reason: 'too_old', n: 1 }]);
    expect(all('SELECT * FROM final_days')).toEqual([]);
  });

  it("a closed, sent day's totals stay until its last hour is queued", async () => {
    const now = D0 + 5 * 24 * H + 300_000;
    db.prepare('INSERT INTO totals (target, day, views) VALUES (?, ?, 1), (?, ?, 1)').run('s1', DAY0, 's1', DAY0 + 1);
    db.prepare('INSERT INTO closed_days VALUES (?), (?)').run(DAY0, DAY0 + 1);
    // The queue is through day 0 only (as if a queue step had failed since).
    db.prepare("INSERT INTO meta VALUES ('outboxed_through', ?), ('expire_turn', 4)").run(DAY0 * 24 + 23);
    // This run's queue step fails, so the cursor stays where it was.
    db.exec('DROP TABLE outbox');
    const r = await run(now);
    expect(r.errors[0]).toMatch(/^queue: /u);
    expect(all('SELECT day FROM totals ORDER BY day')).toEqual([{ day: DAY0 + 1 }]);
  });
});

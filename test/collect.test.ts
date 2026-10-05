// The collector (docs/spec.md §5) on a real SQLite with the worker's own migrations: exact totals,
// the capped detail with its (other) rows, visitors, bots, and what is dropped.
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT, OTHER, type SiteConfig } from '../edge/contract';
import { MIGRATIONS } from '../edge/migrations';
import { d1 } from './d1';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const NOW = Date.UTC(2026, 9, 5, 13, 30);
const HOUR = Math.floor(NOW / 3_600_000);
const SITE: SiteConfig = { t: 's1', paths: [{ path: '/p', c: 'c', s: 's', script: '' }], excluded: ['/admin'] };

let db: DatabaseSync;
let size = 0;
let collect: typeof import('../edge/collect').collect;
beforeEach(async () => {
  db = new DatabaseSync(':memory:');
  for (const m of MIGRATIONS) db.exec(m);
  size = 0;
  // A fresh isolate: no cached salt, no remembered database size.
  vi.resetModules();
  ({ collect } = await import('../edge/collect'));
});

function beacon(o: { page?: string; ua?: string; ip?: string; body?: string; headers?: Record<string, string>; country?: string; site?: SiteConfig } = {}) {
  const req = new Request('https://example.com/p/c', {
    method: 'POST',
    body: o.body ?? 'https://www.google.com/search?q=x',
    headers: { referer: `https://example.com${o.page ?? '/'}`, 'user-agent': o.ua ?? CHROME, 'cf-connecting-ip': o.ip ?? '10.0.0.1', ...o.headers },
  });
  Object.assign(req, { cf: { country: o.country ?? 'DE' } });
  return collect(d1(db, { size: () => size }), req, o.body ?? 'https://www.google.com/search?q=x', 'example.com', o.site ?? SITE, NOW);
}
const all = (sql: string) => db.prepare(sql).all().map((r) => ({ ...r }));

describe('a view', () => {
  it('adds to the exact totals, the hour column, one detail row and the day visitor', async () => {
    expect(await beacon({ page: '/blog/user@example.com/0123456789abcdef0123' })).toBe('view');
    expect(all('SELECT target, views, bots, v13, v12 FROM totals')).toEqual([{ target: 's1', views: 1, bots: 0, v13: 1, v12: 0 }]);
    expect(all('SELECT * FROM views_hourly')).toEqual([{ target: 's1', hour: HOUR, page: '/blog/:id/:id', source: 'google.com', country: 'DE', device: 'desktop', browser: 'chrome', os: 'windows', views: 1 }]);
    expect(all('SELECT target, count(*) AS n FROM visitors_daily GROUP BY target')).toEqual([{ target: 's1', n: 1 }]);
    expect(all('SELECT scope, n FROM rows_hourly ORDER BY scope')).toEqual([{ scope: ACCOUNT, n: 1 }, { scope: 's1', n: 1 }]);
  });

  it('a returning visitor is one hash; the same page and source is one row', async () => {
    await beacon();
    await beacon();
    await beacon({ ip: '10.0.0.2' });
    expect(all('SELECT count(*) AS n FROM visitors_daily')).toEqual([{ n: 2 }]);
    expect(all('SELECT views FROM views_hourly')).toEqual([{ views: 3 }]);
    expect(all('SELECT n FROM rows_hourly WHERE scope = \'s1\'')).toEqual([{ n: 1 }]);
  });

  it('own host and a missing referrer give an empty source and page; a phone is mobile', async () => {
    await beacon({ body: 'https://www.example.com/other', ua: IPHONE, country: 'T1', headers: { referer: 'https://elsewhere.net/x' } });
    expect(all('SELECT page, source, country, device, os FROM views_hourly')).toEqual([{ page: '', source: '', country: '', device: 'mobile', os: 'ios' }]);
  });
});

describe('dropped', () => {
  it('an excluded path, another origin, a body that is not text/plain — nothing is written', async () => {
    expect(await beacon({ page: '/admin/users' })).toBe('dropped');
    expect(await beacon({ headers: { origin: 'https://evil.example' } })).toBe('dropped');
    expect(await beacon({ headers: { 'content-type': 'application/json' } })).toBe('dropped');
    expect(all('SELECT * FROM totals')).toEqual([]);
    expect(await beacon({ headers: { origin: 'https://example.com' } })).toBe('view');
  });
});

describe('bots', () => {
  it('count by category in the totals, with no detail and no visitor', async () => {
    expect(await beacon({ ua: CHROME.replace('Chrome', 'HeadlessChrome') })).toBe('bot');
    expect(await beacon({ ua: 'curl/8.5.0' })).toBe('bot');
    expect(all('SELECT views, bots FROM totals')).toEqual([{ views: 0, bots: 2 }]);
    expect(all('SELECT category, hits FROM bots_hourly ORDER BY category')).toEqual([{ category: 'headless', hits: 1 }, { category: 'other', hits: 1 }]);
    expect(all('SELECT * FROM views_hourly')).toEqual([]);
    expect(all('SELECT * FROM visitors_daily')).toEqual([]);
  });
});

describe('detail caps', () => {
  const views = (target: string, page: string) => (db.prepare('SELECT views FROM views_hourly WHERE target = ? AND page = ?').get(target, page) as { views: number } | undefined)?.views;

  it('a target keeps 299 combinations an hour; the rest go to its own (other) row, totals stay exact', async () => {
    for (let i = 0; i < 301; i++) await beacon({ page: `/p${i}` });
    await beacon({ page: '/p5' });
    expect(all("SELECT count(*) AS n FROM views_hourly WHERE page != '(other)'")).toEqual([{ n: 299 }]);
    expect(views('s1', OTHER)).toBe(2);
    expect(views('s1', '/p5')).toBe(2);
    expect(all('SELECT views FROM totals')).toEqual([{ views: 302 }]);
    expect(all('SELECT scope, n FROM rows_hourly ORDER BY scope')).toEqual([{ scope: ACCOUNT, n: 300 }, { scope: 's1', n: 300 }]);
  });

  it('a full account sends a new combination to the account-wide row; a target with its own (other) keeps it', async () => {
    await beacon({ page: '/kept' });
    db.prepare(`INSERT INTO views_hourly VALUES ('s1', ?, '${OTHER}', '', '', '', '', '', 5)`).run(HOUR);
    db.prepare(`UPDATE rows_hourly SET n = 1500 WHERE scope = '${ACCOUNT}'`).run();
    const s2 = { ...SITE, t: 's2' };
    await beacon({ page: '/new', site: s2 });
    await beacon({ page: '/new2' });
    await beacon({ page: '/kept' });
    expect(views(ACCOUNT, OTHER)).toBe(1);
    expect(views('s1', OTHER)).toBe(6);
    expect(views('s1', '/kept')).toBe(2);
    expect(all("SELECT target, views FROM totals ORDER BY target")).toEqual([{ target: 's1', views: 3 }, { target: 's2', views: 1 }]);
  });

  it('a database at 400 MB makes no new combination rows, from an isolate\'s first view; existing ones still count', async () => {
    db.prepare("INSERT INTO views_hourly VALUES ('s1', ?, '/old', 'google.com', 'DE', 'desktop', 'chrome', 'windows', 1)").run(HOUR);
    size = 400 * 1024 * 1024;
    await beacon({ page: '/y' });
    await beacon({ page: '/old' });
    expect(views('s1', '/y')).toBeUndefined();
    expect(views('s1', OTHER)).toBe(1);
    expect(views('s1', '/old')).toBe(2);
    expect(all('SELECT views FROM totals')).toEqual([{ views: 2 }]);
  });
});

describe('the body', () => {
  it('only its first 2 KB is read', async () => {
    const { bodyHead } = await import('../edge/collect');
    const big = `${'a'.repeat(3000)} https://late.example/`;
    const head = await bodyHead(new Request('https://example.com/p/c', { method: 'POST', body: big }));
    expect(head).toHaveLength(2048);
    expect(head).not.toContain('late.example');
  });
});

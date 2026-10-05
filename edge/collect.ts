// The collector (docs/spec.md §5): one beacon → the target's exact totals, a capped detail row, the
// day's visitor hash; or, for a bot, its category. Every check here drops browser noise and caps
// quota use, nothing more: the counter is not fraud-resistant. IP, UA and body are written nowhere.
import { botCategory, browserOf, osOf } from './bots';
import { ACCOUNT, ACCOUNT_ROWS, dayOf, FULL_BYTES, HOUR_COLUMNS, hourOf, OTHER, TARGET_ROWS, type SiteConfig } from './contract';

/** The beacon's body: its first 2 KB. The stream is read until 2 KB are in — at most one network
 *  chunk past it — then cancelled; nothing beyond 2 KB is kept or parsed. */
export async function bodyHead(request: Request, max = 2048): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let n = 0;
  while (n < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    n += value.byteLength;
  }
  reader.cancel().catch(() => undefined);
  const bytes = new Uint8Array(Math.min(n, max));
  let at = 0;
  for (const c of chunks) {
    bytes.set(c.subarray(0, bytes.length - at), at);
    at += Math.min(c.byteLength, bytes.length - at);
  }
  return new TextDecoder().decode(bytes);
}

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};
const bare = (host: string) => host.replace(/^www\./u, '');

/** A segment that names a person or a record rather than a page. */
const ID = /@|%40|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^[0-9a-f]{16,}$/iu;
export const pageOf = (pathname: string) =>
  pathname
    .split('/')
    .map((s) => (ID.test(s) ? ':id' : s))
    .join('/')
    .slice(0, 200);

/** The last database size this isolate saw (every D1 answer carries it), for backpressure (§8). */
let size = 0;
/** The day's salt, read once per isolate and day. */
let salt: { day: number; value: string } | null = null;

async function saltOf(db: D1Database, day: number): Promise<string> {
  if (salt?.day === day) return salt.value;
  // An isolate's first view reads the salt, so it learns the database size before its first write.
  const read = async () => {
    const r = await db.prepare('SELECT salt FROM salts WHERE day = ?').bind(day).all<{ salt: string }>();
    size = r.meta?.size_after ?? size;
    return r.results[0]?.salt ?? null;
  };
  let value = await read();
  if (!value) {
    // Concurrent first beacons of a day agree on whichever salt was inserted first.
    const fresh = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    await db.prepare('INSERT OR IGNORE INTO salts (day, salt) VALUES (?, ?)').bind(day, fresh).run();
    value = (await read())!;
  }
  salt = { day, value };
  return value;
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// The detail row of a view, one of four statements (§5): each has its own predicate, evaluated
// after the ones before it in the same batch, so exactly one of them writes. ?1…?8 are the row's
// dimensions, ?9 is 1 while the database has room for new rows.
const ROW = 'target = ?1 AND hour = ?2 AND page = ?3 AND source = ?4 AND country = ?5 AND device = ?6 AND browser = ?7 AND os = ?8';
const COMBO = `EXISTS (SELECT 1 FROM views_hourly WHERE ${ROW})`;
const MINE = `EXISTS (SELECT 1 FROM views_hourly WHERE target = ?1 AND hour = ?2 AND page = '${OTHER}' AND source = '' AND country = '' AND device = '' AND browser = '' AND os = '')`;
const TARGET_N = 'coalesce((SELECT n FROM rows_hourly WHERE scope = ?1 AND hour = ?2), 0)';
const ACCOUNT_N = `coalesce((SELECT n FROM rows_hourly WHERE scope = '${ACCOUNT}' AND hour = ?2), 0)`;
const COLS = 'target, hour, page, source, country, device, browser, os, views';
const DETAIL = [
  `UPDATE views_hourly SET views = views + 1 WHERE ${ROW}`,
  `INSERT INTO views_hourly (${COLS}) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1 WHERE NOT ${COMBO} AND ?9 AND ${TARGET_N} < ${TARGET_ROWS} AND ${ACCOUNT_N} < ${ACCOUNT_ROWS} ON CONFLICT DO NOTHING`,
  `INSERT INTO views_hourly (${COLS}) SELECT ?1, ?2, '${OTHER}', '', '', '', '', '', 1 WHERE NOT ${COMBO} AND (((${TARGET_N} >= ${TARGET_ROWS} OR NOT ?9) AND ${ACCOUNT_N} < ${ACCOUNT_ROWS}) OR ${MINE}) ON CONFLICT (target, hour, page, source, country, device, browser, os) DO UPDATE SET views = views + 1`,
  `INSERT INTO views_hourly (${COLS}) SELECT '${ACCOUNT}', ?2, '${OTHER}', '', '', '', '', '', 1 WHERE NOT ${COMBO} AND NOT ${MINE} AND ${ACCOUNT_N} >= ${ACCOUNT_ROWS} ON CONFLICT (target, hour, page, source, country, device, browser, os) DO UPDATE SET views = views + 1`,
];

/**
 * Counts one beacon to a site's collector, or drops it. `host` is the request's own host, `body` the
 * first 2 KB of it. Returns what it did, for tests.
 */
export async function collect(db: D1Database, request: Request, body: string, host: string, site: SiteConfig, now: number): Promise<'view' | 'bot' | 'dropped'> {
  const h = request.headers;
  if (!/^text\/plain\b/iu.test(h.get('content-type') ?? '')) return 'dropped';
  const origin = h.get('origin');
  if (origin && hostOf(origin) !== host) return 'dropped';
  const referer = h.get('referer');
  const pathname = referer && hostOf(referer) === host ? new URL(referer).pathname : '';
  if (pathname && site.excluded.some((p) => pathname.startsWith(p))) return 'dropped';

  const target = site.t;
  const hour = hourOf(now);
  const day = dayOf(now);
  const ua = (h.get('user-agent') ?? '').slice(0, 512);
  const bot = botCategory(ua);
  if (bot) {
    await db.batch([
      db.prepare('INSERT INTO totals (target, day, bots) VALUES (?, ?, 1) ON CONFLICT (target, day) DO UPDATE SET bots = bots + 1').bind(target, day),
      db.prepare('INSERT INTO bots_hourly (target, hour, category, hits) VALUES (?, ?, ?, 1) ON CONFLICT (target, hour, category) DO UPDATE SET hits = hits + 1').bind(target, hour, bot),
    ]);
    return 'bot';
  }

  const ref = body.match(/https?:\/\/[^\s"'<>\\]+/u)?.[0];
  const refHost = ref ? (hostOf(ref) ?? '') : '';
  const source = refHost && bare(refHost) !== bare(host) ? bare(refHost) : '';
  const country = String((request as { cf?: { country?: unknown } }).cf?.country ?? '');
  const ip = h.get('cf-connecting-ip') ?? '';
  const vhash = (await sha256(`${await saltOf(db, day)}|${target}|${ip}|${ua}`)).slice(0, 32);
  const dims = [target, hour, pageOf(pathname), source, /^[A-Z]{2}$/u.test(country) ? country : '', /Mobile|Android|iPhone/u.test(ua) ? 'mobile' : 'desktop', browserOf(ua), osOf(ua)];
  const column = HOUR_COLUMNS[hour % 24]!;
  const results = await db.batch([
    // Exact, whatever the caps below drop.
    db.prepare(`INSERT INTO totals (target, day, views, ${column}) VALUES (?, ?, 1, 1) ON CONFLICT (target, day) DO UPDATE SET views = views + 1, ${column} = ${column} + 1`).bind(target, day),
    ...DETAIL.map((sql) => db.prepare(sql).bind(...dims, ...(sql.includes('?9') ? [size < FULL_BYTES ? 1 : 0] : []))),
    db.prepare('INSERT OR IGNORE INTO visitors_daily (target, day, vhash) VALUES (?, ?, ?)').bind(target, day, vhash),
  ]);
  size = results.at(-1)?.meta?.size_after ?? size;
  return 'view';
}

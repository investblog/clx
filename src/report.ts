// The reports of a site and of a link (docs/spec.md §7, §10): a site's totals and series from
// clx.cx's own `hourly`/`daily`, a link's closed days from there and its other days live from the
// user's clx-edge database; breakdowns from that database through the D1 REST API when asked for. The
// breakdowns are best effort: no token, a Cloudflare error or a timeout leaves them unavailable
// while the totals still come. Reads of the user's database are not logged (§8).
import { dayOf, HOUR_COLUMNS } from '../edge/contract';
import { CfError, cf } from './cf/api';
import { inService, workingToken, type EdgeAccount } from './cf/connect';
import { planOf, writeBudget } from './limits';
import type { Env } from './types';

const H = 3_600_000;
const D = 24 * H;
export const PERIODS = { today: 1, '7d': 7, '30d': 30 } as const;
export type Period = keyof typeof PERIODS;
const TIMEOUT = 5_000;
const CACHE_TTL = 5 * 60_000;
const TOP = 10;

export const DIMENSIONS = ['pages', 'sources', 'countries', 'devices', 'browsers', 'os', 'bots'] as const;
type Breakdowns = Record<(typeof DIMENSIONS)[number], { key: string; n: number }[]>;
export type Unavailable = 'not_installed' | 'cloudflare' | 'rate_limited';

// One statement (D1 takes one with params): from day ?2 up to hour ?3 (exclusive) — the same
// "as of" as the totals, so the open hour the worker has not sent yet is left out. Closed days come
// from the daily detail, days not closed yet — today, or days the worker has not reached after a
// downtime — from the hourly detail, so no view is counted twice; then the top of each dimension.
// D1 takes at most 5 terms in a compound SELECT (cloudflare-facts.md), so the six view dimensions
// are one pass over the rows joined with a list of dimension names, not six UNION ALL terms. The
// value is named `val`, never `key`: json_each has a column `key`, and GROUP BY would take that one.
const COLUMNS = { pages: 'page', sources: 'source', countries: 'country', devices: 'device', browsers: 'browser', os: 'os' } as const;
const RANGE = 'hour >= CAST(?2 AS INTEGER) * 24 AND hour < CAST(?3 AS INTEGER) AND hour / 24 NOT IN (SELECT day FROM closed)';
const BREAKDOWNS = `WITH closed AS (SELECT day FROM closed_days WHERE day >= CAST(?2 AS INTEGER) AND day * 24 + 24 <= CAST(?3 AS INTEGER)),
v AS (SELECT page, source, country, device, browser, os, views FROM views_daily WHERE target = ?1 AND day IN (SELECT day FROM closed)
  UNION ALL SELECT page, source, country, device, browser, os, views FROM views_hourly WHERE target = ?1 AND ${RANGE}),
b AS (SELECT category, hits FROM bots_daily WHERE target = ?1 AND day IN (SELECT day FROM closed)
  UNION ALL SELECT category, hits FROM bots_hourly WHERE target = ?1 AND ${RANGE}),
d AS (SELECT j.value AS dim, CASE j.value ${Object.entries(COLUMNS)
  .map(([dim, col]) => `WHEN '${dim}' THEN ${col}`)
  .join(' ')} END AS val, sum(views) AS n FROM v CROSS JOIN json_each('${JSON.stringify(Object.keys(COLUMNS))}') j GROUP BY dim, val
  UNION ALL SELECT 'bots', category, sum(hits) FROM b GROUP BY category)
SELECT dim, val AS key, n FROM (SELECT dim, val, n, row_number() OVER (PARTITION BY dim ORDER BY n DESC, val) AS r FROM d) WHERE r <= ${TOP}`;

// Answers kept for speed only, per isolate; a request already in flight is shared — the rate limit
// included, so a burst of the same report spends one request of the limit.
const cache = new Map<string, { at: number; answer: Promise<unknown> }>();
export const clearReportCache = () => cache.clear();
class Limited extends Error {}
class NoToken extends Error {}

/** A row of the one statement: `dim`, `key`, `n` — a breakdown entry, or a live day (`dim` 'day',
 *  `key` its JSON). */
type Row = { dim: string; key: string; n: number };

/**
 * One statement on the user's database (D1 takes one with params): one call, 5 s, one request of the
 * per-user limit; cached and merged in flight. `at` is when it was read — a cached answer is as old
 * as that, not as the request.
 */
async function userQuery(env: Env, userId: number, edge: EdgeAccount, key: string, sql: string, params: unknown[], now: number): Promise<{ at: number; rows: Row[] }> {
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL) return { at: hit.at, rows: (await hit.answer) as Row[] };
  for (const [k, v] of cache) if (now - v.at >= CACHE_TTL) cache.delete(k);
  const answer = (async () => {
    if (!(await env.REPORT_LIMIT.limit({ key: `u:${userId}` })).success) throw new Limited();
    // A token that cannot be opened (a corrupt seal, a key gone from the keyring) is no token.
    const token = await workingToken(env, edge).catch(() => Promise.reject(new NoToken()));
    const [res] = await cf<{ results: Row[] }[]>(token, 'POST', `/accounts/${edge.cf_account_id}/d1/database/${edge.d1_id}/query`, { sql, params }, undefined, AbortSignal.timeout(TIMEOUT));
    return res?.results ?? [];
  })();
  cache.set(key, { at: now, answer });
  answer.catch(() => cache.delete(key));
  return { at: now, rows: await answer };
}

function breakdownsOf(rows: Row[]): Breakdowns {
  const out = Object.fromEntries(DIMENSIONS.map((d) => [d, [] as { key: string; n: number }[]])) as Breakdowns;
  for (const r of rows) out[r.dim as keyof Breakdowns]?.push({ key: String(r.key), n: Number(r.n) });
  return out;
}
async function breakdowns(env: Env, userId: number, edge: EdgeAccount, target: string, from: number, until: number, now: number): Promise<Breakdowns> {
  return breakdownsOf((await userQuery(env, userId, edge, `b|${edge.id}|${target}|${from}|${until}`, BREAKDOWNS, [target, from, until], now)).rows);
}

/** What the user's database cannot give now, as the report's `unavailable`; anything else is thrown. */
function unavailableOf(e: unknown, edge: EdgeAccount): Unavailable {
  if (e instanceof Limited) return 'rate_limited';
  if (e instanceof NoToken) return 'not_installed';
  // A timeout comes as a CfError too (status 0): cf() wraps the aborted fetch.
  if (!(e instanceof CfError)) throw e;
  console.error('report', edge.id, e.message);
  return 'cloudflare';
}
const reachable = (edge: EdgeAccount) => inService(edge) && !!edge.d1_id && !!edge.token_sealed;

const iso = (ms: number) => new Date(ms).toISOString();

export async function siteReport(env: Env, user: { id: number; plan: string }, edge: EdgeAccount, target: string, period: Period, withBreakdowns: boolean, now = Date.now()) {
  const db = env.DB;
  const today = dayOf(now);
  const from = today - PERIODS[period] + 1;
  const [hours, days, sites] = await db.batch([
    db.prepare('SELECT hour, views, bots FROM hourly WHERE account_id = ?1 AND target = ?2 AND hour >= ?3 ORDER BY hour').bind(edge.id, target, today * 24),
    db.prepare('SELECT day, as_of_hour, final, views, bots, visitors FROM daily WHERE account_id = ?1 AND target = ?2 AND day BETWEEN ?3 AND ?4 ORDER BY day').bind(edge.id, target, from, today),
    db.prepare("SELECT count(*) AS n FROM sites WHERE account_id = ?1 AND state != 'deleted'").bind(edge.id),
  ]);
  const hourRows = hours!.results as { hour: number; views: number; bots: number }[];
  const dayRows = days!.results as { day: number; as_of_hour: number; final: number; views: number; bots: number; visitors: number }[];
  const todayRow = dayRows.find((r) => r.day === today);

  const byHour = new Map(hourRows.map((r) => [r.hour, r]));
  const byDay = new Map(dayRows.map((r) => [r.day, r]));
  // Everything is as of the end of the latest closed hour the worker sent today; without one, as of
  // the end of yesterday.
  const until = todayRow ? todayRow.as_of_hour + 1 : today * 24;
  const series =
    period === 'today'
      ? Array.from({ length: until - today * 24 }, (_, i) => today * 24 + i).map((h) => ({ at: iso(h * H), views: byHour.get(h)?.views ?? 0, bots: byHour.get(h)?.bots ?? 0 }))
      : Array.from({ length: PERIODS[period] }, (_, i) => from + i).map((d) => ({ at: iso(d * D), views: byDay.get(d)?.views ?? 0, bots: byDay.get(d)?.bots ?? 0, visitors: byDay.get(d)?.visitors ?? 0 }));
  const sum = (k: 'views' | 'bots' | 'visitors') => dayRows.reduce((n, r) => n + r[k], 0);
  // Over the write budget today, clx.cx refused this account's hours and snapshots (§8).
  const budget = writeBudget(planOf(user.plan), Number((sites!.results[0] as { n: number }).n));
  const incomplete = edge.budget_day === today && (edge.budget_used ?? 0) >= budget;

  const report: Record<string, unknown> = {
    period,
    from: iso(from * D).slice(0, 10),
    to: iso(today * D).slice(0, 10),
    // Hours arrive up to an hour late: today is "as of" the end of the latest closed hour sent.
    as_of: todayRow ? iso(until * H) : null,
    totals: { views: sum('views'), bots: sum('bots'), visitors: sum('visitors') },
    series,
    incomplete,
  };
  if (!withBreakdowns) return report;

  if (!reachable(edge)) return { ...report, breakdowns: null, unavailable: 'not_installed' as Unavailable };
  try {
    return { ...report, breakdowns: await breakdowns(env, user.id, edge, target, from, until, now) };
  } catch (e) {
    return { ...report, breakdowns: null, unavailable: unavailableOf(e, edge) };
  }
}

/** Days not final on clx.cx, read live from the user's database (`list`: the parameter holding a JSON
 *  list of days), as rows `('day', {day, views, bots, visitors, hours, bot_hours}, 0)`: visitors are
 *  counted until the day closes, then kept in final_days; views and bots by hour of the day. */
const liveDays = (list: string) => `SELECT 'day' AS dim, json_object('day', t.day, 'views', t.views, 'bots', t.bots,
  'visitors', coalesce((SELECT f.visitors FROM final_days f WHERE f.target = t.target AND f.day = t.day), (SELECT count(*) FROM visitors_daily v WHERE v.target = t.target AND v.day = t.day)),
  'hours', json_array(${HOUR_COLUMNS.map((c) => `t.${c}`).join(', ')}),
  'bot_hours', json((SELECT json_group_object(hour % 24, s) FROM (SELECT hour, sum(hits) AS s FROM bots_hourly b WHERE b.target = t.target AND b.hour / 24 = t.day GROUP BY hour)))) AS key, 0 AS n
  FROM totals t WHERE t.target = ?1 AND t.day IN (SELECT value FROM json_each(${list}))`;
/** A link's live days alone (?1 target, ?2 days), or with its breakdowns in the same statement — one
 *  read, so the totals and the breakdowns of an answer are of the same moment (?1 target, ?2 and ?3
 *  the breakdowns' range, ?4 days). Two terms at the top level: within D1's five. */
const LIVE_DAYS = liveDays('?2');
const LIVE_WITH_BREAKDOWNS = `${BREAKDOWNS} UNION ALL ${liveDays('?4')}`;
interface LiveDay {
  day: number;
  views: number;
  bots: number;
  visitors: number;
  hours: number[];
  bot_hours: Record<string, number> | null;
}
/** The user's database keeps a day's totals this long (edge/cron.ts). */
const LIVE_BACK = 31;

/**
 * The report of a link (§7): its closed days from clx.cx (a link sends only final days), its other
 * days — today, and any the worker has not sent yet — live from the user's database, under the same
 * limit and unavailable state as the breakdowns. Nothing waits for an hourly push: it is as of now.
 */
export async function linkReport(env: Env, user: { id: number; plan: string }, edge: EdgeAccount, target: string, period: Period, withBreakdowns: boolean, now = Date.now()) {
  const today = dayOf(now);
  const from = today - PERIODS[period] + 1;
  const finals = (await env.DB.prepare('SELECT day, views, bots, visitors FROM daily WHERE account_id = ?1 AND target = ?2 AND day BETWEEN ?3 AND ?4 AND final = 1').bind(edge.id, target, from, today).all<{ day: number; views: number; bots: number; visitors: number }>()).results;
  const byDay = new Map(finals.map((r) => [r.day, r]));
  const missing = Array.from({ length: PERIODS[period] }, (_, i) => from + i).filter((d) => !byDay.has(d) && d > today - LIVE_BACK);
  // The open hour included: clicks are counted in the user's database the moment they happen.
  const until = Math.floor(now / H) + 1;
  let unavailable: Unavailable | null = reachable(edge) ? null : 'not_installed';
  let rows: Row[] = [];
  let readAt = now;
  if (!unavailable)
    try {
      const days = JSON.stringify(missing);
      const [sql, params] = withBreakdowns ? [LIVE_WITH_BREAKDOWNS, [target, from, until, days]] : [LIVE_DAYS, [target, days]];
      ({ at: readAt, rows } = await userQuery(env, user.id, edge, `l|${edge.id}|${target}|${days}|${until}|${withBreakdowns ? 'b' : ''}`, sql, params, now));
    } catch (e) {
      unavailable = unavailableOf(e, edge);
    }
  const live = rows.filter((r) => r.dim === 'day').map((r) => JSON.parse(r.key) as LiveDay);
  for (const r of live) byDay.set(r.day, r);
  const todayRow = live.find((r) => r.day === today);
  const series =
    period === 'today'
      ? unavailable
        ? []
        : Array.from({ length: until - today * 24 }, (_, h) => ({ at: iso((today * 24 + h) * H), views: todayRow?.hours[h] ?? 0, bots: todayRow?.bot_hours?.[h] ?? 0 }))
      : Array.from({ length: PERIODS[period] }, (_, i) => from + i).map((d) => ({ at: iso(d * D), views: byDay.get(d)?.views ?? 0, bots: byDay.get(d)?.bots ?? 0, visitors: byDay.get(d)?.visitors ?? 0 }));
  const sum = (k: 'views' | 'bots' | 'visitors') => [...byDay.values()].reduce((n, r) => n + r[k], 0);
  const report: Record<string, unknown> = {
    period,
    from: iso(from * D).slice(0, 10),
    to: iso(today * D).slice(0, 10),
    // When the live days were read: up to 5 minutes ago, from the cache.
    as_of: unavailable ? null : iso(readAt),
    totals: { views: sum('views'), bots: sum('bots'), visitors: sum('visitors') },
    series,
    // A link's final days are taken over any budget (§8): nothing of it is refused.
    incomplete: false,
  };
  if (unavailable) return { ...report, ...(withBreakdowns ? { breakdowns: null } : {}), unavailable };
  return withBreakdowns ? { ...report, breakdowns: breakdownsOf(rows.filter((r) => r.dim !== 'day')) } : report;
}

// The report of a site (docs/spec.md §7, §10): totals and series from clx.cx's own `hourly`/`daily`,
// breakdowns from the user's clx-edge database through the D1 REST API when asked for. The
// breakdowns are best effort: no token, a Cloudflare error or a timeout leaves them unavailable
// while the totals still come. Reads of the user's database are not logged (§8).
import { dayOf } from '../edge/contract';
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
const COLUMNS = { pages: 'page', sources: 'source', countries: 'country', devices: 'device', browsers: 'browser', os: 'os' } as const;
const RANGE = 'hour >= CAST(?2 AS INTEGER) * 24 AND hour < CAST(?3 AS INTEGER) AND hour / 24 NOT IN (SELECT day FROM closed)';
const BREAKDOWNS = `WITH closed AS (SELECT day FROM closed_days WHERE day >= CAST(?2 AS INTEGER) AND day * 24 + 24 <= CAST(?3 AS INTEGER)),
v AS (SELECT page, source, country, device, browser, os, views FROM views_daily WHERE target = ?1 AND day IN (SELECT day FROM closed)
  UNION ALL SELECT page, source, country, device, browser, os, views FROM views_hourly WHERE target = ?1 AND ${RANGE}),
b AS (SELECT category, hits FROM bots_daily WHERE target = ?1 AND day IN (SELECT day FROM closed)
  UNION ALL SELECT category, hits FROM bots_hourly WHERE target = ?1 AND ${RANGE}),
d AS (${Object.entries(COLUMNS)
  .map(([dim, col]) => `SELECT '${dim}' AS dim, ${col} AS key, sum(views) AS n FROM v GROUP BY ${col}`)
  .join(' UNION ALL ')} UNION ALL SELECT 'bots', category, sum(hits) FROM b GROUP BY category)
SELECT dim, key, n FROM (SELECT dim, key, n, row_number() OVER (PARTITION BY dim ORDER BY n DESC, key) AS r FROM d) WHERE r <= ${TOP}`;

// Answers kept for speed only, per isolate; a request already in flight is shared — the rate limit
// included, so a burst of the same report spends one request of the limit.
const cache = new Map<string, { at: number; answer: Promise<Breakdowns> }>();
export const clearReportCache = () => cache.clear();
class Limited extends Error {}
class NoToken extends Error {}

async function breakdowns(env: Env, userId: number, edge: EdgeAccount, target: string, from: number, until: number, now: number): Promise<Breakdowns> {
  const key = `${edge.id}|${target}|${from}|${until}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL) return hit.answer;
  for (const [k, v] of cache) if (now - v.at >= CACHE_TTL) cache.delete(k);
  const answer = (async () => {
    if (!(await env.REPORT_LIMIT.limit({ key: `u:${userId}` })).success) throw new Limited();
    // A token that cannot be opened (a corrupt seal, a key gone from the keyring) is no token.
    const token = await workingToken(env, edge).catch(() => Promise.reject(new NoToken()));
    const [res] = await cf<{ results: { dim: string; key: string; n: number }[] }[]>(
      token,
      'POST',
      `/accounts/${edge.cf_account_id}/d1/database/${edge.d1_id}/query`,
      { sql: BREAKDOWNS, params: [target, from, until] },
      undefined,
      AbortSignal.timeout(TIMEOUT),
    );
    const out = Object.fromEntries(DIMENSIONS.map((d) => [d, [] as { key: string; n: number }[]])) as Breakdowns;
    for (const r of res?.results ?? []) out[r.dim as keyof Breakdowns]?.push({ key: r.key, n: Number(r.n) });
    return out;
  })();
  cache.set(key, { at: now, answer });
  answer.catch(() => cache.delete(key));
  return answer;
}

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

  if (!inService(edge) || !edge.d1_id || !edge.token_sealed) return { ...report, breakdowns: null, unavailable: 'not_installed' as Unavailable };
  try {
    return { ...report, breakdowns: await breakdowns(env, user.id, edge, target, from, until, now) };
  } catch (e) {
    if (e instanceof Limited) return { ...report, breakdowns: null, unavailable: 'rate_limited' as Unavailable };
    if (e instanceof NoToken) return { ...report, breakdowns: null, unavailable: 'not_installed' as Unavailable };
    // A timeout comes as a CfError too (status 0): cf() wraps the aborted fetch.
    if (!(e instanceof CfError)) throw e;
    console.error('breakdowns', edge.id, e.message);
    return { ...report, breakdowns: null, unavailable: 'cloudflare' as Unavailable };
  }
}

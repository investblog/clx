// The upgrade advice (docs/spec.md §8): when to move a Cloudflare account to Workers Paid, from its
// measured use — worker requests, D1 writes and reads of the whole account (the Free quotas are
// shared by all its workers) from GraphQL Analytics, and the size of clx-edge from the D1 REST API.
// Computed once a day per account by the hourly job; never guessed: what cannot be read is
// "unavailable".
import { FULL_BYTES } from '../edge/contract';
import { CfError, cf, cfGraphql } from './cf/api';
import { workingToken, type EdgeAccount } from './cf/connect';
import { CF_FREE } from './limits';
import { appOrigin, sendNotice } from './mail';
import type { Env } from './types';

const D = 86_400_000;
export const DAYS = 7;
/** Accounts per hourly run, and how often each is visited. */
const BATCH = 100;
export const ADVICE_EVERY = 20 * 3_600_000;
const RETRY = 3_600_000;

const LEVELS = ['ok', 'watch', 'upgrade_soon', 'over'] as const;
export type Level = (typeof LEVELS)[number];
type Counter = 'requests' | 'writes' | 'reads';
export type Metric = Counter | 'size';
export interface MetricAdvice {
  level: Level;
  limit: number;
  /** The busiest of the last complete days, or the current size. */
  busiest: { day: string | null; value: number };
  /** When the trend reaches the limit, if it does within 30 days. */
  forecast: string | null;
}
export interface Advice {
  level: Level;
  metric: Metric | null;
  metrics: Partial<Record<Metric, MetricAdvice>>;
  unavailable?: ('analytics' | 'size')[];
  /** Size alone is the problem: shorter hourly retention helps without an upgrade. */
  suggest?: 'shorter_hourly_retention';
  at: string;
}

const date = (day: number) => new Date(day * D).toISOString().slice(0, 10);
const worse = (a: Level, b: Level) => (LEVELS.indexOf(b) > LEVELS.indexOf(a) ? b : a);
const byShare = (share: number): Level => (share >= 1 ? 'over' : share >= 0.8 ? 'upgrade_soon' : share >= 0.6 ? 'watch' : 'ok');

/** One counter over the last complete days (oldest first, `first` = the day of values[0]). */
export function assessCounter(values: number[], first: number, limit: number, today: number): MetricAdvice {
  let at = 0;
  values.forEach((v, i) => {
    if (v > values[at]!) at = i;
  });
  const top = values[at] ?? 0;
  let level = byShare(top / limit);
  // The trend: a least-squares line through the days since use began, at least 4 of them, rising.
  let forecast: string | null = null;
  const start = values.findIndex((v) => v > 0);
  const ys = start < 0 ? [] : values.slice(start);
  if (ys.length >= 4) {
    const n = ys.length;
    const mx = (n - 1) / 2;
    const my = ys.reduce((s, y) => s + y, 0) / n;
    const slope = ys.reduce((s, y, x) => s + (x - mx) * (y - my), 0) / ys.reduce((s, _, x) => s + (x - mx) ** 2, 0);
    if (slope > 0) {
      const reach = first + start + Math.ceil(mx + (limit - my) / slope);
      const inDays = reach - today;
      if (inDays <= 30) {
        forecast = date(Math.max(reach, today));
        level = worse(level, inDays <= 7 ? 'upgrade_soon' : 'watch');
      }
    }
  }
  return { level, limit, busiest: { day: values.length ? date(first + at) : null, value: top }, forecast };
}

/** The size of clx-edge now: over the limit — or at backpressure, when the collector already drops detail. */
export function assessSize(bytes: number): MetricAdvice {
  const level = bytes >= FULL_BYTES ? 'over' : byShare(bytes / CF_FREE.size);
  return { level, limit: CF_FREE.size, busiest: { day: null, value: bytes }, forecast: null };
}

export function advise(counters: Record<Counter, number[]> | null, size: number | null, first: number, today: number, now: number): Advice {
  const metrics: Partial<Record<Metric, MetricAdvice>> = {};
  if (counters) for (const k of ['requests', 'writes', 'reads'] as const) metrics[k] = assessCounter(counters[k], first, CF_FREE[k], today);
  if (size !== null) metrics.size = assessSize(size);
  let level: Level = 'ok';
  let metric: Metric | null = null;
  for (const [k, m] of Object.entries(metrics) as [Metric, MetricAdvice][])
    if (LEVELS.indexOf(m.level) > LEVELS.indexOf(level)) {
      level = m.level;
      metric = k;
    }
  const unavailable = [...(counters ? [] : ['analytics' as const]), ...(size === null ? ['size' as const] : [])];
  const others = (['requests', 'writes', 'reads'] as const).every((k) => (metrics[k]?.level ?? 'ok') === 'ok');
  return {
    level,
    metric,
    metrics,
    ...(unavailable.length ? { unavailable } : {}),
    ...(metrics.size && metrics.size.level !== 'ok' && others ? { suggest: 'shorter_hourly_retention' as const } : {}),
    at: new Date(now).toISOString(),
  };
}

type Rows<T> = { viewer: { accounts: Record<string, T[]>[] } };

/** Requests, D1 writes and reads of the whole account per day, `first` .. `first + DAYS - 1`. */
export async function measure(token: string, cfAccountId: string, first: number): Promise<Record<Counter, number[]>> {
  const last = first + DAYS - 1;
  // Sums by date only: a fresh script is counted under `__unknown__` for a while (cloudflare-facts.md).
  const data = await cfGraphql<Rows<{ sum: Record<string, number>; dimensions: { date: string } }>>(
    token,
    `{ viewer { accounts(filter: { accountTag: "${cfAccountId}" }) {
      inv: workersInvocationsAdaptive(limit: 10000, filter: { datetime_geq: "${date(first)}T00:00:00Z", datetime_leq: "${date(last)}T23:59:59Z" }) { sum { requests } dimensions { date } }
      d1: d1AnalyticsAdaptiveGroups(limit: 10000, filter: { date_geq: "${date(first)}", date_leq: "${date(last)}" }) { sum { rowsRead rowsWritten } dimensions { date } } } } }`,
  );
  const acc = data.viewer.accounts[0] ?? {};
  const out: Record<Counter, number[]> = { requests: Array(DAYS).fill(0), writes: Array(DAYS).fill(0), reads: Array(DAYS).fill(0) };
  const add = (k: Counter, day: string, n: number | undefined) => {
    const i = Math.round(Date.parse(`${day}T00:00:00Z`) / D) - first;
    if (i >= 0 && i < DAYS) out[k][i]! += n ?? 0;
  };
  for (const r of acc.inv ?? []) add('requests', r.dimensions.date, r.sum.requests);
  for (const r of acc.d1 ?? []) {
    add('writes', r.dimensions.date, r.sum.rowsWritten);
    add('reads', r.dimensions.date, r.sum.rowsRead);
  }
  return out;
}

/** The advice of the accounts due, the longest-waiting first. */
export async function runAdvice(env: Env, now = Date.now()): Promise<{ advised: number }> {
  const rows = (
    await env.DB.prepare("SELECT * FROM edge_accounts WHERE state NOT IN ('pending', 'bootstrap_lost', 'revoked') AND bundle IS NOT NULL AND d1_id IS NOT NULL AND advice_at <= ? ORDER BY advice_at LIMIT ?")
      .bind(now, BATCH)
      .all<EdgeAccount>()
  ).results;
  let advised = 0;
  const today = Math.floor(now / D);
  const first = today - DAYS; // complete days only: today is never used
  for (const edge of rows) {
    // Once per UTC day — a new complete day to read — and never sooner than ADVICE_EVERY.
    let next = Math.max(now + ADVICE_EVERY, (today + 1) * D);
    let advice: Advice | null = null;
    let revoked = false;
    // No token, or one that cannot be opened: the token check reports that; nothing to measure.
    const token = await workingToken(env, edge).catch(() => null);
    if (token) {
      // 403 means the data cannot be had (no right, no dataset): unavailable. 401 is a revoked
      // token — the token check's to say, so it is asked to look at once. Anything passing — 5xx,
      // 429, the network — leaves the account to the next hour.
      const status = (e: unknown) => (e instanceof CfError ? e.status : 0);
      const [counters, size] = await Promise.allSettled([
        measure(token, edge.cf_account_id, first),
        cf<{ file_size?: number }>(token, 'GET', `/accounts/${edge.cf_account_id}/d1/database/${edge.d1_id}`).then((d) => d.file_size ?? null),
      ]);
      const failed = [counters, size].flatMap((r) => (r.status === 'rejected' ? [status(r.reason)] : []));
      revoked = failed.includes(401);
      if (revoked || failed.some((s) => s !== 403)) next = now + RETRY;
      else advice = advise(counters.status === 'fulfilled' ? counters.value : null, size.status === 'fulfilled' ? size.value : null, first, today, now);
    }
    await env.DB.prepare('UPDATE edge_accounts SET advice = coalesce(?1, advice), advice_at = ?2, token_checked_at = CASE WHEN ?4 THEN 0 ELSE token_checked_at END WHERE id = ?3')
      .bind(advice ? JSON.stringify(advice) : null, next, edge.id, revoked ? 1 : 0)
      .run();
    if (advice) {
      advised++;
      await mailAdvice(env, edge, advice, now).catch((e: unknown) => console.error('advice mail', edge.id, e instanceof Error ? e.message : e));
    }
  }
  return { advised };
}

const WEEK = 7 * D;
const METRIC_TEXT: Record<Metric, string> = { requests: 'запросы к воркерам за сутки', writes: 'записи D1 за сутки', reads: 'чтения D1 за сутки', size: 'размер базы clx-edge' };

/**
 * The advice by e-mail (§8): `over` at once, `upgrade_soon` at most weekly — a level higher than the
 * last one written about goes at once, the same level again after a week; back to `ok` or `watch`,
 * the last level is cleared, so a new rise is written about at once.
 */
async function mailAdvice(env: Env, edge: EdgeAccount, advice: Advice, now: number): Promise<void> {
  const rank = (l: string | null) => (l ? LEVELS.indexOf(l as Level) : -1);
  if (rank(advice.level) < rank('upgrade_soon')) {
    if (edge.advice_mailed_level) await env.DB.prepare('UPDATE edge_accounts SET advice_mailed_level = NULL WHERE id = ?').bind(edge.id).run();
    return;
  }
  if (rank(advice.level) <= rank(edge.advice_mailed_level) && edge.advice_mailed_at > now - WEEK) return;
  const user = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(edge.user_id).first<{ email: string }>();
  if (!user) return;
  const m = advice.metric ? advice.metrics[advice.metric] : undefined;
  const what = advice.metric ? `${METRIC_TEXT[advice.metric]}: ${m?.busiest.value.toLocaleString('ru-RU')} из ${m?.limit.toLocaleString('ru-RU')}${m?.forecast ? `, к пределу — около ${m.forecast}` : ''}` : '';
  const name = edge.cf_account_name ?? edge.cf_account_id;
  const text =
    advice.level === 'over'
      ? `Здравствуйте!\n\nАккаунт Cloudflare «${name}» упёрся в лимит бесплатного тарифа Workers — ${what}.\nСверх лимита Cloudflare отказывает в работе воркерам: счётчик и ссылки могут не отвечать до конца суток (UTC).\n${advice.suggest ? 'Дело в размере базы: помогло бы хранить почасовые детали короче.\n' : 'Переход этого аккаунта на Workers Paid ($5 в месяц) снимает лимит.\n'}\nПодробности: ${appOrigin(env)}/#/accounts/${edge.id}\n`
      : `Здравствуйте!\n\nАккаунт Cloudflare «${name}» скоро упрётся в лимит бесплатного тарифа Workers — ${what}.\n${advice.suggest ? 'Дело в размере базы: помогло бы хранить почасовые детали короче.\n' : 'Стоит заранее перевести его на Workers Paid ($5 в месяц).\n'}\nПодробности: ${appOrigin(env)}/#/accounts/${edge.id}\n`;
  if (await sendNotice(env, user.email, advice.level === 'over' ? `clx: «${name}» упёрся в лимит Cloudflare` : `clx: «${name}» скоро упрётся в лимит Cloudflare`, text, now))
    await env.DB.prepare('UPDATE edge_accounts SET advice_mailed_level = ?, advice_mailed_at = ? WHERE id = ?').bind(advice.level, now, edge.id).run();
}

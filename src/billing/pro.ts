// The balance and Pro (docs/spec.md §18, ADR 0034). The balance is the sum of an append-only
// journal; Pro is an open period charged by the UTC day. Every money step is one conditional
// statement that re-checks what it rests on — the balance, the period still open, no plan given by
// hand, no delete under way — so a step racing another (a top-up, a switch, the cron twice) either
// holds or does nothing; a unique (user, day) index keeps one charge per day.
import { fail } from '../v1/http';
import { applyPlan } from './pause';

/** $9 per 30 days, charged by the day: 300,000 micro-USD, exact. */
export const PRO_PRICE = 9_000_000;
export const DAY_PRICE = PRO_PRICE / 30;
/** Grace before an unpaid period closes (§18). */
export const GRACE_MS = 3 * 86_400_000;
/** A balance under this many days of Pro is told once (§18). */
export const LOW_DAYS = 14;

export const dayOf = (ms: number) => Math.floor(ms / 86_400_000);
export const isoDay = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);

export interface Period {
  id: number;
  start_day: number;
  end_day: number | null;
}

export async function balanceOf(db: D1Database, userId: number): Promise<number> {
  return (await db.prepare('SELECT coalesce(sum(amount), 0) AS b FROM ledger WHERE user_id = ?').bind(userId).first<{ b: number }>())!.b;
}

export const openPeriod = (db: D1Database, userId: number) => db.prepare('SELECT id, start_day, end_day FROM pro_periods WHERE user_id = ? AND end_day IS NULL').bind(userId).first<Period>();

/** Charge one day of a period: only while the balance covers it, the period is still open and holds
 *  the day, the plan is not given by hand, the user is not being deleted, and the day is unpaid. */
async function chargeDay(db: D1Database, userId: number, periodId: number, day: number, now: number): Promise<'charged' | 'already' | 'short' | 'gone'> {
  const res = await db
    .prepare(
      `INSERT INTO ledger (user_id, type, amount, day, created_at)
       SELECT ?1, 'charge', -?2, ?3, ?4
       WHERE (SELECT coalesce(sum(amount), 0) FROM ledger WHERE user_id = ?1) >= ?2
         AND NOT EXISTS (SELECT 1 FROM ledger WHERE user_id = ?1 AND type = 'charge' AND day = ?3)
         AND EXISTS (SELECT 1 FROM pro_periods WHERE id = ?5 AND end_day IS NULL AND start_day <= ?3)
         AND EXISTS (SELECT 1 FROM users WHERE id = ?1 AND plan_comp = 0 AND deleting_at IS NULL)`,
    )
    .bind(userId, DAY_PRICE, day, now, periodId)
    .run();
  if (res.meta.changes) return 'charged';
  if (await db.prepare("SELECT 1 FROM ledger WHERE user_id = ? AND type = 'charge' AND day = ?").bind(userId, day).first()) return 'already';
  const live = await db.prepare('SELECT 1 FROM pro_periods p JOIN users u ON u.id = p.user_id WHERE p.id = ? AND p.end_day IS NULL AND u.plan_comp = 0 AND u.deleting_at IS NULL').bind(periodId).first();
  return live ? 'short' : 'gone';
}

/** The first day of the period, up to today, that is not charged — or null. */
async function firstUnpaid(db: D1Database, userId: number, period: Period, today: number): Promise<number | null> {
  const paid = (await db.prepare("SELECT day FROM ledger WHERE user_id = ? AND type = 'charge' AND day >= ? AND day <= ? ORDER BY day").bind(userId, period.start_day, today).all<{ day: number }>()).results;
  let d = period.start_day;
  for (const r of paid) {
    if (r.day !== d) break;
    d++;
  }
  return d <= today ? d : null;
}

/**
 * Close a period at `endDay` (exclusive) — only if it is still open and, when `unpaid` is given, that
 * day is still not charged (a top-up may have paid it meanwhile). A period closed at its start held
 * no day and goes. The grace ends with it unless another period is open. Returns whether it closed.
 */
async function closePeriod(db: D1Database, userId: number, periodId: number, endDay: number, unpaid: number | null): Promise<boolean> {
  const [closed] = await db.batch([
    db
      .prepare("UPDATE pro_periods SET end_day = max(start_day, ?2) WHERE id = ?1 AND end_day IS NULL AND (?3 IS NULL OR NOT EXISTS (SELECT 1 FROM ledger WHERE user_id = ?4 AND type = 'charge' AND day = ?3))")
      .bind(periodId, endDay, unpaid, userId),
    db.prepare('DELETE FROM pro_periods WHERE id = ? AND end_day = start_day').bind(periodId),
    db.prepare('UPDATE users SET grace_since = NULL WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM pro_periods WHERE user_id = ?1 AND end_day IS NULL)').bind(userId),
  ]);
  return !!closed!.meta.changes;
}

/** End the open period now: after today when all is paid, else at its first unpaid day (forgiven).
 *  A close lost to a charge racing it is tried again; one that keeps losing is an error to retry. */
async function endPeriod(db: D1Database, userId: number, today: number): Promise<void> {
  for (let tries = 0; tries < 10; tries++) {
    const period = await openPeriod(db, userId);
    if (!period) return;
    const unpaid = await firstUnpaid(db, userId, period, today);
    if (await closePeriod(db, userId, period.id, unpaid ?? today + 1, unpaid)) return;
  }
  fail(409, 'operation_in_progress', 'Pro is being charged right now; retry in a moment.');
}

/**
 * Charge the open period's unpaid days up to today, oldest first, a whole day at a time; then set
 * or end the grace, and close the period at its first unpaid day once the grace has run out. Run by
 * the cron for every open period and by a deposit for its user. Returns what changed for the user.
 */
export async function settleUser(env: { DB: D1Database }, userId: number, now = Date.now()): Promise<'paid' | 'grace_started' | 'grace' | 'closed' | 'none'> {
  const db = env.DB;
  const period = await openPeriod(db, userId);
  if (!period) return 'none';
  const today = dayOf(now);
  // Bounded: each pass either charges a day, or meets a day it cannot pay and decides.
  for (let pass = 0, d = await firstUnpaid(db, userId, period, today); d !== null && pass < 100; pass++, d = await firstUnpaid(db, userId, period, today)) {
    const r = await chargeDay(db, userId, period.id, d, now);
    if (r === 'gone') return 'none';
    if (r !== 'short') continue;
    // A grace starts only on what is still true: the period open, the day unpaid, the balance short.
    const set = await db
      .prepare(
        `UPDATE users SET grace_since = ?2 WHERE id = ?1 AND grace_since IS NULL AND plan_comp = 0 AND deleting_at IS NULL
           AND EXISTS (SELECT 1 FROM pro_periods WHERE id = ?3 AND end_day IS NULL)
           AND NOT EXISTS (SELECT 1 FROM ledger WHERE user_id = ?1 AND type = 'charge' AND day = ?4)
           AND (SELECT coalesce(sum(amount), 0) FROM ledger WHERE user_id = ?1) < ?5`,
      )
      .bind(userId, now, period.id, d, DAY_PRICE)
      .run();
    if (set.meta.changes) return 'grace_started';
    const since = await db.prepare('SELECT grace_since FROM users WHERE id = ?').bind(userId).first<number>('grace_since');
    if (since === null) continue; // something changed meanwhile: look again
    if (now - since < GRACE_MS) return 'grace';
    // The grace ran out: the period ends at its first unpaid day, which nobody then owes — unless
    // a top-up paid that day meanwhile.
    if (!(await closePeriod(db, userId, period.id, d, d))) return 'none';
    await applyPlan(env, userId, now);
    return 'closed';
  }
  await db.prepare('UPDATE users SET grace_since = NULL WHERE id = ? AND grace_since IS NOT NULL').bind(userId).run();
  return 'paid';
}

/**
 * Pro on (§18): needs a confirmed e-mail and a balance of at least $9, checked in the statement that
 * opens the period; then today is charged. Pro given by hand needs nothing.
 */
export async function proOn(env: { DB: D1Database }, userId: number, now = Date.now()): Promise<void> {
  const db = env.DB;
  const user = (await db.prepare('SELECT email_confirmed_at, plan_comp FROM users WHERE id = ?').bind(userId).first<{ email_confirmed_at: number | null; plan_comp: number }>())!;
  if (user.email_confirmed_at === null) fail(403, 'email_unconfirmed', 'Confirm your e-mail address first.');
  if (user.plan_comp) return;
  if (!(await openPeriod(db, userId))) {
    let opened = false;
    try {
      const r = await db
        .prepare(
          `INSERT INTO pro_periods (user_id, start_day, created_at) SELECT ?1, ?2, ?3
           WHERE (SELECT coalesce(sum(amount), 0) FROM ledger WHERE user_id = ?1) >= ?4
             AND EXISTS (SELECT 1 FROM users WHERE id = ?1 AND plan_comp = 0 AND deleting_at IS NULL)`,
        )
        .bind(userId, dayOf(now), now, PRO_PRICE)
        .run();
      opened = !!r.meta.changes;
    } catch (e) {
      if (!String(e).includes('UNIQUE')) throw e; // switched on twice at once: one period
      opened = true;
    }
    if (!opened) {
      const balance = await balanceOf(db, userId);
      fail(402, 'insufficient_balance', 'Pro needs a balance of at least $9; top it up first.', { balance_micro_usd: balance, needed_micro_usd: PRO_PRICE });
    }
  }
  await settleUser(env, userId, now);
  await applyPlan(env, userId, now);
}

/** Pro off (§18): the period ends after today, or at its first unpaid day; nothing after is charged. */
export async function proOff(env: { DB: D1Database }, userId: number, now = Date.now()): Promise<void> {
  await endPeriod(env.DB, userId, dayOf(now));
  await applyPlan(env, userId, now);
}

/** A plan given or taken by hand (§17 `/plan`): given, no charge passes from here on and the paid
 *  period is settled and closed; taken, the user is on what their periods say. */
export async function setComp(env: { DB: D1Database }, userId: number, comp: boolean, now = Date.now()): Promise<'free' | 'api'> {
  const db = env.DB;
  await db.prepare('UPDATE users SET plan_comp = ?2, grace_since = CASE WHEN ?2 THEN NULL ELSE grace_since END WHERE id = ?1').bind(userId, comp ? 1 : 0).run();
  if (comp) await endPeriod(db, userId, dayOf(now));
  return applyPlan(env, userId, now);
}

/** The last day of the unbroken run of paid days from the open period's start, or null. */
export async function paidThrough(db: D1Database, userId: number, period: Period | null): Promise<number | null> {
  if (!period) return null;
  const paid = (await db.prepare("SELECT day FROM ledger WHERE user_id = ? AND type = 'charge' AND day >= ? ORDER BY day").bind(userId, period.start_day).all<{ day: number }>()).results;
  let d = period.start_day;
  for (const r of paid) {
    if (r.day !== d) break;
    d++;
  }
  return d > period.start_day ? d - 1 : null;
}

/** Users one hourly run settles: a few D1 queries each, within the invocation's query budget; the
 *  rest go next hour, and their days are charged then (a late charge is still the same day's). */
const CHARGE_PAGE = 100;

/** The cron (§18): open periods not yet charged today and every grace, graces first (oldest first). */
export async function runCharges(env: { DB: D1Database }, now = Date.now()): Promise<{ users: number; grace: number[]; closed: number[] }> {
  const db = env.DB;
  const due = (
    await db
      .prepare(
        `SELECT p.user_id FROM pro_periods p JOIN users u ON u.id = p.user_id
         WHERE p.end_day IS NULL AND u.plan_comp = 0 AND u.deleting_at IS NULL
           AND (u.grace_since IS NOT NULL OR NOT EXISTS (SELECT 1 FROM ledger l WHERE l.user_id = p.user_id AND l.type = 'charge' AND l.day = ?))
         ORDER BY u.grace_since IS NULL, u.grace_since, p.user_id LIMIT ${CHARGE_PAGE}`,
      )
      .bind(dayOf(now))
      .all<{ user_id: number }>()
  ).results;
  const grace: number[] = [];
  const closed: number[] = [];
  for (const { user_id } of due) {
    const r = await settleUser(env, user_id, now).catch((e: unknown) => (console.error('charge', user_id, e instanceof Error ? e.message : e), 'none' as const));
    if (r === 'grace_started') grace.push(user_id);
    if (r === 'closed') closed.push(user_id);
  }
  return { users: due.length, grace, closed };
}

/**
 * Users whose balance has fallen under 14 days of Pro and who have not been told since it was last
 * above (§18) — the notice before a bonus or a top-up runs out. The caller marks each one told
 * (`markLowTold`) only once the notice went, so a failed one is tried again next hour.
 */
export async function lowBalances(env: { DB: D1Database }): Promise<number[]> {
  const db = env.DB;
  const low = LOW_DAYS * DAY_PRICE;
  const balance = '(SELECT coalesce(sum(amount), 0) FROM ledger WHERE user_id = u.id)';
  const [, due] = await db.batch([
    db.prepare(`UPDATE users AS u SET low_mailed_at = NULL WHERE low_mailed_at IS NOT NULL AND ${balance} >= ?`).bind(low),
    db
      .prepare(
        `SELECT u.id FROM users u JOIN pro_periods p ON p.user_id = u.id AND p.end_day IS NULL
         WHERE u.low_mailed_at IS NULL AND u.plan_comp = 0 AND u.deleting_at IS NULL AND ${balance} < ? LIMIT 100`,
      )
      .bind(low),
  ]);
  return (due!.results as { id: number }[]).map((r) => r.id);
}

export const markLowTold = (env: { DB: D1Database }, userId: number, now = Date.now()) => env.DB.prepare('UPDATE users SET low_mailed_at = ? WHERE id = ? AND low_mailed_at IS NULL').bind(now, userId).run();

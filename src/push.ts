// The receiver of worker pushes (docs/spec.md §7). It trusts nothing in the body: the account comes
// from the worker key alone, every item is checked on its own — known fields, a target of this
// account, an hour or day neither in the future nor over 31 days old, integers in range — and
// refused alone. Hours are written as they come (a repeat is the same row again); a day only moves
// forward by (final, as_of_hour), so an old snapshot never overwrites a newer one.
import { dayOf, hourOf, PART_ITEMS, PUSH_VERSION, TERMINAL, type PushAnswer, type PushBody, type Reason } from '../edge/contract';
import type { EdgeAccount } from './cf/connect';
import { staleSync } from './cf/sites';
import { planOf, writeBudget } from './limits';

const MAX = 1_000_000_000;
const DAYS_BACK = 31;
const int = (v: unknown, min = 0, max = MAX): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const str = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;
const exactly = (o: object, keys: string[]) => Object.keys(o).length === keys.length && keys.every((k) => k in o);
const DROPS = new Set<string>([...TERMINAL, 'busy', 'expired']);

/** The body's frame, or null: then the whole push is refused (the worker sends nothing else). */
export function parseBody(v: unknown): PushBody | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const b = v as Record<string, unknown>;
  if (Object.keys(b).some((k) => !['v', 'bundle', 'schema', 'queue', 'revision', 'error', 'dropped', 'items'].includes(k))) return null;
  if (b.v !== PUSH_VERSION || !str(b.bundle) || !(b.schema === null || int(b.schema)) || !int(b.queue) || !int(b.revision)) return null;
  if (b.error !== undefined && !str(b.error)) return null;
  if (b.dropped !== undefined) {
    const d = b.dropped;
    if (!d || typeof d !== 'object' || Array.isArray(d) || Object.entries(d).some(([k, n]) => !DROPS.has(k) || !int(n))) return null;
  }
  if (!Array.isArray(b.items) || b.items.length > PART_ITEMS) return null;
  const ids = new Set<number>();
  for (const it of b.items) {
    if (!it || typeof it !== 'object' || Array.isArray(it) || !int((it as { id?: unknown }).id) || ids.has((it as { id: number }).id)) return null;
    ids.add((it as { id: number }).id);
  }
  return b as unknown as PushBody;
}

type Row = { kind: 'hour'; target: string; hour: number; views: number; bots: number } | { kind: 'day'; target: string; day: number; as_of_hour: number; final: boolean; views: number; bots: number; visitors: number };

/** One item: its row, or why it is refused. */
function check(it: Record<string, unknown>, targets: Set<string>, links: Set<string>, now: number): Row | Reason {
  const hourNow = hourOf(now);
  const today = dayOf(now);
  if ('hour' in it) {
    if (!exactly(it, ['id', 'target', 'hour', 'views', 'bots']) || !str(it.target, 64) || !int(it.hour) || !int(it.views) || !int(it.bots)) return 'invalid';
    if (it.hour >= hourNow) return 'invalid'; // only closed hours
    if (it.hour < hourNow - DAYS_BACK * 24) return 'too_old';
    // A link sends only its final days (§7).
    if (links.has(it.target)) return 'invalid';
    if (!targets.has(it.target)) return 'unknown_target';
    return { kind: 'hour', target: it.target, hour: it.hour, views: it.views, bots: it.bots };
  }
  const final = it.final;
  if (!exactly(it, final === false ? ['id', 'target', 'day', 'as_of_hour', 'final', 'views', 'bots', 'visitors'] : ['id', 'target', 'day', 'final', 'views', 'bots', 'visitors'])) return 'invalid';
  if (typeof final !== 'boolean' || !str(it.target, 64) || !int(it.day) || !int(it.views) || !int(it.bots) || !int(it.visitors)) return 'invalid';
  // A day is final only once it is over; a snapshot is as of one of its hours already closed.
  const asOf = final ? it.day * 24 + 23 : it.as_of_hour;
  if (it.day > today || (final && it.day === today) || !int(asOf) || asOf < it.day * 24 || asOf > it.day * 24 + 23 || asOf >= hourNow) return 'invalid';
  if (it.day < today - DAYS_BACK) return 'too_old';
  if (!final && links.has(it.target)) return 'invalid';
  if (!targets.has(it.target) && !links.has(it.target)) return 'unknown_target';
  return { kind: 'day', target: it.target, day: it.day, as_of_hour: asOf, final, views: it.views, bots: it.bots, visitors: it.visitors };
}

/** Rows per statement: D1 takes at most 100 parameters (`d1/platform/limits`). */
const chunks = <T>(list: T[], n: number) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

export async function receive(db: D1Database, edge: EdgeAccount, body: PushBody, now: number): Promise<PushAnswer> {
  const today = dayOf(now);
  const [sites, owner, links] = await db.batch([
    db.prepare('SELECT target, state FROM sites WHERE account_id = ?1').bind(edge.id),
    db.prepare('SELECT plan FROM users WHERE id = ?1').bind(edge.user_id),
    db.prepare('SELECT target, state FROM links WHERE account_id = ?1').bind(edge.id),
  ]);
  const siteRows = sites!.results as { target: string; state: string }[];
  const linkRows = links!.results as { target: string; state: string }[];
  const targets = new Set(siteRows.map((s) => s.target));
  const linkTargets = new Set(linkRows.map((l) => l.target));
  const live = (rows: { state: string }[]) => rows.filter((r) => r.state !== 'deleted').length;
  const budget = writeBudget(planOf((owner!.results[0] as { plan?: string } | undefined)?.plan ?? 'free'), live(siteRows), live(linkRows));

  const answer: PushAnswer = { accepted: [], rejected: [] };
  const valid: { id: number; row: Row }[] = [];
  for (const it of body.items as unknown as Record<string, unknown>[]) {
    const row = check(it, targets, linkTargets, now);
    if (typeof row === 'string') answer.rejected.push({ id: it.id as number, reason: row });
    else valid.push({ id: it.id as number, row });
  }
  // The budget is reserved before anything is decided — every valid item and the heartbeat, in
  // one statement — so two pushes at once cannot both spend the same room; what is not used is
  // given back with the writes.
  const want = valid.length + 1;
  const reserved = await db
    .prepare('UPDATE edge_accounts SET budget_used = CASE WHEN budget_day = ?1 THEN budget_used ELSE 0 END + ?2, budget_day = ?1 WHERE id = ?3 RETURNING budget_used')
    .bind(today, want, edge.id)
    .first<number>('budget_used');
  let used = (reserved ?? want) - want + 1;
  const hours: Extract<Row, { kind: 'hour' }>[] = [];
  const days: Extract<Row, { kind: 'day' }>[] = [];
  for (const { id, row } of valid) {
    // Over the budget only final days are taken: daily totals stay exact (§8).
    const final = row.kind === 'day' && row.final;
    if (!final && used >= budget) {
      answer.rejected.push({ id, reason: 'budget' });
      continue;
    }
    used++;
    if (row.kind === 'hour') hours.push(row);
    else days.push(row);
    answer.accepted.push(id);
  }
  const refund = want - 1 - answer.accepted.length;

  const writes: D1PreparedStatement[] = [];
  for (const part of chunks(hours, 20))
    writes.push(
      db
        .prepare(`INSERT INTO hourly (account_id, target, hour, views, bots) VALUES ${part.map(() => '(?, ?, ?, ?, ?)').join(', ')} ON CONFLICT (account_id, target, hour) DO UPDATE SET views = excluded.views, bots = excluded.bots`)
        .bind(...part.flatMap((r) => [edge.id, r.target, r.hour, r.views, r.bots])),
    );
  for (const part of chunks(days, 12))
    writes.push(
      db
        .prepare(
          `INSERT INTO daily (account_id, target, day, as_of_hour, final, views, bots, visitors) VALUES ${part.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ')} ` +
            'ON CONFLICT (account_id, target, day) DO UPDATE SET as_of_hour = excluded.as_of_hour, final = excluded.final, views = excluded.views, bots = excluded.bots, visitors = excluded.visitors ' +
            'WHERE (excluded.final, excluded.as_of_hour) > (daily.final, daily.as_of_hour)',
        )
        .bind(...part.flatMap((r) => [edge.id, r.target, r.day, r.as_of_hour, r.final ? 1 : 0, r.views, r.bots, r.visitors])),
    );
  // The heartbeat; a worker heard from again is no longer "no connection".
  writes.push(
    db
      .prepare(
        `UPDATE edge_accounts SET last_push_at = ?1, push_bundle = ?2, push_schema = ?3, push_queue = ?4, push_error = ?5, push_revision = ?6, push_dropped = ?7,
         budget_used = CASE WHEN budget_day = ?8 THEN max(budget_used - ?9, 0) ELSE budget_used END,
         state = CASE WHEN state = 'no_connection' THEN 'ready' ELSE state END, updated_at = ?1 WHERE id = ?10`,
      )
      .bind(now, body.bundle, body.schema, body.queue, body.error ?? null, body.revision, body.dropped ? JSON.stringify(body.dropped) : null, today, refund, edge.id),
  );
  try {
    await db.batch(writes);
  } catch (e) {
    // Nothing was written: the whole reservation goes back, and the worker sends again.
    await db.prepare('UPDATE edge_accounts SET budget_used = max(budget_used - ?1, 0) WHERE id = ?2 AND budget_day = ?3').bind(want, edge.id, today).run().catch(() => undefined);
    throw e;
  }
  // The push is in; the sync check is best effort — a failure here must not make the worker send
  // the same items again.
  await staleSync(db, edge, body.revision, now).catch((e: unknown) => console.error('staleSync', edge.id, e instanceof Error ? e.message : e));
  return answer;
}

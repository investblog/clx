// The worker's hourly run (docs/spec.md §5, §7): close past days, queue the closed hours, expire old
// data. Every step makes a fixed number of D1 queries — Free allows 50 per invocation and counts each
// statement of a batch — and the work is set-based SQL, so the run's CPU does not grow with traffic.
import { ACCOUNT, ACCOUNT_ROWS, dayOf, FULL_BYTES, HOUR_COLUMNS, hourOf, OTHER, OUTBOX_HOURS, PART_ITEMS, TARGET_ROWS } from './contract';
import { send } from './push';

/** Days closed per run, at most (the query ledger of §5). */
export const CLOSE_DAYS = 3;
const HOURS_KEPT = 31 * 24;
const DAYS_KEPT = 400;
/** A final day clx.cx has not accepted in this many days it would refuse anyway (§7). */
const FINAL_DAYS_KEPT = 31;

const DIMS = 'page, source, country, device, browser, os';
const IS_OTHER = `(page = '${OTHER}' AND source = '' AND country = '' AND device = '' AND browser = '' AND os = '')`;
/** A combination keeps its own row if its target has at most 299 in the day, or it is among the
 *  target's 298 busiest; the rest go to the target's (other) row, its 299th. */
const KEEPS = `(n <= ${TARGET_ROWS} OR rt < ${TARGET_ROWS})`;

/** One day's close, one batch (?1, ?2: its hours; ?3: the day): hours → day with the caps of §5,
 *  the visitor count into final_days, the day's hashes, salt and counters deleted, the mark. A
 *  failed batch leaves the day open as a whole. */
function closeDay(db: D1Database, day: number): D1PreparedStatement[] {
  const hours = [day * 24, day * 24 + 24] as const;
  return [
    db
      .prepare(
        `WITH agg AS (SELECT target, ${DIMS}, sum(views) AS v FROM views_hourly WHERE hour >= ?1 AND hour < ?2 GROUP BY target, ${DIMS}),
         t AS (SELECT *, ${IS_OTHER} AS oth, count(*) OVER (PARTITION BY target) AS n, row_number() OVER (PARTITION BY target ORDER BY v DESC, ${DIMS}) AS rt FROM agg WHERE target != '${ACCOUNT}'),
         kt AS (SELECT target, ${DIMS}, v FROM t WHERE NOT oth AND ${KEEPS}
                UNION ALL SELECT target, '${OTHER}', '', '', '', '', '', sum(v) FROM t WHERE oth OR NOT ${KEEPS} GROUP BY target),
         ka AS (SELECT *, row_number() OVER (ORDER BY v DESC, target, ${DIMS}) AS ra FROM kt)
         INSERT INTO views_daily (target, day, ${DIMS}, views)
         SELECT * FROM (
           SELECT target, ?3, ${DIMS}, v FROM ka WHERE ra <= ${ACCOUNT_ROWS}
           UNION ALL SELECT '${ACCOUNT}', ?3, '${OTHER}', '', '', '', '', '', sum(v) FROM (SELECT v FROM ka WHERE ra > ${ACCOUNT_ROWS} UNION ALL SELECT v FROM agg WHERE target = '${ACCOUNT}') HAVING count(*) > 0
         ) WHERE true ON CONFLICT (target, day, ${DIMS}) DO UPDATE SET views = excluded.views`,
      )
      .bind(...hours, day),
    db
      .prepare('INSERT INTO bots_daily (target, day, category, hits) SELECT target, ?3, category, sum(hits) FROM bots_hourly WHERE hour >= ?1 AND hour < ?2 GROUP BY target, category ON CONFLICT (target, day, category) DO UPDATE SET hits = excluded.hits')
      .bind(...hours, day),
    db
      .prepare(
        // The first close wins: a repeat would find the visitor hashes already deleted.
        'INSERT INTO final_days (target, day, views, bots, visitors) SELECT t.target, t.day, t.views, t.bots, (SELECT count(*) FROM visitors_daily v WHERE v.target = t.target AND v.day = t.day) FROM totals t WHERE t.day = ?1 ON CONFLICT DO NOTHING',
      )
      .bind(day),
    db.prepare('DELETE FROM visitors_daily WHERE day = ?1').bind(day),
    db.prepare('DELETE FROM salts WHERE day = ?1').bind(day),
    db.prepare('DELETE FROM rows_hourly WHERE hour >= ?1 AND hour < ?2').bind(...hours),
    db.prepare('INSERT INTO closed_days (day) VALUES (?1) ON CONFLICT DO NOTHING').bind(day),
  ];
}

/** A site's views in hour `h` from its day's totals row. */
const VIEWS_AT = `CASE h % 24 ${HOUR_COLUMNS.map((c, i) => `WHEN ${i} THEN t.${c}`).join(' ')} END`;

/** The queue step, one batch: the hour items of sites for the closed hours after the cursor (one
 *  outbox row per hour, more when an hour has over 2,000 items), the running day snapshot as of the
 *  last closed hour, and the cursor. Under storage backpressure only the cursor moves (§8). Both
 *  inserts hold only while the stored cursor is still `stored`, so a second run of the same hour —
 *  a cron fired twice — queues nothing again. */
function queue(db: D1Database, stored: number, cursor: number, last: number, room: boolean): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = [];
  const unmoved = (p: string) => `coalesce((SELECT value FROM meta WHERE key = 'outboxed_through'), -1) = ${p}`;
  if (room && cursor < last) {
    out.push(
      db
        .prepare(
          // A bound number may arrive as REAL; h / 24 must be integer division.
          `WITH RECURSIVE hrs(h) AS (SELECT CAST(?1 AS INTEGER) + 1 UNION ALL SELECT h + 1 FROM hrs WHERE h < ?2),
           v AS (SELECT t.target, h AS hour, ${VIEWS_AT} AS views, 0 AS bots FROM hrs JOIN totals t ON t.day = h / 24 WHERE t.target LIKE 's%'),
           b AS (SELECT target, hour, 0, sum(hits) FROM bots_hourly WHERE hour > ?1 AND hour <= ?2 AND target LIKE 's%' GROUP BY target, hour),
           x AS (SELECT target, hour, sum(views) AS views, sum(bots) AS bots FROM (SELECT * FROM v UNION ALL SELECT * FROM b) GROUP BY target, hour HAVING sum(views) + sum(bots) > 0),
           p AS (SELECT *, (row_number() OVER (PARTITION BY hour ORDER BY target) - 1) / ${PART_ITEMS} AS part FROM x)
           INSERT INTO outbox (hour, items) SELECT hour, json_group_array(json_object('target', target, 'hour', hour, 'views', views, 'bots', bots)) FROM p WHERE ${unmoved('?3')} GROUP BY hour, part ORDER BY hour, part`,
        )
        .bind(cursor, last, stored),
    );
    // The day of the last closed hour, unless the close step has just closed it: its final item
    // follows from final_days. Visitors are the day's so far — they cannot be split by hour.
    const day = Math.floor(last / 24);
    const views = HOUR_COLUMNS.slice(0, (last % 24) + 1).join(' + ');
    out.push(
      db
        .prepare(
          `INSERT INTO outbox (hour, items) SELECT ?1, json_group_array(json_object('target', t.target, 'day', t.day, 'as_of_hour', ?1, 'final', json('false'), 'views', ${views}, ` +
            "'bots', (SELECT coalesce(sum(hits), 0) FROM bots_hourly b WHERE b.target = t.target AND b.hour >= ?2 AND b.hour <= ?1), " +
            "'visitors', (SELECT count(*) FROM visitors_daily v WHERE v.target = t.target AND v.day = t.day))) " +
            `FROM totals t WHERE t.day = ?3 AND t.target LIKE 's%' AND NOT EXISTS (SELECT 1 FROM closed_days WHERE day = ?3) AND ${unmoved('?4')} HAVING count(*) > 0`,
        )
        .bind(last, day * 24, day, stored),
    );
  }
  out.push(db.prepare("INSERT INTO meta (key, value) VALUES ('outboxed_through', ?1) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(last));
  return out;
}

/** The expiry step: one table per run, in turn — at most two statements, then the turn moves. */
function expire(db: D1Database, turn: number, now: number): D1PreparedStatement[] {
  const hour = hourOf(now);
  const today = dayOf(now);
  const steps: [string, number, number?][][] = [
    [['DELETE FROM views_hourly WHERE hour < ?1', hour - HOURS_KEPT]],
    [['DELETE FROM bots_hourly WHERE hour < ?1', hour - HOURS_KEPT]],
    [
      ['DELETE FROM views_daily WHERE day < ?1', today - DAYS_KEPT],
      ['DELETE FROM closed_days WHERE day < ?1', today - DAYS_KEPT],
    ],
    [['DELETE FROM bots_daily WHERE day < ?1', today - DAYS_KEPT]],
    // A day's totals go once it is closed, its last hour queued, its final item gone and 2 days
    // have passed — or after 31 days whatever happened.
    [
      [
        "DELETE FROM totals WHERE day < ?1 OR (day <= ?2 AND day IN (SELECT day FROM closed_days) AND day * 24 + 23 <= coalesce((SELECT value FROM meta WHERE key = 'outboxed_through'), -1) " +
          'AND NOT EXISTS (SELECT 1 FROM final_days f WHERE f.target = totals.target AND f.day = totals.day))',
        today - FINAL_DAYS_KEPT,
        today - 2,
      ],
    ],
    // Old queue parts and final days clx.cx would refuse: deleted, and counted for the heartbeat.
    [
      ["INSERT INTO sync_status (reason, n) SELECT 'expired', count(*) FROM outbox WHERE hour < ?1 HAVING count(*) > 0 ON CONFLICT (reason) DO UPDATE SET n = n + excluded.n", hour - OUTBOX_HOURS],
      ['DELETE FROM outbox WHERE hour < ?1', hour - OUTBOX_HOURS],
    ],
    [
      ["INSERT INTO sync_status (reason, n) SELECT 'too_old', count(*) FROM final_days WHERE day < ?1 HAVING count(*) > 0 ON CONFLICT (reason) DO UPDATE SET n = n + excluded.n", today - FINAL_DAYS_KEPT],
      ['DELETE FROM final_days WHERE day < ?1', today - FINAL_DAYS_KEPT],
    ],
  ];
  const at = turn % steps.length;
  return [
    ...steps[at]!.map(([sql, ...args]) => db.prepare(sql).bind(...args)),
    db.prepare("INSERT INTO meta (key, value) VALUES ('expire_turn', ?1) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind((at + 1) % steps.length),
  ];
}

export interface HourlyResult {
  closed: number[];
  queuedThrough: number;
  pushes: number;
  /** D1 queries this run made: at most LEDGER. */
  statements: number;
  errors: string[];
}

/** D1 queries a Free invocation may make, less one for headroom (§5). */
export const LEDGER = 49;

/** One hourly run at `now` (the cron's scheduled time). A failed step is recorded and the run goes
 *  on; sending gets what the steps before it left of the ledger. */
export async function hourly(db: D1Database, now: number, worker: { HOOK_URL: string; EDGE_KEY: string; BUNDLE: string }): Promise<HourlyResult> {
  const last = hourOf(now) - 1;
  const today = dayOf(now);
  // The run's own state, the latest config commit and the drop counters, in one query.
  const read = await db
    .prepare("SELECT key, value FROM meta UNION ALL SELECT 'head', coalesce(max(revision), 0) FROM commits UNION ALL SELECT 'drop:' || reason, n FROM sync_status")
    .all<{ key: string; value: number | string }>();
  let statements = 1;
  const meta = new Map(read.results.map((r) => [r.key, r.value]));
  const size = read.meta?.size_after ?? 0;
  const errors: string[] = [];
  const step = async (name: string, work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
    }
  };

  const closed: number[] = [];
  const batch = (list: D1PreparedStatement[]) => ((statements += list.length), db.batch(list));
  await step('close', async () => {
    statements++;
    const days = (await db.prepare(`SELECT DISTINCT day FROM totals WHERE day < ?1 AND day NOT IN (SELECT day FROM closed_days) ORDER BY day LIMIT ${CLOSE_DAYS}`).bind(today).all<{ day: number }>()).results;
    for (const { day } of days) {
      await batch(closeDay(db, day));
      closed.push(day);
    }
  });
  // Hours are queued from the cursor, at most the last 7 days (older ones the queue would drop).
  const stored = Number(meta.get('outboxed_through') ?? -1);
  const cursor = Math.max(stored, last - OUTBOX_HOURS);
  let queuedThrough = cursor;
  await step('queue', async () => {
    await batch(queue(db, stored, cursor, last, size < FULL_BYTES));
    queuedThrough = last;
  });
  await step('expire', () => batch(expire(db, Number(meta.get('expire_turn') ?? 0), now)));

  // One query stays for the error mark at the end.
  const dropped = Object.fromEntries([...meta].filter(([k]) => k.startsWith('drop:')).map(([k, v]) => [k.slice(5), Number(v)]));
  const beat = { bundle: worker.BUNDLE, schema: meta.has('schema') ? Number(meta.get('schema')) : null, revision: Number(meta.get('head') ?? 0), error: (errors.join('; ') || String(meta.get('last_error') ?? '')).slice(0, 200) || undefined, dropped };
  let pushes = 0;
  await step('push', async () => {
    const r = await send(db, worker, beat, meta, LEDGER - 1 - statements, now);
    statements += r.statements;
    pushes = r.pushes;
    if (r.error) throw new Error(r.error);
  });

  statements++;
  if (errors.length) await db.prepare("INSERT INTO meta (key, value) VALUES ('last_error', ?1) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(errors.join('; ').slice(0, 200)).run().catch(() => undefined);
  else if (meta.has('last_error')) await db.prepare("DELETE FROM meta WHERE key = 'last_error'").run().catch(() => undefined);
  else statements--;
  return { closed, queuedThrough, pushes, statements, errors };
}

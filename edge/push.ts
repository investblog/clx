// Sending totals to clx.cx (docs/spec.md §7): outbox parts first, then pages of final days, each
// push one read and one batch. Every run pushes at least once — an empty push is the heartbeat, and
// silence means "no connection" (§4). A whole-request failure leaves the queue as it is: a lost
// answer only means the same items again next hour, which clx.cx takes as a repeat.
import { ATTEMPTS, PART_ITEMS, PUSH_VERSION, TERMINAL, type DayItem, type DropReason, type HourItem, type PushAnswer, type PushBody, type Reason } from './contract';

/** Statements one push may take: the read, then delete/rewrite, attempts, drop counters. */
export const PUSH_STATEMENTS = 4;
export const MAX_PUSHES = 6;
/** After this many 401s in a row the worker asks once a day (§7). */
const AUTH_FAILS = 20;
const DAY = 86_400_000;

type Item = (HourItem | DayItem) & { attempts?: number };
export interface Heartbeat {
  bundle: string;
  schema: number | null;
  revision: number;
  error?: string;
  dropped: Partial<Record<DropReason, number>>;
}
export interface SendResult {
  pushes: number;
  statements: number;
  error?: string;
}

// The next thing to send: the oldest outbox part, or else a page of final days. One query, with the
// queue depth (parts + final days waiting).
const NEXT = `SELECT id, items, (SELECT count(*) FROM outbox) + (SELECT count(*) FROM final_days) AS depth FROM (SELECT id, items FROM outbox ORDER BY hour, id LIMIT 1)
  UNION ALL SELECT NULL, (SELECT json_group_array(json_object('target', target, 'day', day, 'final', json('true'), 'views', views, 'bots', bots, 'visitors', visitors, 'attempts', attempts))
    FROM (SELECT * FROM final_days ORDER BY day, target LIMIT ${PART_ITEMS})), (SELECT count(*) FROM final_days)
  WHERE NOT EXISTS (SELECT 1 FROM outbox) AND EXISTS (SELECT 1 FROM final_days)`;
const KEYS = "SELECT j.value ->> '$.target', j.value ->> '$.day' FROM json_each(?1) j";

/** Push what waits, within `budget` statements; `meta` is what the run read at its start. */
export async function send(db: D1Database, env: { HOOK_URL: string; EDGE_KEY: string }, beat: Heartbeat, meta: Map<string, unknown>, budget: number, now: number): Promise<SendResult> {
  let statements = 0;
  const fails = Number(meta.get('push_401') ?? 0);
  if (fails >= AUTH_FAILS && now < Number(meta.get('push_401_next') ?? 0)) return { pushes: 0, statements };
  let pushes = 0;
  // After refusals, the first accepted push also clears their count: one more query, once.
  let clear = fails > 0;
  while (pushes < MAX_PUSHES && budget - statements >= PUSH_STATEMENTS + (clear ? 1 : 0)) {
    statements++;
    const next = await db.prepare(NEXT).first<{ id: number | null; items: string; depth: number }>();
    // Nothing waits: one empty push still goes, as the heartbeat.
    if (!next && pushes > 0) break;
    const stored: Item[] = next ? (JSON.parse(next.items) as Item[]) : [];
    const items = stored.map(({ attempts: _, ...item }, id) => ({ ...item, id }));
    const body: PushBody = { v: PUSH_VERSION, bundle: beat.bundle, schema: beat.schema, queue: next?.depth ?? 0, revision: beat.revision, ...(beat.error ? { error: beat.error } : {}), ...(Object.keys(beat.dropped).length ? { dropped: beat.dropped } : {}), items };
    let res: Response;
    try {
      res = await fetch(`${env.HOOK_URL}/push`, { method: 'POST', headers: { authorization: `Bearer ${env.EDGE_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      return { pushes, statements, error: e instanceof Error ? e.name : 'failed' };
    }
    pushes++;
    if (res.status === 401) {
      statements++;
      await db
        .prepare("INSERT INTO meta (key, value) VALUES ('push_401', ?1), ('push_401_next', ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
        .bind(fails + 1, fails + 1 >= AUTH_FAILS ? now + DAY : 0)
        .run();
      return { pushes, statements, error: '401' };
    }
    if (res.status !== 200) return { pushes, statements, error: String(res.status) };
    const answer = (await res.json()) as PushAnswer;
    if (clear) {
      clear = false;
      statements++;
      await db.prepare("DELETE FROM meta WHERE key IN ('push_401', 'push_401_next')").run();
    }
    if (!next) break;

    // Each item: accepted, dropped (terminal, or busy too often — counted), or kept for a retry.
    const verdict = new Map<number, Reason | 'ok'>(answer.accepted.map((id) => [id, 'ok']));
    for (const r of answer.rejected) verdict.set(r.id, r.reason);
    const dropped: Partial<Record<DropReason, number>> = {};
    const done: Item[] = [];
    const retry: Item[] = [];
    for (const [i, item] of stored.entries()) {
      const v = verdict.get(i) ?? 'busy'; // an item the answer does not mention is tried again
      const terminal = (TERMINAL as readonly string[]).includes(v);
      const spent = v === 'busy' && (item.attempts ?? 0) + 1 >= ATTEMPTS;
      if (terminal || spent) dropped[v as Reason] = (dropped[v as Reason] ?? 0) + 1;
      if (v === 'ok' || terminal || spent) done.push(item);
      else retry.push({ ...item, attempts: (item.attempts ?? 0) + 1 });
    }
    const batch: D1PreparedStatement[] = [];
    if (next.id !== null) {
      batch.push(retry.length ? db.prepare('UPDATE outbox SET items = ?1 WHERE id = ?2').bind(JSON.stringify(retry), next.id) : db.prepare('DELETE FROM outbox WHERE id = ?1').bind(next.id));
    } else {
      if (done.length) batch.push(db.prepare(`DELETE FROM final_days WHERE (target, day) IN (${KEYS})`).bind(JSON.stringify(done)));
      if (retry.length) batch.push(db.prepare(`UPDATE final_days SET attempts = attempts + 1 WHERE (target, day) IN (${KEYS})`).bind(JSON.stringify(retry)));
    }
    if (Object.keys(dropped).length)
      batch.push(db.prepare('INSERT INTO sync_status (reason, n) SELECT key, value FROM json_each(?1) WHERE true ON CONFLICT (reason) DO UPDATE SET n = n + excluded.n').bind(JSON.stringify(dropped)));
    statements += batch.length;
    if (batch.length) await db.batch(batch);
    // A page of final days that came back whole for a retry would come back again at once.
    if (next.id === null && !done.length) break;
  }
  return { pushes, statements };
}

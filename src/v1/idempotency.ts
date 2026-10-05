// Idempotency of mutating /v1 calls (docs/spec.md §15). The record is reserved before the handler
// runs, keyed by (principal, method, canonical path, Idempotency-Key), with a hash of the canonical
// body; the first answer is stored and replayed for 24 hours. A server failure removes the record,
// so a retry runs the handler again — handlers with Cloudflare side effects resume their recorded
// operation instead of starting a second one.
import { sha256 } from '../lib/crypto';
import { ApiError, errorBody, fail } from './http';

export const IDEM_TTL = 86_400_000;
/** An answer-less record younger than this is a call still running. */
const IN_FLIGHT = 60_000;

export interface Answer {
  status: number;
  body: unknown;
  /** What to keep instead of the body (an answer that carries a secret keeps only an id). */
  stored?: unknown;
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  return v;
}

export const canonicalPath = (url: URL): string => url.pathname + (url.search ? `?${[...url.searchParams].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&')}` : '');

export async function idempotent(
  db: D1Database,
  rec: { principal: string; method: string; path: string; key: string; body: unknown },
  replay: (stored: { status: number; answer: unknown }) => Answer,
  run: () => Promise<Answer>,
): Promise<Answer> {
  if (!/^[\x21-\x7e]{1,200}$/u.test(rec.key)) fail(400, 'invalid_request', 'Idempotency-Key must be 1–200 visible ASCII characters.');
  const bodyHash = await sha256(JSON.stringify(canonical(rec.body) ?? null));
  const now = Date.now();
  const claim = crypto.randomUUID();
  const where = 'principal = ? AND method = ? AND path = ? AND idem_key = ?';
  const ids = [rec.principal, rec.method, rec.path, rec.key];
  await db.prepare(`DELETE FROM idempotency WHERE ${where} AND created_at < ?`).bind(...ids, now - IDEM_TTL).run();
  const reserved = await db
    .prepare('INSERT INTO idempotency (principal, method, path, idem_key, body_hash, claim, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
    .bind(...ids, bodyHash, claim, now)
    .run();
  if (!reserved.meta.changes) {
    const prior = await db
      .prepare(`SELECT body_hash, status, answer, claim, created_at FROM idempotency WHERE ${where}`)
      .bind(...ids)
      .first<{ body_hash: string; status: number | null; answer: string | null; claim: string; created_at: number }>();
    // Gone between the insert and the read (expired, or a failed call cleaned up): never run
    // without owning a record.
    if (!prior) fail(409, 'operation_in_progress', 'A call with this Idempotency-Key just changed state; retry.');
    else {
      if (prior.body_hash !== bodyHash) fail(409, 'idempotency_conflict', 'This Idempotency-Key was used with another request body.');
      if (prior.status !== null) return replay({ status: prior.status, answer: JSON.parse(prior.answer ?? 'null') });
      if (now - prior.created_at < IN_FLIGHT) fail(409, 'operation_in_progress', 'A call with this Idempotency-Key is still running; retry shortly.');
      // An abandoned call: take it over. The claim moves to this call (compare-and-swap on the old
      // one), so the old call, if it is still alive, can no longer store or drop the record.
      const taken = await db.prepare(`UPDATE idempotency SET claim = ?, created_at = ? WHERE ${where} AND claim = ? AND status IS NULL`).bind(claim, now, ...ids, prior.claim).run();
      if (!taken.meta.changes) fail(409, 'operation_in_progress', 'A call with this Idempotency-Key is still running; retry shortly.');
    }
  }
  const mine = `${where} AND claim = ?`;
  const store = (status: number, answer: unknown) => db.prepare(`UPDATE idempotency SET status = ?, answer = ? WHERE ${mine}`).bind(status, JSON.stringify(answer), ...ids, claim).run();
  const drop = () => db.prepare(`DELETE FROM idempotency WHERE ${mine}`).bind(...ids, claim).run();
  let answer: Answer;
  try {
    answer = await run();
  } catch (e) {
    // A call told that another one holds the account leaves the record to that one, untouched.
    // Other client errors are final answers (replayed as they were); anything else leaves the call
    // retryable.
    if (e instanceof ApiError && e.code === 'operation_in_progress') throw e;
    if (e instanceof ApiError && e.status < 500 && e.status !== 429) await store(e.status, errorBody(e));
    else await drop();
    throw e;
  }
  if (answer.status >= 500) await drop();
  else await store(answer.status, answer.stored ?? answer.body);
  return answer;
}

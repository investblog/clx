// POST /hook/telegram (docs/spec.md §17): the Telegram bot's webhook. Not a /v1 method — it stays
// out of the API's contract and the MCP tools. The secret header is compared in constant time; the
// per-user limit is checked before anything is written. An update is
// claimed before it is handled and marked done after: a repeat of a done update is answered 200,
// one still running 500 (Telegram tries again later), a claim a minute old is taken over; a passing
// failure gives the claim back and answers 500. Everything final answers 200.
import { Hono } from 'hono';
import { sameBytes } from '../auth/password';
import type { Env } from '../types';
import { handleMessage, type Fetcher, type TgMessage } from './bot';

/** Handled updates are kept two days: Telegram gives up redelivering long before. */
export const UPDATES_TTL = 2 * 86_400_000;
/** A claim not done after a minute is a Worker that died: the next delivery takes it over. */
const STALE_CLAIM = 60_000;

export function telegram(fetcher: Fetcher) {
  const route = new Hono<{ Bindings: Env }>();
  route.post('/', async (c) => {
    const env = c.env;
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET || !env.TELEGRAM_CODE_KEY) return c.json({ error: { code: 'telegram_not_configured', message: 'The Telegram bot is not set up.' } }, 503);
    const enc = new TextEncoder();
    if (!sameBytes(enc.encode(c.req.header('x-telegram-bot-api-secret-token') ?? ''), enc.encode(env.TELEGRAM_WEBHOOK_SECRET))) return c.json({ error: { code: 'unauthorized', message: 'Wrong secret.' } }, 401);
    const update = (await c.req.json().catch(() => null)) as { update_id?: unknown; message?: TgMessage } | null;
    const msg = update?.message;
    // Only a person's private message is anything to the bot; the rest is answered 200 unrecorded,
    // and Telegram does not send it again.
    if (!update || typeof update.update_id !== 'number' || !msg || msg.chat?.type !== 'private' || !msg.from || msg.from.is_bot) return c.json({ ok: true });
    const updateId = update.update_id;
    const now = Date.now();
    const running = () => c.json({ error: { code: 'operation_in_progress', message: 'Still running; retry.' } }, 500);
    // A delivery seen before: done is answered 200; still running 500, so Telegram comes back later —
    // never 200 for work that may yet fail. Read, not written.
    const seen = await env.DB.prepare('SELECT done, at FROM tg_updates WHERE update_id = ?').bind(updateId).first<{ done: number; at: number }>();
    if (seen?.done) return c.json({ ok: true });
    if (seen && now - seen.at < STALE_CLAIM) return running();
    // A new update meets the per-user limit before anything is written: past it, silence and no
    // cost. A redelivery does not count again.
    if (!seen && !(await env.TG_LIMIT.limit({ key: String(msg.from.id) })).success) return c.json({ ok: true });
    // Claimed with a mark of its own; a claim a minute old is taken over.
    const claim = crypto.randomUUID();
    const claimed = await env.DB.prepare('INSERT INTO tg_updates (update_id, at, claim) VALUES (?1, ?2, ?3) ON CONFLICT (update_id) DO UPDATE SET at = ?2, claim = ?3 WHERE done = 0 AND at < ?2 - ?4 RETURNING claim')
      .bind(updateId, now, claim, STALE_CLAIM)
      .first<{ claim: string }>();
    if (!claimed) return (await env.DB.prepare('SELECT done FROM tg_updates WHERE update_id = ?').bind(updateId).first<number>('done')) ? c.json({ ok: true }) : running();
    try {
      await handleMessage(env, c.executionCtx, fetcher, updateId, msg);
    } catch (e) {
      console.error('telegram update', updateId, e instanceof Error ? e.message : e);
      // Given back, so Telegram's redelivery runs it once more.
      await env.DB.prepare('DELETE FROM tg_updates WHERE update_id = ? AND claim = ? AND done = 0').bind(updateId, claim).run().catch(() => undefined);
      return c.json({ error: { code: 'internal', message: 'Retry.' } }, 500);
    }
    // The work is done and its state stored: a failure to mark it is logged, and the answer is still
    // 200 — a redelivery would feed this message to the dialog's next step.
    await env.DB.prepare('UPDATE tg_updates SET done = 1 WHERE update_id = ? AND claim = ?')
      .bind(updateId, claim)
      .run()
      .catch((e: unknown) => console.error('telegram update done', updateId, e instanceof Error ? e.message : e));
    return c.json({ ok: true });
  });
  return route;
}

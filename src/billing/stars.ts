// Top-ups in Telegram Stars (docs/spec.md §18, ADR 0035), after catchall.in's `tg/stars.ts`. The
// invoice is made by the same route as a crypto one, from the bot only; its payload is our invoice
// id. Money moves on `successful_payment` alone, checked again there: the answer to the
// pre-checkout is only a read, and Telegram says not to take it for payment.
import { esc, tgCall } from '../tg/api';
import type { Env } from '../types';
import { fail, newId } from '../v1/http';
import { credit, invoiceById, OPEN_LIMIT, tellOperators, type InvoiceRow } from './invoices';

/** Only the numbers Telegram sells (@PremiumBot): a pack it does not sell makes the payer buy the
 *  next one up and leave the rest unspent (catchall.in, 04.09). About $0.012 a star — to be checked
 *  against the Telegram dashboard before the release. */
export const STAR_PACKS: readonly { stars: number; usd: number }[] = [
  { stars: 750, usd: 9_000_000 },
  { stars: 2500, usd: 30_000_000 },
];
export const packOf = (stars: unknown) => STAR_PACKS.find((p) => p.stars === stars);

const HOUR = 3_600_000;
const DAY = 86_400_000;
/** A payment Telegram approved just before the invoice ran out may arrive just after: it is still
 *  credited for this long. No checkout is approved past the hour; a payment delivered later still
 *  (a delivery held up) is kept in `star_payments` and goes to an operator. */
export const STARS_GRACE = 15 * 60_000;
/** A payment's claim not settled after a minute is a Worker that died. */
const STALE_CLAIM = 60_000;

/** A Stars invoice (§18): a pack, an hour, three pending at most with the crypto ones. */
export async function createStars(env: Env, userId: number, body: { stars?: unknown }, idemRef: string | null): Promise<InvoiceRow> {
  const pack = packOf(body.stars);
  if (!pack) fail(400, 'invalid_request', `"stars" must be one of ${STAR_PACKS.map((p) => p.stars).join(', ')}.`, { field: 'stars' });
  const db = env.DB;
  const user = await db.prepare('SELECT email_confirmed_at FROM users WHERE id = ?').bind(userId).first<{ email_confirmed_at: number | null }>();
  if (user?.email_confirmed_at == null) fail(403, 'email_unconfirmed', 'Confirm your e-mail address first.');
  // A retry of the same update resumes its invoice, as a crypto one does (createCrypto).
  const earlier = idemRef ? await db.prepare('SELECT * FROM invoices WHERE idem_ref = ? AND user_id = ?').bind(idemRef, userId).first<InvoiceRow>() : null;
  if (earlier && earlier.status !== 'void' && earlier.created_at > Date.now() - DAY) return earlier;
  if (earlier) await db.prepare('UPDATE invoices SET idem_ref = NULL WHERE id = ?').bind(earlier.id).run();
  const id = newId();
  const now = Date.now();
  const made = await db
    .prepare(
      `INSERT INTO invoices (id, user_id, rail, usd, coin, stars, status, created_at, expires_at, idem_ref)
       SELECT ?1, ?2, 'stars', ?3, 'XTR', ?4, 'pending', ?5, ?6, ?8
       WHERE (SELECT count(*) FROM invoices WHERE user_id = ?2 AND status = 'pending' AND expires_at > ?5) < ?7
         AND EXISTS (SELECT 1 FROM users WHERE id = ?2 AND deleting_at IS NULL)`,
    )
    .bind(id, userId, pack!.usd, pack!.stars, now, now + HOUR, OPEN_LIMIT, idemRef)
    .run();
  if (!made.meta.changes) fail(409, 'invoice_limit', `At most ${OPEN_LIMIT} unpaid invoices at once; pay one or let it expire (an hour).`, { limit: OPEN_LIMIT });
  return (await invoiceById(db, id))!;
}

/** Telegram's invoice in the chat; `provider_token` is empty for Stars. A failure leaves ours
 *  pending: an answer lost on the way looks the same as a refusal, and an invoice Telegram did
 *  send may yet be paid — it runs out with its hour like any other. */
export async function sendStarsInvoice(env: Env, chatId: number, invoice: InvoiceRow, text: { title: string; description: string }): Promise<boolean> {
  const sent = await tgCall(env, 'sendInvoice', {
    chat_id: chatId,
    title: text.title,
    description: text.description,
    payload: invoice.id,
    provider_token: '',
    currency: 'XTR',
    prices: [{ label: text.title, amount: invoice.stars }],
  });
  return sent !== null;
}

/** One check for both the pre-checkout and the credit (a check only in the first guarantees nothing:
 *  the money comes in the second). Whose, still open, not run out, `XTR`, exactly its stars — those
 *  asked when it was made, not today's packs. */
function payable(invoice: InvoiceRow | null, userId: number | null, currency: unknown, stars: unknown, now: number, grace = 0): boolean {
  return (
    !!invoice &&
    invoice.rail === 'stars' &&
    userId !== null &&
    invoice.user_id === userId &&
    invoice.status === 'pending' &&
    invoice.expires_at > now - grace &&
    currency === 'XTR' &&
    stars === invoice.stars
  );
}

const linkedUser = (env: Env, tg: number) => env.DB.prepare('SELECT user_id FROM tg_identities WHERE tg_user_id = ?').bind(tg).first<number>('user_id');

export interface PreCheckout {
  id: string;
  from: { id: number; language_code?: string };
  currency?: string;
  total_amount?: number;
  invoice_payload?: string;
}

/** The pre-checkout (§18), answered within Telegram's ten seconds: reads only. */
export async function answerPreCheckout(env: Env, q: PreCheckout, refused: string): Promise<void> {
  const invoice = q.invoice_payload ? await invoiceById(env.DB, q.invoice_payload) : null;
  const ok = payable(invoice, await linkedUser(env, q.from.id), q.currency, q.total_amount, Date.now());
  await tgCall(env, 'answerPreCheckoutQuery', { pre_checkout_query_id: q.id, ok, ...(ok ? {} : { error_message: refused }) });
}

export interface SuccessfulPayment {
  currency?: string;
  total_amount?: number;
  invoice_payload?: string;
  telegram_payment_charge_id?: string;
}

export type StarsPaid = { credited: InvoiceRow } | 'repeat' | 'review';

/**
 * A `successful_payment` (§18): the stars are taken, so it is either credited — the invoice's own
 * sum, never one worked out from the stars — or put before an operator to credit or refund. The
 * payment is written to `star_payments` first, keyed by its charge id and tied to no user or
 * invoice, so a lost support message, a deleted account or a late delivery cannot lose it. One
 * delivery handles it at a time (a claim, as the webhook claims an update): another finding it
 * claimed is thrown back, so Telegram brings it again once it is settled. A charge already settled
 * is a repeat; one still `received` whose claim is a minute old (its handling died) is handled again.
 */
export async function starsPaid(env: Env, tg: number, p: SuccessfulPayment): Promise<StarsPaid> {
  const charge = typeof p.telegram_payment_charge_id === 'string' && p.telegram_payment_charge_id ? p.telegram_payment_charge_id : null;
  const db = env.DB;
  const payload = typeof p.invoice_payload === 'string' ? p.invoice_payload : null;
  const what = `a Stars payment of ${Number(p.total_amount) || 0} ${esc(String(p.currency ?? '?'))} from #u${tg}, charge <code>${esc(charge ?? '—')}</code>`;
  // Telegram always sends one; without it there is nothing to key the payment by, or to refund.
  if (!charge) return (await tellOperators(env, `${what} without a charge id, payload ${esc(payload ?? '—')}`), 'review');
  const now = Date.now();
  const claim = crypto.randomUUID();
  await db
    .prepare('INSERT INTO star_payments (charge_id, tg_user_id, invoice_id, stars, currency, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (charge_id) DO NOTHING')
    .bind(charge, tg, payload, Number.isSafeInteger(p.total_amount) ? p.total_amount : null, typeof p.currency === 'string' ? p.currency : null, now)
    .run();
  const claimed = await db
    .prepare("UPDATE star_payments SET claim = ?2, claimed_at = ?3 WHERE charge_id = ?1 AND state = 'received' AND (claim IS NULL OR claimed_at < ?3 - ?4)")
    .bind(charge, claim, now, STALE_CLAIM)
    .run();
  if (!claimed.meta.changes) {
    if ((await db.prepare('SELECT state FROM star_payments WHERE charge_id = ?').bind(charge).first<string>('state')) !== 'received') return 'repeat';
    throw new Error(`stars ${charge}: another delivery is handling it`);
  }
  /** The payment's outcome, by the claim's holder only. A review keeps the operators' message
   *  until it has gone (`tellStarsReviews` sends what did not). */
  const settle = async (state: 'credited' | 'review', reason: string | null, message: string | null = null) => {
    const moved = await db.prepare("UPDATE star_payments SET state = ?2, reason = ?3, message = ?4, settled_at = ?5 WHERE charge_id = ?1 AND state = 'received' AND claim = ?6").bind(charge, state, reason, message, Date.now(), claim).run();
    // A claim lost to a delivery that took it over (this one ran past a minute) tells nobody.
    if (moved.meta.changes && message && (await tellOperators(env, message))) await db.prepare('UPDATE star_payments SET told_at = ? WHERE charge_id = ?').bind(Date.now(), charge).run();
  };

  const invoice = payload ? await invoiceById(db, payload) : null;
  // Credited already by this charge, and the handling died before the row said so.
  if (invoice?.status === 'paid' && invoice.processor_id === charge) return (await settle('credited', null), 'repeat');
  const userId = await linkedUser(env, tg);
  if (payable(invoice, userId, p.currency, p.total_amount, now, STARS_GRACE)) {
    const note = `Telegram Stars top-up · ${invoice!.stars} XTR · $${(invoice!.usd / 1e6).toFixed(2)} credited`;
    // From `expired` too: the cron may have expired it since the check, which allowed for the grace.
    if (await credit(env, invoice!, invoice!.usd, note, ['pending', 'expired'], undefined, charge)) {
      await settle('credited', null);
      return { credited: (await invoiceById(db, invoice!.id))! };
    }
    // Paid since by this very charge — a handler that outlived its claim, or the one that took it
    // over — is a repeat. By another charge: the payer paid one invoice twice, and this one is owed back.
    if ((await invoiceById(db, invoice!.id))?.processor_id === charge) return (await settle('credited', null), 'repeat');
    await settle('review', 'paid_twice', `${what} for invoice <code>${esc(invoice!.id)}</code>, already paid by another charge — paid twice; refund this one.`);
    return 'review';
  }
  // Anything else: the stars are taken all the same. The invoice, when it is this payer's and still
  // open, goes to review holding the charge id; the payment's own row keeps it in every case.
  const reason = !invoice || invoice.rail !== 'stars' ? 'no_invoice' : invoice.user_id !== userId ? 'not_linked' : p.currency !== 'XTR' || p.total_amount !== invoice.stars ? 'amount_mismatch' : invoice.status !== 'pending' ? `invoice_${invoice.status}` : 'expired';
  // (Or held already by this charge: the handling died between moving it and settling the row.)
  const held =
    (invoice?.status === 'review' && invoice.processor_id === charge) ||
    (!!invoice &&
    invoice.rail === 'stars' &&
    invoice.user_id === userId &&
    !!(await db.prepare("UPDATE invoices SET status = 'review', review_reason = ?2, processor_id = ?3 WHERE id = ?1 AND status IN ('pending', 'expired')").bind(invoice.id, reason, charge).run()).meta.changes);
  const where = held
    ? ` — invoice <code>${esc(invoice!.id)}</code> is in review: /credit ${esc(invoice!.id)} &lt;usd&gt; or refund the stars`
    : `${invoice ? ` for invoice <code>${esc(invoice.id)}</code>` : ''}${reason === 'invoice_paid' ? ', already paid by another charge — paid twice; refund this one' : ' — refund the stars'}`;
  await settle('review', reason, `${what} not credited (${reason})${where}.`);
  return 'review';
}

/** A pending Stars invoice past its grace can no longer be paid (§18): expired, so it holds no
 *  place of the three and does not keep its owner from deleting the account. */
export async function expireStars(env: Env, now = Date.now()): Promise<number> {
  const r = await env.DB.prepare("UPDATE invoices SET status = 'expired' WHERE rail = 'stars' AND status = 'pending' AND expires_at < ?").bind(now - STARS_GRACE).run();
  return r.meta.changes;
}

/** Payments in review whose message did not reach the support group (§18): sent again by the
 *  cron, 20 a run, until one goes. */
export async function tellStarsReviews(env: Env): Promise<number> {
  const rows = (await env.DB.prepare("SELECT charge_id, message FROM star_payments WHERE state = 'review' AND told_at IS NULL AND message IS NOT NULL ORDER BY created_at LIMIT 20").all<{ charge_id: string; message: string }>()).results;
  let told = 0;
  for (const r of rows) {
    if (!(await tellOperators(env, r.message))) break;
    await env.DB.prepare('UPDATE star_payments SET told_at = ? WHERE charge_id = ?').bind(Date.now(), r.charge_id).run();
    told++;
  }
  return told;
}

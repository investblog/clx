// Top-up invoices and the one way money comes in (docs/spec.md §18, ADR 0035). A deposit is written
// only by `credit`, under a unique index of one deposit per invoice, so a webhook, a reconcile run
// and an operator crediting the same invoice credit it once.
import { esc, sendMessage } from '../tg/api';
import { supportChat } from '../tg/support';
import type { Env } from '../types';
import { fail, newId } from '../v1/http';
import { commissionStmt, depositBonusStmts } from '../partners/accrue';
import { settleUser } from './pro';
import { COIN_LABEL, configured, createInvoice as trybitCreate, INFO_BATCH, isCoin, PAID_STATUSES, statuses, toMicro, type Coin, type Status } from './trybit';

export const MIN_USD = 9;
export const MAX_USD = 1000;
/** Pending invoices a user may have at once. */
export const OPEN_LIMIT = 3;
const HOUR = 3_600_000;
const DAY = 86_400_000;

export interface InvoiceRow {
  id: string;
  user_id: number;
  rail: 'crypto' | 'stars';
  usd: number;
  coin: string;
  stars: number | null;
  status: 'pending' | 'paid' | 'expired' | 'review' | 'void';
  processor_id: string | null;
  address: string | null;
  amount_crypto: string | null;
  pay_url: string | null;
  review_reason: string | null;
  created_at: number;
  expires_at: number;
  paid_at: number | null;
  reconciled_at: number | null;
}

export const invoiceById = (db: D1Database, id: string) => db.prepare('SELECT * FROM invoices WHERE id = ?').bind(id).first<InvoiceRow>();

export function invoiceView(i: InvoiceRow) {
  return {
    id: i.id,
    rail: i.rail,
    usd_micro_usd: i.usd,
    coin: i.coin,
    coin_label: i.rail === 'crypto' ? (COIN_LABEL[i.coin as Coin] ?? i.coin) : 'Telegram Stars',
    stars: i.stars,
    status: i.status,
    address: i.status === 'pending' ? i.address : null,
    amount: i.status === 'pending' ? i.amount_crypto : null,
    pay_url: i.status === 'pending' ? i.pay_url : null,
    created_at: new Date(i.created_at).toISOString(),
    expires_at: new Date(i.expires_at).toISOString(),
    paid_at: i.paid_at ? new Date(i.paid_at).toISOString() : null,
  };
}

/** Tell the support group (§17), best effort: a failed message changes no money. Whether it went. */
export async function tellOperators(env: Env, text: string): Promise<boolean> {
  const chat = supportChat(env);
  return chat !== null && !!env.TELEGRAM_BOT_TOKEN && (await sendMessage(env, chat, `💸 ${text}`).catch(() => false));
}

/** A crypto invoice (§18): whole dollars, 9 to 1,000, a coin Trybit takes; three pending at most. */
export async function createCrypto(env: Env, userId: number, body: { usd?: unknown; coin?: unknown }, idemRef: string | null, fetcher: typeof fetch = fetch): Promise<InvoiceRow> {
  if (!Number.isInteger(body.usd) || (body.usd as number) < MIN_USD || (body.usd as number) > MAX_USD) fail(400, 'invalid_request', `"usd" must be whole dollars, ${MIN_USD} to ${MAX_USD}.`, { field: 'usd' });
  if (!isCoin(body.coin)) fail(400, 'invalid_request', '"coin" must be one of USDT_TRC20, USDT_BSC, USDT_ERC20, USDC_ERC20.', { field: 'coin' });
  if (!configured(env)) fail(503, 'payments_unavailable', 'Crypto top-ups are not available right now; try Telegram Stars in the bot, or later.');
  const db = env.DB;
  const user = await db.prepare('SELECT email_confirmed_at FROM users WHERE id = ?').bind(userId).first<{ email_confirmed_at: number | null }>();
  if (user?.email_confirmed_at == null) fail(403, 'email_unconfirmed', 'Confirm your e-mail address first.');
  // A retry of a call that died after its insert (the same Idempotency-Key) resumes that invoice —
  // the same order id at Trybit — instead of making a second one.
  // Within the idempotency records' 24 hours only, and never a void one (its creation failed: a
  // retry tries again). Trybit may then hold an invoice our row never learnt of — it was never shown
  // to anyone, so nothing is paid to it (order ids would still settle it here).
  let earlier = idemRef ? await db.prepare('SELECT * FROM invoices WHERE idem_ref = ? AND user_id = ?').bind(idemRef, userId).first<InvoiceRow>() : null;
  if (earlier && (earlier.status === 'void' || earlier.created_at < Date.now() - DAY)) {
    await db.prepare('UPDATE invoices SET idem_ref = NULL WHERE id = ?').bind(earlier.id).run();
    earlier = null;
  }
  if (earlier && (earlier.processor_id || earlier.status !== 'pending')) return earlier;
  const id = earlier?.id ?? newId();
  const now = Date.now();
  if (!earlier) {
    const made = await db
      .prepare(
        `INSERT INTO invoices (id, user_id, rail, usd, coin, status, created_at, expires_at, idem_ref)
         SELECT ?1, ?2, 'crypto', ?3, ?4, 'pending', ?5, ?6, ?8
         WHERE (SELECT count(*) FROM invoices WHERE user_id = ?2 AND status = 'pending' AND expires_at > ?5) < ?7
           AND EXISTS (SELECT 1 FROM users WHERE id = ?2 AND deleting_at IS NULL)`,
      )
      .bind(id, userId, (body.usd as number) * 1_000_000, body.coin, now, now + HOUR, OPEN_LIMIT, idemRef)
      .run();
    if (!made.meta.changes) fail(409, 'invoice_limit', `At most ${OPEN_LIMIT} unpaid invoices at once; pay one or let it expire (an hour).`, { limit: OPEN_LIMIT });
  }
  const remote = await trybitCreate(env, { id, usd: (body.usd as number) * 1_000_000, coin: body.coin as Coin }, fetcher);
  if (!remote) {
    // Nothing at Trybit to pay: the invoice is void at once, and the payer is told.
    await db.prepare("UPDATE invoices SET status = 'void', review_reason = 'trybit_create_failed' WHERE id = ? AND status = 'pending'").bind(id).run();
    fail(503, 'payments_unavailable', 'The payment processor did not answer; try again in a minute.');
  }
  await db.prepare('UPDATE invoices SET processor_id = ?, address = ?, amount_crypto = ?, pay_url = ? WHERE id = ?').bind(remote!.id, remote!.address, remote!.amountCrypto, remote!.payUrl, id).run();
  return (await invoiceById(db, id))!;
}

/**
 * Credit an invoice — the only way a deposit is written. The invoice moves to `paid` from one of
 * `from` and the deposit is inserted in the same batch, both only while the user is not being
 * deleted; a second credit finds the invoice paid and writes nothing. A Stars payment's charge id
 * lands on the invoice in the same statement. Then Pro's unpaid days are
 * charged at once (§18). Returns whether this call credited it.
 */
export async function credit(env: Env, invoice: InvoiceRow, micro: number, note: string, from: InvoiceRow['status'][], by?: { tg: number; name: string }, processorId?: string): Promise<boolean> {
  if (!Number.isSafeInteger(micro) || micro <= 0) throw new Error(`credit ${invoice.id}: ${micro} is not a positive amount`);
  const db = env.DB;
  const now = Date.now();
  const [moved] = await db.batch([
    db
      .prepare("UPDATE invoices SET status = 'paid', paid_at = ?1, processor_id = coalesce(?5, processor_id) WHERE id = ?2 AND status IN (SELECT value FROM json_each(?3)) AND EXISTS (SELECT 1 FROM users WHERE id = ?4 AND deleting_at IS NULL)")
      .bind(now, invoice.id, JSON.stringify(from), invoice.user_id, processorId ?? null),
    db
      .prepare("INSERT INTO ledger (user_id, type, amount, invoice_id, note, by_tg, by_name, created_at) SELECT ?1, 'deposit', ?2, ?3, ?4, ?5, ?6, ?7 WHERE changes() = 1")
      .bind(invoice.user_id, micro, invoice.id, note, by?.tg ?? null, by?.name ?? null, now),
    // A Stars payment in review credited by hand is credited in its own record too, at once: that
    // record outlives the invoice, and /refundstars must never give back stars already credited.
    db
      .prepare("UPDATE star_payments SET state = 'credited', settled_at = ?2 WHERE charge_id = (SELECT processor_id FROM invoices WHERE id = ?1 AND rail = 'stars') AND state = 'review' AND EXISTS (SELECT 1 FROM ledger WHERE invoice_id = ?1 AND type = 'deposit')")
      .bind(invoice.id, now),
    // What the deposit earns (§19): the partner's commission and the promo code's bonus, each once.
    commissionStmt(db, invoice.id, now),
    ...depositBonusStmts(db, invoice.id, now),
  ]);
  if (!moved!.meta.changes) return false;
  await settleUser(env, invoice.user_id, now).catch((e: unknown) => console.error('settle after deposit', invoice.user_id, e instanceof Error ? e.message : e));
  return true;
}

/** Move an invoice to `to` from one of `from`; true when this call moved it. */
async function move(db: D1Database, id: string, to: InvoiceRow['status'], from: InvoiceRow['status'][], reason: string | null = null): Promise<boolean> {
  const r = await db.prepare('UPDATE invoices SET status = ?2, review_reason = coalesce(?3, review_reason) WHERE id = ?1 AND status IN (SELECT value FROM json_each(?4))').bind(id, to, reason, JSON.stringify(from)).run();
  return !!r.meta.changes;
}

export type Settled = 'credited' | 'already' | 'not_paid' | 'partial' | 'review' | 'void' | 'unconfirmed';

/**
 * Settle a crypto invoice from Trybit's own answer — the webhook and the reconcile run alike.
 * Fails closed: an answer about another invoice, or without what arrived, is asked again later.
 */
export async function settleCrypto(env: Env, invoice: InvoiceRow, s: Status): Promise<Settled> {
  if (invoice.rail !== 'crypto') return 'unconfirmed';
  if (s.orderId !== invoice.id) return (console.warn(`trybit ${s.id}: order_id is not ${invoice.id}`), 'unconfirmed');
  if (invoice.status === 'paid' || invoice.status === 'void') return 'already';
  const received = s.receivedUsd === null ? null : toMicro(s.receivedUsd);
  if (received === null || received < 0) return 'unconfirmed';
  const nominal = s.invoiceUsd === null ? null : toMicro(s.invoiceUsd);
  const nominalOk = nominal === invoice.usd;
  const open: InvoiceRow['status'][] = ['pending', 'expired'];
  const toReview = async (reason: string, text: string): Promise<Settled> => {
    if (await move(env.DB, invoice.id, 'review', open, reason)) await tellOperators(env, `${text} — invoice <code>${esc(invoice.id)}</code> (Trybit ${esc(s.id)}). /credit ${esc(invoice.id)} &lt;usd&gt; or /void ${esc(invoice.id)}`);
    return 'review';
  };

  if (s.status === 'created') return received > 0 ? 'unconfirmed' : 'not_paid';
  if (s.status === 'partial') {
    if (received <= 0 || nominal === null) return 'unconfirmed';
    if (!nominalOk) return toReview('nominal_mismatch', `partial payment, and Trybit's nominal ${s.invoiceUsd} USD is not ours`);
    // Never credited by itself: the payer may add the rest, and one deposit per invoice would lose it.
    await toReview('partial', `partial payment: ${s.receivedUsd} of ${s.invoiceUsd} USD received`);
    return 'partial';
  }
  if (s.status === 'canceled') {
    if (received > 0) return toReview('canceled_with_money', `canceled at Trybit, but ${s.receivedUsd} USD received`);
    await move(env.DB, invoice.id, 'expired', ['pending']);
    return 'not_paid';
  }
  if (!PAID_STATUSES.has(s.status)) return (console.warn(`trybit ${s.id}: unknown status ${s.status}`), 'not_paid');
  if (nominal === null) return 'unconfirmed';
  if (received === 0) return toReview('paid_zero', `paid at Trybit, but 0 USD received`);
  if (!nominalOk) return toReview('nominal_mismatch', `Trybit's nominal ${s.invoiceUsd} USD is not ours`);
  const fees = ((s.paidUsd === null ? null : toMicro(s.paidUsd)) ?? received) - received;
  const note = `Crypto top-up · ${s.paidCrypto ? `sent ${s.paidCrypto} ${COIN_LABEL[invoice.coin as Coin] ?? invoice.coin} · ` : ''}$${(received / 1e6).toFixed(2)} credited${fees > 0 ? ` · network and processing fees $${(fees / 1e6).toFixed(2)}` : ''}`;
  // A review invoice Trybit now reports paid in full (the payer added the rest) is credited too.
  return (await credit(env, invoice, received, note, ['pending', 'expired', 'review'])) ? 'credited' : 'already';
}

/** Reconcile (§18): the minute cron, every 15 minutes. */
export const RECONCILE_EVERY_MIN = 15;
const BATCH = Math.min(20, INFO_BATCH);
const FRESH = 20 * 60_000;
const EXPIRED_HORIZON = 30 * DAY;

/**
 * Ask Trybit about pending invoices older than 20 minutes and expired ones up to 30 days old, 20 a
 * run, those asked longest ago first; settle each by the same code as the webhook. A pending invoice
 * a day past its expiry with nothing arrived becomes `expired`. A 429 is honoured until its time.
 */
export async function reconcile(env: Env, now = Date.now(), fetcher: typeof fetch = fetch): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  if (!configured(env)) return counts;
  const db = env.DB;
  const wait = await db.prepare("SELECT value FROM billing_meta WHERE key = 'trybit_retry_after'").first<string>('value');
  if (wait && Number(wait) > now) return counts;
  const due = (
    await db
      .prepare(
        `SELECT * FROM invoices WHERE rail = 'crypto' AND processor_id IS NOT NULL
           AND ((status = 'pending' AND created_at < ?1) OR (status = 'expired' AND expires_at > ?2))
         ORDER BY reconciled_at IS NOT NULL, reconciled_at LIMIT ?3`,
      )
      .bind(now - FRESH, now - EXPIRED_HORIZON, BATCH)
      .all<InvoiceRow>()
  ).results;
  if (!due.length) return counts;
  const answer = await statuses(env, due.map((i) => i.processor_id!), fetcher);
  if (!answer.ok) {
    if (answer.retryAfter) await db.prepare("INSERT INTO billing_meta (key, value) VALUES ('trybit_retry_after', ?1) ON CONFLICT (key) DO UPDATE SET value = ?1").bind(String(now + answer.retryAfter * 1000)).run();
    counts.api_failed = 1;
    return counts;
  }
  // Every id asked is marked, those missing from the answer too, or they would stay first forever.
  await db.prepare('UPDATE invoices SET reconciled_at = ? WHERE id IN (SELECT value FROM json_each(?))').bind(now, JSON.stringify(due.map((i) => i.id))).run();
  for (const inv of due) {
    const s = answer.rows.get(inv.processor_id!);
    const out: Settled | 'missing' = s ? await settleCrypto(env, inv, s) : 'missing';
    counts[out] = (counts[out] ?? 0) + 1;
    if ((out === 'not_paid' || out === 'missing') && inv.status === 'pending' && inv.expires_at < now - DAY) await move(db, inv.id, 'expired', ['pending']);
  }
  return counts;
}

/** An operator's `/credit <invoice> <usd>` (§18): what arrived on a `review` invoice, as its deposit. */
export async function operatorCredit(env: Env, invoiceId: string, usd: string, by: { tg: number; name: string }): Promise<string> {
  const inv = await invoiceById(env.DB, invoiceId);
  if (!inv) return `No invoice ${esc(invoiceId)}.`;
  if (inv.status !== 'review') return `Invoice ${esc(invoiceId)} is ${inv.status}; only one in review is credited by hand.`;
  // The amount as typed, read exactly: dollars with up to six decimals, more than zero.
  const micro = /^\d{1,4}(\.\d{1,6})?$/u.test(usd) ? toMicro(usd) : null;
  if (!micro || micro > MAX_USD * 2 * 1_000_000) return 'Use: /credit invoice usd (what arrived, e.g. 9.85)';
  const shown = `$${(micro / 1e6).toFixed(2)}`;
  const ok = await credit(env, inv, micro, `Top-up credited by support · ${shown}`, ['review'], by);
  return ok ? `Invoice ${esc(invoiceId)}: ${shown} credited.` : `Invoice ${esc(invoiceId)} was settled meanwhile; nothing written.`;
}

/** An operator's `/void <invoice>` (§18): a `review` invoice where nothing came. */
export async function operatorVoid(env: Env, invoiceId: string): Promise<string> {
  return (await move(env.DB, invoiceId, 'void', ['review'])) ? `Invoice ${esc(invoiceId)}: void.` : `Invoice ${esc(invoiceId)} is not in review; nothing changed.`;
}

// Refunds and corrections (docs/spec.md §18, ADR 0035). A refund starts with the user and is made by
// an operator in the support group; each is tied to one deposit and written to the journal — in the
// same batch that moves the request to `pending`, before any money leaves.
import { esc, tgAsk } from '../tg/api';
import type { Env } from '../types';
import { fail, newId } from '../v1/http';
import { invoiceById, MAX_USD, tellOperators, type InvoiceRow } from './invoices';
import { settleUser } from './pro';
import { toMicro, type Coin } from './trybit';
import { clawbacks, CREDITS_SQL } from '../partners/accrue';

const DAY = 86_400_000;
/** How long after its deposit a top-up may be refunded. */
export const REFUND_DAYS = 90;

export interface RefundRow {
  id: string;
  user_id: number;
  invoice_id: string;
  rail: 'crypto' | 'stars';
  address: string | null;
  status: 'requested' | 'pending' | 'done' | 'declined';
  amount: number | null;
  txid: string | null;
  by_name: string | null;
  told_at: number | null;
  created_at: number;
  settled_at: number | null;
}

export function refundView(r: RefundRow) {
  return {
    id: r.id,
    invoice_id: r.invoice_id,
    rail: r.rail,
    address: r.address,
    status: r.status,
    amount_micro_usd: r.amount,
    txid: r.txid,
    created_at: new Date(r.created_at).toISOString(),
    settled_at: r.settled_at ? new Date(r.settled_at).toISOString() : null,
  };
}

const usd = (micro: number) => `$${(micro / 1e6).toFixed(2)}`;

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** A Tron address: Base58Check of 0x41 and 20 bytes. */
async function isTron(s: string): Promise<boolean> {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/u.test(s)) return false;
  let n = 0n;
  for (const ch of s) n = n * 58n + BigInt(B58.indexOf(ch));
  const bytes = new Uint8Array(25);
  for (let i = 24; i >= 0; i--, n >>= 8n) bytes[i] = Number(n & 0xffn);
  if (n !== 0n || bytes[0] !== 0x41) return false;
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', await crypto.subtle.digest('SHA-256', bytes.slice(0, 21))));
  return hash.slice(0, 4).every((b, i) => b === bytes[21 + i]);
}

/** An address on the invoice's network: Tron for TRC-20, an EVM one for BSC and ERC-20. */
export async function isAddressFor(coin: Coin, s: string): Promise<boolean> {
  return coin === 'USDT_TRC20' ? isTron(s) : /^0x[0-9a-fA-F]{40}$/u.test(s);
}

/** What a refund may take: the balance less the credit no deposit brought (a start credit). */
async function refundRoom(db: D1Database, userId: number): Promise<number> {
  return (await db.prepare(`SELECT (SELECT coalesce(sum(amount), 0) FROM ledger WHERE user_id = ?1) - (${CREDITS_SQL}) AS room`).bind(userId).first<number>('room')) ?? 0;
}

/** What a deposit brought in, less what was refunded from it already (refund rows are negative). */
const LEFT_SQL = "SELECT coalesce(sum(amount), 0) AS rest FROM ledger WHERE invoice_id = ?1 AND type IN ('deposit', 'refund')";

/** What each of the user's top-ups could still be refunded from, as `requestRefund` judges it: a
 *  deposit under 90 days old with something left and no open request; 0 otherwise. For the page. */
export async function refundable(db: D1Database, userId: number, invoiceIds: string[], now = Date.now()): Promise<Map<string, number>> {
  const rows = (
    await db
      .prepare(
        `SELECT l.invoice_id AS id, sum(l.amount) AS rest, max(CASE WHEN l.type = 'deposit' THEN l.created_at END) AS at,
           EXISTS (SELECT 1 FROM refunds r WHERE r.invoice_id = l.invoice_id AND r.status IN ('requested', 'pending')) AS open
         FROM ledger l WHERE l.user_id = ?1 AND l.type IN ('deposit', 'refund') AND l.invoice_id IN (SELECT value FROM json_each(?2)) GROUP BY l.invoice_id`,
      )
      .bind(userId, JSON.stringify(invoiceIds))
      .all<{ id: string; rest: number; at: number | null; open: number }>()
  ).results;
  return new Map(rows.map((r) => [r.id, r.at !== null && r.at >= now - REFUND_DAYS * DAY && !r.open && r.rest > 0 ? r.rest : 0]));
}

/** The user's request (§18): a deposit under 90 days old; for crypto, the address it goes to. */
export async function requestRefund(env: Env, userId: number, body: { invoice_id?: unknown; address?: unknown }): Promise<RefundRow> {
  if (typeof body.invoice_id !== 'string') fail(400, 'invalid_request', '"invoice_id" is required.', { field: 'invoice_id' });
  const db = env.DB;
  const inv = await db.prepare('SELECT * FROM invoices WHERE id = ? AND user_id = ?').bind(body.invoice_id, userId).first<InvoiceRow>();
  if (!inv) fail(404, 'not_found', 'No such invoice.');
  const deposit = await db.prepare("SELECT amount, created_at FROM ledger WHERE invoice_id = ? AND type = 'deposit'").bind(inv!.id).first<{ amount: number; created_at: number }>();
  if (!deposit) fail(409, 'refund_unavailable', 'This top-up was never credited; there is nothing to refund.');
  if (deposit!.created_at < Date.now() - REFUND_DAYS * DAY) fail(409, 'refund_unavailable', `Top-ups are refunded within ${REFUND_DAYS} days.`);
  const left = (await db.prepare(LEFT_SQL).bind(inv!.id).first<number>('rest')) ?? 0;
  if (left <= 0) fail(409, 'refund_unavailable', 'This top-up was refunded already.');
  let address: string | null = null;
  if (inv!.rail === 'crypto') {
    if (typeof body.address !== 'string' || !(await isAddressFor(inv!.coin as Coin, body.address.trim())))
      fail(400, 'invalid_request', `"address" must be your ${inv!.coin === 'USDT_TRC20' ? 'Tron (TRC-20)' : 'EVM (0x…)'} address on the network the top-up came by.`, { field: 'address' });
    address = (body.address as string).trim();
  } else if (body.address !== undefined) fail(400, 'invalid_request', 'Stars are refunded in Telegram: no address.', { field: 'address' });
  const id = newId();
  const now = Date.now();
  // One open request per deposit (`refunds_open`); none while the account is being deleted. What
  // was checked above is checked again here: a request done meanwhile may have left nothing.
  const made = await db
    .prepare(
      `INSERT OR IGNORE INTO refunds (id, user_id, invoice_id, rail, address, status, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5, 'requested', ?6 WHERE EXISTS (SELECT 1 FROM users WHERE id = ?2 AND deleting_at IS NULL)
         AND (${LEFT_SQL.replace('?1', '?3')}) > 0
         AND EXISTS (SELECT 1 FROM ledger WHERE invoice_id = ?3 AND type = 'deposit' AND created_at >= ?6 - ?7)`,
    )
    .bind(id, userId, inv!.id, inv!.rail, address, now, REFUND_DAYS * DAY)
    .run();
  if (!made.meta.changes) {
    if (await db.prepare("SELECT 1 FROM refunds WHERE invoice_id = ? AND status IN ('requested', 'pending')").bind(inv!.id).first()) fail(409, 'refund_open', 'A refund of this top-up is asked for already.');
    if (await db.prepare('SELECT 1 FROM users WHERE id = ? AND deleting_at IS NOT NULL').bind(userId).first()) fail(409, 'operation_in_progress', 'The account is being deleted.');
    fail(409, 'refund_unavailable', 'This top-up was refunded already.');
  }
  await tellRefund(env, id);
  return (await db.prepare('SELECT * FROM refunds WHERE id = ?').bind(id).first<RefundRow>())!;
}

/** The support group hears of a request; until it has, the cron asks again (`tellRefunds`). */
async function tellRefund(env: Env, id: string): Promise<boolean> {
  const db = env.DB;
  const r = await db
    .prepare(
      `SELECT r.id, r.invoice_id, r.rail, r.address, u.email, i.coin, (SELECT stars FROM star_payments WHERE charge_id = i.processor_id) AS stars,
         (SELECT amount FROM ledger WHERE invoice_id = r.invoice_id AND type = 'deposit') AS deposit,
         (${LEFT_SQL.replace('?1', 'r.invoice_id')}) AS rest,
         (SELECT coalesce(sum(amount), 0) FROM ledger WHERE user_id = r.user_id) AS balance, (${CREDITS_SQL.replace('?1', 'r.user_id')}) AS credits
       FROM refunds r JOIN users u ON u.id = r.user_id JOIN invoices i ON i.id = r.invoice_id WHERE r.id = ? AND r.status = 'requested' AND r.told_at IS NULL`,
    )
    .bind(id)
    .first<{ id: string; invoice_id: string; rail: string; address: string | null; email: string; coin: string; stars: number | null; deposit: number; rest: number; balance: number; credits: number }>();
  if (!r) return true;
  const what = r.rail === 'stars' ? `${r.stars}★, whole only` : `to <code>${esc(r.address ?? '')}</code> (${esc(r.coin)}), less the network fee`;
  const told = await tellOperators(
    env,
    `refund asked <code>${r.id}</code> · ${esc(r.email)} · invoice <code>${esc(r.invoice_id)}</code> · deposit ${usd(r.deposit)}, refundable ${usd(Math.min(r.rest, Math.max(r.balance - r.credits, 0)))} (balance ${usd(r.balance)}) · ${what}. /refund ${r.id} ${r.rail === 'stars' ? '' : '&lt;usd&gt; '}or /decline ${r.id}`,
  );
  if (told) await db.prepare('UPDATE refunds SET told_at = ? WHERE id = ?').bind(Date.now(), r.id).run();
  return told;
}

/** The cron, every 15 minutes: requests the support group has not heard of, 20 a run, stopping at
 *  the first that does not go (the group is down for all of them). */
export async function tellRefunds(env: Env): Promise<number> {
  const due = (await env.DB.prepare("SELECT id FROM refunds WHERE status = 'requested' AND told_at IS NULL ORDER BY created_at LIMIT 20").all<{ id: string }>()).results;
  let n = 0;
  for (const r of due) {
    if (!(await tellRefund(env, r.id))) break;
    n++;
  }
  return n;
}

export interface Operator {
  tg: number;
  name: string;
}

/** Telegram's own refund of a Stars payment: the whole payment. "Already refunded" is done. */
async function refundStars(env: Env, chargeId: string): Promise<{ ok: true } | { ok: false; why: string }> {
  const tg = await env.DB.prepare('SELECT tg_user_id FROM star_payments WHERE charge_id = ?').bind(chargeId).first<number>('tg_user_id');
  if (!tg) return { ok: false, why: 'no Telegram payment is recorded under that charge id' };
  const r = await tgAsk(env, 'refundStarPayment', { user_id: tg, telegram_payment_charge_id: chargeId });
  // The Bot API's reason for a charge refunded before (MTProto's payments.refundStarsCharge).
  if (r.ok || /CHARGE_ALREADY_REFUNDED/u.test(r.description)) return { ok: true };
  return { ok: false, why: r.description || 'Telegram did not answer' };
}

/**
 * An operator's `/refund <request> [usd]` (§18). A request `requested` moves to `pending` and its
 * journal row is written in one batch, only within what the deposit has left and what the balance
 * holds; Stars are refunded whole, then by Telegram. A Stars request still `pending` (the call
 * failed) is retried; a crypto one waits for `/refunded`.
 */
export async function operatorRefund(env: Env, refundId: string, rawUsd: string | undefined, by: Operator): Promise<string> {
  const db = env.DB;
  const r = await db.prepare('SELECT * FROM refunds WHERE id = ?').bind(refundId).first<RefundRow>();
  if (!r) return `No refund request ${esc(refundId)}. Use: /refund request [usd]`;
  if (r.status === 'done' || r.status === 'declined') return `Refund ${esc(refundId)} is ${r.status}.`;
  const inv = (await invoiceById(db, r.invoice_id))!;
  // What Telegram gives back is the payment, which an operator may have credited off its invoice's pack.
  const paidStars = r.rail === 'stars' ? ((await db.prepare('SELECT stars FROM star_payments WHERE charge_id = ?').bind(inv.processor_id).first<number>('stars')) ?? inv.stars) : null;
  if (r.status === 'requested') {
    let micro: number | null;
    if (r.rail === 'stars') {
      micro = (await db.prepare("SELECT amount FROM ledger WHERE invoice_id = ? AND type = 'deposit'").bind(r.invoice_id).first<number>('amount')) ?? null;
      if (micro === null) return `Invoice ${esc(r.invoice_id)} has no deposit.`;
      if (rawUsd !== undefined && toMicro(rawUsd) !== micro) return `Stars are refunded whole: ${usd(micro)} for invoice ${esc(r.invoice_id)}. Use: /refund ${esc(refundId)}`;
    } else {
      micro = rawUsd !== undefined && /^\d{1,4}(\.\d{1,6})?$/u.test(rawUsd) ? toMicro(rawUsd) : null;
      if (!micro || micro > MAX_USD * 2 * 1_000_000) return `Use: /refund ${esc(refundId)} usd (taken from the balance, e.g. 9.85)`;
    }
    const now = Date.now();
    const note = r.rail === 'stars' ? `Refund in Telegram Stars · ${paidStars}★` : `Refund in ${inv.coin} · ${usd(micro)} less the network fee`;
    // What it takes back with it: the partner's clawback and the promo bonus of that deposit (§19).
    const { stmts: back, bonusBack } = await clawbacks(db, r, micro, now);
    // Both caps and the move in one statement, the journal row only if it moved: a second /refund
    // finds the request pending and writes nothing (and `ledger_op` holds the row to one). The
    // balance must hold the refund and the bonus taken back, beside the credit no deposit brought.
    const [moved] = await db.batch([
      db
        .prepare(
          `UPDATE refunds SET status = 'pending', amount = ?2, by_tg = ?3, by_name = ?4 WHERE id = ?1 AND status = 'requested'
             AND ?2 <= (${LEFT_SQL.replace('?1', '?5')})
             AND ?2 + ?7 <= (SELECT coalesce(sum(amount), 0) FROM ledger WHERE user_id = ?6) - (${CREDITS_SQL.replace('?1', '?6')})
             AND EXISTS (SELECT 1 FROM users WHERE id = ?6 AND deleting_at IS NULL)`,
        )
        .bind(r.id, micro, by.tg, by.name, r.invoice_id, r.user_id, bonusBack),
      db
        .prepare("INSERT INTO ledger (user_id, type, amount, invoice_id, op_key, note, by_tg, by_name, created_at) SELECT ?1, 'refund', ?2, ?3, ?4, ?5, ?6, ?7, ?8 WHERE changes() = 1")
        .bind(r.user_id, -micro, r.invoice_id, `refund:${r.id}`, note, by.tg, by.name, now),
      ...back,
    ]);
    if (!moved!.meta.changes) {
      const again = (await db.prepare('SELECT status FROM refunds WHERE id = ?').bind(r.id).first<string>('status'))!;
      if (again !== 'requested') return `Refund ${esc(refundId)} was settled meanwhile (${again}); nothing written.`;
      const left = (await db.prepare(LEFT_SQL).bind(r.invoice_id).first<number>('rest')) ?? 0;
      const room = (await refundRoom(db, r.user_id)) - bonusBack;
      if (micro > left) return `Refund ${esc(refundId)}: at most ${usd(left)} is left of that deposit; nothing written.`;
      if (micro > room)
        return `Refund ${esc(refundId)}: the balance allows ${usd(Math.max(room, 0))} only${bonusBack ? ` (${usd(bonusBack)} of promo bonus goes back with it)` : ''}${r.rail === 'stars' ? ' — Stars are refunded whole, so not now' : ''}; nothing written.`;
      return `Refund ${esc(refundId)}: the account is being deleted; nothing written.`;
    }
    if (r.rail === 'crypto') return `Refund ${esc(refundId)}: ${usd(micro)} taken from the balance. Send it, less the network fee, to <code>${esc(r.address ?? '')}</code> (${esc(inv.coin)}), then /refunded ${esc(refundId)} txid`;
  } else if (r.rail === 'crypto')
    // Taken already, maybe sent already by another operator: never a second "send it".
    return `Refund ${esc(refundId)} was made already: ${usd(r.amount ?? 0)} taken by ${esc(r.by_name ?? '?')}. Do NOT send again unless the wallet shows no transfer to <code>${esc(r.address ?? '')}</code>; once sent, /refunded ${esc(refundId)} txid`;
  // Stars: the journal row is there; Telegram now, again on every /refund until it is done.
  const out = await refundStars(env, inv.processor_id ?? '');
  if (!out.ok) return `Refund ${esc(refundId)}: written, but Telegram refused (${esc(out.why)}); /refund ${esc(refundId)} again.`;
  await db.batch([
    db.prepare("UPDATE refunds SET status = 'done', settled_at = ? WHERE id = ? AND status = 'pending'").bind(Date.now(), r.id),
    db.prepare("UPDATE star_payments SET state = 'refunded' WHERE charge_id = ?").bind(inv.processor_id),
  ]);
  return `Refund ${esc(refundId)}: ${paidStars}★ refunded in Telegram.`;
}

/** An operator's `/refunded <request> <txid>`: the crypto was sent; nothing more is written. */
export async function operatorRefunded(env: Env, refundId: string, txid: string): Promise<string> {
  if (!/^[0-9A-Za-z]{20,100}$/u.test(txid)) return 'Use: /refunded request txid';
  const r = await env.DB.prepare("UPDATE refunds SET status = 'done', txid = ?, settled_at = ? WHERE id = ? AND status = 'pending' AND rail = 'crypto'").bind(txid, Date.now(), refundId).run();
  return r.meta.changes ? `Refund ${esc(refundId)}: done.` : `Refund ${esc(refundId)} is not a pending crypto refund; nothing changed.`;
}

/** An operator's `/decline <request>`: a request not acted on is closed; nothing moves. */
export async function operatorDecline(env: Env, refundId: string): Promise<string> {
  const r = await env.DB.prepare("UPDATE refunds SET status = 'declined', settled_at = ? WHERE id = ? AND status = 'requested'").bind(Date.now(), refundId).run();
  return r.meta.changes ? `Refund ${esc(refundId)}: declined.` : `Refund ${esc(refundId)} is not waiting; nothing changed.`;
}

/**
 * An operator's `/refundstars <charge id>`: a Stars payment in review, never credited, goes back in
 * full. Its invoice, when one is held in review by it, is void first, so a `/credit` racing this
 * cannot credit what is being refunded; a credited one is refused.
 */
export async function operatorRefundStars(env: Env, chargeId: string): Promise<string> {
  const db = env.DB;
  const p = await db.prepare('SELECT state, stars FROM star_payments WHERE charge_id = ?').bind(chargeId).first<{ state: string; stars: number }>();
  if (!p) return `No Stars payment ${esc(chargeId)}. Use: /refundstars charge_id`;
  if (p.state === 'refunded') return `Payment ${esc(chargeId)} was refunded already.`;
  if (p.state !== 'review' && p.state !== 'refunding') return `Payment ${esc(chargeId)} is ${esc(p.state)}, not in review; a credited one is refunded on the user's request.`;
  // The invoice first: once void, no /credit can take it. A credit that came before it marked the
  // payment `credited` in its own batch, so the claim below fails.
  await db.prepare("UPDATE invoices SET status = 'void' WHERE processor_id = ? AND status = 'review'").bind(chargeId).run();
  if (await db.prepare("SELECT 1 FROM invoices WHERE processor_id = ? AND status = 'paid'").bind(chargeId).first()) return `Payment ${esc(chargeId)}: its invoice was credited meanwhile; nothing refunded.`;
  const claimed = await db.prepare("UPDATE star_payments SET state = 'refunding' WHERE charge_id = ? AND state IN ('review', 'refunding')").bind(chargeId).run();
  if (!claimed.meta.changes) return `Payment ${esc(chargeId)}: it was credited meanwhile; nothing refunded.`;
  const out = await refundStars(env, chargeId);
  if (!out.ok) return `Payment ${esc(chargeId)}: Telegram refused (${esc(out.why)}); /refundstars ${esc(chargeId)} again.`;
  await db.prepare("UPDATE star_payments SET state = 'refunded', settled_at = ? WHERE charge_id = ? AND state = 'refunding'").bind(Date.now(), chargeId).run();
  return `Payment ${esc(chargeId)}: ${p.stars}★ refunded in Telegram.`;
}

/** An operator's `/adjust <email> <usd> <note>`: a correction, either way, never below zero. Keyed
 *  by the command's message, so a Telegram update delivered twice writes once. */
export async function operatorAdjust(env: Env, email: string, rawUsd: string, note: string, by: Operator, key: string): Promise<string> {
  const micro = /^-?\d{1,4}(\.\d{1,6})?$/u.test(rawUsd) ? toMicro(rawUsd.replace('-', '')) : null;
  if (!micro || !note) return 'Use: /adjust email usd note (usd may be negative, e.g. -1.50)';
  const amount = rawUsd.startsWith('-') ? -micro : micro;
  const db = env.DB;
  const u = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email.trim().toLowerCase()).first<number>('id');
  if (!u) return `No account ${esc(email)}.`;
  const r = await db
    .prepare(
      `INSERT OR IGNORE INTO ledger (user_id, type, amount, op_key, note, by_tg, by_name, created_at)
       SELECT ?1, 'adjustment', ?2, ?3, ?4, ?5, ?6, ?7
       WHERE EXISTS (SELECT 1 FROM users WHERE id = ?1 AND deleting_at IS NULL)
         AND (SELECT coalesce(sum(amount), 0) FROM ledger WHERE user_id = ?1) + ?2 >= 0`,
    )
    .bind(u, amount, `adjust:${key}`, note.slice(0, 200), by.tg, by.name, Date.now())
    .run();
  if (!r.meta.changes) {
    if (await db.prepare('SELECT 1 FROM ledger WHERE op_key = ?').bind(`adjust:${key}`).first()) return 'Written already.';
    return `${esc(email)}: not written — the balance would go below zero, or the account is being deleted.`;
  }
  if (amount > 0) await settleUser(env, u, Date.now()).catch((e: unknown) => console.error('settle after adjust', u, e instanceof Error ? e.message : e));
  return `${esc(email)}: ${amount < 0 ? '−' : '+'}${usd(micro)} written (${esc(note.slice(0, 200))}).`;
}

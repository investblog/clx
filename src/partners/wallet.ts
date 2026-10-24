// The partner's wallet (docs/spec.md §19, ADR 0036): its own journal, `partner_ledger`. Available is
// the sum less commissions still held; a clawback may take it below zero, and then nothing leaves it.
// Moving money out is one batch writing both rows, or neither.
import { tellOperators } from '../billing/invoices';
import { isAddressFor } from '../billing/refunds';
import { botName, esc } from '../tg/api';
import type { Env } from '../types';
import { fail } from '../v1/http';
import { IDEM_TTL } from '../v1/idempotency';
import { HOLD_DAYS, RATE_BP } from './accrue';
import { newRefCode, normalizeCode } from './codes';

export const PAYOUT_MIN = 20_000_000;
const usd = (micro: number) => `$${(micro / 1e6).toFixed(2)}`;

/** Available now: everything less the commissions still held (`?1` the partner, `?2` now). */
const AVAILABLE_SQL = "SELECT coalesce(sum(amount), 0) - coalesce(sum(CASE WHEN type = 'commission' AND matures_at > ?2 THEN amount END), 0) FROM partner_ledger WHERE user_id = ?1";

/** Dollars as given, at most cents, more than zero. */
function microOf(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 100_000) return null;
  const micro = Math.round(v * 100) * 10_000;
  return Math.abs(micro - v * 1e6) < 1 ? micro : null;
}

export async function partnerView(env: Env, userId: number, now = Date.now()) {
  const db = env.DB;
  // An account made outside sign-up (a script) gets its code when it first looks.
  await db.prepare('UPDATE users SET ref_code = ? WHERE id = ? AND ref_code IS NULL').bind(await newRefCode(db), userId).run();
  const me = (await db.prepare('SELECT ref_code FROM users WHERE id = ?').bind(userId).first<{ ref_code: string }>())!;
  const w = (await db
    .prepare(
      `SELECT (SELECT coalesce(sum(amount), 0) FROM partner_ledger WHERE user_id = ?1) AS total, (${AVAILABLE_SQL}) AS available,
         (SELECT count(*) FROM users WHERE referred_by = ?1) AS referrals`,
    )
    .bind(userId, now)
    .first<{ total: number; available: number; referrals: number }>())!;
  const journal = (
    await db.prepare('SELECT id, type, amount, invoice_id, matures_at, note, created_at FROM partner_ledger WHERE user_id = ? ORDER BY id DESC LIMIT 50').bind(userId).all<{ id: number; type: string; amount: number; invoice_id: string | null; matures_at: number | null; note: string | null; created_at: number }>()
  ).results;
  const payouts = (await db.prepare('SELECT id, amount, address, status, txid, created_at, settled_at FROM partner_payouts WHERE user_id = ? ORDER BY id DESC LIMIT 10').bind(userId).all<{ id: number; amount: number; address: string; status: string; txid: string | null; created_at: number; settled_at: number | null }>()).results;
  const bot = await botName(env).catch(() => null);
  const iso = (ms: number | null) => (ms ? new Date(ms).toISOString() : null);
  return {
    code: me.ref_code,
    links: { site: `${new URL(env.HOOK_URL).origin}/?ref=${me.ref_code}`, bot: bot ? `https://t.me/${bot}?start=ref_${me.ref_code}` : null },
    rate_bp: RATE_BP,
    hold_days: HOLD_DAYS,
    payout_min_micro_usd: PAYOUT_MIN,
    referrals: w.referrals,
    wallet: { total_micro_usd: w.total, available_micro_usd: w.available, held_micro_usd: w.total - w.available },
    journal: journal.map((r) => ({ id: r.id, type: r.type, amount_micro_usd: r.amount, invoice_id: r.invoice_id, available_at: r.type === 'commission' ? iso(r.matures_at) : null, note: r.note, at: iso(r.created_at) })),
    payouts: payouts.map((p) => ({ id: p.id, amount_micro_usd: p.amount, address: p.address, status: p.status, txid: p.txid, created_at: iso(p.created_at), settled_at: iso(p.settled_at) })),
  };
}

/** What both moves need: a confirmed e-mail, no delete under way. */
const OWNER_OK = 'EXISTS (SELECT 1 FROM users WHERE id = ?1 AND deleting_at IS NULL AND email_confirmed_at IS NOT NULL)';

async function refuse(env: Env, userId: number, micro: number): Promise<never> {
  const u = await env.DB.prepare('SELECT email_confirmed_at, deleting_at FROM users WHERE id = ?').bind(userId).first<{ email_confirmed_at: number | null; deleting_at: number | null }>();
  if (u?.email_confirmed_at == null) fail(403, 'email_unconfirmed', 'Confirm your e-mail address first.');
  if (u?.deleting_at != null) fail(409, 'operation_in_progress', 'The account is being deleted.');
  const available = (await env.DB.prepare(`SELECT (${AVAILABLE_SQL}) AS a`).bind(userId, Date.now()).first<number>('a')) ?? 0;
  return fail(409, 'insufficient_balance', `The wallet has ${usd(Math.max(available, 0))} available; ${usd(micro)} asked.`, { available_micro_usd: available });
}

/** `POST /v1/partner/transfer {usd}`: from the wallet to one's own clx balance, both journals at once. */
export async function transfer(env: Env, userId: number, body: { usd?: unknown }, idemRef: string): Promise<void> {
  const micro = microOf(body.usd);
  if (!micro) fail(400, 'invalid_request', '"usd" must be dollars more than zero and at most 100,000, at most cents.', { field: 'usd' });
  const db = env.DB;
  const now = Date.now();
  // Keyed by the call's Idempotency-Key in both journals: a retry after a Worker that died past this
  // batch, before its answer was stored, finds the move made and makes it no second time.
  const key = `transfer:${idemRef}`;
  const made = async () => resumes(await db.prepare('SELECT -amount AS amount, created_at FROM partner_ledger WHERE op_key = ?').bind(key).first<{ amount: number; created_at: number }>(), micro!, now);
  if (await made()) return;
  const [moved] = await db.batch([
    db
      .prepare(`INSERT OR IGNORE INTO partner_ledger (user_id, type, amount, op_key, note, created_at) SELECT ?1, 'transfer', -?3, ?4, 'To the clx balance', ?2 WHERE ${OWNER_OK} AND (${AVAILABLE_SQL}) >= ?3`)
      .bind(userId, now, micro, key),
    db.prepare("INSERT INTO ledger (user_id, type, amount, op_key, note, created_at) SELECT ?1, 'partner_transfer', ?2, ?4, 'From the partner wallet', ?3 WHERE changes() = 1").bind(userId, micro, now, key),
  ]);
  if (!moved!.meta.changes && !(await made())) await refuse(env, userId, micro!);
}

/** `POST /v1/partner/payouts {usd, address}`: from $20, to a USDT TRC-20 address; the request and the
 *  row reserving its money are one batch, so a transfer cannot spend it meanwhile. */
export async function requestPayout(env: Env, userId: number, body: { usd?: unknown; address?: unknown }, idemRef: string): Promise<number> {
  const micro = microOf(body.usd);
  if (!micro || micro < PAYOUT_MIN) fail(400, 'invalid_request', `"usd" must be at least ${usd(PAYOUT_MIN)} and at most 100,000, at most cents.`, { field: 'usd' });
  const address = typeof body.address === 'string' ? body.address.trim() : '';
  if (!(await isAddressFor('USDT_TRC20', address))) fail(400, 'invalid_request', '"address" must be a USDT TRC-20 (Tron) address.', { field: 'address' });
  const db = env.DB;
  const now = Date.now();
  // A retry after a Worker that died past this batch, before its answer was stored, resumes the
  // request made then (its Idempotency-Key is the request's `idem_ref`).
  const earlier = async () => {
    const p = await db.prepare('SELECT id, amount, address, created_at FROM partner_payouts WHERE idem_ref = ? AND user_id = ?').bind(idemRef, userId).first<{ id: number; amount: number; address: string; created_at: number }>();
    if (!p) return null;
    // The same request is the same sum to the same address.
    resumes({ amount: p.address === address ? p.amount : -1, created_at: p.created_at }, micro!, now);
    // Its notice may not have gone before the Worker died.
    await tellPayout(env, p.id);
    return p.id;
  };
  const before = await earlier();
  if (before) return before;
  const [made] = await db.batch([
    db
      .prepare(`INSERT OR IGNORE INTO partner_payouts (user_id, amount, address, status, idem_ref, created_at) SELECT ?1, ?3, ?4, 'requested', ?5, ?2 WHERE ${OWNER_OK} AND (${AVAILABLE_SQL}) >= ?3`)
      .bind(userId, now, micro, address, idemRef),
    db.prepare("INSERT INTO partner_ledger (user_id, type, amount, payout_id, note, created_at) SELECT ?1, 'payout', -?2, last_insert_rowid(), 'Payout requested', ?3 WHERE changes() = 1").bind(userId, micro, now),
  ]);
  if (!made!.meta.changes) {
    const raced = await earlier();
    if (raced) return raced;
    await refuse(env, userId, micro!);
  }
  const id = made!.meta.last_row_id;
  await tellPayout(env, id);
  return id;
}

/**
 * A move made before under the same Idempotency-Key (its stored answer lost with a Worker that died):
 * resumed only within the key's 24 hours and for the same request; another use of the key is a
 * conflict, never a silent no-op.
 */
function resumes(row: { amount: number; created_at: number } | null, micro: number, now: number): boolean {
  if (!row) return false;
  if (row.created_at < now - IDEM_TTL || row.amount !== micro) fail(409, 'idempotency_conflict', 'This Idempotency-Key was used for another request; send a new one.');
  return true;
}

/** The support group hears of a payout request; until it has, the cron tells it again. */
async function tellPayout(env: Env, id: number): Promise<boolean> {
  const p = await env.DB.prepare("SELECT p.amount, p.address, u.email FROM partner_payouts p JOIN users u ON u.id = p.user_id WHERE p.id = ? AND p.status = 'requested' AND p.told_at IS NULL")
    .bind(id)
    .first<{ amount: number; address: string; email: string }>();
  if (!p) return true;
  const told = await tellOperators(env, `payout asked #${id} · ${esc(p.email)} · ${usd(p.amount)} USDT TRC-20 to <code>${esc(p.address)}</code>. Send it, then /paid ${id} txid — or /reject ${id}`);
  if (told) await env.DB.prepare('UPDATE partner_payouts SET told_at = ? WHERE id = ?').bind(Date.now(), id).run();
  return told;
}

/** The cron, every 15 minutes: payout requests the group has not heard of, 20 a run. */
export async function tellPayouts(env: Env): Promise<number> {
  const due = (await env.DB.prepare("SELECT id FROM partner_payouts WHERE status = 'requested' AND told_at IS NULL ORDER BY id LIMIT 20").all<{ id: number }>()).results;
  let n = 0;
  for (const p of due) {
    if (!(await tellPayout(env, p.id))) break;
    n++;
  }
  return n;
}

/** An operator's `/payouts`: the requests waiting. */
export async function operatorPayouts(env: Env): Promise<string> {
  const rows = (
    await env.DB.prepare("SELECT p.id, p.amount, p.address, p.created_at, u.email FROM partner_payouts p JOIN users u ON u.id = p.user_id WHERE p.status = 'requested' ORDER BY p.id LIMIT 30").all<{ id: number; amount: number; address: string; created_at: number; email: string }>()
  ).results;
  if (!rows.length) return 'No payouts waiting.';
  return ['<b>Payouts waiting</b> (/paid id txid, /reject id)', ...rows.map((p) => `#${p.id} · ${esc(p.email)} · ${usd(p.amount)} to <code>${esc(p.address)}</code> · ${new Date(p.created_at).toISOString().slice(0, 10)}`)].join('\n');
}

/** An operator's `/paid <id> <txid>`: sent; nothing more is written. */
export async function operatorPaid(env: Env, id: string, txid: string, by: { tg: number; name: string }): Promise<string> {
  // A Tron transaction id: 64 hex digits — a typo cannot mark a payout paid.
  if (!/^\d+$/u.test(id) || !/^[0-9a-fA-F]{64}$/u.test(txid)) return 'Use: /paid id txid (the Tron transaction id, 64 hex digits)';
  const r = await env.DB.prepare("UPDATE partner_payouts SET status = 'paid', txid = ?, by_tg = ?, by_name = ?, settled_at = ? WHERE id = ? AND status = 'requested'").bind(txid, by.tg, by.name, Date.now(), Number(id)).run();
  return r.meta.changes ? `Payout #${id}: paid.` : `Payout #${id} is not waiting; nothing changed.`;
}

/** An operator's `/reject <id>`: refused, its money back in the wallet — the only `payout_return`. */
export async function operatorReject(env: Env, id: string, by: { tg: number; name: string }): Promise<string> {
  if (!/^\d+$/u.test(id)) return 'Use: /reject id';
  const now = Date.now();
  const db = env.DB;
  const [moved] = await db.batch([
    // Only while its partner is not being deleted, as every money writer: the return lands or neither does.
    db
      .prepare("UPDATE partner_payouts SET status = 'rejected', by_tg = ?2, by_name = ?3, settled_at = ?4 WHERE id = ?1 AND status = 'requested' AND EXISTS (SELECT 1 FROM users u WHERE u.id = partner_payouts.user_id AND u.deleting_at IS NULL)")
      .bind(Number(id), by.tg, by.name, now),
    db
      .prepare("INSERT INTO partner_ledger (user_id, type, amount, payout_id, note, created_at) SELECT user_id, 'payout_return', amount, id, 'Payout refused', ?2 FROM partner_payouts WHERE id = ?1 AND changes() = 1")
      .bind(Number(id), now),
  ]);
  return moved!.meta.changes ? `Payout #${id}: rejected, the money is back in the wallet.` : `Payout #${id} is not waiting; nothing changed.`;
}

const PROMO_KINDS = ['first_deposit', 'any_deposit', 'signup_credit'];

/** An operator's `/promo <code> <kind> <usd> [max uses] [until YYYY-MM-DD]`: a new promo code. */
export async function operatorPromo(env: Env, args: string[], by: { tg: number; name: string }): Promise<string> {
  const use = `Use: /promo code ${PROMO_KINDS.join('|')} usd [max uses] [until YYYY-MM-DD]`;
  const [rawCode, kind, rawUsd, ...rest] = args;
  const code = normalizeCode(rawCode);
  if (!code || !kind || !PROMO_KINDS.includes(kind) || !rawUsd || !/^\d{1,4}(\.\d{1,2})?$/u.test(rawUsd)) return use;
  let max: number | null = null;
  let until: number | null = null;
  for (const a of rest) {
    if (/^\d+$/u.test(a)) max = Number(a);
    else if (/^\d{4}-\d{2}-\d{2}$/u.test(a) && !Number.isNaN(Date.parse(a))) until = Date.parse(a) + 86_400_000;
    else return use;
  }
  if (kind === 'any_deposit' && until === null) return `An any_deposit code needs an end date. ${use}`;
  const bonus = Math.round(Number(rawUsd) * 100) * 10_000;
  if (bonus <= 0) return use;
  const db = env.DB;
  // One name space: a partner's code is never shadowed.
  if (await db.prepare('SELECT 1 FROM users WHERE ref_code = ?').bind(code).first()) return `${esc(code)} is a partner's code.`;
  const made = await db
    .prepare('INSERT OR IGNORE INTO promo_codes (code, kind, bonus, max_uses, until, by_tg, by_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(code, kind, bonus, max, until, by.tg, by.name, Date.now())
    .run();
  if (!made.meta.changes) return `${esc(code)} exists already.`;
  return `Promo ${esc(code)}: ${kind}, ${usd(bonus)}${max ? `, ${max} uses` : ''}${until ? `, until ${new Date(until - 86_400_000).toISOString().slice(0, 10)}` : ''}.`;
}

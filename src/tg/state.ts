// What the bot remembers (docs/spec.md §17): the Telegram link of an account, the dialog of a
// Telegram user and the codes it mails. A code is an HMAC with TELEGRAM_CODE_KEY over its purpose,
// the dialog's instance and the digits: six digits under a plain hash are reversed by trying them
// all, and a code of one dialog or purpose never passes in another.
import { sameBytes } from '../auth/password';
import type { Env } from '../types';

/** A dialog step lives two hours: a person answers a question an hour later. */
export const STEP_TTL = 2 * 3_600_000;
/** A mailed code: 15 minutes and three tries, as the e-mail says. */
export const CODE_TTL = 15 * 60_000;
export const CODE_TRIES = 3;

export type Purpose = 'link' | 'connect';

export interface Identity {
  tg_user_id: number;
  user_id: number;
  username: string | null;
  linked_at: number;
}

export interface Dialog {
  step: string;
  data: Record<string, unknown>;
  nonce: string;
  code_hash: string | null;
}

export const identityOf = (env: Env, tgUserId: number) => env.DB.prepare('SELECT tg_user_id, user_id, username, linked_at FROM tg_identities WHERE tg_user_id = ?').bind(tgUserId).first<Identity>();

/** The live dialog of a Telegram user, or null (none, or its step outlived STEP_TTL). */
export async function dialogOf(env: Env, tgUserId: number, now: number): Promise<Dialog | null> {
  const row = await env.DB.prepare('SELECT step, data, nonce, code_hash FROM tg_states WHERE tg_user_id = ? AND expires_at > ?').bind(tgUserId, now).first<{ step: string; data: string; nonce: string; code_hash: string | null }>();
  return row ? { ...row, data: JSON.parse(row.data) as Record<string, unknown> } : null;
}

const nonceOf = () => crypto.randomUUID();

/** A new dialog step, replacing whatever was there: a new instance, no code. */
export async function startDialog(env: Env, tgUserId: number, step: string, data: Record<string, unknown>, now: number): Promise<string> {
  const nonce = nonceOf();
  await env.DB.prepare(
    `INSERT INTO tg_states (tg_user_id, step, data, nonce, code_hash, tries, code_until, expires_at) VALUES (?1, ?2, ?3, ?4, NULL, 0, 0, ?5)
     ON CONFLICT (tg_user_id) DO UPDATE SET step = ?2, data = ?3, nonce = ?4, code_hash = NULL, tries = 0, code_until = 0, expires_at = ?5`,
  )
    .bind(tgUserId, step, JSON.stringify(data), nonce, now + STEP_TTL)
    .run();
  return nonce;
}

/** The next step of the same dialog — only while it is still the instance the caller read: a
 *  delayed answer does not bring back a dialog that was cancelled or replaced. */
export async function advance(env: Env, tgUserId: number, nonce: string, step: string, data: Record<string, unknown>, now: number): Promise<boolean> {
  const r = await env.DB.prepare('UPDATE tg_states SET step = ?, data = ?, expires_at = ? WHERE tg_user_id = ? AND nonce = ?').bind(step, JSON.stringify(data), now + STEP_TTL, tgUserId, nonce).run();
  return Boolean(r.meta.changes);
}

export const endDialog = (env: Env, tgUserId: number) => env.DB.prepare('DELETE FROM tg_states WHERE tg_user_id = ?').bind(tgUserId).run();

/** Ends the dialog only while it is still the instance `nonce`: a question the step itself asked
 *  next (a numbered choice) stays. */
export const endDialogIf = (env: Env, tgUserId: number, nonce: string) => env.DB.prepare('DELETE FROM tg_states WHERE tg_user_id = ? AND nonce = ?').bind(tgUserId, nonce).run();

async function mac(env: Env, purpose: Purpose, nonce: string, code: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.TELEGRAM_CODE_KEY ?? ''), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${purpose}|${nonce}|${code}`)));
  return btoa(String.fromCharCode(...sig));
}

/** Six random digits, without the bias of a plain modulo. */
function sixDigits(): string {
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0]! < 4_294_000_000) return String(buf[0]! % 1_000_000).padStart(6, '0');
  }
}

/** A fresh code for the dialog step `step`, in a new instance of the dialog: the code is bound to
 *  that instance and to `purpose`. Returns the code to mail. */
export async function issueCode(env: Env, tgUserId: number, purpose: Purpose, step: string, data: Record<string, unknown>, now: number): Promise<string> {
  const nonce = nonceOf();
  const code = sixDigits();
  const hash = await mac(env, purpose, nonce, code);
  await env.DB.prepare(
    `INSERT INTO tg_states (tg_user_id, step, data, nonce, code_hash, tries, code_until, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7)
     ON CONFLICT (tg_user_id) DO UPDATE SET step = ?2, data = ?3, nonce = ?4, code_hash = ?5, tries = 0, code_until = ?6, expires_at = ?7`,
  )
    .bind(tgUserId, step, JSON.stringify({ ...data, purpose }), nonce, hash, now + CODE_TTL, now + STEP_TTL)
    .run();
  return code;
}

/**
 * One try of a code against the dialog the caller read (`d`). The try is taken atomically and only
 * from that very code (the instance and the hash are in the condition), so tries are never lost to
 * a newer code nor counted twice. A right code is not consumed here: the caller consumes it in the
 * same statement or transaction as what it allows (`stillHolds`), so a failure in between leaves
 * the code for Telegram's redelivery. `ok` — the code was right; `wrong` — a try is gone; `over` —
 * no try left, the code expired, or the dialog moved on.
 */
export async function tryCode(env: Env, tgUserId: number, d: Dialog, purpose: Purpose, code: string, now: number): Promise<'ok' | 'wrong' | 'over'> {
  if (!d.code_hash || d.data.purpose !== purpose) return 'over';
  const taken = await env.DB.prepare('UPDATE tg_states SET tries = tries + 1 WHERE tg_user_id = ? AND nonce = ? AND code_hash = ? AND tries < ? AND code_until > ? RETURNING tries')
    .bind(tgUserId, d.nonce, d.code_hash, CODE_TRIES, now)
    .first<{ tries: number }>();
  if (!taken) return 'over';
  const given = /^\d{6}$/u.test(code) ? await mac(env, purpose, d.nonce, code) : '';
  const enc = new TextEncoder();
  if (!given || !sameBytes(enc.encode(given), enc.encode(d.code_hash))) return taken.tries >= CODE_TRIES ? 'over' : 'wrong';
  return 'ok';
}

/** SQL that holds while the code of `d` is unspent — for the condition of the statement that spends it. */
export const stillHolds = 'EXISTS (SELECT 1 FROM tg_states WHERE tg_user_id = ? AND nonce = ? AND code_hash = ?)';

/** The next step of the dialog, spending its code in the same statement: only while that code is
 *  still unspent. Whether it moved on. */
export async function advanceSpending(env: Env, tgUserId: number, d: Dialog, step: string, now: number): Promise<boolean> {
  const r = await env.DB.prepare('UPDATE tg_states SET step = ?, code_hash = NULL, expires_at = ? WHERE tg_user_id = ? AND nonce = ? AND code_hash = ?').bind(step, now + STEP_TTL, tgUserId, d.nonce, d.code_hash).run();
  return Boolean(r.meta.changes);
}

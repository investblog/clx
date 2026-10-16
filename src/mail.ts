// E-mail from clx.cx (docs/spec.md §9): Cloudflare Email Sending through the `EMAIL` binding, from
// no-reply@<this host>. At most one e-mail per address per 10 minutes (sign-up, reset) and 5 per UTC day, counted in
// D1 — global, unlike the rate limiting binding; over it nothing is sent and the caller answers the
// same, so the limit tells nothing about the address either.
import { notifyTelegram } from './tg/notify';
import type { Env } from './types';

/** The binding's shape (Email Sending, beta 2026): `env.EMAIL.send({to, from, subject, text, html})`. */
export interface Mailer {
  send(message: { to: string; from: string; subject: string; text: string; html?: string }): Promise<{ messageId?: string }>;
}

const GAP = 10 * 60_000;
const PER_DAY = 5;

/** The page's own origin, from where workers report (`https://clx.cx/hook` → `https://clx.cx`). */
export const appOrigin = (env: Env) => new URL(env.HOOK_URL).origin;

/**
 * Take one e-mail of `to`'s limits, if there is one left; returns whether it was taken. One
 * statement, so two requests at once cannot both pass. Taken for any address — known or not — so
 * the limit says nothing about whether it has an account.
 */
export async function reserveMail(env: Env, to: string, now = Date.now(), gap = GAP): Promise<boolean> {
  const day = Math.floor(now / 86_400_000);
  const taken = await env.DB.prepare(
    `INSERT INTO email_sends (email, day, count, last_at) VALUES (?1, ?2, 1, ?3)
     ON CONFLICT (email) DO UPDATE SET count = CASE WHEN day = ?2 THEN count + 1 ELSE 1 END, day = ?2, last_at = ?3
     WHERE last_at <= ?3 - ?4 AND (day != ?2 OR count < ${PER_DAY})`,
  )
    .bind(to, day, now, gap)
    .run();
  return Boolean(taken.meta.changes);
}

/** Send one e-mail whose place `reserveMail` took; a failed send is logged, not retried — the user asks again. */
export async function deliverMail(env: Env, to: string, subject: string, text: string): Promise<boolean> {
  if (!env.EMAIL) {
    console.error('mail: no EMAIL binding; not sent:', subject);
    return false;
  }
  try {
    await env.EMAIL.send({ to, from: `no-reply@${new URL(appOrigin(env)).hostname}`, subject, text });
    return true;
  } catch (e) {
    console.error('mail', subject, e instanceof Error ? e.message : e);
    return false;
  }
}

/** Both: an e-mail to `to` if its address is under the limits; returns whether it went. */
export const sendMail = async (env: Env, to: string, subject: string, text: string, now = Date.now()) => (await reserveMail(env, to, now)) && deliverMail(env, to, subject, text);

/** A notice about the user's own account (the advice, a silent worker): clx sends it, nobody can
 *  make it send one, so only the daily cap applies — two notices of one hourly run both go. The
 *  Telegram linked to the account gets it too (§17). A notice the caller tries again while its
 *  e-mail fails (the advice, the renewal) sends the message with the e-mail, so it does not go
 *  every hour meanwhile; a notice sent `once` (a silent worker, a revoked token) sends it anyway. */
export async function sendNotice(env: Env, user: { id: number; email: string }, subject: string, text: string, now = Date.now(), once = false): Promise<boolean> {
  const sent = (await reserveMail(env, user.email, now, 0)) && (await deliverMail(env, user.email, subject, text));
  if (sent || once) await notifyTelegram(env, user.id, subject, text).catch((e: unknown) => console.error('telegram notice', e instanceof Error ? e.message : e));
  return sent;
}

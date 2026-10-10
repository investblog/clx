// Sign-up, e-mail confirmation and password reset (docs/spec.md §9). Sign-up and reset answer the
// same for a known and an unknown address, and the same whether an e-mail went or the address was
// over its limit: nothing in the answer tells whether the address has an account. E-mail tokens are
// 32 random bytes; D1 keeps their SHA-256 and expiry, and one DELETE … RETURNING consumes one, so a
// second use fails. A reset ends every session of the user (`session_version`).
import { Hono, type Context } from 'hono';
import { sha256 } from '../lib/crypto';
import { deliverMail, reserveMail } from '../mail';
import { appUrl, localeOf, MAIL, type Locale } from '../mail-text';
import type { Env } from '../types';
import { hashPassword } from './password';
import { userOf } from './routes';

const CONFIRM_TTL = 24 * 3_600_000;
const RESET_TTL = 3_600_000;
const MAX_BODY = 4096;
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/u;
export const PASSWORD_MIN = 10;

type C = Context<{ Bindings: Env }>;
const ipOf = (c: C) => c.req.header('cf-connecting-ip') ?? '';

async function bodyOf(c: C): Promise<Record<string, unknown> | null> {
  if (Number(c.req.header('content-length') ?? 0) > MAX_BODY) return null;
  const raw = await c.req.text();
  if (raw.length > MAX_BODY) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const emailOf = (v: unknown) => {
  const e = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return EMAIL.test(e) && new TextEncoder().encode(e).length <= 254 ? e : null;
};
const passwordOf = (v: unknown) => (typeof v === 'string' && v.length >= PASSWORD_MIN && v.length <= 256 ? v : null);

/** Turnstile (§9): the token the widget gave the page, checked with Cloudflare. */
async function human(env: Env, token: unknown, ip: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET || typeof token !== 'string' || !token || token.length > 2048) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form }).catch(() => null);
  return Boolean(res?.ok && ((await res.json()) as { success?: boolean }).success);
}

/** The first checks of an anonymous e-mail request: the IP's rate, the body, Turnstile. */
async function gate(c: C): Promise<Response | Record<string, unknown>> {
  if (!(await c.env.SIGNUP_LIMIT.limit({ key: ipOf(c) || 'unknown' })).success) return c.json({ error: 'rate_limit_exceeded', retryAfter: 60 }, 429, { 'Retry-After': '60' });
  const body = await bodyOf(c);
  if (!body) return c.json({ error: 'invalid_request' }, 400);
  if (!c.env.TURNSTILE_SECRET) return c.json({ error: 'not_configured' }, 503);
  if (!(await human(c.env, body.turnstile, ipOf(c)))) return c.json({ error: 'turnstile_failed' }, 403);
  return body;
}

/** A new token next to any earlier one (expired tokens of anyone go on the way); `settle` keeps
 *  only it once its e-mail went, or drops it when the e-mail did not. */
async function issueToken(db: D1Database, userId: number, kind: 'confirm' | 'reset', now: number): Promise<{ token: string; settle: (sent: boolean) => Promise<unknown> }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
  const hash = await sha256(token);
  await db.batch([
    db.prepare('DELETE FROM email_tokens WHERE expires_at < ?').bind(now),
    db.prepare('INSERT INTO email_tokens (token_hash, user_id, kind, expires_at) VALUES (?, ?, ?, ?)').bind(hash, userId, kind, now + (kind === 'confirm' ? CONFIRM_TTL : RESET_TTL)),
  ]);
  return {
    token,
    settle: (sent) =>
      sent
        ? db.prepare('DELETE FROM email_tokens WHERE user_id = ? AND kind = ? AND token_hash != ?').bind(userId, kind, hash).run()
        : db.prepare('DELETE FROM email_tokens WHERE token_hash = ?').bind(hash).run(),
  };
}

/** Consume a token of `kind`: its user, or null when it is unknown, used or expired. */
async function consume(db: D1Database, token: unknown, kind: 'confirm' | 'reset', now: number): Promise<number | null> {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(token)) return null;
  const row = await db.prepare('DELETE FROM email_tokens WHERE token_hash = ?1 AND kind = ?2 AND expires_at >= ?3 RETURNING user_id').bind(await sha256(token), kind, now).first<{ user_id: number }>();
  return row?.user_id ?? null;
}

const sent = (c: C) => c.json({ ok: true, message: 'If the address can get it, an e-mail is on its way.' }, 202);

/** Work after the answer: what differs between a known and an unknown address (a token, an e-mail
 *  through Cloudflare) does not show in how long the answer takes. */
const later = (c: C, work: Promise<unknown>) => c.executionCtx.waitUntil(work.catch((e: unknown) => console.error('signup mail', e instanceof Error ? e.message : e)));

/** A token and its e-mail — only once the e-mail's place is taken; the new link replaces the old one
 *  only when its e-mail went, so a request over the limit or a failed send leaves the link already
 *  sent working. In the user's language, linking to the app of that language. */
async function mailToken(env: Env, user: { id: number; email: string; locale: Locale }, kind: 'confirm' | 'reset', reserved: boolean, now: number): Promise<void> {
  if (!reserved) return;
  const { token, settle } = await issueToken(env.DB, user.id, kind, now);
  const mail = MAIL[user.locale][kind](appUrl(env, user.locale, `#/${kind}?t=${token}`));
  await settle(await deliverMail(env, user.email, mail.subject, mail.text));
}

export const signup = new Hono<{ Bindings: Env }>();

/** What the sign-up and reset pages need before they ask anything: Turnstile's site key. */
signup.get('/config', (c) => c.json({ turnstile_site_key: c.env.TURNSTILE_SITE_KEY || null, password_min: PASSWORD_MIN }));

signup.post('/signup', async (c) => {
  const body = await gate(c);
  if (body instanceof Response) return body;
  const email = emailOf(body.email);
  const password = passwordOf(body.password);
  if (!email) return c.json({ error: 'invalid_email' }, 400);
  if (!password) return c.json({ error: 'weak_password', min: PASSWORD_MIN }, 400);
  const now = Date.now();
  // The hash is made either way, so a known address costs the same time as a new one. The session
  // version starts at the time: SQLite may hand a deleted user's id out again (no AUTOINCREMENT),
  // and that user's sessions carry a small version, which then never matches.
  // The language is the sign-up page's (ADR 0015); the account keeps it.
  const locale = localeOf(body.locale);
  const created = await c.env.DB.prepare('INSERT INTO users (email, password_hash, created_at, session_version, locale) VALUES (?1, ?2, ?3, ?3, ?4) ON CONFLICT (email) DO NOTHING RETURNING id')
    .bind(email, await hashPassword(password), now, locale)
    .first<{ id: number }>();
  const reserved = await reserveMail(c.env, email, now);
  if (created) later(c, mailToken(c.env, { id: created.id, email, locale }, 'confirm', reserved, now));
  // A known address: the owner is told in their own language, nothing changes — the answer is the same.
  else if (reserved)
    later(
      c,
      c.env.DB.prepare('SELECT locale FROM users WHERE email = ?')
        .bind(email)
        .first<{ locale: Locale }>()
        .then((u) => {
          const known = localeOf(u?.locale ?? locale);
          const mail = MAIL[known].known(appUrl(c.env, known), appUrl(c.env, known, '#/reset'));
          return deliverMail(c.env, email, mail.subject, mail.text);
        }),
    );
  return sent(c);
});

signup.post('/confirm', async (c) => {
  const body = await bodyOf(c);
  const userId = await consume(c.env.DB, body?.token, 'confirm', Date.now());
  if (!userId) return c.json({ error: 'invalid_token' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET email_confirmed_at = coalesce(email_confirmed_at, ?) WHERE id = ?').bind(Date.now(), userId),
    // Any other confirmation link still on its way has nothing left to do.
    c.env.DB.prepare("DELETE FROM email_tokens WHERE user_id = ? AND kind = 'confirm'").bind(userId),
  ]);
  return c.json({ ok: true });
});

/** A new confirmation e-mail for the signed-in user whose address is not confirmed yet. */
signup.post('/confirm/resend', async (c) => {
  const userId = await userOf(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);
  const user = await c.env.DB.prepare('SELECT email, email_confirmed_at, locale FROM users WHERE id = ?').bind(userId).first<{ email: string; email_confirmed_at: number | null; locale: Locale }>();
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  if (user.email_confirmed_at !== null) return c.json({ ok: true, confirmed: true });
  const now = Date.now();
  await mailToken(c.env, { id: userId, email: user.email, locale: user.locale }, 'confirm', await reserveMail(c.env, user.email, now), now);
  return sent(c);
});

signup.post('/reset', async (c) => {
  const body = await gate(c);
  if (body instanceof Response) return body;
  const email = emailOf(body.email);
  if (!email) return c.json({ error: 'invalid_email' }, 400);
  const now = Date.now();
  // The same work before the answer for any address: the limit is taken, the user looked up.
  const [reserved, user] = await Promise.all([reserveMail(c.env, email, now), c.env.DB.prepare('SELECT id, locale FROM users WHERE email = ?').bind(email).first<{ id: number; locale: Locale }>()]);
  if (user) later(c, mailToken(c.env, { id: user.id, email, locale: user.locale }, 'reset', reserved, now));
  return sent(c);
});

signup.post('/reset/confirm', async (c) => {
  const body = await bodyOf(c);
  const password = passwordOf(body?.password);
  if (!password) return c.json({ error: 'weak_password', min: PASSWORD_MIN }, 400);
  const now = Date.now();
  const userId = await consume(c.env.DB, body?.token, 'reset', now);
  if (!userId) return c.json({ error: 'invalid_token' }, 400);
  // A new session version ends every session and access token issued before; the address is proven too.
  const hash = await hashPassword(password);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET password_hash = ?1, session_version = session_version + 1, email_confirmed_at = coalesce(email_confirmed_at, ?2) WHERE id = ?3').bind(hash, now, userId),
    // Every other reset link — an older one, or one whose e-mail is still on its way — dies with this reset.
    c.env.DB.prepare("DELETE FROM email_tokens WHERE user_id = ? AND kind = 'reset'").bind(userId),
  ]);
  return c.json({ ok: true });
});

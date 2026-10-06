// Sign-in, as the 301.st UI expects it from the 301.st API: the
// access token in the JSON answer, the refresh id in an HttpOnly cookie, a new refresh id on every
// refresh. Differences: the refresh session is bound to the browser (User-Agent) but not to the IP —
// a phone or a VPN changes address and would lose the session; the cookie is SameSite=Strict on
// /auth only, since the reports are served from the same origin.
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Env } from '../types';
import { accessOf, ACCESS_TTL, signAccess } from './jwt';
import { verifyPassword } from './password';
import { LIMITS, overLimit } from './ratelimit';

const COOKIE = 'clx_refresh';
const REFRESH_TTL = 7 * 86_400;

interface Session {
  user_id: number;
  ua: string;
  created_at: number;
  /** users.session_version when it was opened; a session from before versions counts as 0 */
  ver?: number;
}

const ipOf = (c: Context): string => c.req.header('cf-connecting-ip') ?? 'unknown';
const uaOf = (c: Context): string => c.req.header('user-agent') ?? '';
const tooMany = (c: Context, wait: number) => c.json({ error: 'rate_limit_exceeded', retryAfter: wait }, 429, { 'Retry-After': String(wait) });

/** A new refresh session and its access token, both under the user's current session version. */
async function openSession(c: Context<{ Bindings: Env }>, userId: number, ver: number, now: number): Promise<Response> {
  const id = crypto.randomUUID();
  await c.env.SESSIONS.put(`refresh:${id}`, JSON.stringify({ user_id: userId, ua: uaOf(c), created_at: now, ver } satisfies Session), { expirationTtl: REFRESH_TTL });
  setCookie(c, COOKIE, id, { httpOnly: true, secure: true, sameSite: 'Strict', path: '/auth', maxAge: REFRESH_TTL });
  return c.json({ ok: true, access_token: await signAccess(c.env.JWT_SECRET, userId, now, ver), expires_in: ACCESS_TTL });
}

/** The signed-in user from `Authorization: Bearer <access token>`, or null — also when the token is
 *  of an older session version (a password reset ended it). */
export async function userOf(c: Context<{ Bindings: Env }>): Promise<number | null> {
  const token = c.req.header('authorization')?.match(/^Bearer (.+)$/u)?.[1];
  const access = token ? await accessOf(c.env.JWT_SECRET, token, Date.now()) : null;
  if (!access) return null;
  const ver = await c.env.DB.prepare('SELECT session_version FROM users WHERE id = ?').bind(access.sub).first<number>('session_version');
  return ver === access.ver ? access.sub : null;
}

export const auth = new Hono<{ Bindings: Env }>();

const MAX_BODY = 2048;

auth.post('/login', async (c) => {
  // A declared oversized body is refused unread; an undeclared one is still capped once read.
  if (Number(c.req.header('content-length') ?? 0) > MAX_BODY) return c.json({ error: 'payload_too_large' }, 413);
  const raw = await c.req.text();
  if (raw.length > MAX_BODY) return c.json({ error: 'payload_too_large' }, 413);
  let body: { email?: unknown; password?: unknown } = {};
  try {
    body = JSON.parse(raw) ?? {};
  } catch {
    // not JSON: treated as missing credentials below
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) return c.json({ error: 'missing_credentials' }, 400);
  // Before KV (the e-mail is part of a key, at most 512 bytes) and before PBKDF2 sees the password.
  if (new TextEncoder().encode(email).length > 254 || password.length > 256) return c.json({ error: 'invalid_login' }, 401);
  const now = Date.now();
  const wait = (await overLimit(c.env, `login:ip:${ipOf(c)}`, LIMITS.loginByIp, now)) ?? (await overLimit(c.env, `login:email:${email}`, LIMITS.loginByEmail, now));
  if (wait) return tooMany(c, wait);
  const user = await c.env.DB.prepare('SELECT id, password_hash, session_version FROM users WHERE email = ?').bind(email).first<{ id: number; password_hash: string; session_version: number }>();
  if (!(await verifyPassword(password, user?.password_hash ?? null)) || !user) return c.json({ error: 'invalid_login' }, 401);
  await c.env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now, user.id).run();
  return openSession(c, user.id, user.session_version, now);
});

auth.post('/refresh', async (c) => {
  const wait = await overLimit(c.env, `refresh:ip:${ipOf(c)}`, LIMITS.refreshByIp, Date.now());
  if (wait) return tooMany(c, wait);
  const id = getCookie(c, COOKIE);
  if (!id) return c.json({ error: 'missing_refresh_id' }, 401);
  const session = await c.env.SESSIONS.get<Session>(`refresh:${id}`, 'json');
  await c.env.SESSIONS.delete(`refresh:${id}`);
  // Another browser holding this cookie: the session is ended for both.
  if (!session || session.ua !== uaOf(c)) {
    deleteCookie(c, COOKIE, { path: '/auth' });
    return c.json({ error: 'invalid_refresh' }, 401);
  }
  const user = await c.env.DB.prepare('SELECT id, session_version FROM users WHERE id = ?').bind(session.user_id).first<{ id: number; session_version: number }>();
  // A session of an older version — a password reset came after it — is over.
  if (!user || (session.ver ?? 0) !== user.session_version) {
    deleteCookie(c, COOKIE, { path: '/auth' });
    return c.json({ error: 'invalid_refresh' }, 401);
  }
  return openSession(c, user.id, user.session_version, Date.now());
});

auth.post('/logout', async (c) => {
  const id = getCookie(c, COOKIE);
  if (id) await c.env.SESSIONS.delete(`refresh:${id}`);
  deleteCookie(c, COOKIE, { path: '/auth' });
  return c.json({ ok: true });
});

auth.get('/me', async (c) => {
  const id = await userOf(c);
  if (!id) return c.json({ error: 'unauthorized' }, 401);
  const user = await c.env.DB.prepare('SELECT id, email FROM users WHERE id = ?').bind(id).first<{ id: number; email: string }>();
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  return c.json({ ok: true, user: { id: user.id, email: user.email } });
});

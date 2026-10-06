// Sign-up, e-mail confirmation and password reset (docs/spec.md §9). E-mail goes to a fake EMAIL
// binding; Turnstile's check is answered here — the token "human" passes.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/auth/password';
import { app } from '../src/index';
import type { Env } from '../src/types';
import { fakeCtx, testEnv } from './env';

let env: Env;
let dispose: () => Promise<void>;
const mail: { to: string; from: string; subject: string; text: string }[] = [];
beforeAll(async () => {
  ({ env, dispose } = await testEnv());
  env = { ...env, TURNSTILE_SECRET: 'turnstile-test', EMAIL: { send: async (m) => (mail.push(m), { messageId: `m${mail.length}` }) } };
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url !== 'https://challenges.cloudflare.com/turnstile/v0/siteverify') return realFetch(input, init);
    const form = init!.body as FormData;
    return Response.json({ success: form.get('secret') === 'turnstile-test' && form.get('response') === 'human' });
  });
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await dispose();
});

const UA = 'Mozilla/5.0 test-browser';
let ipSeq = 0;
beforeEach(async () => {
  mail.length = 0;
  for (const t of ['email_tokens', 'email_sends', 'users']) await env.DB.prepare(`DELETE FROM ${t}`).run();
  await env.DB.prepare("INSERT INTO users (id, email, password_hash, created_at, email_confirmed_at) VALUES (1, 'owner@example.com', ?, 0, 0)").bind(await hashPassword('Right-pass-1')).run();
});

/** A fresh address per request, so the per-IP limit of one test does not reach the next; the work
 *  after the answer (tokens, e-mail) has finished when this returns. */
async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const { ctx, settle } = fakeCtx();
  const res = await app.request(`https://clx.cx${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'user-agent': UA, 'cf-connecting-ip': `10.6.${++ipSeq >> 8}.${ipSeq & 255}`, ...headers } }, env, ctx);
  await settle();
  return res;
}
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, any> });
const tokenIn = (text: string) => text.match(/[?&]t=([A-Za-z0-9_-]{43})/u)?.[1] ?? '';
async function login(email: string, password: string) {
  const res = await post('/auth/login', { email, password });
  return { status: res.status, token: ((await res.json()) as { access_token?: string }).access_token ?? '', cookie: res.headers.get('set-cookie')?.match(/clx_refresh=([^;]*)/u)?.[1] ?? '' };
}
const me = (token: string) => app.request('https://clx.cx/v1/me', { headers: { authorization: `Bearer ${token}` } }, env);

describe('sign-up', () => {
  it("the page's config: Turnstile's site key and the password minimum", async () => {
    const res = await app.request('https://clx.cx/auth/config', {}, { ...env, TURNSTILE_SITE_KEY: '0x4AAA-site' });
    expect(await res.json()).toEqual({ turnstile_site_key: '0x4AAA-site', password_min: 10 });
  });

  it('a new address: an unconfirmed user, a confirmation e-mail; signed in, it cannot connect an account until confirmed', async () => {
    const r = await json(await post('/auth/signup', { email: 'New@Example.com', password: 'a-long-password', turnstile: 'human' }));
    expect(r).toMatchObject({ status: 202, body: { ok: true } });
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ to: 'new@example.com', from: 'no-reply@clx.example.com' });
    expect(mail[0]!.text).toContain('https://clx.example.com/#/confirm?t=');
    const { token } = await login('new@example.com', 'a-long-password');
    expect(((await (await me(token)).json()) as { user: { email_confirmed: boolean } }).user.email_confirmed).toBe(false);
    const connect = await app.request('https://clx.cx/v1/accounts', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ cf_account_id: 'a'.repeat(32), bootstrap_token: 'x'.repeat(40) }) }, env);
    expect(((await connect.json()) as { error: { code: string } }).error.code).toBe('email_unconfirmed');
    // The link confirms once.
    const t = tokenIn(mail[0]!.text);
    expect(await json(await post('/auth/confirm', { token: t }))).toMatchObject({ status: 200, body: { ok: true } });
    expect(await json(await post('/auth/confirm', { token: t }))).toMatchObject({ status: 400, body: { error: 'invalid_token' } });
    expect(((await (await me(token)).json()) as { user: { email_confirmed: boolean } }).user.email_confirmed).toBe(true);
  });

  it('a known address gets the same answer; its owner is told by e-mail, the password stays', async () => {
    const r = await json(await post('/auth/signup', { email: 'owner@example.com', password: 'someone-elses-pass', turnstile: 'human' }));
    expect(r).toEqual({ status: 202, body: { ok: true, message: 'If the address can get it, an e-mail is on its way.' } });
    expect(mail).toHaveLength(1);
    expect(mail[0]!.subject).toContain('уже есть аккаунт');
    expect((await login('owner@example.com', 'Right-pass-1')).status).toBe(200);
  });

  it('Turnstile, the e-mail and the password are checked; no secret — not configured', async () => {
    expect(await json(await post('/auth/signup', { email: 'a@example.com', password: 'a-long-password', turnstile: 'bot' }))).toMatchObject({ status: 403, body: { error: 'turnstile_failed' } });
    expect(await json(await post('/auth/signup', { email: 'not-an-email', password: 'a-long-password', turnstile: 'human' }))).toMatchObject({ status: 400, body: { error: 'invalid_email' } });
    expect(await json(await post('/auth/signup', { email: 'a@example.com', password: 'short', turnstile: 'human' }))).toMatchObject({ status: 400, body: { error: 'weak_password', min: 10 } });
    const bare = { ...env, TURNSTILE_SECRET: undefined };
    const res = await app.request('https://clx.cx/auth/signup', { method: 'POST', body: JSON.stringify({ email: 'a@example.com', password: 'a-long-password', turnstile: 'human' }), headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.7.0.1' } }, bare, fakeCtx().ctx);
    expect(res.status).toBe(503);
    expect(mail).toHaveLength(0);
  });

  it('at most one e-mail per address per 10 minutes and five a day; the answer does not change', async () => {
    for (let i = 0; i < 3; i++) expect((await post('/auth/signup', { email: 'owner@example.com', password: 'a-long-password', turnstile: 'human' })).status).toBe(202);
    expect(mail).toHaveLength(1);
    const day = Math.floor(Date.now() / 86_400_000);
    await env.DB.prepare('UPDATE email_sends SET last_at = 0, count = 5, day = ?').bind(day).run();
    await post('/auth/signup', { email: 'owner@example.com', password: 'a-long-password', turnstile: 'human' });
    expect(mail).toHaveLength(1);
    await env.DB.prepare('UPDATE email_sends SET last_at = 0, day = ?').bind(day - 1).run();
    await post('/auth/signup', { email: 'owner@example.com', password: 'a-long-password', turnstile: 'human' });
    expect(mail).toHaveLength(2);
  });

  it('a signed-in unconfirmed user can have the confirmation sent again', async () => {
    await post('/auth/signup', { email: 'new@example.com', password: 'a-long-password', turnstile: 'human' });
    const { token } = await login('new@example.com', 'a-long-password');
    await env.DB.prepare('UPDATE email_sends SET last_at = 0').run();
    expect((await post('/auth/confirm/resend', {}, { authorization: `Bearer ${token}` })).status).toBe(202);
    expect(mail).toHaveLength(2);
    // The new link replaced the old one.
    expect((await post('/auth/confirm', { token: tokenIn(mail[0]!.text) })).status).toBe(400);
    expect((await post('/auth/confirm', { token: tokenIn(mail[1]!.text) })).status).toBe(200);
  });
});

describe('password reset', () => {
  it('an unknown address: the same answer, no e-mail', async () => {
    expect(await json(await post('/auth/reset', { email: 'nobody@example.com', turnstile: 'human' }))).toEqual({ status: 202, body: { ok: true, message: 'If the address can get it, an e-mail is on its way.' } });
    expect(mail).toHaveLength(0);
  });

  it('a reset sets the password and ends every session; its link works once', async () => {
    const before = await login('owner@example.com', 'Right-pass-1');
    expect((await me(before.token)).status).toBe(200);
    await post('/auth/reset', { email: 'owner@example.com', turnstile: 'human' });
    const t = tokenIn(mail[0]!.text);
    expect(mail[0]!.text).toContain('/#/reset?t=');
    expect(await json(await post('/auth/reset/confirm', { token: t, password: 'short' }))).toMatchObject({ status: 400, body: { error: 'weak_password' } });
    // Within the same second as the sign-in: the session still ends.
    expect((await post('/auth/reset/confirm', { token: t, password: 'a-new-long-password' })).status).toBe(200);
    expect((await me(before.token)).status).toBe(401);
    const refresh = await post('/auth/refresh', {}, { cookie: `clx_refresh=${before.cookie}` });
    expect(refresh.status).toBe(401);
    expect((await login('owner@example.com', 'Right-pass-1')).status).toBe(401);
    const after = await login('owner@example.com', 'a-new-long-password');
    expect((await me(after.token)).status).toBe(200);
    expect((await post('/auth/reset/confirm', { token: t, password: 'another-long-password' })).status).toBe(400);
  });

  it('an unknown address takes its place in the limits too; a request over the limit keeps the link already sent', async () => {
    await post('/auth/reset', { email: 'nobody@example.com', turnstile: 'human' });
    expect(await env.DB.prepare("SELECT count FROM email_sends WHERE email = 'nobody@example.com'").first('count')).toBe(1);
    await post('/auth/reset', { email: 'owner@example.com', turnstile: 'human' });
    expect(mail).toHaveLength(1);
    // Within 10 minutes: no e-mail, and the first link still works.
    await post('/auth/reset', { email: 'owner@example.com', turnstile: 'human' });
    expect(mail).toHaveLength(1);
    expect((await post('/auth/reset/confirm', { token: tokenIn(mail[0]!.text), password: 'a-new-long-password' })).status).toBe(200);
  });

  it('a send that fails keeps the link already sent', async () => {
    await post('/auth/reset', { email: 'owner@example.com', turnstile: 'human' });
    const first = tokenIn(mail[0]!.text);
    await env.DB.prepare('UPDATE email_sends SET last_at = 0').run();
    const send = env.EMAIL!.send;
    env.EMAIL!.send = async () => Promise.reject(new Error('Email Sending is down'));
    try {
      await post('/auth/reset', { email: 'owner@example.com', turnstile: 'human' });
    } finally {
      env.EMAIL!.send = send;
    }
    expect(await env.DB.prepare("SELECT count(*) AS n FROM email_tokens WHERE kind = 'reset'").first('n')).toBe(1);
    expect((await post('/auth/reset/confirm', { token: first, password: 'a-new-long-password' })).status).toBe(200);
  });

  it('a reset ends every other reset link of the user', async () => {
    await post('/auth/reset', { email: 'owner@example.com', turnstile: 'human' });
    // Another link issued meanwhile (its e-mail still on its way).
    await env.DB.prepare("INSERT INTO email_tokens (token_hash, user_id, kind, expires_at) VALUES ('other', 1, 'reset', ?)").bind(Date.now() + 3_600_000).run();
    expect((await post('/auth/reset/confirm', { token: tokenIn(mail[0]!.text), password: 'a-new-long-password' })).status).toBe(200);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM email_tokens WHERE kind = 'reset'").first('n')).toBe(0);
  });

  it('an expired link is refused', async () => {
    await post('/auth/reset', { email: 'owner@example.com', turnstile: 'human' });
    await env.DB.prepare('UPDATE email_tokens SET expires_at = 1').run();
    expect((await post('/auth/reset/confirm', { token: tokenIn(mail[0]!.text), password: 'a-new-long-password' })).status).toBe(400);
  });
});

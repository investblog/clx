import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { signAccess, verifyAccess } from '../src/auth/jwt';
import { hashPassword } from '../src/auth/password';
import type { Env } from '../src/types';
import { testEnv } from './env';

let env: Env;
let dispose: () => Promise<void>;
beforeAll(async () => ({ env, dispose } = await testEnv()));
afterAll(() => dispose());

const UA = 'Mozilla/5.0 test-browser';
let ipSeq = 0;
let ip = '';
beforeEach(async () => {
  ip = `10.0.0.${++ipSeq}`; // a fresh address per test, so limits from one test don't leak into the next
  await env.DB.prepare('DELETE FROM users').run();
  await env.DB.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (1, 'owner@example.com', ?, 0), (2, 'other@example.com', ?, 0)")
    .bind(await hashPassword('Right-pass-1'), await hashPassword('Other-pass-2'))
    .run();
});

const call = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  app.request(`https://clx.cx${path}`, { ...init, headers: { 'user-agent': UA, 'cf-connecting-ip': ip, ...init.headers } }, env);
const login = (email: string, password: string) => call('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }), headers: { 'content-type': 'application/json' } });
const cookieOf = (res: Response) => res.headers.get('set-cookie')?.match(/clx_refresh=([^;]*)/u)?.[1] ?? '';

describe('sign-in', () => {
  it('logs in: an access token that verifies, a strict HttpOnly cookie on /auth', async () => {
    const res = await login('Owner@Example.com', 'Right-pass-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { access_token: string };
    expect(await verifyAccess('test-jwt-secret', body.access_token, Date.now())).toBe(1);
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/HttpOnly/iu);
    expect(cookie).toMatch(/SameSite=Strict/iu);
    expect(cookie).toMatch(/Path=\/auth/iu);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('a wrong password and an unknown e-mail get the same answer', async () => {
    for (const [e, p] of [['owner@example.com', 'nope'], ['nobody@example.com', 'Right-pass-1']] as const) {
      const res = await login(e, p);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'invalid_login' });
    }
  });

  it('refuses an oversized body unread', async () => {
    expect((await login('owner@example.com', 'x'.repeat(10_000))).status).toBe(413);
  });

  it('refuses an oversized e-mail or password before touching KV', async () => {
    for (const [e, p] of [[`${'a'.repeat(300)}@example.com`, 'Right-pass-1'], [`${'я'.repeat(130)}@example.com`, 'Right-pass-1'], ['owner@example.com', 'x'.repeat(300)]] as const) {
      const res = await login(e, p);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'invalid_login' });
    }
  });

  it('stops guessing from one address after five tries', async () => {
    for (let i = 0; i < 5; i++) expect((await login('owner@example.com', `bad${i}`)).status).toBe(401);
    const res = await login('owner@example.com', 'Right-pass-1');
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('refresh rotates the session; the old id is dead; another browser ends it', async () => {
    const first = cookieOf(await login('owner@example.com', 'Right-pass-1'));
    const r1 = await call('/auth/refresh', { method: 'POST', headers: { cookie: `clx_refresh=${first}` } });
    expect(r1.status).toBe(200);
    const second = cookieOf(r1);
    expect(second).not.toBe(first);
    expect((await call('/auth/refresh', { method: 'POST', headers: { cookie: `clx_refresh=${first}` } })).status).toBe(401);
    const stolen = await call('/auth/refresh', { method: 'POST', headers: { cookie: `clx_refresh=${second}`, 'user-agent': 'curl/8' } });
    expect(stolen.status).toBe(401);
    expect((await call('/auth/refresh', { method: 'POST', headers: { cookie: `clx_refresh=${second}` } })).status).toBe(401);
  });

  it('logout ends the session', async () => {
    const id = cookieOf(await login('owner@example.com', 'Right-pass-1'));
    expect((await call('/auth/logout', { method: 'POST', headers: { cookie: `clx_refresh=${id}` } })).status).toBe(200);
    expect((await call('/auth/refresh', { method: 'POST', headers: { cookie: `clx_refresh=${id}` } })).status).toBe(401);
  });

  it('an expired or foreign-signed token is refused', async () => {
    const old = await signAccess('test-jwt-secret', 1, Date.now() - 3_600_000);
    const forged = await signAccess('another-secret', 1, Date.now());
    for (const t of [old, forged, 'x.y.z']) expect((await call('/auth/me', { headers: { authorization: `Bearer ${t}` } })).status).toBe(401);
    const good = await signAccess('test-jwt-secret', 1, Date.now());
    expect(await (await call('/auth/me', { headers: { authorization: `Bearer ${good}` } })).json()).toEqual({ ok: true, user: { id: 1, email: 'owner@example.com' } });
  });
});

describe('configuration', () => {
  it('without its secret the Worker refuses sign-in', async () => {
    const bare = { ...env, JWT_SECRET: '' };
    expect((await app.request('https://clx.cx/auth/login', { method: 'POST', body: '{}' }, bare)).status).toBe(503);
    expect((await app.request('https://clx.cx/auth/me', {}, bare)).status).toBe(503);
  });
});

describe('scripts/user.mjs hash', () => {
  it("node's PBKDF2 hash is one the Worker accepts", async () => {
    const { pbkdf2Sync, randomBytes } = await import('node:crypto');
    const { verifyPassword } = await import('../src/auth/password');
    const salt = randomBytes(16);
    // Buffer's toString(encoding) is hidden by workers-types here; base64 by hand is the same bytes.
    const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
    const stored = `${b64(salt)}:${b64(pbkdf2Sync('Aa1-from-node', salt, 100_000, 32, 'sha256'))}`;
    expect(await verifyPassword('Aa1-from-node', stored)).toBe(true);
    expect(await verifyPassword('Aa1-from-nodf', stored)).toBe(false);
  });
});

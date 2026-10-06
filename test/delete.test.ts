// Deleting a clx.cx account (docs/spec.md §9): its Cloudflare accounts disconnected, its totals gone
// at once, the user with everything of theirs.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccess } from '../src/auth/jwt';
import { hashPassword } from '../src/auth/password';
import { app } from '../src/index';
import type { Env } from '../src/types';
import { fakeCtx, testEnv } from './env';
import { ACC, BOOT, fakeCf, useFakeCloudflare } from './fake-cf';

let env: Env;
let dispose: () => Promise<void>;
beforeAll(async () => ({ env, dispose } = await testEnv()));
afterAll(() => dispose());
useFakeCloudflare();

let idem = 0;
async function call(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { authorization: `Bearer ${await signAccess('test-jwt-secret', 1, Date.now())}`, 'cf-connecting-ip': '10.8.0.1' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['idempotency-key'] = `d${++idem}`;
  const { ctx, settle } = fakeCtx();
  const res = await app.request(`https://clx.cx${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env, ctx);
  await settle();
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

beforeEach(async () => {
  for (const t of ['links', 'link_hosts', 'sites', 'hourly', 'daily', 'departed', 'cf_calls', 'edge_accounts', 'operations', 'idempotency', 'api_keys', 'users']) await env.DB.prepare(`DELETE FROM ${t}`).run();
  await env.DB.prepare("INSERT INTO users (id, email, password_hash, created_at, email_confirmed_at, plan) VALUES (1, 'me@example.com', ?, 0, 0, 'api')").bind(await hashPassword('Right-pass-1')).run();
  fakeCf.reset();
});

describe('deleting the account', () => {
  it('with the password: Cloudflare accounts disconnected, totals, keys, sites and the user gone', async () => {
    const accountId = (await call('POST', '/v1/accounts', { cf_account_id: ACC, bootstrap_token: BOOT })).body.account.id;
    expect(fakeCf.scripts.has('clx-edge')).toBe(true);
    await env.DB.prepare("INSERT INTO daily (account_id, target, day, as_of_hour, final, views, bots, visitors) VALUES (?, 'sx', 1, 47, 1, 5, 0, 5)").bind(accountId).run();
    await call('POST', '/v1/keys', { scopes: ['reports'] });
    await env.DB.prepare("INSERT INTO email_sends (email, day, count, last_at) VALUES ('me@example.com', 1, 1, 0)").run();
    await env.DB.prepare("INSERT INTO link_hosts (id, account_id, host, zone_id, state, revision, created_at, updated_at) VALUES ('h', ?, 'go.example.com', 'zone1', 'deleted', 0, 0, 0)").bind(accountId).run();
    expect(await call('DELETE', '/v1/me', { password: 'wrong-password' })).toMatchObject({ status: 403, body: { error: { code: 'invalid_password' } } });
    expect(await env.DB.prepare('SELECT count(*) AS n FROM users').first('n')).toBe(1);

    const r = await call('DELETE', '/v1/me', { password: 'Right-pass-1' });
    expect(r).toMatchObject({ status: 200, body: { ok: true, left: [], revoke_tokens: [expect.stringMatching(/^clx-/u)] } });
    expect(fakeCf.scripts.has('clx-edge')).toBe(false);
    for (const t of ['users', 'edge_accounts', 'api_keys', 'daily', 'departed', 'cf_calls', 'email_sends', 'link_hosts']) expect(await env.DB.prepare(`SELECT count(*) AS n FROM ${t}`).first('n')).toBe(0);
    // The session is over with the user.
    expect((await call('GET', '/v1/me')).status).toBe(401);
  });

  it('refused while an operation runs on an account — and then nothing is ended', async () => {
    await call('POST', '/v1/accounts', { cf_account_id: ACC, bootstrap_token: BOOT });
    await env.DB.prepare('UPDATE edge_accounts SET lease_until = ?').bind(Date.now() + 60_000).run();
    expect(await call('DELETE', '/v1/me', { password: 'Right-pass-1' })).toMatchObject({ status: 409, body: { error: { code: 'operation_in_progress' } } });
    expect((await call('GET', '/v1/me')).status).toBe(200);
  });

  it('an API key cannot delete the account', async () => {
    const issued = await call('POST', '/v1/keys', { scopes: ['accounts', 'sites', 'links', 'reports'] });
    const res = await app.request('https://clx.cx/v1/me', { method: 'DELETE', headers: { authorization: `Bearer ${issued.body.key}`, 'content-type': 'application/json', 'idempotency-key': 'k1', 'cf-connecting-ip': '10.8.0.2' }, body: JSON.stringify({ password: 'Right-pass-1' }) }, env, fakeCtx().ctx);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('session_required');
  });
});

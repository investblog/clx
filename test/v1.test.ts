import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { checkTokens } from '../src/cf/connect';
import { seal } from '../src/lib/crypto';
import { app } from '../src/index';
import { signAccess } from '../src/auth/jwt';
import type { Env } from '../src/types';
import { fakeCtx, testEnv } from './env';
import { ACC, BOOT, fakeCf, OTHER, useFakeCloudflare } from './fake-cf';

let env: Env;
let dispose: () => Promise<void>;
beforeAll(async () => ({ env, dispose } = await testEnv()));
afterAll(() => dispose());

useFakeCloudflare();

beforeEach(async () => {
  for (const t of ['cf_calls', 'edge_accounts', 'operations', 'idempotency', 'api_keys', 'users']) await env.DB.prepare(`DELETE FROM ${t}`).run();
  await env.DB.prepare("INSERT INTO users (id, email, password_hash, created_at, plan) VALUES (1, 'free@example.com', 'x', 0, 'free'), (2, 'api@example.com', 'x', 0, 'api')").run();
  fakeCf.reset();
});

const session = async (user: number) => `Bearer ${await signAccess('test-jwt-secret', user, Date.now())}`;
let ip = 0;
async function call(method: string, path: string, opts: { auth: string; body?: unknown; key?: string } ) {
  const headers: Record<string, string> = { authorization: opts.auth, 'cf-connecting-ip': `10.1.0.${++ip % 250}` };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.key) headers['idempotency-key'] = opts.key;
  // Work after the answer (the install) is waited for, so every test sees where it stopped.
  const { ctx, settle } = fakeCtx();
  const res = await app.request(`https://clx.cx${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }, env, ctx);
  await settle();
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}
const connectAs = async (auth: string, key = 'k1', body: unknown = { cf_account_id: ACC, bootstrap_token: BOOT }) => call('POST', '/v1/accounts', { auth, body, key });
const clxTokens = () => [...fakeCf.tokens.values()].filter((t) => t.name.startsWith('clx-'));

describe('/v1 basics', () => {
  it('needs a principal, and answers errors in one shape', async () => {
    const r = await call('GET', '/v1/me', { auth: 'Bearer nope' });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: { code: 'unauthorized', message: expect.any(String) } });
  });

  it('me: plan, limits, use', async () => {
    const r = await call('GET', '/v1/me', { auth: await session(1) });
    expect(r.body).toMatchObject({ user: { email: 'free@example.com' }, plan: 'free', limits: { cfAccounts: 1 }, use: { cf_accounts: 0 } });
  });
});

describe('API keys', () => {
  it('only the api plan gets keys; the key is shown once, its replay says so', async () => {
    expect((await call('POST', '/v1/keys', { auth: await session(1), body: { scopes: ['sites'] }, key: 'i1' })).body.error.code).toBe('plan_required');
    const made = await call('POST', '/v1/keys', { auth: await session(2), body: { scopes: ['sites', 'reports'] }, key: 'i1' });
    expect(made.status).toBe(201);
    expect(made.body.key).toMatch(/^clx_[A-Za-z0-9_-]{40,}$/u);
    const again = await call('POST', '/v1/keys', { auth: await session(2), body: { scopes: ['sites', 'reports'] }, key: 'i1' });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: 'key_already_issued', details: { key_id: made.body.id } });
    expect(JSON.stringify(again.body)).not.toContain(made.body.key);
    const stored = await env.DB.prepare('SELECT key_hash FROM api_keys').first<{ key_hash: string }>();
    expect(stored!.key_hash).not.toContain(made.body.key);
  });

  it('a key works by scope, cannot manage keys, needs Idempotency-Key, and dies when revoked', async () => {
    const { body } = await call('POST', '/v1/keys', { auth: await session(2), body: { scopes: ['reports'] }, key: 'i2' });
    const key = `Bearer ${body.key}`;
    expect((await call('GET', '/v1/me', { auth: key })).body.via).toBe('key');
    expect((await call('GET', '/v1/keys', { auth: key })).body.error.code).toBe('session_required');
    expect((await connectAs(key)).body.error.code).toBe('scope_required');
    expect((await call('POST', '/v1/accounts', { auth: key, body: {} })).status).toBe(403);
    expect((await call('DELETE', `/v1/keys/${body.id}`, { auth: await session(2) })).status).toBe(200);
    expect((await call('GET', '/v1/me', { auth: key })).status).toBe(401);
  });

  it('a key with the accounts scope must send Idempotency-Key on a mutation', async () => {
    const { body } = await call('POST', '/v1/keys', { auth: await session(2), body: { scopes: ['accounts'] }, key: 'i3' });
    const r = await call('POST', '/v1/accounts', { auth: `Bearer ${body.key}`, body: { cf_account_id: ACC, bootstrap_token: BOOT } });
    expect(r.body.error.code).toBe('invalid_request');
  });

  it("a key's allow list hides other accounts as not found", async () => {
    await connectAs(await session(2));
    const id = (await call('GET', '/v1/accounts', { auth: await session(2) })).body.accounts[0].id;
    const { body } = await call('POST', '/v1/keys', { auth: await session(2), body: { scopes: ['accounts'], allow_accounts: [OTHER] }, key: 'i4' });
    expect((await call('GET', `/v1/accounts/${id}`, { auth: `Bearer ${body.key}` })).status).toBe(404);
    expect((await call('GET', '/v1/accounts', { auth: `Bearer ${body.key}` })).body.accounts).toEqual([]);
  });
});

describe('connecting a Cloudflare account', () => {
  it('makes a named working token, stores it sealed, deletes the bootstrap, logs only mutations', async () => {
    const r = await connectAs(await session(1));
    expect(r.status).toBe(202);
    expect(r.body.account).toMatchObject({ cf_account_id: ACC, name: 'Test account', state: 'installing', token: { name: expect.stringMatching(/^clx-/u) } });
    expect(fakeCf.tokens.has('boot')).toBe(false);
    const [working] = clxTokens();
    expect(working!.rights.sort()).toEqual(['g0', 'g1', 'g2', 'g3', 'g4', 'g5', 'z0', 'z1', 'z2']);
    const sealed = await env.DB.prepare('SELECT token_sealed FROM edge_accounts WHERE id = ?').bind(r.body.account.id).first<string>('token_sealed');
    expect(sealed).toBeTruthy();
    expect(sealed).not.toContain(working!.value);
    const calls = (await env.DB.prepare('SELECT method, path FROM cf_calls ORDER BY id').all<{ method: string; path: string }>()).results;
    // The connect's own: the token made, the bootstrap deleted; the install's follow.
    expect(calls.slice(0, 2).map((c) => c.method)).toEqual(['POST', 'DELETE']);
    expect(calls.slice(2).every((c) => !c.path.includes('/tokens'))).toBe(true);
  });

  it('a repeat with the same Idempotency-Key replays the answer and makes nothing new', async () => {
    const first = await connectAs(await session(1));
    const again = await connectAs(await session(1));
    expect(again).toEqual(first);
    expect(clxTokens()).toHaveLength(1);
    const other = await connectAs(await session(1), 'k1', { cf_account_id: ACC, bootstrap_token: BOOT.replace('x', 'y') });
    expect(other.body.error.code).toBe('idempotency_conflict');
  });

  it('a bad bootstrap token is refused and leaves nothing behind', async () => {
    const r = await connectAs(await session(1), 'k2', { cf_account_id: ACC, bootstrap_token: 'z'.repeat(40) });
    expect(r.body.error.code).toBe('invalid_bootstrap');
    expect(await env.DB.prepare('SELECT count(*) AS n FROM edge_accounts').first('n')).toBe(0);
  });

  it('free plan: one account; a connected account is not connected twice', async () => {
    await connectAs(await session(1));
    fakeCf.tokens.set('boot', { id: 'boot', name: 'bootstrap', value: BOOT, status: 'active', rights: [] });
    expect((await connectAs(await session(1), 'k3')).body.error.code).toBe('already_connected');
  });

  it('a failure after the token was made is resumed by the retry: the orphan goes, one token stays', async () => {
    fakeCf.failOnce.add('/workers/scripts');
    const lost = await connectAs(await session(1), 'k4');
    expect(lost.status).toBe(502);
    expect(clxTokens()).toHaveLength(1);
    expect(await env.DB.prepare("SELECT state FROM edge_accounts").first('state')).toBe('pending');
    const resumed = await connectAs(await session(1), 'k4');
    expect(resumed.status).toBe(202);
    expect(clxTokens()).toHaveLength(1);
    expect(clxTokens()[0]!.id).not.toBe('t1');
  });

  it("a user's own token shaped like clx's is not taken for an orphan: only clx's own operations count", async () => {
    fakeCf.tokens.set('mine', { id: 'mine', name: 'clx-AAAAAAAAAAAAAAAAAAAAAA', value: 'mine'.padEnd(40, 'm'), status: 'active', rights: [] });
    expect((await connectAs(await session(1), 'k6')).status).toBe(202);
    expect(fakeCf.tokens.has('mine')).toBe(true);
  });

  it('a working token Cloudflare does not accept (401) is deleted, and nothing stays connected', async () => {
    fakeCf.rejectWorking.add('/workers/scripts');
    const r = await connectAs(await session(1), 'k5');
    expect(r.body.error.code).toBe('token_check_failed');
    expect(clxTokens()).toHaveLength(0);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM edge_accounts').first('n')).toBe(0);
  });

  it('a 403 on a check keeps the token and says permission_error with the endpoint (§3 item 6)', async () => {
    fakeCf.denyWorking.add('/workers/scripts');
    const r = await connectAs(await session(1), 'k7');
    expect(r.status).toBe(202);
    expect(r.body.account).toMatchObject({ state: 'permission_error', error: { code: 'permission_error', path: expect.stringContaining('/workers/scripts'), status: 403 } });
    expect(clxTokens()).toHaveLength(1);
  });

  it('renewal swaps in a new token and deletes the old one only after it works', async () => {
    const { body } = await connectAs(await session(1));
    // The install the connect started has ended (a renewal waits for it otherwise).
    await env.DB.prepare("UPDATE operations SET state = 'done' WHERE kind = 'install'").run();
    const old = clxTokens()[0]!.id;
    fakeCf.tokens.set('boot2', { id: 'boot2', name: 'bootstrap', value: BOOT.replace('x', 'q'), status: 'active', rights: [] });
    fakeCf.rejectWorking.add('/workers/scripts');
    const failed = await call('POST', `/v1/accounts/${body.account.id}/token`, { auth: await session(1), body: { bootstrap_token: BOOT.replace('x', 'q') }, key: 'r1' });
    expect(failed.body.error.code).toBe('token_check_failed');
    expect(clxTokens().map((t) => t.id)).toEqual([old]);
    fakeCf.rejectWorking.clear();
    fakeCf.tokens.set('boot2', { id: 'boot2', name: 'bootstrap', value: BOOT.replace('x', 'q'), status: 'active', rights: [] });
    const renewed = await call('POST', `/v1/accounts/${body.account.id}/token`, { auth: await session(1), body: { bootstrap_token: BOOT.replace('x', 'q') }, key: 'r2' });
    expect(renewed.status).toBe(200);
    expect(clxTokens()).toHaveLength(1);
    expect(clxTokens()[0]!.id).not.toBe(old);
  });

  it('the daily check marks a revoked token; disconnect names the token to revoke', async () => {
    const { body } = await connectAs(await session(1));
    clxTokens()[0]!.status = 'disabled';
    expect((await checkTokens(env)).checked).toBe(0); // just checked by the connect itself
    expect(await checkTokens(env, Date.now() + 21 * 3_600_000)).toMatchObject({ checked: 1, revoked: 1 });
    expect((await call('GET', `/v1/accounts/${body.account.id}`, { auth: await session(1) })).body.account.state).toBe('revoked');
    const gone = await call('DELETE', `/v1/accounts/${body.account.id}`, { auth: await session(1), key: 'd1' });
    // A revoked token deletes nothing: what clx put there is listed for the user.
    expect(gone.body).toEqual({ ok: true, revoke_token: body.account.token.name, left: ['worker clx-edge', expect.stringMatching(/^database clx-edge/u)] });
    expect(await env.DB.prepare('SELECT count(*) AS n FROM edge_accounts').first('n')).toBe(0);
  });
});

describe('review fixes', () => {
  it('two connects at once: one wins, the other is told an operation is running', async () => {
    const auth = await session(1);
    const [a, b] = await Promise.all([connectAs(auth, 'c1'), connectAs(auth, 'c2')]);
    expect([a.status, b.status].sort()).toEqual([202, 409]);
    expect([a, b].find((r) => r.status === 409)!.body.error.code).toBe('operation_in_progress');
    expect(clxTokens()).toHaveLength(1);
  });

  it('an operation past its checks is finished even when its bootstrap token is gone', async () => {
    // The state a crash leaves after the checks: the operation at "probed", the token stored, and
    // the bootstrap token already deleted.
    const auth = await session(1);
    const edgeId = 'e1';
    await env.DB.batch([
      env.DB.prepare("INSERT INTO operations (id, user_id, kind, cf_account_id, state, step, data, created_at, updated_at) VALUES ('op1', 1, 'connect', ?, 'running', 'probed', ?, 0, 0)").bind(
        ACC,
        JSON.stringify({ token_id: 'tw', token_name: 'clx-op1', token_expires_at: Date.now() + 1e9, account_name: 'Test account' }),
      ),
      env.DB.prepare("INSERT INTO edge_accounts (id, user_id, cf_account_id, state, token_id, token_name, token_sealed, operation_id, created_at, updated_at) VALUES (?, 1, ?, 'bootstrap_lost', 'tw', 'clx-op1', ?, 'op1', 0, 0)").bind(
        edgeId,
        ACC,
        JSON.stringify(await seal(env.MASTER_KEYS, 'working-secret', `${edgeId}|${ACC}`)),
      ),
    ]);
    fakeCf.tokens.delete('boot');
    const r = await connectAs(auth, 'c3');
    expect(r.status).toBe(202);
    expect(r.body.account).toMatchObject({ state: 'installing', token: { name: 'clx-op1' } });
  });

  it('a stored refusal of POST /v1/keys replays as that refusal, not as "already issued"', async () => {
    const first = await call('POST', '/v1/keys', { auth: await session(2), body: { scopes: ['nope'] }, key: 'kk' });
    const again = await call('POST', '/v1/keys', { auth: await session(2), body: { scopes: ['nope'] }, key: 'kk' });
    expect(first.body.error.code).toBe('invalid_request');
    expect(again).toEqual(first);
  });

  it('reading accounts takes the accounts or sites scope', async () => {
    const { body } = await call('POST', '/v1/keys', { auth: await session(2), body: { scopes: ['reports'] }, key: 'kr' });
    expect((await call('GET', '/v1/accounts', { auth: `Bearer ${body.key}` })).body.error.code).toBe('scope_required');
  });

  it('a missing ciphertext is flagged as ours, never as a revocation', async () => {
    const { body } = await connectAs(await session(1));
    await env.DB.prepare('UPDATE edge_accounts SET token_sealed = NULL WHERE id = ?').bind(body.account.id).run();
    await env.DB.prepare('UPDATE edge_accounts SET token_checked_at = 0').run();
    expect((await checkTokens(env)).revoked).toBe(0);
    const a = (await call('GET', `/v1/accounts/${body.account.id}`, { auth: await session(1) })).body.account;
    expect(a).toMatchObject({ state: 'installing', error: { code: 'credentials_missing' } });
  });

  it('a pending connect left for an hour becomes bootstrap_lost, naming the possible orphan', async () => {
    fakeCf.failOnce.add('/workers/scripts');
    await connectAs(await session(1), 'c4');
    const r = await checkTokens(env, Date.now() + 2 * 3_600_000);
    expect(r.lost).toBe(1);
    const a = (await call('GET', '/v1/accounts', { auth: await session(1) })).body.accounts[0];
    expect(a).toMatchObject({ state: 'bootstrap_lost', error: { code: 'bootstrap_lost', possible_orphan: expect.stringMatching(/^clx-/u) } });
  });

  it('a token clx made but could not delete is named in the error, for the user to revoke', async () => {
    fakeCf.rejectWorking.add('/workers/scripts');
    const orig = fakeCf.tokens.set.bind(fakeCf.tokens);
    fakeCf.tokens.set = (k, v) => {
      if (v.name.startsWith('clx-')) fakeCf.stuck.add(k);
      return orig(k, v);
    };
    try {
      const r = await connectAs(await session(1), 'c5');
      expect(r.body.error).toMatchObject({ code: 'token_check_failed', details: { revoke_token: expect.stringMatching(/^clx-/u) } });
    } finally {
      fakeCf.tokens.set = orig;
    }
  });

  it('/v1 without its secrets answers in the /v1 error shape', async () => {
    const res = await app.request('https://clx.cx/v1/me', {}, { ...env, MASTER_KEYS: '' });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: { code: 'not_configured', message: expect.any(String) } });
  });
});

describe('review fixes, round 2', () => {
  it("an earlier operation's token on the second page of the list is still found and deleted", async () => {
    for (let i = 0; i < 60; i++) fakeCf.tokens.set(`u${i}`, { id: `u${i}`, name: `user-token-${i}`, value: `u${i}`.padEnd(40, 'u'), status: 'active', rights: [] });
    await env.DB.prepare("INSERT INTO operations (id, user_id, kind, cf_account_id, state, step, created_at, updated_at) VALUES ('oldop', 1, 'connect', ?, 'failed', 'failed', 0, 0)").bind(ACC).run();
    fakeCf.tokens.set('lost', { id: 'lost', name: 'clx-oldop', value: 'lost'.padEnd(40, 'l'), status: 'active', rights: [] });
    const r = await connectAs(await session(1), 'p1');
    expect(r.status).toBe(202);
    expect(fakeCf.tokens.has('lost')).toBe(false);
    expect(fakeCf.tokens.has('u59')).toBe(true);
  });

  it('a renewal resumed after its swap still deletes the token it replaced', async () => {
    const { body } = await connectAs(await session(1));
    const old = clxTokens()[0]!;
    // The state a crash leaves after the swap: the account already on the new token, the
    // operation at "probed" remembering the old one.
    fakeCf.tokens.set('tnew', { id: 'tnew', name: 'clx-renewop', value: 'tnew'.padEnd(40, 'n'), status: 'active', rights: [] });
    await env.DB.batch([
      env.DB.prepare("INSERT INTO operations (id, user_id, kind, cf_account_id, state, step, data, created_at, updated_at) VALUES ('renewop', 1, 'renew', ?, 'running', 'probed', ?, 0, 0)").bind(
        ACC,
        JSON.stringify({ old_token_id: old.id, old_token_name: old.name, token_id: 'tnew', token_name: 'clx-renewop', token_expires_at: Date.now() + 1e9 }),
      ),
      env.DB.prepare("UPDATE edge_accounts SET token_id = 'tnew', token_name = 'clx-renewop', operation_id = 'renewop' WHERE id = ?").bind(body.account.id),
    ]);
    fakeCf.tokens.set('boot3', { id: 'boot3', name: 'bootstrap', value: BOOT.replace('x', 'w'), status: 'active', rights: [] });
    const r = await call('POST', `/v1/accounts/${body.account.id}/token`, { auth: await session(1), body: { bootstrap_token: BOOT.replace('x', 'w') }, key: 'rr' });
    expect(r.status).toBe(200);
    expect(fakeCf.tokens.has(old.id)).toBe(false);
    expect(r.body.account.token.name).toBe('clx-renewop');
  });

  it("someone else's account is not revealed to a caller without a valid bootstrap token", async () => {
    await connectAs(await session(2));
    const r = await connectAs(await session(1), 'x1', { cf_account_id: ACC, bootstrap_token: 'z'.repeat(40) });
    expect(r.body.error.code).toBe('invalid_bootstrap');
  });
});

describe('review fixes, round 3', () => {
  it('an unreadable ciphertext is flagged and the check goes on to the next account', async () => {
    const { body } = await connectAs(await session(1));
    await env.DB.prepare('UPDATE edge_accounts SET token_sealed = ?, token_checked_at = 0 WHERE id = ?').bind(JSON.stringify({ key_id: 'gone', iv: 'AAAA', data: 'AAAA' }), body.account.id).run();
    expect((await checkTokens(env)).checked).toBe(1);
    const a = (await call('GET', `/v1/accounts/${body.account.id}`, { auth: await session(1) })).body.account;
    expect(a).toMatchObject({ state: 'installing', error: { code: 'credentials_unreadable' } });
  });

  it('every mutation is in the call log, with its answer', async () => {
    await connectAs(await session(1));
    const rows = (await env.DB.prepare('SELECT method, status FROM cf_calls ORDER BY id').all<{ method: string; status: number }>()).results;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.status >= 200)).toBe(true);
  });
});

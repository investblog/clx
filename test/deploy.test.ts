// Installing, updating and removing clx-edge (docs/spec.md §4) against the fake Cloudflare.
import fs from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EDGE_CODE, EDGE_SHA256 } from '../edge/bundle.gen';
import { SELF_CHECK_CRON, WORKING_CRON } from '../edge/contract';
import { SCHEMA } from '../edge/migrations';
import { signAccess } from '../src/auth/jwt';
import { checkTokens } from '../src/cf/connect';
import { runOperations } from '../src/cf/deploy';
import { app } from '../src/index';
import { sha256 } from '../src/lib/crypto';
import type { Env } from '../src/types';
import { fakeCtx, testEnv } from './env';
import { ACC, BOOT, fakeCf, useFakeCloudflare } from './fake-cf';

let env: Env;
let dispose: () => Promise<void>;
beforeAll(async () => ({ env, dispose } = await testEnv()));
afterAll(() => dispose());
useFakeCloudflare();

beforeEach(async () => {
  for (const t of ['cf_calls', 'edge_accounts', 'operations', 'idempotency', 'api_keys', 'users']) await env.DB.prepare(`DELETE FROM ${t}`).run();
  await env.DB.prepare("INSERT INTO users (id, email, password_hash, created_at, plan, admin) VALUES (1, 'free@example.com', 'x', 0, 'free', 1), (2, 'api@example.com', 'x', 0, 'api', 0)").run();
  fakeCf.reset();
});

let ip = 0;
let idem = 0;
async function call(method: string, path: string, opts: { auth?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { authorization: opts.auth ?? (await session(1)), 'cf-connecting-ip': `10.2.0.${++ip % 250}` };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['idempotency-key'] = `i${++idem}`;
  const { ctx, settle } = fakeCtx();
  const res = await app.request(`https://clx.cx${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }, env, ctx);
  await settle();
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}
const session = (user: number) => signAccess('test-jwt-secret', user, Date.now()).then((t) => `Bearer ${t}`);
const connect = () => call('POST', '/v1/accounts', { body: { cf_account_id: ACC, bootstrap_token: BOOT } });
const account = async (id: string) => (await call('GET', `/v1/accounts/${id}`)).body.account;
const edge = () => fakeCf.scripts.get('clx-edge');
const binding = (name: string) => edge()!.bindings.find((b) => b.name === name)?.text;

/** What the worker's self-check cron sends (edge/worker.ts). */
async function setupOk(over: Record<string, unknown> = {}, key = edge()!.secrets.get('EDGE_KEY')!) {
  const db = [...fakeCf.dbs.values()][0];
  const body = { deployment_id: binding('DEPLOYMENT_ID'), bundle: binding('BUNDLE'), schema: db?.schema ?? null, ...over };
  const res = await app.request('https://clx.cx/hook/setup', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }, env);
  return { status: res.status, body: await res.json() };
}

/** Move a waiting self-check past its deadline and let the cron find it. */
async function overdue() {
  const ops = (await env.DB.prepare("SELECT id, data FROM operations WHERE state = 'running'").all<{ id: string; data: string }>()).results;
  for (const op of ops) await env.DB.prepare('UPDATE operations SET data = ?, updated_at = 0 WHERE id = ?').bind(JSON.stringify({ ...JSON.parse(op.data), deadline: 1 }), op.id).run();
  return runOperations(env);
}

async function ready(): Promise<string> {
  const { body } = await connect();
  expect((await setupOk()).status).toBe(200);
  return body.account.id;
}

describe('the bundle', () => {
  it('edge/bundle.gen.ts is what edge/worker.ts builds to, and it is a released bundle', async () => {
    const { buildEdge } = (await import('../scripts/build-edge.mjs' as string)) as { buildEdge: () => Promise<{ sha256: string; file: string }> };
    const built = await buildEdge();
    expect(fs.readFileSync('edge/bundle.gen.ts', 'utf8')).toBe(built.file);
    expect(built.sha256).toBe(EDGE_SHA256);
    expect(JSON.parse(fs.readFileSync('edge/released.json', 'utf8'))).toContain(EDGE_SHA256);
  });
});

describe('install', () => {
  it('a connect goes on to the install: database, schema, worker with its key, the self-check cron', async () => {
    const { status, body } = await connect();
    expect(status).toBe(202);
    expect(body.account.state).toBe('installing');
    const [db] = [...fakeCf.dbs.entries()];
    expect(db![1]).toMatchObject({ name: 'clx-edge', schema: SCHEMA });
    expect(edge()!.code).toBe(EDGE_CODE);
    expect(edge()!.bindings.find((b) => b.name === 'DB')?.id).toBe(db![0]);
    expect(binding('BUNDLE')).toBe(EDGE_SHA256);
    expect(binding('HOOK_URL')).toBe(env.HOOK_URL);
    expect(edge()!.crons).toEqual([SELF_CHECK_CRON]);
    const row = (await env.DB.prepare('SELECT * FROM edge_accounts').first<Record<string, unknown>>())!;
    expect(row).toMatchObject({ d1_id: db![0], script_owned: 1, edge_key_hash: await sha256(edge()!.secrets.get('EDGE_KEY')!), deployment_id: binding('DEPLOYMENT_ID') });
    expect((await account(body.account.id)).operation).toMatchObject({ kind: 'install', state: 'running', step: 'selfcheck' });
  });

  it("setup_ok with this deployment, bundle and schema makes it ready with the working cron; it is single-use", async () => {
    const { body } = await connect();
    expect(await setupOk({ deployment_id: 'old' })).toMatchObject({ status: 409 });
    expect(await setupOk({ bundle: 'f'.repeat(64) })).toMatchObject({ status: 409 });
    expect(await setupOk({ schema: 0 })).toMatchObject({ status: 409 });
    expect(await setupOk({}, 'x'.repeat(40))).toMatchObject({ status: 401 });
    expect(await setupOk({ extra: 1 })).toMatchObject({ status: 400 });
    expect((await account(body.account.id)).state).toBe('installing');
    expect(await setupOk()).toMatchObject({ status: 200 });
    expect(edge()!.crons).toEqual([WORKING_CRON]);
    expect(await account(body.account.id)).toMatchObject({ state: 'ready', edge: { bundle: EDGE_SHA256, up_to_date: true, schema: SCHEMA }, operation: { state: 'done' } });
    expect(await setupOk()).toMatchObject({ status: 409 });
  });

  it('a setup_ok that arrives before the run recorded its step is "not yet" (503), not refused', async () => {
    const { body } = await connect();
    await env.DB.prepare("UPDATE operations SET step = 'uploaded' WHERE kind = 'install'").run();
    expect(await setupOk()).toMatchObject({ status: 503 });
    await env.DB.prepare("UPDATE operations SET step = 'selfcheck' WHERE kind = 'install'").run();
    expect(await setupOk()).toMatchObject({ status: 200 });
    expect((await account(body.account.id)).state).toBe('ready');
  });

  it('no setup_ok in time: the worker and database it created are deleted', async () => {
    const { body } = await connect();
    // Still within its deadline, it is not even picked up by the cron.
    await env.DB.prepare('UPDATE operations SET updated_at = 0').run();
    expect(await runOperations(env)).toBe(0);
    expect(await overdue()).toBe(1);
    expect(fakeCf.scripts.size).toBe(0);
    expect(fakeCf.dbs.size).toBe(0);
    const a = await account(body.account.id);
    expect(a).toMatchObject({ state: 'connected', error: { code: 'self_check_timeout' }, operation: { state: 'failed' } });
    const row = (await env.DB.prepare('SELECT script_owned, d1_id, edge_key_hash FROM edge_accounts').first())!;
    expect(row).toEqual({ script_owned: 0, d1_id: null, edge_key_hash: null });
  });

  it("a clx-edge worker clx did not put there is left alone: name_taken, nothing created", async () => {
    fakeCf.foreignScript('clx-edge', 'export default { fetch() { return new Response("mine"); } }');
    const { body } = await connect();
    expect(fakeCf.scripts.get('clx-edge')!.code).toContain('mine');
    expect(fakeCf.dbs.size).toBe(0);
    expect(await account(body.account.id)).toMatchObject({ state: 'connected', error: { code: 'name_taken', resource: 'worker' } });
  });

  it('a clx-edge database clx did not create is left alone too', async () => {
    fakeCf.dbs.set('theirs', { name: 'clx-edge', schema: 0, sql: [] });
    const { body } = await connect();
    expect(fakeCf.dbs.get('theirs')!.sql).toEqual([]);
    expect(fakeCf.scripts.size).toBe(0);
    expect(await account(body.account.id)).toMatchObject({ state: 'connected', error: { code: 'name_taken', resource: 'database' } });
  });

  it('all five cron triggers in use: cron_limit, naming who holds them', async () => {
    fakeCf.foreignScript('a', 'x', ['fetch', 'scheduled'], ['1 * * * *', '2 * * * *', '3 * * * *']);
    fakeCf.foreignScript('b', 'x', ['fetch', 'scheduled'], ['4 * * * *', '5 * * * *']);
    const { body } = await connect();
    expect(await account(body.account.id)).toMatchObject({ state: 'connected', error: { code: 'cron_limit', holders: [{ script: 'a', crons: 3 }, { script: 'b', crons: 2 }] } });
    expect(fakeCf.dbs.size).toBe(0);
  });

  it('a passing failure leaves the operation to the cron, which finishes it from its step', async () => {
    fakeCf.failOnce.add('/d1/database/db-');
    const { body } = await connect();
    expect((await account(body.account.id)).operation).toMatchObject({ state: 'running', step: 'd1' });
    await env.DB.prepare('UPDATE operations SET updated_at = 0').run();
    expect(await runOperations(env)).toBe(1);
    expect((await account(body.account.id)).operation).toMatchObject({ state: 'running', step: 'selfcheck' });
    expect(fakeCf.dbs.size).toBe(1);
    expect(await setupOk()).toMatchObject({ status: 200 });
  });

  it('a token that cannot be opened ends the operation with the reason, and the cron goes on', async () => {
    fakeCf.failOnce.add('/d1/database/db-');
    const { body } = await connect();
    await env.DB.prepare("UPDATE edge_accounts SET token_sealed = ?").bind(JSON.stringify({ key_id: 'gone', iv: 'AAAA', data: 'AAAA' })).run();
    await env.DB.prepare('UPDATE operations SET updated_at = 0').run();
    expect(await runOperations(env)).toBe(1);
    expect(await account(body.account.id)).toMatchObject({ state: 'connected', error: { code: 'credentials_unreadable' }, operation: { state: 'failed' } });
  });

  it('a renewal waits for an install in its self-check instead of taking its place', async () => {
    const { body } = await connect();
    fakeCf.tokens.set('boot2', { id: 'boot2', name: 'bootstrap', value: BOOT.replace('x', 'y'), status: 'active', rights: [] });
    const r = await call('POST', `/v1/accounts/${body.account.id}/token`, { body: { bootstrap_token: BOOT.replace('x', 'y') } });
    expect(r.body.error.code).toBe('operation_in_progress');
    expect(await setupOk()).toMatchObject({ status: 200 });
    expect((await account(body.account.id)).state).toBe('ready');
  });

  it('a worker that appears before a resumed upload is not overwritten, nor deleted by the undo', async () => {
    fakeCf.failOnce.add(`/accounts/${ACC}/workers/scripts/clx-edge`);
    const { body } = await connect();
    expect((await account(body.account.id)).operation).toMatchObject({ state: 'running', step: 'uploading' });
    fakeCf.foreignScript('clx-edge', 'export default { fetch() { return new Response("theirs"); } }');
    await env.DB.prepare('UPDATE operations SET updated_at = 0').run();
    await runOperations(env);
    expect(fakeCf.scripts.get('clx-edge')!.code).toContain('theirs');
    expect(fakeCf.dbs.size).toBe(0);
    expect(await account(body.account.id)).toMatchObject({ state: 'connected', error: { code: 'name_taken', step: 'uploading' } });
    expect(await env.DB.prepare('SELECT script_owned FROM edge_accounts').first('script_owned')).toBe(0);
  });

  it('an upload Cloudflare refuses is undone without deleting anything it did not make', async () => {
    fakeCf.refuse.add(`PUT /accounts/${ACC}/workers/scripts/clx-edge`);
    const { body } = await connect();
    expect(fakeCf.scripts.size).toBe(0);
    expect(fakeCf.dbs.size).toBe(0);
    expect(await account(body.account.id)).toMatchObject({ state: 'connected', error: { code: 'cloudflare_error', step: 'uploading' } });
  });

  it('a 403 on an install step is permission_error; what was made is undone', async () => {
    fakeCf.denyWorking.add('/workers/scripts/clx-edge');
    const { body } = await connect();
    expect(await account(body.account.id)).toMatchObject({ state: 'permission_error', error: { code: 'permission_error', step: 'uploading' } });
    expect(fakeCf.dbs.size).toBe(0);
  });

  it('a reinstall keeps the database, puts a new key, and accepts the old one for a day', async () => {
    const id = await ready();
    const oldKey = edge()!.secrets.get('EDGE_KEY')!;
    const dbs = [...fakeCf.dbs.keys()];
    const r = await call('POST', `/v1/accounts/${id}/install`);
    expect(r.status).toBe(202);
    expect([...fakeCf.dbs.keys()]).toEqual(dbs);
    const newKey = edge()!.secrets.get('EDGE_KEY')!;
    expect(newKey).not.toBe(oldKey);
    expect(await env.DB.prepare('SELECT edge_key_prev_hash FROM edge_accounts').first('edge_key_prev_hash')).toBe(await sha256(oldKey));
    expect(await setupOk({}, oldKey)).toMatchObject({ status: 200 });
    expect((await account(id)).state).toBe('ready');
  });

  it('install and the token check: a ready account is still checked', async () => {
    await ready();
    expect(await checkTokens(env, Date.now() + 21 * 3_600_000)).toMatchObject({ checked: 1, revoked: 0 });
  });
});

describe('update (rollout)', () => {
  it('admin only; dry_run lists; an update keeps the key and needs a setup_ok', async () => {
    const id = await ready();
    expect((await call('POST', '/admin/edge/rollout', { auth: await session(2), body: { force: true } })).status).toBe(404);
    expect((await call('GET', '/admin/edge/bundle-info')).body).toMatchObject({ sha256: EDGE_SHA256, schema: SCHEMA });
    expect((await call('POST', '/admin/edge/rollout', { body: {} })).body.accounts).toEqual([]);
    expect((await call('POST', '/admin/edge/rollout', { body: { force: true, dry_run: true } })).body.accounts).toEqual([{ id, from: EDGE_SHA256 }]);
    const key = edge()!.secrets.get('EDGE_KEY')!;
    const before = edge()!.live;
    const r = await call('POST', '/admin/edge/rollout', { body: { force: true } });
    expect(r.status).toBe(202);
    expect(edge()!.live).not.toBe(before);
    expect(edge()!.secrets.get('EDGE_KEY')).toBe(key);
    expect(edge()!.crons).toEqual([SELF_CHECK_CRON]);
    expect(await setupOk({}, key)).toMatchObject({ status: 200 });
    expect(await account(id)).toMatchObject({ state: 'ready', operation: { kind: 'update', state: 'done' } });
    expect(edge()!.crons).toEqual([WORKING_CRON]);
  });

  it('a failed update returns to the previous version and the working cron', async () => {
    const id = await ready();
    const before = edge()!.live;
    await call('POST', '/admin/edge/rollout', { body: { force: true } });
    expect(edge()!.live).not.toBe(before);
    await overdue();
    expect(edge()!.live).toBe(before);
    expect(edge()!.crons).toEqual([WORKING_CRON]);
    expect(await account(id)).toMatchObject({ state: 'ready', error: { code: 'self_check_timeout' }, operation: { kind: 'update', state: 'failed' } });
  });

  it('a return that Cloudflare refuses claims no bundle: the account asks for a reinstall', async () => {
    const id = await ready();
    await call('POST', '/admin/edge/rollout', { body: { force: true } });
    fakeCf.refuse.add(`POST /accounts/${ACC}/workers/scripts/clx-edge/deployments`);
    await overdue();
    expect(await account(id)).toMatchObject({ state: 'connected', edge: null, error: { code: 'self_check_timeout', warnings: expect.arrayContaining(['worker_version_not_undone', 'serving_unknown']) } });
  });

  it('a return whose working cron is refused is not ready either', async () => {
    const id = await ready();
    await call('POST', '/admin/edge/rollout', { body: { force: true } });
    fakeCf.refuse.add(`PUT /accounts/${ACC}/workers/scripts/clx-edge/schedules`);
    await overdue();
    expect(await account(id)).toMatchObject({ state: 'connected', edge: null, error: { warnings: expect.arrayContaining(['cron_not_undone', 'serving_unknown']) } });
  });

  it('a worker changed outside clx is resource_drift: not replaced, not deleted', async () => {
    const id = await ready();
    edge()!.code = 'export default { fetch() { return new Response("edited"); } }';
    await call('POST', '/admin/edge/rollout', { body: { force: true } });
    expect(edge()!.code).toContain('edited');
    expect(await account(id)).toMatchObject({ state: 'resource_drift', error: { code: 'resource_drift', resource: 'worker' } });
    const gone = await call('DELETE', `/v1/accounts/${id}`);
    expect(gone.body.left).toEqual(['worker clx-edge (changed outside clx)']);
    expect(fakeCf.scripts.has('clx-edge')).toBe(true);
    expect(fakeCf.dbs.size).toBe(0);
  });
});

describe('disconnect', () => {
  it('deletes the recorded worker and database, then the record; the working token is named', async () => {
    fakeCf.foreignScript('theirs');
    const id = await ready();
    const r = await call('DELETE', `/v1/accounts/${id}`);
    expect(r.body).toMatchObject({ ok: true, left: [], revoke_token: expect.stringMatching(/^clx-/u) });
    expect([...fakeCf.scripts.keys()]).toEqual(['theirs']);
    expect(fakeCf.dbs.size).toBe(0);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM edge_accounts').first('n')).toBe(0);
  });

  it('during a self-check: the install is superseded and does not come back', async () => {
    const { body } = await connect();
    await call('DELETE', `/v1/accounts/${body.account.id}`);
    expect(fakeCf.scripts.size).toBe(0);
    await overdue();
    expect(fakeCf.scripts.size).toBe(0);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM operations WHERE state = 'running'").first('n')).toBe(0);
  });
});

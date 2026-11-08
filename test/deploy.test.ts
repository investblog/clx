// Installing, updating and removing clx-edge (docs/spec.md §4) against the fake Cloudflare.
import fs from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EDGE_CODE, EDGE_SHA256 } from '../edge/bundle.gen';
import { SELF_CHECK_CRON, WORKING_CRON } from '../edge/contract';
import { SCHEMA } from '../edge/migrations';
import { signAccess } from '../src/auth/jwt';
import { checkTokens, type EdgeAccount } from '../src/cf/connect';
import { confirmSetup, runDeploy, runOperations } from '../src/cf/deploy';
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
  await env.DB.prepare("INSERT INTO users (id, email, password_hash, created_at, email_confirmed_at, plan, admin) VALUES (1, 'free@example.com', 'x', 0, 0, 'free', 1), (2, 'api@example.com', 'x', 0, 0, 'api', 0)").run();
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
  const db = edge()!.bindings.find((b) => b.name === 'DB')?.id;
  const body = { deployment_id: binding('DEPLOYMENT_ID'), bundle: binding('BUNDLE'), schema: db ? fakeCf.schemaOf(db) : null, ...over };
  const res = await app.request('https://clx.cx/hook/setup', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }, env);
  return { status: res.status, body: await res.json() };
}

/** Move a waiting self-check past its deadline and let the cron find it. */
async function overdue() {
  const ops = (await env.DB.prepare("SELECT id, data FROM operations WHERE state = 'running'").all<{ id: string; data: string }>()).results;
  for (const op of ops) await env.DB.prepare('UPDATE operations SET data = ?, updated_at = 0 WHERE id = ?').bind(JSON.stringify({ ...JSON.parse(op.data), deadline: 1 }), op.id).run();
  return runOperations(env);
}

/** A rollout as an admin starts it, then the cron's next run, which takes its operations up. */
async function rollout(body: Record<string, unknown> = { force: true }) {
  const r = await call('POST', '/admin/edge/rollout', { body });
  await runOperations(env, Date.now() + 61_000);
  return r;
}

/** The database with runDeploy's first read of the operation stale, as a run that read it before
 *  another moved it on would see it; every other statement is the real one. */
function staleRead(db: D1Database, over: Record<string, unknown>): D1Database {
  let used = false;
  return new Proxy(db, {
    get(target, prop) {
      if (prop !== 'prepare') return Reflect.get(target, prop, target);
      return (sql: string) => {
        const real = target.prepare(sql);
        if (used || sql !== 'SELECT * FROM operations WHERE id = ?') return real;
        used = true;
        return { bind: (...args: unknown[]) => ({ first: async () => ({ ...(await real.bind(...args).first<Record<string, unknown>>()), ...over }) }) };
      };
    },
  });
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
  it('a connect goes on to the install: database, schema, worker with its key, the self-check and working crons', async () => {
    const { status, body } = await connect();
    expect(status).toBe(202);
    expect(body.account.state).toBe('installing');
    const [db] = [...fakeCf.dbs.entries()];
    expect(db![1].name).toBe('clx-edge');
    expect(fakeCf.schemaOf(db![0])).toBe(SCHEMA);
    expect(edge()!.code).toBe(EDGE_CODE);
    expect(edge()!.bindings.find((b) => b.name === 'DB')?.id).toBe(db![0]);
    expect(binding('BUNDLE')).toBe(EDGE_SHA256);
    expect(binding('HOOK_URL')).toBe(env.HOOK_URL);
    expect(edge()!.crons).toEqual([SELF_CHECK_CRON, WORKING_CRON]);
    const row = (await env.DB.prepare('SELECT * FROM edge_accounts').first<Record<string, unknown>>())!;
    expect(row).toMatchObject({ d1_id: db![0], script_owned: 1, edge_key_hash: await sha256(edge()!.secrets.get('EDGE_KEY')!), deployment_id: binding('DEPLOYMENT_ID') });
    expect((await account(body.account.id)).operation).toMatchObject({ kind: 'install', state: 'running', step: 'selfcheck' });
  });

  it('an account whose Workers pages were never opened gets a workers.dev subdomain, and the install goes on', async () => {
    fakeCf.subdomain = null;
    fakeCf.subdomainTaken = 2; // the first two names are someone else's: the third attempt makes it
    const { body } = await connect();
    expect(fakeCf.subdomain).toMatch(/^[a-z][a-z0-9]{10}$/u);
    expect(edge()!.crons).toEqual([SELF_CHECK_CRON, WORKING_CRON]);
    expect(await account(body.account.id)).toMatchObject({ state: 'ready', operation: { kind: 'install', state: 'running', step: 'selfcheck' } });
    const op = (await env.DB.prepare("SELECT data FROM operations WHERE kind = 'install'").first<{ data: string }>())!;
    expect(JSON.parse(op.data).subdomain_created).toBe(fakeCf.subdomain);
  });

  it('a subdomain someone made meanwhile (10036) is taken as it is: the install goes on, nothing recorded', async () => {
    fakeCf.subdomain = null;
    fakeCf.subdomainRace = true;
    const { body } = await connect();
    expect(fakeCf.subdomain).toBe('theirs');
    expect(edge()!.crons).toEqual([SELF_CHECK_CRON, WORKING_CRON]);
    expect((await account(body.account.id)).state).toBe('ready');
    const op = (await env.DB.prepare("SELECT data FROM operations WHERE kind = 'install'").first<{ data: string }>())!;
    expect(JSON.parse(op.data).subdomain_created).toBeUndefined();
  });

  it('a subdomain that cannot be made stops the install as before, and nothing is left', async () => {
    fakeCf.subdomain = null;
    fakeCf.subdomainTaken = 3; // three attempts, all taken
    const { body } = await connect();
    expect(fakeCf.subdomain).toBeNull();
    expect(fakeCf.scripts.has('clx-edge')).toBe(false);
    expect(await account(body.account.id)).toMatchObject({ operation: { kind: 'install', state: 'failed' } });
  });

  it('an install a missing subdomain stopped can be tried again without a new token; another permission_error cannot', async () => {
    const id = await ready();
    const stopped = (codes: number[]) =>
      env.DB.prepare("UPDATE edge_accounts SET state = 'permission_error', bundle = NULL, error = ?").bind(JSON.stringify({ code: 'permission_error', path: `/accounts/${ACC}/workers/scripts/clx-edge/schedules`, status: 403, codes })).run();
    await stopped([9109]);
    expect((await call('POST', `/v1/accounts/${id}/install`)).body.error.code).toBe('account_not_ready');
    // As a clx without the subdomain step left the user's account (12.10.2026).
    await stopped([10063]);
    const again = await call('POST', `/v1/accounts/${id}/install`);
    expect(again.body.error).toBeUndefined();
    expect(edge()!.crons).toEqual([SELF_CHECK_CRON, WORKING_CRON]);
    expect(await account(id)).toMatchObject({ state: 'ready' });
    // An update still waits for a working token.
    expect(await setupOk()).toMatchObject({ status: 200 });
    await env.DB.prepare("UPDATE edge_accounts SET state = 'permission_error'").run();
    await rollout();
    expect((await account(id)).state).toBe('permission_error');
    expect(await env.DB.prepare("SELECT count(*) AS n FROM operations WHERE kind = 'update'").first<number>('n')).toBe(0);
  });

  it("setup_ok with this deployment, bundle and schema makes it ready with the working cron; it is single-use", async () => {
    const { body } = await connect();
    expect(await setupOk({ deployment_id: 'old' })).toMatchObject({ status: 409 });
    expect(await setupOk({ bundle: 'f'.repeat(64) })).toMatchObject({ status: 409 });
    expect(await setupOk({ schema: 0 })).toMatchObject({ status: 409 });
    expect(await setupOk({}, 'x'.repeat(40))).toMatchObject({ status: 401 });
    expect(await setupOk({ extra: 1 })).toMatchObject({ status: 400 });
    // In service already, still waiting for its confirmation.
    expect(await account(body.account.id)).toMatchObject({ state: 'ready', operation: { state: 'running', step: 'selfcheck' } });
    expect(edge()!.crons).toEqual([SELF_CHECK_CRON, WORKING_CRON]);
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

  it('no setup_ok in time: the install stays, with the working cron and a not_confirmed warning', async () => {
    const { body } = await connect();
    // Still within its deadline, it is not even picked up by the cron.
    await env.DB.prepare('UPDATE operations SET updated_at = 0').run();
    expect(await runOperations(env)).toBe(0);
    expect(await overdue()).toBe(1);
    expect(fakeCf.scripts.has('clx-edge')).toBe(true);
    expect(fakeCf.dbs.size).toBe(1);
    expect(edge()!.crons).toEqual([WORKING_CRON]);
    expect(await account(body.account.id)).toMatchObject({ state: 'ready', edge: { bundle: EDGE_SHA256 }, error: { warnings: ['not_confirmed'] }, operation: { state: 'done', step: 'unconfirmed' } });
    // A late report changes nothing.
    expect(await setupOk()).toMatchObject({ status: 409 });
  });

  it("a clx-edge worker clx did not put there is left alone: name_taken, nothing created", async () => {
    fakeCf.foreignScript('clx-edge', 'export default { fetch() { return new Response("mine"); } }');
    const { body } = await connect();
    expect(fakeCf.scripts.get('clx-edge')!.code).toContain('mine');
    expect(fakeCf.dbs.size).toBe(0);
    expect(await account(body.account.id)).toMatchObject({ state: 'connected', error: { code: 'name_taken', resource: 'worker' } });
  });

  it('a clx-edge database clx did not create is left alone too', async () => {
    fakeCf.foreignDb('theirs', 'clx-edge');
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

  it('one cron trigger left: the install sets the self-check alone, and the working cron on confirmation', async () => {
    fakeCf.foreignScript('a', 'x', ['fetch', 'scheduled'], ['1 * * * *', '2 * * * *', '3 * * * *', '4 * * * *']);
    const { body } = await connect();
    expect(edge()!.crons).toEqual([SELF_CHECK_CRON]);
    expect(await setupOk()).toMatchObject({ status: 200 });
    expect(edge()!.crons).toEqual([WORKING_CRON]);
    expect((await account(body.account.id)).state).toBe('ready');
  });

  it('crons that appear after the start are counted right before the cron triggers are set', async () => {
    fakeCf.failOnce.add(`/accounts/${ACC}/workers/scripts/clx-edge`);
    const { body } = await connect();
    expect((await account(body.account.id)).operation).toMatchObject({ state: 'running', step: 'uploading' });
    fakeCf.foreignScript('a', 'x', ['fetch', 'scheduled'], ['1 * * * *', '2 * * * *', '3 * * * *', '4 * * * *']);
    await env.DB.prepare('UPDATE operations SET updated_at = 0').run();
    await runOperations(env);
    expect(edge()!.crons).toEqual([SELF_CHECK_CRON]);
  });

  it('all cron triggers taken while the install runs: cron_limit before the crons, the worker undone', async () => {
    fakeCf.failOnce.add(`/accounts/${ACC}/workers/scripts/clx-edge`);
    const { body } = await connect();
    fakeCf.foreignScript('a', 'x', ['fetch', 'scheduled'], ['1 * * * *', '2 * * * *', '3 * * * *', '4 * * * *', '5 * * * *']);
    await env.DB.prepare('UPDATE operations SET updated_at = 0').run();
    await runOperations(env);
    expect(fakeCf.scripts.has('clx-edge')).toBe(false);
    expect(await account(body.account.id)).toMatchObject({ state: 'connected', error: { code: 'cron_limit', step: 'uploaded', holders: [{ script: 'a', crons: 5 }] } });
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

  it('a new script that reads as absent right after its upload does not stop the install', async () => {
    fakeCf.lagReads = 1; // as on a user's account, 13.10.2026: GET …/deployments answered 404 10007
    const { body } = await connect();
    expect(await account(body.account.id)).toMatchObject({ state: 'ready', operation: { kind: 'install', state: 'running', step: 'selfcheck' } });
    expect(await setupOk()).toMatchObject({ status: 200 });
  });

  it('an undo right after the upload does not believe the script is gone: it stays marked, and a reinstall takes it', async () => {
    fakeCf.lagReads = 2; // the version read and the undo's read both miss it
    fakeCf.refuse.add(`PUT /accounts/${ACC}/workers/scripts/clx-edge/schedules`);
    const { body } = await connect();
    expect(fakeCf.scripts.has('clx-edge')).toBe(true);
    expect(await account(body.account.id)).toMatchObject({ state: 'connected', error: { code: 'cloudflare_error', step: 'uploaded', warnings: ['worker_not_undone'] } });
    expect(await env.DB.prepare('SELECT script_owned FROM edge_accounts').first('script_owned')).toBe(1);
    fakeCf.refuse.clear();
    expect((await call('POST', `/v1/accounts/${body.account.id}/install`)).status).toBe(202);
    expect(await setupOk()).toMatchObject({ status: 200 });
    expect((await account(body.account.id)).state).toBe('ready');
  });

  it('an unmarked clx bundle an earlier install of clx made here is taken back; without that record it is name_taken', async () => {
    const id = await ready();
    // As the undo before this fix left a user's account (13.10.2026): the script there, the mark gone.
    await env.DB.prepare('UPDATE edge_accounts SET script_owned = 0, bundle = NULL, state = ?').bind('connected').run();
    const done = await env.DB.prepare('SELECT data FROM operations WHERE kind = ?').bind('install').first<string>('data');
    await env.DB.prepare("UPDATE operations SET data = json_remove(data, '$.script_created') WHERE kind = 'install'").run();
    await call('POST', `/v1/accounts/${id}/install`);
    expect(await account(id)).toMatchObject({ state: 'connected', error: { code: 'name_taken', resource: 'worker' } });
    expect(edge()!.code).toBe(EDGE_CODE);
    await env.DB.prepare("UPDATE operations SET data = ? WHERE kind = 'install'").bind(done).run();
    expect((await call('POST', `/v1/accounts/${id}/install`)).status).toBe(202);
    expect(await setupOk()).toMatchObject({ status: 200 });
    expect(await account(id)).toMatchObject({ state: 'ready' });
    expect(await env.DB.prepare('SELECT script_owned FROM edge_accounts').first('script_owned')).toBe(1);
  });

  it('an install whose upload was refused proves nothing: a clx bundle that appears later is name_taken', async () => {
    fakeCf.refuse.add(`PUT /accounts/${ACC}/workers/scripts/clx-edge`);
    const { body } = await connect();
    fakeCf.refuse.clear();
    fakeCf.foreignScript('clx-edge', EDGE_CODE, ['fetch', 'scheduled']);
    await call('POST', `/v1/accounts/${body.account.id}/install`);
    expect(await account(body.account.id)).toMatchObject({ state: 'connected', error: { code: 'name_taken', resource: 'worker' } });
    expect(edge()!.versions).toEqual(['vx']);
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
    const r = await rollout();
    expect(r.status).toBe(202);
    expect(edge()!.live).not.toBe(before);
    expect(edge()!.secrets.get('EDGE_KEY')).toBe(key);
    expect(edge()!.crons).toEqual([SELF_CHECK_CRON, WORKING_CRON]);
    expect(await setupOk({}, key)).toMatchObject({ status: 200 });
    expect(await account(id)).toMatchObject({ state: 'ready', operation: { kind: 'update', state: 'done' } });
    expect(edge()!.crons).toEqual([WORKING_CRON]);
  });

  it('the rollout only starts the updates: the per-minute cron runs them, at most ten a run', async () => {
    const id = await ready();
    const before = edge()!.live;
    const r = await call('POST', '/admin/edge/rollout', { body: { force: true } });
    expect(r.status).toBe(202);
    expect(edge()!.live).toBe(before);
    expect(await account(id)).toMatchObject({ operation: { kind: 'update', state: 'running', step: 'reserved' } });
    // The cron leaves an operation started less than a minute ago, then takes it up.
    expect(await runOperations(env)).toBe(0);
    expect(await runOperations(env, Date.now() + 61_000)).toBe(1);
    expect(edge()!.live).not.toBe(before);
    expect(await account(id)).toMatchObject({ operation: { kind: 'update', state: 'running', step: 'selfcheck' } });
    // Twelve waiting operations: ten are run (these, of no account, only end superseded).
    for (let i = 0; i < 12; i++)
      await env.DB.prepare("INSERT INTO operations (id, user_id, kind, cf_account_id, state, step, data, created_at, updated_at) VALUES (?, 1, 'update', ?, 'running', 'reserved', '{}', 0, 0)").bind(`waiting-${i}`, `none-${i}`).run();
    expect(await runOperations(env)).toBe(10);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM operations WHERE id LIKE 'waiting-%' AND state = 'running'").first<number>('n')).toBe(2);
  });

  it('a passing failure is kept in the operation: its step and what threw', async () => {
    await ready();
    fakeCf.failOnce.add(`/accounts/${ACC}/workers/scripts/clx-edge/schedules`);
    await rollout();
    const op = (await env.DB.prepare("SELECT state, step, data FROM operations WHERE kind = 'update'").first<{ state: string; step: string; data: string }>())!;
    expect(op).toMatchObject({ state: 'running', step: 'uploaded' });
    const data = JSON.parse(op.data) as { attempts: number; last_error: { step: string; message: string; at: number } };
    expect(data.attempts).toBe(1);
    expect(data.last_error).toMatchObject({ step: 'uploaded', message: expect.stringContaining('/schedules → 503') });
    expect(data.last_error.at).toBeGreaterThan(Date.now() - 60_000);
    // The next run goes on from that step.
    expect(await runOperations(env, Date.now() + 61_000)).toBe(1);
    expect((await env.DB.prepare("SELECT step FROM operations WHERE kind = 'update'").first<{ step: string }>())!.step).toBe('selfcheck');
  });

  it('an update with no room for a second cron keeps to the self-check alone until confirmed', async () => {
    await ready();
    fakeCf.foreignScript('a', 'x', ['fetch', 'scheduled'], ['1 * * * *', '2 * * * *', '3 * * * *', '4 * * * *']);
    await rollout();
    expect(edge()!.crons).toEqual([SELF_CHECK_CRON]);
    expect(await setupOk()).toMatchObject({ status: 200 });
    expect(edge()!.crons).toEqual([WORKING_CRON]);
  });

  it('a failed update returns to the previous version and the working cron', async () => {
    const id = await ready();
    const before = edge()!.live;
    await rollout();
    expect(edge()!.live).not.toBe(before);
    await overdue();
    expect(edge()!.live).toBe(before);
    expect(edge()!.crons).toEqual([WORKING_CRON]);
    expect(await account(id)).toMatchObject({ state: 'ready', error: { code: 'self_check_timeout' }, operation: { kind: 'update', state: 'failed' } });
  });

  it('a run that read the operation before another advanced it does not fail the update just in its self-check', async () => {
    const id = await ready();
    await rollout();
    const updated = edge()!.live;
    const opId = (await env.DB.prepare("SELECT id FROM operations WHERE kind = 'update' AND state = 'running'").first<{ id: string }>())!.id;
    // As a second run saw it before the first reached the self-check (rollout 06.11).
    await runDeploy({ ...env, DB: staleRead(env.DB, { step: 'uploaded' }) }, opId);
    expect(edge()!.live).toBe(updated);
    expect(await account(id)).toMatchObject({ operation: { kind: 'update', state: 'running', step: 'selfcheck' } });
    expect(await setupOk()).toMatchObject({ status: 200 });
    expect(await account(id)).toMatchObject({ state: 'ready', edge: { bundle: EDGE_SHA256 }, operation: { kind: 'update', state: 'done' } });
  });

  it('nor undo an update a setup_ok ended while it waited for the lease', async () => {
    const id = await ready();
    await rollout();
    const updated = edge()!.live;
    const opId = (await env.DB.prepare("SELECT id FROM operations WHERE kind = 'update' AND state = 'running'").first<{ id: string }>())!.id;
    expect(await setupOk()).toMatchObject({ status: 200 });
    await runDeploy({ ...env, DB: staleRead(env.DB, { state: 'running', step: 'uploaded' }) }, opId);
    expect(edge()!.live).toBe(updated);
    expect(edge()!.crons).toEqual([WORKING_CRON]);
    expect(await account(id)).toMatchObject({ state: 'ready', error: null, operation: { kind: 'update', state: 'done' } });
  });

  describe('a run whose lease ran out during a slow call changes nothing in Cloudflare after it', () => {
    const script = (path: string) => path.endsWith('/workers/scripts/clx-edge');
    /** An update whose run meets `steal` on some call: another run takes the account there, and
     *  every change this run still sends to Cloudflare after that is listed. */
    async function stolen(steal: (method: string, path: string) => Promise<Response | void | 'steal'>) {
      const id = await ready();
      const before = edge()!.live;
      const after: string[] = [];
      let taken = false;
      fakeCf.onCall = async (method, path) => {
        if (taken) {
          if (method !== 'GET') after.push(`${method} ${path}`);
          return;
        }
        const r = await steal(method, path);
        if (r === undefined) return;
        taken = true;
        await env.DB.prepare("UPDATE edge_accounts SET lease_owner = 'another-run', lease_until = ?").bind(Date.now() + 120_000).run();
        return r === 'steal' ? undefined : r;
      };
      await rollout();
      const op = (await env.DB.prepare("SELECT state, step, data FROM operations WHERE kind = 'update'").first<{ state: string; step: string; data: string }>())!;
      const owner = (await env.DB.prepare('SELECT lease_owner FROM edge_accounts WHERE id = ?').bind(id).first<{ lease_owner: string }>())!.lease_owner;
      return { taken, after, op: { ...op, data: JSON.parse(op.data) }, before, owner };
    }
    const answer = (status: number) => Response.json({ success: false, result: null, errors: [{ code: 1000, message: `fake ${status}` }] }, { status });

    it('a slow read before the upload: no upload follows', async () => {
      const r = await stolen(async (method, path) => {
        const step = (await env.DB.prepare("SELECT step FROM operations WHERE kind = 'update' AND state = 'running'").first<{ step: string }>())?.step;
        return method === 'GET' && script(path) && step === 'uploading' ? 'steal' : undefined;
      });
      expect(r.taken).toBe(true);
      expect(r.after).toEqual([]);
      expect(edge()!.live).toBe(r.before);
      expect(r.op).toMatchObject({ state: 'running', step: 'uploading' });
      expect(r.owner).toBe('another-run');
    });

    for (const status of [503, 400])
      it(`a slow upload that ends in ${status}: no retry written, no undo`, async () => {
        const r = await stolen(async (method, path) => (method === 'PUT' && script(path) ? answer(status) : undefined));
        expect(r.after).toEqual([]);
        expect(edge()!.live).toBe(r.before);
        expect(r.op.state).toBe('running');
        expect(r.op.data.attempts).toBeUndefined();
        expect(r.owner).toBe('another-run');
      });

    it('a change cut off has an unknown outcome: the run keeps the lease to run out, so no run follows at once', async () => {
      const id = await ready();
      fakeCf.onCall = async (method, path) => {
        if (method === 'PUT' && script(path)) throw new Error('The operation was aborted due to timeout');
      };
      await rollout();
      const row = (await env.DB.prepare('SELECT lease_owner, lease_until FROM edge_accounts WHERE id = ?').bind(id).first<{ lease_owner: string | null; lease_until: number | null }>())!;
      expect(row.lease_owner).not.toBeNull();
      expect(row.lease_until).toBeGreaterThan(Date.now() + 60_000);
      const op = (await env.DB.prepare("SELECT state, data FROM operations WHERE kind = 'update'").first<{ state: string; data: string }>())!;
      expect(op.state).toBe('running');
      expect(JSON.parse(op.data).attempts).toBe(1);
    });

    it("so does one cut off inside the undo, which carries on past it", async () => {
      const id = await ready();
      fakeCf.onCall = async (method, path) => {
        if (method === 'PUT' && script(path)) return answer(400);
        if (method === 'POST' && path.endsWith('/workers/scripts/clx-edge/deployments')) throw new Error('The operation was aborted due to timeout');
      };
      await rollout();
      const op = (await env.DB.prepare("SELECT state, data FROM operations WHERE kind = 'update'").first<{ state: string; data: string }>())!;
      expect(op.state).toBe('failed');
      expect(JSON.parse(op.data).warnings).toContain('worker_version_not_undone');
      const row = (await env.DB.prepare('SELECT lease_owner, lease_until FROM edge_accounts WHERE id = ?').bind(id).first<{ lease_owner: string | null; lease_until: number | null }>())!;
      expect(row.lease_owner).not.toBeNull();
      expect(row.lease_until).toBeGreaterThan(Date.now() + 60_000);
    });

    it("a slow read in the undo: the previous version is not put back over the newer run's", async () => {
      let refused = false;
      const r = await stolen(async (method, path) => {
        if (method === 'PUT' && script(path) && !refused) {
          refused = true;
          return answer(400);
        }
        return refused && method === 'GET' && script(path) ? 'steal' : undefined;
      });
      expect(r.taken).toBe(true);
      expect(r.after).toEqual([]);
      expect(r.op.state).toBe('running');
    });
  });

  it("a setup_ok read before the lease is checked again under it: a late one takes nothing from the next update", async () => {
    const id = await ready();
    await rollout();
    const stale = (await env.DB.prepare('SELECT * FROM edge_accounts WHERE id = ?').bind(id).first<EdgeAccount>())!;
    const db = edge()!.bindings.find((b) => b.name === 'DB')?.id;
    const late = { deployment_id: binding('DEPLOYMENT_ID')!, bundle: binding('BUNDLE')!, schema: db ? fakeCf.schemaOf(db) : null };
    // That update times out and the next one starts before the late report is handled.
    await overdue();
    await rollout();
    expect(edge()!.crons).toEqual([SELF_CHECK_CRON, WORKING_CRON]);
    // As the hook read the account and the operation before the lease.
    expect(await confirmSetup({ ...env, DB: staleRead(env.DB, { state: 'running', step: 'selfcheck' }) }, stale, late)).toBe('mismatch');
    expect(edge()!.crons).toEqual([SELF_CHECK_CRON, WORKING_CRON]);
    expect(await account(id)).toMatchObject({ operation: { kind: 'update', state: 'running', step: 'selfcheck' } });
    expect(await setupOk()).toMatchObject({ status: 200 });
  });

  it('a return that Cloudflare refuses claims no bundle: the account asks for a reinstall', async () => {
    const id = await ready();
    await rollout();
    fakeCf.refuse.add(`POST /accounts/${ACC}/workers/scripts/clx-edge/deployments`);
    await overdue();
    expect(await account(id)).toMatchObject({ state: 'connected', edge: null, error: { code: 'self_check_timeout', warnings: expect.arrayContaining(['worker_version_not_undone', 'serving_unknown']) } });
  });

  it('a return whose working cron is refused is not ready either', async () => {
    const id = await ready();
    await rollout();
    fakeCf.refuse.add(`PUT /accounts/${ACC}/workers/scripts/clx-edge/schedules`);
    await overdue();
    expect(await account(id)).toMatchObject({ state: 'connected', edge: null, error: { warnings: expect.arrayContaining(['cron_not_undone', 'serving_unknown']) } });
  });

  it('a worker changed outside clx is resource_drift: not replaced, not deleted', async () => {
    const id = await ready();
    edge()!.code = 'export default { fetch() { return new Response("edited"); } }';
    await rollout();
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

  it('a worker that does not read yet right after its upload is named, not deleted unread', async () => {
    fakeCf.lagReads = 2; // the install's version read, then the disconnect's read
    const { body } = await connect();
    expect(fakeCf.lagging).toBe(1);
    expect((await call('DELETE', `/v1/accounts/${body.account.id}`)).body).toMatchObject({ ok: true, left: ['worker clx-edge (uploaded moments ago and not readable yet)'] });
    expect(fakeCf.scripts.has('clx-edge')).toBe(true);
  });

  it('a worker deleted outside clx long after the install is simply gone', async () => {
    const id = await ready();
    fakeCf.scripts.delete('clx-edge');
    await env.DB.prepare('UPDATE operations SET updated_at = 0').run();
    expect((await call('DELETE', `/v1/accounts/${id}`)).body).toMatchObject({ ok: true, left: [] });
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

// Totals from the worker to clx.cx (docs/spec.md §7) end to end: beacons counted in the fake
// account's database, the worker's hourly run pushing to the real receiver, and what clx.cx keeps —
// plus the receiver's refusals, the worker's retries and back-off, the heartbeat and its states.
import type { DatabaseSync } from 'node:sqlite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { signAccess } from '../src/auth/jwt';
import worker from '../src/index';
import { app } from '../src/index';
import type { Env } from '../src/types';
import { d1 } from './d1';
import { fakeCtx, testEnv } from './env';
import { ACC, BOOT, fakeCf, useFakeCloudflare } from './fake-cf';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const H = 3_600_000;
const D0 = Date.UTC(2026, 9, 5);
const DAY0 = D0 / (24 * H);
const HOUR10 = DAY0 * 24 + 10;

let env: Env;
let dispose: () => Promise<void>;
beforeAll(async () => ({ env, dispose } = await testEnv()));
afterAll(() => dispose());
useFakeCloudflare();

let accountId = '';
let target = '';
let idem = 0;
const at = (t: number) => vi.setSystemTime(t);
const session = () => signAccess('test-jwt-secret', 1, Date.now()).then((t) => `Bearer ${t}`);
async function call(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { authorization: await session(), 'cf-connecting-ip': '10.4.0.1' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['idempotency-key'] = `p${++idem}`;
  const { ctx, settle } = fakeCtx();
  const res = await app.request(`https://clx.cx${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env, ctx);
  await settle();
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}
const script = () => fakeCf.scripts.get('clx-edge')!;
const userDb = (): DatabaseSync => fakeCf.dbs.get(script().bindings.find((b) => b.name === 'DB')!.id!)!.db;
const workerEnv = () => ({ HOOK_URL: 'https://clx.cx/hook', EDGE_KEY: script().secrets.get('EDGE_KEY')!, BUNDLE: script().bindings.find((b) => b.name === 'BUNDLE')!.text! });
const rows = (sql: string, ...args: (string | number)[]) => env.DB.prepare(sql).bind(...args).all().then((r) => r.results);
const account = async () => (await call('GET', `/v1/accounts/${accountId}`)).body.account;

/** clx.cx's own hook answers the worker's pushes; anything else goes to the fake Cloudflare. */
let answer: ((req: Request) => Promise<Response>) | null = null;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at(D0 + 9 * H);
  for (const t of ['hourly', 'daily', 'departed', 'sites', 'cf_calls', 'edge_accounts', 'operations', 'idempotency', 'api_keys', 'users']) await env.DB.prepare(`DELETE FROM ${t}`).run();
  await env.DB.prepare("INSERT INTO users (id, email, password_hash, created_at, plan) VALUES (1, 'free@example.com', 'x', 0, 'free')").run();
  fakeCf.reset();
  const { body } = await call('POST', '/v1/accounts', { cf_account_id: ACC, bootstrap_token: BOOT });
  accountId = body.account.id;
  const text = (n: string) => script().bindings.find((b) => b.name === n)?.text;
  await app.request('https://clx.cx/hook/setup', { method: 'POST', headers: { authorization: `Bearer ${script().secrets.get('EDGE_KEY')}` }, body: JSON.stringify({ deployment_id: text('DEPLOYMENT_ID'), bundle: text('BUNDLE'), schema: fakeCf.schemaOf(script().bindings.find((b) => b.name === 'DB')!.id!) }) }, env);
  const site = (await call('POST', '/v1/sites', { account_id: accountId, host: 'example.com' })).body.site;
  target = (await rows('SELECT target FROM sites WHERE id = ?', site.id))[0]!.target as string;
  answer = null;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init: RequestInit = {}) => {
    const req = new Request(input, init);
    if (new URL(req.url).hostname !== 'clx.cx') return cloudflare(input, init);
    return answer ? answer(req) : app.request(req, undefined, env);
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.stubGlobal('fetch', cloudflare);
});
/** The fake Cloudflare's fetch, as useFakeCloudflare set it. */
let cloudflare: typeof fetch;
beforeAll(() => {
  cloudflare = globalThis.fetch;
});

async function view(t: number, o: { ip?: string; ua?: string } = {}) {
  at(t);
  const { collect } = await import('../edge/collect');
  const req = new Request('https://example.com/p/c', { method: 'POST', body: 'x', headers: { 'content-type': 'text/plain', 'user-agent': o.ua ?? CHROME, 'cf-connecting-ip': o.ip ?? '10.0.0.1' } });
  const cfg = JSON.parse((userDb().prepare("SELECT data FROM cfg WHERE key = 'site:example.com' ORDER BY revision DESC LIMIT 1").get() as { data: string }).data);
  return collect(d1(userDb()), req, '', 'example.com', cfg, t);
}
async function hourly(t: number) {
  at(t);
  const { hourly: run } = await import('../edge/cron');
  return run(d1(userDb()), t, workerEnv());
}

describe('end to end', () => {
  it('a closed hour and the running day reach clx.cx; at midnight the final day follows', async () => {
    await view(D0 + 10.2 * H);
    await view(D0 + 10.4 * H, { ip: '10.0.0.2' });
    await view(D0 + 10.6 * H, { ua: 'curl/8' });
    const r = await hourly(D0 + 11 * H + 300_000);
    expect(r).toMatchObject({ errors: [], pushes: 2 });
    expect(await rows('SELECT target, hour, views, bots FROM hourly')).toEqual([{ target, hour: HOUR10, views: 2, bots: 1 }]);
    expect(await rows('SELECT day, as_of_hour, final, views, bots, visitors FROM daily')).toEqual([{ day: DAY0, as_of_hour: HOUR10, final: 0, views: 2, bots: 1, visitors: 2 }]);
    expect(userDb().prepare('SELECT count(*) AS n FROM outbox').get()).toEqual({ n: 0 });
    expect((await account()).push).toMatchObject({ bundle: workerEnv().BUNDLE, schema: 4, queue: expect.any(Number), error: null });

    const night = await hourly(D0 + 24 * H + 300_000);
    expect(night.closed).toEqual([DAY0]);
    expect(await rows('SELECT day, as_of_hour, final, views, visitors FROM daily')).toEqual([{ day: DAY0, as_of_hour: DAY0 * 24 + 23, final: 1, views: 2, visitors: 2 }]);
    expect(userDb().prepare('SELECT count(*) AS n FROM final_days').get()).toEqual({ n: 0 });
  });

  it('a run with nothing to send still pushes once: the heartbeat', async () => {
    const r = await hourly(D0 + 11 * H + 300_000);
    expect(r.pushes).toBe(1);
    expect((await account()).push.at).toBe(new Date(D0 + 11 * H + 300_000).toISOString());
  });
});

/** A push straight to the receiver, with this worker's key. */
async function push(items: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  const res = await app.request(
    'https://clx.cx/hook/push',
    { method: 'POST', headers: { authorization: `Bearer ${workerEnv().EDGE_KEY}` }, body: JSON.stringify({ v: 1, bundle: 'b', schema: 4, queue: 0, revision: 1, items: items.map((it, id) => ({ id, ...it })), ...extra }) },
    env,
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe('the receiver', () => {
  beforeEach(() => at(D0 + 12 * H));

  it('a repeated and a late push change nothing; an older snapshot never overwrites a newer one', async () => {
    const snap = (asOf: number, views: number) => ({ target, day: DAY0, as_of_hour: asOf, final: false, views, bots: 0, visitors: 1 });
    await push([{ target, hour: HOUR10, views: 5, bots: 0 }, snap(HOUR10 + 1, 9)]);
    await push([{ target, hour: HOUR10, views: 5, bots: 0 }, snap(HOUR10 + 1, 9)]);
    expect((await push([snap(HOUR10, 4)])).body).toEqual({ accepted: [0], rejected: [] });
    expect(await rows('SELECT hour, views FROM hourly')).toEqual([{ hour: HOUR10, views: 5 }]);
    expect(await rows('SELECT as_of_hour, views FROM daily')).toEqual([{ as_of_hour: HOUR10 + 1, views: 9 }]);
  });

  it('refuses each bad item on its own: a foreign target, a future or too old hour, unknown fields', async () => {
    const r = await push([
      { target: 's-not-mine', hour: HOUR10, views: 1, bots: 0 },
      { target, hour: DAY0 * 24 + 12, views: 1, bots: 0 },
      { target, hour: HOUR10 - 40 * 24, views: 1, bots: 0 },
      { target, hour: HOUR10, views: 1, bots: 0, ip: '1.2.3.4' },
      { target, day: DAY0, final: true, views: 1, bots: 0, visitors: 1 },
      { target, hour: HOUR10, views: 3, bots: 0 },
    ]);
    expect(r.body).toEqual({
      accepted: [5],
      rejected: [
        { id: 0, reason: 'unknown_target' },
        { id: 1, reason: 'invalid' },
        { id: 2, reason: 'too_old' },
        { id: 3, reason: 'invalid' },
        { id: 4, reason: 'invalid' }, // today cannot be final yet
      ],
    });
    expect((await push([], { account: ACC })).status).toBe(400);
    const wrongKey = await app.request('https://clx.cx/hook/push', { method: 'POST', headers: { authorization: `Bearer ${'x'.repeat(43)}` }, body: '{}' }, env);
    expect(wrongKey.status).toBe(401);
  });

  it('over the day\'s write budget only final days are taken', async () => {
    await env.DB.prepare('UPDATE edge_accounts SET budget_day = ?, budget_used = 3000 WHERE id = ?').bind(DAY0, accountId).run();
    const r = await push([
      { target, hour: HOUR10, views: 1, bots: 0 },
      { target, day: DAY0 - 1, final: true, views: 7, bots: 0, visitors: 3 },
    ]);
    expect(r.body).toEqual({ accepted: [1], rejected: [{ id: 0, reason: 'budget' }] });
  });

  it('two pushes at once cannot spend the same room in the budget', async () => {
    await env.DB.prepare('UPDATE edge_accounts SET budget_day = ?, budget_used = 2998 WHERE id = ?').bind(DAY0, accountId).run();
    const two = [{ target, hour: HOUR10, views: 1, bots: 0 }, { target, hour: HOUR10 - 1, views: 1, bots: 0 }];
    const [a, b] = await Promise.all([push(two), push(two)]);
    expect(a.body.accepted.length + b.body.accepted.length).toBe(1);
    // Reserved, then the unused part given back: 2998 + 2 heartbeats + 1 item.
    expect((await rows('SELECT budget_used FROM edge_accounts'))[0]).toEqual({ budget_used: 3001 });
  });

  it('a worker whose config commit is not the synced one is synced again, but not right after a sync', async () => {
    const before = (await rows('SELECT config_revision, synced_revision FROM edge_accounts'))[0] as { config_revision: number; synced_revision: number };
    // The site's sync finished at 09:00; 5 minutes later the mismatch may be that sync in flight.
    at(D0 + 9 * H + 5 * 60_000);
    await push([], { revision: 99 });
    expect((await rows('SELECT config_revision FROM edge_accounts'))[0]).toEqual({ config_revision: before.config_revision });
    at(D0 + 12 * H);
    await push([], { revision: 99 });
    expect((await rows('SELECT config_revision, synced_revision FROM edge_accounts'))[0]).toEqual({ config_revision: 100, synced_revision: 0 });
    expect(await rows('SELECT revision FROM sites')).toEqual([{ revision: 100 }]);
  });
});

describe('the worker side', () => {
  it('busy items are tried 3 times, then dropped and counted; refused ones are dropped at once', async () => {
    await view(D0 + 10.5 * H);
    answer = async (req) => {
      const body = (await req.json()) as { items: { id: number; hour?: number }[] };
      return Response.json({ accepted: [], rejected: body.items.map((it) => ({ id: it.id, reason: it.hour !== undefined ? 'busy' : 'invalid' })) });
    };
    for (let i = 0; i < 3; i++) await hourly(D0 + (11 + i) * H + 300_000);
    const status = userDb().prepare('SELECT reason, n FROM sync_status ORDER BY reason').all().map((r) => ({ ...r }));
    expect(status).toEqual([{ reason: 'busy', n: 1 }, { reason: 'invalid', n: 3 }]);
    expect(userDb().prepare('SELECT count(*) AS n FROM outbox').get()).toEqual({ n: 0 });
  });

  it('after 20 refusals of its key in a row the worker asks once a day; a reinstall clears it', async () => {
    let calls = 0;
    answer = async () => (calls++, new Response('{}', { status: 401 }));
    for (let i = 0; i < 21; i++) await hourly(D0 + (11 + i) * H + 300_000);
    expect(calls).toBe(20);
    await hourly(D0 + (11 + 20) * H + 86_400_000);
    expect(calls).toBe(21);
  });

  it('the first accepted push after refusals clears their count once, within the ledger', async () => {
    userDb().exec("INSERT INTO meta VALUES ('push_401', 3), ('push_401_next', 0)");
    const backlog = userDb().prepare("INSERT INTO outbox (hour, items) VALUES (?, '[]')");
    for (let i = 0; i < 10; i++) backlog.run(HOUR10 - 10 + i);
    const count = { n: 0 };
    at(D0 + 11 * H + 300_000);
    const { hourly: run } = await import('../edge/cron');
    const r = await run(d1(userDb(), { count }), D0 + 11 * H + 300_000, workerEnv());
    expect(r.statements).toBe(count.n);
    expect(count.n).toBeLessThanOrEqual(49);
    expect(r.pushes).toBe(6);
    expect(userDb().prepare("SELECT count(*) AS n FROM meta WHERE key LIKE 'push_401%'").get()).toEqual({ n: 0 });
  });

  it('a worker silent for 26 hours is "no connection" until it pushes again; its sites still work', async () => {
    await hourly(D0 + 11 * H + 300_000);
    at(D0 + 38 * H);
    const { ctx, settle } = fakeCtx();
    await worker.scheduled({ scheduledTime: D0 + 38 * H + 20 * 60_000, cron: '* * * * *' } as ScheduledController, env, ctx);
    await settle();
    expect((await account()).state).toBe('no_connection');
    expect((await call('POST', '/v1/sites', { account_id: accountId, host: 'blog.example.com' })).status).toBe(202);
    await hourly(D0 + 39 * H + 300_000);
    expect((await account()).state).toBe('ready');
  });
});

describe('after a disconnect', () => {
  it("the account's totals stay 30 days, then go", async () => {
    await view(D0 + 10.5 * H);
    await hourly(D0 + 11 * H + 300_000);
    expect(await call('DELETE', `/v1/accounts/${accountId}`)).toMatchObject({ status: 200 });
    const job = async (t: number) => {
      at(t);
      const { ctx, settle } = fakeCtx();
      await worker.scheduled({ scheduledTime: t, cron: '* * * * *' } as ScheduledController, env, ctx);
      await settle();
    };
    await job(D0 + 2 * 24 * H + 20 * 60_000);
    expect(await rows('SELECT count(*) AS n FROM daily')).toEqual([{ n: 1 }]);
    await job(D0 + 31 * 24 * H + 20 * 60_000);
    expect(await rows('SELECT count(*) AS n FROM daily')).toEqual([{ n: 0 }]);
    expect(await rows('SELECT count(*) AS n FROM departed')).toEqual([{ n: 0 }]);
  });
});

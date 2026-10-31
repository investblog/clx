// Sites (docs/spec.md §5) and the config sync (§6), against the fake Cloudflare; the worker itself
// (edge/worker.ts) reads the config clx wrote into the fake account's database.
import type { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { signAccess } from '../src/auth/jwt';
import { applyPlan } from '../src/billing/pause';
import { edgeById } from '../src/cf/connect';
import { runSites, undoRotation } from '../src/cf/sites';
import { app } from '../src/index';
import { namesFor, scriptFor, SNIPPET_REV } from '../src/snippet';
import RELEASED from '../edge/released.json';
import type { Env } from '../src/types';
import { d1 } from './d1';
import { fakeCtx, testEnv } from './env';
import { ACC, BOOT, fakeCf, useFakeCloudflare } from './fake-cf';

let env: Env;
let dispose: () => Promise<void>;
beforeAll(async () => ({ env, dispose } = await testEnv()));
afterAll(() => dispose());
useFakeCloudflare();

let accountId = '';
beforeEach(async () => {
  for (const t of ['link_hosts', 'sites', 'cf_calls', 'edge_accounts', 'operations', 'idempotency', 'api_keys', 'users']) await env.DB.prepare(`DELETE FROM ${t}`).run();
  await env.DB.prepare("INSERT INTO users (id, email, password_hash, created_at, email_confirmed_at, plan) VALUES (1, 'free@example.com', 'x', 0, 0, 'free'), (2, 'api@example.com', 'x', 0, 0, 'api')").run();
  fakeCf.reset();
  accountId = await ready();
});

let ip = 0;
let idem = 0;
const session = (user: number) => signAccess('test-jwt-secret', user, Date.now()).then((t) => `Bearer ${t}`);
async function call(method: string, path: string, opts: { auth?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { authorization: opts.auth ?? (await session(1)), 'cf-connecting-ip': `10.3.0.${++ip % 250}` };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['idempotency-key'] = `s${++idem}`;
  const { ctx, settle } = fakeCtx();
  const res = await app.request(`https://clx.cx${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }, env, ctx);
  await settle();
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

/** Connect and confirm the install, as the worker's self-check would. */
async function ready(user = 1): Promise<string> {
  const { body } = await call('POST', '/v1/accounts', { auth: await session(user), body: { cf_account_id: ACC, bootstrap_token: BOOT } });
  const script = fakeCf.scripts.get('clx-edge')!;
  const text = (n: string) => script.bindings.find((b) => b.name === n)?.text;
  const db = script.bindings.find((b) => b.name === 'DB')!.id!;
  const res = await app.request(
    'https://clx.cx/hook/setup',
    { method: 'POST', headers: { authorization: `Bearer ${script.secrets.get('EDGE_KEY')}` }, body: JSON.stringify({ deployment_id: text('DEPLOYMENT_ID'), bundle: text('BUNDLE'), schema: fakeCf.schemaOf(db) }) },
    env,
  );
  expect(res.status).toBe(200);
  return body.account.id;
}

const addSite = (host: string, extra: Record<string, unknown> = {}, auth?: string) => call('POST', '/v1/sites', { auth, body: { account_id: accountId, host, ...extra } });
const routes = () => fakeCf.routes.get('zone1') ?? [];
const userDb = (): DatabaseSync => {
  const id = fakeCf.scripts.get('clx-edge')!.bindings.find((b) => b.name === 'DB')!.id!;
  return fakeCf.dbs.get(id)!.db;
};

/** A request through the worker, with a fresh isolate (no cached config) and a fake origin; its
 *  counting has finished when this returns. */
async function viaWorker(url: string, init: RequestInit = {}, db?: D1Database): Promise<{ status: number; body: string; headers: Headers; origin: boolean }> {
  vi.resetModules();
  const worker = (await import('../edge/worker')).default;
  let origin = false;
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async () => ((origin = true), new Response('the site itself', { status: 404 })));
  try {
    const { ctx, settle } = fakeCtx();
    const res = await worker.fetch(new Request(url, init), { DB: db ?? d1(userDb()) } as never, ctx);
    await settle();
    return { status: res.status, body: await res.text(), headers: res.headers, origin };
  } finally {
    vi.stubGlobal('fetch', realFetch);
  }
}

describe('adding a site', () => {
  it("lists the account's zones for the host picker; another user's account is not found", async () => {
    const r = await call('GET', `/v1/accounts/${accountId}/zones`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ zones: [{ name: 'example.com', status: 'active' }, { name: 'shop.example.org', status: 'pending' }], truncated: false });
    expect((await call('GET', `/v1/accounts/${accountId}/zones`, { auth: await session(2) })).status).toBe(404);
  });

  it('makes no route while another operation holds the account (a disconnect would miss it); the cron does it after', async () => {
    const hold = (until: number | null) => env.DB.prepare("UPDATE edge_accounts SET lease_until = ?, lease_owner = 'other'").bind(until).run();
    await hold(Date.now() + 60_000);
    const r = await addSite('example.com');
    expect(r.body.site.state).toBe('route_pending');
    expect(routes()).toEqual([]);
    const id = r.body.site.id;
    await hold(null);
    await runSites(env, Date.now() + 61_000);
    expect((await call('GET', `/v1/sites/${id}`)).body.site.state).toBe('active');
    expect(routes()).toHaveLength(1);
    // A rotation needs the lease too.
    await hold(Date.now() + 60_000);
    expect((await call('POST', `/v1/sites/${id}/rotate`)).body.error?.code).toBe('operation_in_progress');
    expect(routes()).toHaveLength(1);
  });

  it('finds the zone, makes the route, syncs the config; the worker serves the script and passes the rest on', async () => {
    const r = await addSite('example.com');
    expect(r.status).toBe(202);
    const site = r.body.site;
    expect(site).toMatchObject({ host: 'example.com', state: 'active', config: 'pending', snippet: { inline: expect.stringMatching(/^<script>/u), script_tag: expect.stringContaining(site.path) } });
    expect(routes()).toEqual([{ id: expect.any(String), pattern: `example.com${site.path}/*`, script: 'clx-edge' }]);
    expect((await call('GET', `/v1/sites/${site.id}`)).body.site.config).toBe('synced');

    const row = (await env.DB.prepare('SELECT seed FROM sites').first<{ seed: string }>())!;
    const names = namesFor(row.seed);
    const js = await viaWorker(`https://example.com${names.path}/${names.s}.js`);
    expect(js).toMatchObject({ status: 200, body: scriptFor(row.seed, names), origin: false });
    expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect([...js.headers.keys()].sort()).toEqual(['cache-control', 'content-type']);
    const beacon = await viaWorker(`https://example.com${names.path}/${names.c}`, {
      method: 'POST',
      body: 'https://ref.example/',
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' },
    });
    expect(beacon).toMatchObject({ status: 204, origin: false });
    expect(beacon.headers.get('cache-control')).toBe('no-store');
    // Counted into the account's own database, under the site's target.
    expect(userDb().prepare('SELECT target, views FROM totals').all()).toEqual([{ target: expect.stringMatching(/^s/u), views: 1 }]);
    expect(userDb().prepare('SELECT source FROM views_hourly').all()).toEqual([{ source: 'ref.example' }]);
    // Everything else under the path, or another method, is the site's own answer.
    expect(await viaWorker(`https://example.com${names.path}/nope`)).toMatchObject({ status: 404, body: 'the site itself', origin: true });
    expect(await viaWorker(`https://example.com${names.path}/${names.c}`)).toMatchObject({ origin: true });
    expect(await viaWorker(`https://other.example.com${names.path}/${names.s}.js`)).toMatchObject({ origin: true });
  });

  it('a subdomain belongs to the most specific zone; a host in no zone is refused', async () => {
    expect((await addSite('blog.example.com')).body.site.state).toBe('active');
    await addSite('a.shop.example.org');
    expect(fakeCf.routes.get('zone2')).toHaveLength(1);
    expect((await addSite('nowhere.net')).body.error.code).toBe('zone_not_found');
    expect((await addSite('not a host')).body.error.code).toBe('invalid_request');
  });

  it('one site per host; the free plan stops at its limit', async () => {
    await addSite('example.com');
    expect((await addSite('example.com')).body.error.code).toBe('site_exists');
    for (let i = 1; i < 10; i++) expect((await addSite(`s${i}.example.com`)).status).toBe(202);
    expect((await addSite('s10.example.com')).body.error).toMatchObject({ code: 'limit_reached', details: { limit: 10 } });
  });

  it("a pattern another worker holds is route_conflict: their route stays, nothing is synced for it", async () => {
    fakeCf.takenHosts.add('example.com');
    const { site } = (await addSite('example.com')).body;
    expect(site).toMatchObject({ state: 'route_conflict', error: { code: 'route_conflict', worker: 'their-worker' } });
    expect(routes()).toEqual([expect.objectContaining({ script: 'their-worker' })]);
  });

  it('a route Cloudflare could not make now is made by the cron', async () => {
    fakeCf.failOnce.add('/workers/routes');
    const { site } = (await addSite('example.com')).body;
    expect(site.state).toBe('route_pending');
    await env.DB.prepare('UPDATE sites SET updated_at = 0').run();
    await runSites(env);
    expect((await call('GET', `/v1/sites/${site.id}`)).body.site.state).toBe('active');
    expect(routes()).toHaveLength(1);
  });

  it('the account must be ready, and the key must reach it', async () => {
    await env.DB.prepare("UPDATE edge_accounts SET state = 'installing'").run();
    expect((await addSite('example.com')).body.error.code).toBe('account_not_ready');
    await env.DB.prepare("UPDATE edge_accounts SET state = 'ready'").run();
    await env.DB.prepare("UPDATE users SET plan = 'api' WHERE id = 1").run();
    const reports = (await call('POST', '/v1/keys', { body: { scopes: ['reports'] } })).body.key;
    expect((await addSite('example.com', {}, `Bearer ${reports}`)).body.error.code).toBe('scope_required');
    const elsewhere = (await call('POST', '/v1/keys', { body: { scopes: ['sites'], allow_accounts: ['b'.repeat(32)] } })).body.key;
    expect((await addSite('example.com', {}, `Bearer ${elsewhere}`)).status).toBe(404);
  });
});

describe('the list of sites', () => {
  it("carries each day's views of the last 7 closed days and whether the counter counted; not without the reports scope", async () => {
    await env.DB.prepare('DELETE FROM daily').run();
    const a = (await addSite('example.com')).body.site;
    const b = (await addSite('blog.example.com')).body.site;
    const target = (id: string) => env.DB.prepare('SELECT target FROM sites WHERE id = ?').bind(id).first<string>('target');
    const ta = (await target(a.id))!;
    const tb = (await target(b.id))!;
    const day = Math.floor(Date.now() / 86_400_000);
    const put = env.DB.prepare('INSERT INTO daily (account_id, target, day, as_of_hour, final, views, bots, visitors) VALUES (?1, ?2, ?3, ?3 * 24 + 23, 1, ?4, 0, 1)');
    // Two days in the week, one before it, and today's running day, which the list leaves out.
    await env.DB.batch([put.bind(accountId, ta, day - 7, 5), put.bind(accountId, ta, day - 1, 3), put.bind(accountId, ta, day - 30, 9), put.bind(accountId, ta, day, 4), put.bind(accountId, tb, day - 2, 0)]);
    const sites = (await call('GET', '/v1/sites')).body.sites as { id: string; views_7d: number[]; counted: boolean }[];
    const of = (id: string) => sites.find((s) => s.id === id)!;
    expect(of(a.id)).toMatchObject({ views_7d: [5, 0, 0, 0, 0, 0, 3], counted: true });
    // A day with no views is not "counted": the site still opens at its snippet.
    expect(of(b.id)).toMatchObject({ views_7d: [0, 0, 0, 0, 0, 0, 0], counted: false });
    // A second account of the user with a site under the same target: each keeps its own days.
    await env.DB.batch([
      env.DB.prepare("INSERT INTO edge_accounts (id, user_id, cf_account_id, cf_account_name, state, created_at, updated_at, synced_revision) SELECT 'ea_other', user_id, 'other-cf-account', 'Other', state, created_at, updated_at, synced_revision FROM edge_accounts WHERE id = ?").bind(accountId),
      env.DB.prepare("INSERT INTO sites (id, account_id, user_id, target, host, zone_id, seed, excluded, state, retiring, revision, created_at, updated_at) SELECT 'site_other', 'ea_other', user_id, target, 'other.example.org', zone_id, seed, excluded, state, retiring, revision, created_at, updated_at FROM sites WHERE id = ?").bind(b.id),
      put.bind('ea_other', tb, day - 1, 8),
    ]);
    const both = (await call('GET', '/v1/sites')).body.sites as { id: string; views_7d: number[]; counted: boolean }[];
    expect(both.find((s) => s.id === b.id)).toMatchObject({ views_7d: [0, 0, 0, 0, 0, 0, 0], counted: false });
    expect(both.find((s) => s.id === 'site_other')).toMatchObject({ views_7d: [0, 0, 0, 0, 0, 0, 8], counted: true });
    // Narrowed to one account: only its sites, with their own days.
    const one = (await call('GET', '/v1/sites?account_id=ea_other')).body.sites as { id: string; views_7d: number[] }[];
    expect(one.map((s) => [s.id, s.views_7d])).toEqual([['site_other', [0, 0, 0, 0, 0, 0, 8]]]);

    await env.DB.prepare("UPDATE users SET plan = 'api' WHERE id = 1").run();
    const issued = await call('POST', '/v1/keys', { body: { scopes: ['sites'] } });
    const bare = (await call('GET', '/v1/sites', { auth: `Bearer ${issued.body.key}` })).body.sites;
    expect(bare[0]).not.toHaveProperty('views_7d');
    expect(bare[0]).not.toHaveProperty('counted');
  });
});

describe('changing a site', () => {
  it('excluded paths reach the worker with the next revision', async () => {
    const { site } = (await addSite('example.com')).body;
    const r = await call('PATCH', `/v1/sites/${site.id}`, { body: { excluded_paths: ['/admin', '/admin'] } });
    expect(r.body.site.excluded_paths).toEqual(['/admin']);
    const data = userDb().prepare("SELECT c.data FROM cfg c JOIN commits m ON m.revision = c.revision AND m.sync_id = c.sync_id WHERE c.key = 'site:example.com' ORDER BY c.revision DESC LIMIT 1").get() as { data: string };
    expect(JSON.parse(data.data).excluded).toEqual(['/admin']);
    // Superseded versions are cleaned up: one row per key is left.
    expect(userDb().prepare("SELECT count(*) AS n FROM cfg WHERE key = 'site:example.com'").get()).toEqual({ n: 1 });
  });

  it('rotate: a new path and snippet; the old path counts for 30 days, then its route goes', async () => {
    const { site } = (await addSite('example.com')).body;
    const old = (await env.DB.prepare('SELECT seed FROM sites').first<{ seed: string }>())!.seed;
    const r = await call('POST', `/v1/sites/${site.id}/rotate`);
    expect(r.body.site.path).not.toBe(site.path);
    expect(r.body.site.snippet.inline).not.toBe(site.snippet.inline);
    expect(r.body.site.retiring).toEqual([{ path: site.path, until: expect.any(String) }]);
    expect(routes()).toHaveLength(2);
    const oldNames = namesFor(old);
    expect((await viaWorker(`https://example.com${oldNames.path}/${oldNames.s}.js`)).origin).toBe(false);

    await env.DB.prepare("UPDATE sites SET retiring = json_set(retiring, '$[0].until', 1), retire_at = 1").run();
    expect((await runSites(env)).retired).toBe(1);
    await runSites(env); // the sync of that change
    expect(routes()).toEqual([expect.objectContaining({ pattern: `example.com${r.body.site.path}/*` })]);
    expect((await viaWorker(`https://example.com${oldNames.path}/${oldNames.s}.js`)).origin).toBe(true);
    const fresh = namesFor((await env.DB.prepare('SELECT seed FROM sites').first<{ seed: string }>())!.seed);
    expect((await viaWorker(`https://example.com${fresh.path}/${fresh.s}.js`)).origin).toBe(false);
  });

  it('delete: routes gone, the worker forgets the host, the host is free again', async () => {
    const { site } = (await addSite('example.com')).body;
    const names = namesFor((await env.DB.prepare('SELECT seed FROM sites').first<{ seed: string }>())!.seed);
    const r = await call('DELETE', `/v1/sites/${site.id}`);
    expect(r.body.site).toMatchObject({ state: 'deleted', snippet: null });
    expect(routes()).toEqual([]);
    expect((await viaWorker(`https://example.com${names.path}/${names.s}.js`)).origin).toBe(true);
    expect((await call('GET', '/v1/sites')).body.sites).toEqual([]);
    expect((await addSite('example.com')).status).toBe(202);
  });

  it('an interrupted sync leaves the previous config working; the next one commits and cleans up', async () => {
    const { site } = (await addSite('example.com')).body;
    fakeCf.failSql = /^INSERT INTO commits/u;
    await call('PATCH', `/v1/sites/${site.id}`, { body: { excluded_paths: ['/x'] } });
    expect((await call('GET', `/v1/sites/${site.id}`)).body.site.config).toBe('pending');
    const committed = () => JSON.parse((userDb().prepare("SELECT c.data FROM cfg c JOIN commits m ON m.revision = c.revision AND m.sync_id = c.sync_id WHERE c.key = 'site:example.com' ORDER BY c.revision DESC LIMIT 1").get() as { data: string }).data).excluded;
    expect(committed()).toEqual([]);
    expect(userDb().prepare("SELECT count(*) AS n FROM cfg").get()).toEqual({ n: 2 }); // the stray rows, invisible
    fakeCf.failSql = null;
    await runSites(env);
    expect(committed()).toEqual(['/x']);
    expect((await call('GET', `/v1/sites/${site.id}`)).body.site.config).toBe('synced');
  });
});

describe('review fixes (4a)', () => {
  it('a rotation that loses a race removes the route it just made', async () => {
    const { site } = (await addSite('example.com')).body;
    // While the new route is being made, the site is deleted.
    fakeCf.onRoutePost = async () => {
      fakeCf.onRoutePost = null;
      await env.DB.prepare("UPDATE sites SET state = 'deleted'").run();
    };
    const r = await call('POST', `/v1/sites/${site.id}/rotate`);
    expect(r.body.error.code).toBe('operation_in_progress');
    expect(routes()).toHaveLength(1); // only the first route; the new one is gone again
  });

  /** A rotation whose Worker dies once Cloudflare made the new route, before clx records it. */
  async function rotationDies(siteId: string) {
    fakeCf.onRouteMade = async () => {
      fakeCf.onRouteMade = null;
      throw new Error('the Worker died here');
    };
    expect((await call('POST', `/v1/sites/${siteId}/rotate`)).status).toBeGreaterThanOrEqual(500);
    expect(routes()).toHaveLength(2);
    return (await env.DB.prepare('SELECT seed, rotating FROM sites WHERE id = ?').bind(siteId).first<{ seed: string; rotating: string }>())!;
  }

  it('a rotation that died and was not retried is undone by the cron: its route goes, the site is as it was', async () => {
    const { site } = (await addSite('example.com')).body;
    const half = await rotationDies(site.id);
    expect(half.rotating).toEqual(expect.any(String));
    expect((await call('GET', `/v1/sites/${site.id}`)).body.site.path).toBe(site.path);
    await runSites(env);
    expect(routes()).toHaveLength(2); // a minute is left for a retry
    await env.DB.prepare('UPDATE sites SET updated_at = 0').run();
    await runSites(env);
    expect(await env.DB.prepare('SELECT seed, rotating FROM sites').first()).toEqual({ seed: half.seed, rotating: null });
    expect(routes()).toEqual([expect.objectContaining({ pattern: `example.com${site.path}/*` })]);
    // A retry of the call that died now rotates once, afresh.
    const r = await call('POST', `/v1/sites/${site.id}/rotate`);
    expect(r.body.site.path).not.toBe(site.path);
    expect(routes()).toHaveLength(2);
  });

  it('a retry of a rotation that died resumes it with the same seed, the route adopted', async () => {
    const { site } = (await addSite('example.com')).body;
    const half = await rotationDies(site.id);
    const r = await call('POST', `/v1/sites/${site.id}/rotate`);
    expect(r.body.site.path).toBe(namesFor(half.rotating).path);
    expect(routes()).toHaveLength(2);
    expect(await env.DB.prepare('SELECT rotating FROM sites').first()).toEqual({ rotating: null });
  });

  it('an undo that picked a rotation a retry has finished since leaves it alone', async () => {
    const { site } = (await addSite('example.com')).body;
    const half = await rotationDies(site.id);
    expect((await call('POST', `/v1/sites/${site.id}/rotate`)).status).toBe(200);
    // The cron chose the row before the retry, and got the lease after it.
    await undoRotation(env, (await edgeById(env.DB, accountId))!, site.id, half.rotating);
    expect(routes()).toHaveLength(2);
    expect(await env.DB.prepare('SELECT seed FROM sites').first()).toEqual({ seed: half.rotating });
  });

  it('a delete while a rotation is making its route waits for it (the lease), never looking too early', async () => {
    const { site } = (await addSite('example.com')).body;
    let during: Awaited<ReturnType<typeof call>> | undefined;
    fakeCf.onRoutePost = async () => {
      fakeCf.onRoutePost = null;
      during = await call('DELETE', `/v1/sites/${site.id}`);
    };
    expect((await call('POST', `/v1/sites/${site.id}/rotate`)).status).toBe(200);
    expect(during!.body.error.code).toBe('operation_in_progress');
    expect((await call('DELETE', `/v1/sites/${site.id}`)).body.site.state).toBe('deleted');
    expect(routes()).toEqual([]);
  });

  it('a new site whose route was made but not recorded: a delete finds it by its pattern', async () => {
    fakeCf.onRouteMade = async () => {
      fakeCf.onRouteMade = null;
      throw new Error('the Worker died here');
    };
    const { site } = (await addSite('example.com')).body;
    expect(site.state).toBe('route_pending');
    expect(routes()).toHaveLength(1);
    expect((await call('DELETE', `/v1/sites/${site.id}`)).body.site.state).toBe('deleted');
    expect(routes()).toEqual([]);
  });

  it('a half-done rotation whose delete could not remove the route: a disconnect still does', async () => {
    const { site } = (await addSite('example.com')).body;
    await rotationDies(site.id);
    fakeCf.failOnce.add('/workers/routes');
    expect((await call('DELETE', `/v1/sites/${site.id}`)).body.site.state).toBe('deleted');
    expect(routes()).toHaveLength(2);
    expect((await call('DELETE', `/v1/accounts/${accountId}`)).body).toMatchObject({ ok: true, left: [] });
    expect(routes()).toEqual([]);
  });

  it('a delete, or a disconnect, while a rotation is half done removes its unrecorded route too', async () => {
    const { site } = (await addSite('example.com')).body;
    await rotationDies(site.id);
    expect((await call('DELETE', `/v1/sites/${site.id}`)).body.site.state).toBe('deleted');
    expect(routes()).toEqual([]);

    const blog = (await addSite('blog.example.com')).body.site;
    await rotationDies(blog.id);
    expect((await call('DELETE', `/v1/accounts/${accountId}`)).body).toMatchObject({ ok: true, left: [] });
    expect(routes()).toEqual([]);
  });

  it('a route made for a site that went meanwhile is removed', async () => {
    fakeCf.onRoutePost = async () => {
      fakeCf.onRoutePost = null;
      await env.DB.prepare('DELETE FROM sites').run();
    };
    await addSite('example.com');
    expect(routes()).toEqual([]);
  });

  it('a delete whose route Cloudflare will not remove now: the site is deleted, the cron removes the route', async () => {
    const { site } = (await addSite('example.com')).body;
    fakeCf.failOnce.add('/workers/routes/');
    const r = await call('DELETE', `/v1/sites/${site.id}`);
    expect(r.body.site.state).toBe('deleted');
    expect(routes()).toHaveLength(1);
    expect((await runSites(env)).retired).toBe(1);
    expect(routes()).toEqual([]);
  });

  it('a route the user pointed at another worker is not deleted, on site delete nor on disconnect', async () => {
    const { site } = (await addSite('example.com')).body;
    routes()[0]!.script = 'their-worker';
    const gone = await call('DELETE', `/v1/sites/${site.id}`);
    expect(gone.body.site).toMatchObject({ state: 'deleted', error: { code: 'route_not_ours' } });
    expect(routes()).toHaveLength(1);
    await addSite('blog.example.com');
    routes().find((r) => r.pattern.startsWith('blog.'))!.pattern = 'blog.example.com/elsewhere/*';
    const off = await call('DELETE', `/v1/accounts/${accountId}`);
    expect(off.body.left).toEqual([expect.stringMatching(/^route blog\.example\.com\/.+ \(changed outside clx\)$/u)]);
    expect(routes()).toHaveLength(2);
  });

  it('a site whose path another worker holds is withdrawn from the worker', async () => {
    fakeCf.takenHosts.add('example.com');
    await addSite('example.com');
    await runSites(env);
    const row = userDb().prepare("SELECT c.deleted FROM cfg c JOIN commits m ON m.revision = c.revision AND m.sync_id = c.sync_id WHERE c.key = 'site:example.com' ORDER BY c.revision DESC LIMIT 1").get() as { deleted: number };
    expect(row.deleted).toBe(1);
  });

  it('a paused site (§18) is withdrawn from the worker and comes back when Pro is on', async () => {
    const { site } = (await addSite('example.com')).body;
    await runSites(env);
    const latest = () => userDb().prepare("SELECT c.deleted FROM cfg c JOIN commits m ON m.revision = c.revision AND m.sync_id = c.sync_id WHERE c.key = 'site:example.com' ORDER BY c.revision DESC LIMIT 1").get() as { deleted: number };
    expect(latest().deleted).toBe(0);
    // Two accounts on free: the account is not the one kept, so all of it pauses.
    await env.DB.prepare("INSERT INTO edge_accounts (id, user_id, cf_account_id, state, created_at, updated_at) VALUES ('ea_old', 1, 'old-cf-account', 'ready', -1, 0)").run();
    await env.DB.prepare("UPDATE users SET plan = 'free' WHERE id = 1").run();
    await applyPlan(env, 1);
    expect((await call('GET', `/v1/sites/${site.id}`)).body.site.paused_at).not.toBeNull();
    await runSites(env);
    expect(latest().deleted).toBe(1);
    await env.DB.prepare("DELETE FROM edge_accounts WHERE id = 'ea_old'").run();
    await applyPlan(env, 1);
    await runSites(env);
    expect(latest().deleted).toBe(0);
  });

  it("a worker database ahead of clx is written over: every site again, above its head", async () => {
    const { site } = (await addSite('example.com')).body;
    userDb().prepare("INSERT INTO commits (revision, sync_id, at) VALUES (999, 'stray', 0)").run();
    await call('PATCH', `/v1/sites/${site.id}`, { body: { excluded_paths: ['/y'] } });
    await runSites(env);
    const acc = await env.DB.prepare('SELECT config_revision, synced_revision FROM edge_accounts').first<{ config_revision: number; synced_revision: number }>();
    expect(acc).toEqual({ config_revision: 1000, synced_revision: 1000 });
    const data = userDb().prepare("SELECT c.data FROM cfg c JOIN commits m ON m.revision = c.revision AND m.sync_id = c.sync_id WHERE c.key = 'site:example.com' ORDER BY c.revision DESC LIMIT 1").get() as { data: string };
    expect(JSON.parse(data.data).excluded).toEqual(['/y']);
  });
});

describe('a change of every snippet (SNIPPET_REV, ADR 0039)', () => {
  const account = () => env.DB.prepare('SELECT config_revision, synced_revision FROM edge_accounts').first<{ config_revision: number; synced_revision: number }>();
  const record = () => env.DB.prepare('SELECT revision, snippet_rev, written_rev FROM sites').first<{ revision: number; snippet_rev: number | null; written_rev: number | null }>();
  /** The revision of the latest committed config row of the site, in the worker's database. */
  const written = () => (userDb().prepare("SELECT max(c.revision) AS r FROM cfg c JOIN commits m ON m.revision = c.revision AND m.sync_id = c.sync_id WHERE c.key = 'site:example.com'").get() as { r: number }).r;

  it('a sync records what wrote the site; the cron leaves such a site alone', async () => {
    await addSite('example.com');
    const r = (await record())!;
    expect(r).toEqual({ revision: r.revision, snippet_rev: SNIPPET_REV, written_rev: r.revision });
    const before = (await account())!;
    await runSites(env);
    expect(await account()).toEqual(before);
  });

  it('a synced site written by other code — before the change, or by an older Worker after it — is written again and recorded', async () => {
    const { site } = (await addSite('example.com')).body;
    const before = (await account())!;
    // An older Worker's sync: the site at its revision, synced, with no record of the code.
    await env.DB.prepare('UPDATE sites SET snippet_rev = NULL, written_rev = NULL').run();
    await runSites(env);
    expect(await account()).toEqual({ config_revision: before.config_revision + 1, synced_revision: before.config_revision + 1 });
    expect(await record()).toEqual({ revision: before.config_revision + 1, snippet_rev: SNIPPET_REV, written_rev: before.config_revision + 1 });
    expect(written()).toBe(before.config_revision + 1);
    const seed = (await env.DB.prepare('SELECT seed FROM sites WHERE id = ?').bind(site.id).first<{ seed: string }>())!.seed;
    const names = namesFor(seed);
    expect((await viaWorker(`https://example.com${names.path}/${names.s}.js`)).body).toBe(scriptFor(seed, names));
  });

  it('a change an older Worker synced after the code was recorded is caught too', async () => {
    await addSite('example.com');
    const before = (await account())!;
    // The older Worker changed the site and synced it: a new revision, the record still the old one.
    await env.DB.batch([
      env.DB.prepare('UPDATE edge_accounts SET config_revision = config_revision + 1, synced_revision = config_revision + 1'),
      env.DB.prepare('UPDATE sites SET revision = revision + 1'),
    ]);
    await runSites(env);
    expect(await record()).toEqual({ revision: before.config_revision + 2, snippet_rev: SNIPPET_REV, written_rev: before.config_revision + 2 });
  });

  it('a site not yet synced is left to its sync', async () => {
    await addSite('example.com');
    await env.DB.prepare('UPDATE sites SET snippet_rev = NULL, written_rev = NULL').run();
    await env.DB.prepare('UPDATE edge_accounts SET synced_revision = 0').run();
    const before = (await account())!;
    expect((await runSites(env)).synced).toBe(1);
    // Written by the sync (a full one, from 0) — no extra move.
    expect((await account())!.config_revision).toBe(before.config_revision);
  });
});

describe('external sites (§5, ADR 0037)', () => {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
  const pro = () => env.DB.prepare("UPDATE users SET plan = 'api' WHERE id = 1").run();
  const addExternal = (host = 'othersite.net', collector = 'example.com') => addSite(host, { collector_host: collector });
  const extNames = async (id: string) => namesFor((await env.DB.prepare('SELECT seed FROM sites WHERE id = ?').bind(id).first<{ seed: string }>())!.seed);
  const beacon = (names: { path: string; c: string }, origin: string | null, body: string) =>
    viaWorker(`https://example.com${names.path}/${names.c}`, { method: 'POST', body, headers: { 'content-type': 'text/plain;charset=UTF-8', 'user-agent': UA, ...(origin ? { origin } : {}) } });

  it('are Pro only; on Pro the route is on the collector host and the snippet sends there', async () => {
    expect((await addExternal()).body.error).toMatchObject({ code: 'limit_reached', details: { limit: 0 } });
    await pro();
    const r = await addExternal();
    expect(r.status).toBe(202);
    const site = r.body.site;
    expect(site).toMatchObject({ host: 'othersite.net', kind: 'external', collector_host: 'example.com', state: 'active' });
    expect(routes()).toEqual([expect.objectContaining({ pattern: `example.com${site.path}/*`, script: 'clx-edge' })]);
    const names = await extNames(site.id);
    expect(site.snippet.inline).toContain(`https://example.com${names.path}/${names.c}`);
    expect(site.snippet.script_tag).toContain(`src="https://example.com${names.path}/${names.s}.js"`);
    const js = await viaWorker(`https://example.com${names.path}/${names.s}.js`);
    expect(js).toMatchObject({ status: 200, origin: false });
    expect(js.body).toContain('https://example.com');
    // Anything else on the collector host is its own.
    expect(await viaWorker(`https://example.com${names.path}/nope`)).toMatchObject({ origin: true });
    expect(await viaWorker('https://example.com/pricing')).toMatchObject({ origin: true });
  });

  it("counts a beacon from its own origin, the page and the source from the body; another origin, none, null or a port is dropped", async () => {
    await pro();
    const names = await extNames((await addExternal()).body.site.id);
    const a = await beacon(names, 'https://www.othersite.net', '/pricing\nhttps://ref.example/x');
    expect(a).toMatchObject({ status: 204, origin: false });
    expect(a.headers.get('access-control-allow-origin')).toBe('https://www.othersite.net');
    expect(a.headers.get('cache-control')).toBe('no-store');
    await beacon(names, 'http://othersite.net', '/about\nhttps://www.othersite.net/pricing');
    await beacon(names, 'https://othersite.net', '/about/42f0c9d0e1a2b3c4d5e6f7a8\nhttps://other.ref/');
    for (const origin of ['https://evil.example', null, 'null', 'https://othersite.net:8443', 'ftp://othersite.net']) {
      const dropped = await beacon(names, origin, '/x\n');
      expect(dropped.status).toBe(204);
      expect(dropped.headers.get('access-control-allow-origin')).toBeNull();
    }
    expect(userDb().prepare('SELECT views FROM totals').all()).toEqual([{ views: 3 }]);
    // Two pages and two sources apart (the lesson of 06.10); the own site is no source, an id is `:id`.
    const rows = userDb().prepare('SELECT page, source, views FROM views_hourly ORDER BY page, source').all();
    expect(rows).toEqual([
      { page: '/about', source: '', views: 1 },
      { page: '/about/:id', source: 'other.ref', views: 1 },
      { page: '/pricing', source: 'ref.example', views: 1 },
    ]);
  });

  it('a host in a zone, a collector in none, a link host as collector or an old bundle is refused', async () => {
    await pro();
    expect((await addExternal('blog.example.com')).body.error).toMatchObject({ code: 'invalid_request', details: { field: 'host' } });
    expect((await addExternal('othersite.net', 'nowhere.net')).body.error).toMatchObject({ code: 'zone_not_found', details: { field: 'collector_host' } });
    expect((await addExternal('othersite.net', 'othersite.net')).body.error).toMatchObject({ code: 'invalid_request', details: { field: 'collector_host' } });
    await env.DB.prepare("INSERT INTO link_hosts (id, account_id, host, zone_id, state, revision, created_at, updated_at) VALUES ('lh1', ?, 'go.example.com', 'zone1', 'active', 0, 0, 0)").bind(accountId).run();
    expect((await addExternal('othersite.net', 'go.example.com')).body.error).toMatchObject({ code: 'invalid_request', details: { field: 'collector_host' } });
    await env.DB.prepare("UPDATE edge_accounts SET bundle = ?").bind(RELEASED[10]).run();
    expect((await addExternal()).body.error.code).toBe('update_required');
  });

  it('keeps its path for life: no rotation, no link host of its own; a host once per user', async () => {
    await pro();
    const { site } = (await addExternal()).body;
    expect((await call('POST', `/v1/sites/${site.id}/rotate`)).body.error.code).toBe('invalid_request');
    expect((await call('POST', '/v1/link-hosts', { body: { site_id: site.id } })).body.error).toMatchObject({ code: 'invalid_request', details: { field: 'site_id' } });
    expect((await addExternal()).body.error.code).toBe('site_exists');
    // Its collector host is a site's route host: no link host there.
    expect((await call('POST', '/v1/link-hosts', { body: { account_id: accountId, host: 'example.com' } })).body.error.code).toBe('invalid_request');
  });

  it("an external site is added under the account's lease; a zone site that meets its path is drawn again", async () => {
    await pro();
    await env.DB.prepare("UPDATE edge_accounts SET lease_until = ?, lease_owner = 'other'").bind(Date.now() + 60_000).run();
    expect((await addExternal()).body.error.code).toBe('operation_in_progress');
    expect(await env.DB.prepare('SELECT count(*) AS n FROM sites').first('n')).toBe(0);
    await env.DB.prepare('UPDATE edge_accounts SET lease_until = NULL, lease_owner = NULL').run();
    const ext = (await addExternal()).body.site;
    const zone = (await addSite('example.com')).body.site;
    // As if the zone site had been added while the lease was held, on the external site's path.
    await env.DB.prepare("UPDATE sites SET seed = (SELECT seed FROM sites WHERE id = ?1), state = 'route_pending', route_id = NULL, updated_at = 0 WHERE id = ?2").bind(ext.id, zone.id).run();
    fakeCf.routes.set('zone1', routes().filter((r) => r.pattern === `example.com${ext.path}/*`));
    await runSites(env);
    await runSites(env);
    const after = (await call('GET', `/v1/sites/${zone.id}`)).body.site;
    expect(after).toMatchObject({ state: 'active', config: 'synced' });
    expect(after.path).not.toBe(ext.path);
    expect((await call('GET', `/v1/sites/${ext.id}`)).body.site.path).toBe(ext.path);
    expect(routes().map((r) => r.pattern).sort()).toEqual([`example.com${after.path}/*`, `example.com${ext.path}/*`].sort());
    // Both count, each into its own target.
    const z = namesFor((await env.DB.prepare('SELECT seed FROM sites WHERE id = ?').bind(zone.id).first<{ seed: string }>())!.seed);
    await viaWorker(`https://example.com${z.path}/${z.c}`, { method: 'POST', body: '', headers: { 'content-type': 'text/plain', 'user-agent': UA } });
    await beacon(await extNames(ext.id), 'https://othersite.net', '/\n');
    expect(userDb().prepare('SELECT count(DISTINCT target) AS n, sum(views) AS v FROM totals').get()).toEqual({ n: 2, v: 2 });
  });

  it('a link host is never a collector: an ext: key left on its host answers nothing', async () => {
    const config = { t: 'sx', paths: [{ path: '/abc', c: 'def', s: 'ghi', script: '' }], excluded: [], origins: ['othersite.net'] };
    userDb().prepare("INSERT INTO commits (revision, sync_id, at) VALUES (900, 'x', 0)").run();
    const put = userDb().prepare("INSERT INTO cfg (key, revision, sync_id, deleted, data, at) VALUES (?, 900, 'x', 0, ?, 0)");
    put.run('ext:go.example.com/abc', JSON.stringify(config));
    put.run('linkhost:go.example.com', '{}');
    const r = await viaWorker('https://go.example.com/abc/def', { method: 'POST', body: '/\n', headers: { 'content-type': 'text/plain', origin: 'https://othersite.net', 'user-agent': UA } });
    expect(r).toMatchObject({ status: 404, origin: false });
    expect(userDb().prepare('SELECT count(*) AS n FROM totals').get()).toEqual({ n: 0 });
    // The same key on a host that is no link host counts — but not while that cannot be read.
    put.run('ext:example.com/abc', JSON.stringify(config));
    const post = (db?: D1Database) => viaWorker('https://example.com/abc/def', { method: 'POST', body: '/\n', headers: { 'content-type': 'text/plain', origin: 'https://othersite.net', 'user-agent': UA } }, db);
    const base = d1(userDb());
    const noLinkHosts = {
      ...base,
      prepare: (sql: string) => {
        const s = base.prepare(sql);
        return { ...s, bind: (...args: unknown[]) => (String(args[0]).startsWith('linkhost:') ? { ...s.bind(...args), first: () => Promise.reject(new Error('D1 down')) } : s.bind(...args)) };
      },
    } as D1Database;
    expect(await post(noLinkHosts)).toMatchObject({ origin: true });
    expect((await post()).headers.get('access-control-allow-origin')).toBe('https://othersite.net');
  });

  it('delete removes its route and withdraws its key; free pauses it, Pro brings it back', async () => {
    await pro();
    const zone = (await addSite('example.com')).body.site;
    const ext = (await addExternal()).body.site;
    const names = await extNames(ext.id);
    const key = `ext:example.com${names.path}`;
    const latest = () => userDb().prepare('SELECT c.deleted FROM cfg c JOIN commits m ON m.revision = c.revision AND m.sync_id = c.sync_id WHERE c.key = ? ORDER BY c.revision DESC LIMIT 1').get(key) as { deleted: number };
    await runSites(env);
    expect(latest().deleted).toBe(0);
    await env.DB.prepare("UPDATE users SET plan = 'free' WHERE id = 1").run();
    await applyPlan(env, 1);
    expect((await call('GET', `/v1/sites/${ext.id}`)).body.site.paused_at).not.toBeNull();
    expect((await call('GET', `/v1/sites/${zone.id}`)).body.site.paused_at).toBeNull();
    await runSites(env);
    expect(latest().deleted).toBe(1);
    expect(await beacon(names, 'https://othersite.net', '/\n')).toMatchObject({ origin: true });
    await env.DB.prepare('UPDATE users SET plan_comp = 1 WHERE id = 1').run();
    await applyPlan(env, 1);
    await runSites(env);
    expect(latest().deleted).toBe(0);
    await call('DELETE', `/v1/sites/${ext.id}`);
    expect(routes().map((r) => r.pattern)).toEqual([`example.com${zone.path}/*`]);
    expect(latest().deleted).toBe(1);
  });
});

describe('disconnect', () => {
  it("removes the sites' routes along with the worker and the database", async () => {
    fakeCf.foreignRoute('zone1', 'example.com/their/*', 'their-worker');
    await addSite('example.com');
    await call('POST', `/v1/sites/${(await call('GET', '/v1/sites')).body.sites[0].id}/rotate`);
    expect(routes()).toHaveLength(3);
    const gone = await call('DELETE', `/v1/accounts/${accountId}`);
    expect(gone.body.left).toEqual([]);
    expect(routes()).toEqual([expect.objectContaining({ script: 'their-worker' })]);
  });
});

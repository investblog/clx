// Sites (docs/spec.md §5) and the config sync (§6), against the fake Cloudflare; the worker itself
// (edge/worker.ts) reads the config clx wrote into the fake account's database.
import type { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { signAccess } from '../src/auth/jwt';
import { runSites } from '../src/cf/sites';
import { app } from '../src/index';
import { namesFor, scriptFor } from '../src/snippet';
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
  for (const t of ['sites', 'cf_calls', 'edge_accounts', 'operations', 'idempotency', 'api_keys', 'users']) await env.DB.prepare(`DELETE FROM ${t}`).run();
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
async function viaWorker(url: string, init: RequestInit = {}): Promise<{ status: number; body: string; headers: Headers; origin: boolean }> {
  vi.resetModules();
  const worker = (await import('../edge/worker')).default;
  let origin = false;
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async () => ((origin = true), new Response('the site itself', { status: 404 })));
  try {
    const { ctx, settle } = fakeCtx();
    const res = await worker.fetch(new Request(url, init), { DB: d1(userDb()) } as never, ctx);
    await settle();
    return { status: res.status, body: await res.text(), headers: res.headers, origin };
  } finally {
    vi.stubGlobal('fetch', realFetch);
  }
}

describe('adding a site', () => {
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

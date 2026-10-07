// Short links and the link host (docs/spec.md §6), against the fake Cloudflare; the worker itself
// (edge/worker.ts) redirects and counts from the config clx wrote into the fake account's database.
import type { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { signAccess } from '../src/auth/jwt';
import type { EdgeAccount } from '../src/cf/connect';
import { runLinkHosts } from '../src/cf/links';
import { runSites } from '../src/cf/sites';
import { app } from '../src/index';
import { generateMatrix, renderSvg } from '../src/qr';
import { receive } from '../src/push';
import { clearReportCache, linkReport } from '../src/report';
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
  for (const t of ['links', 'link_hosts', 'sites', 'cf_calls', 'edge_accounts', 'operations', 'idempotency', 'api_keys', 'users']) await env.DB.prepare(`DELETE FROM ${t}`).run();
  await env.DB.prepare("INSERT INTO users (id, email, password_hash, created_at, email_confirmed_at, plan) VALUES (1, 'free@example.com', 'x', 0, 0, 'free')").run();
  fakeCf.reset();
  accountId = await ready();
});

let ip = 0;
let idem = 0;
const session = (user: number) => signAccess('test-jwt-secret', user, Date.now()).then((t) => `Bearer ${t}`);
async function call(method: string, path: string, opts: { body?: unknown } = {}) {
  const headers: Record<string, string> = { authorization: await session(1), 'cf-connecting-ip': `10.4.0.${++ip % 250}` };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['idempotency-key'] = `l${++idem}`;
  const { ctx, settle } = fakeCtx();
  const res = await app.request(`https://clx.cx${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }, env, ctx);
  await settle();
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

/** Connect and confirm the install, as the worker's self-check would. */
async function ready(): Promise<string> {
  const { body } = await call('POST', '/v1/accounts', { body: { cf_account_id: ACC, bootstrap_token: BOOT } });
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

const setHost = (host: string) => call('PUT', `/v1/accounts/${accountId}/link-host`, { body: { host } });
const addLink = (body: Record<string, unknown>) => call('POST', '/v1/links', { body: { account_id: accountId, ...body } });
const routes = () => fakeCf.routes.get('zone1') ?? [];
const userDb = (): DatabaseSync => {
  const id = fakeCf.scripts.get('clx-edge')!.bindings.find((b) => b.name === 'DB')!.id!;
  return fakeCf.dbs.get(id)!.db;
};

/** A request through the worker, with a fresh isolate (no cached config), a fake origin and the
 *  visitor's country as Cloudflare would set it; its counting has finished when this returns. */
async function viaWorker(url: string, init: RequestInit = {}, country = 'RS'): Promise<{ status: number; body: string; headers: Headers; origin: boolean }> {
  vi.resetModules();
  const worker = (await import('../edge/worker')).default;
  let origin = false;
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async () => ((origin = true), new Response('the origin', { status: 404 })));
  try {
    const { ctx, settle } = fakeCtx();
    const request = new Request(url, init);
    Object.defineProperty(request, 'cf', { value: { country } });
    const res = await worker.fetch(request, { DB: d1(userDb()) } as never, ctx);
    await settle();
    return { status: res.status, body: await res.text(), headers: res.headers, origin };
  } finally {
    vi.stubGlobal('fetch', realFetch);
  }
}
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const visit = (url: string, headers: Record<string, string> = {}, country?: string) => viaWorker(url, { headers: { 'user-agent': CHROME, 'cf-connecting-ip': '198.51.100.7', ...headers } }, country);

describe('the link host', () => {
  it('gets no route while another operation holds the account; the cron makes it after', async () => {
    const hold = (until: number | null) => env.DB.prepare("UPDATE edge_accounts SET lease_until = ?, lease_owner = 'other'").bind(until).run();
    await hold(Date.now() + 60_000);
    expect((await setHost('go.example.com')).body.link_host.state).toBe('route_pending');
    expect(routes()).toEqual([]);
    await hold(null);
    await runLinkHosts(env, Date.now() + 61_000);
    expect((await call('GET', `/v1/accounts/${accountId}`)).body.account.link_host.state).toBe('active');
    expect(routes()).toHaveLength(1);
  });

  it('routes the whole host to clx-edge and reaches the worker; the account shows it', async () => {
    const r = await setHost('go.example.com');
    expect(r.status).toBe(202);
    expect(r.body.link_host).toMatchObject({ host: 'go.example.com', state: 'active' });
    expect(routes()).toEqual([expect.objectContaining({ pattern: 'go.example.com/*', script: 'clx-edge' })]);
    expect((await call('GET', `/v1/accounts/${accountId}`)).body.account.link_host).toMatchObject({ host: 'go.example.com', state: 'active', config: 'synced' });
    // Nothing on it passes through: there is no origin behind a link host.
    expect(await visit('https://go.example.com/')).toMatchObject({ status: 404, body: '', origin: false });
    expect(await visit('https://go.example.com/nope')).toMatchObject({ status: 404, body: '', origin: false });
    // Another host of the zone is not a link host: passed through.
    expect(await visit('https://example.com/nope')).toMatchObject({ origin: true });
  });

  it('a host in no zone is refused; the same host again changes nothing', async () => {
    expect((await setHost('go.nowhere.net')).body.error.code).toBe('zone_not_found');
    await setHost('go.example.com');
    expect((await setHost('go.example.com')).status).toBe(202);
    expect(routes()).toHaveLength(1);
  });

  it('another host replaces it: the old route goes, the links answer on the new host', async () => {
    await setHost('go.example.com');
    await addLink({ code: 'promo', url: 'https://shop.example.org/sale' });
    const r = await setHost('l.example.com');
    expect(r.body.link_host).toMatchObject({ host: 'l.example.com', state: 'active' });
    expect(routes().map((x) => x.pattern)).toEqual(['l.example.com/*']);
    expect(await visit('https://l.example.com/promo')).toMatchObject({ status: 302 });
    expect(await visit('https://go.example.com/promo')).toMatchObject({ origin: true });
    expect((await call('GET', '/v1/links')).body.links[0].short_url).toBe('https://l.example.com/promo');
  });

  it('a host another worker holds is route_conflict: not a link host for the worker', async () => {
    fakeCf.takenHosts.add('go.example.com');
    expect((await setHost('go.example.com')).body.link_host).toMatchObject({ state: 'route_conflict', error: { code: 'route_conflict' } });
    await runSites(env);
    expect(await visit('https://go.example.com/x1y2z3')).toMatchObject({ origin: true });
  });

  it('the same host again after a conflict tries the route once more', async () => {
    fakeCf.takenHosts.add('go.example.com');
    expect((await setHost('go.example.com')).body.link_host.state).toBe('route_conflict');
    fakeCf.takenHosts.clear();
    fakeCf.routes.clear();
    expect((await setHost('go.example.com')).body.link_host).toMatchObject({ state: 'active', error: null });
    await runSites(env);
    expect(await visit('https://go.example.com/x1y2z3')).toMatchObject({ status: 404, origin: false });
  });

  it('a site host cannot be the link host, nor the link host a site: one passes through, the other does not', async () => {
    expect((await call('POST', '/v1/sites', { body: { account_id: accountId, host: 'example.com' } })).status).toBe(202);
    expect(await setHost('example.com')).toMatchObject({ status: 409, body: { error: { details: { field: 'host' } } } });
    await setHost('go.example.com');
    expect(await call('POST', '/v1/sites', { body: { account_id: accountId, host: 'go.example.com' } })).toMatchObject({ status: 409, body: { error: { details: { field: 'host' } } } });
    expect(await visit('https://example.com/about')).toMatchObject({ origin: true });
  });

  it('a replacement refused in the batch keeps the current link host', async () => {
    await setHost('go.example.com');
    // A site for the new host appears after the check, while the zone is looked up.
    fakeCf.onZones = async () => {
      fakeCf.onZones = null;
      await env.DB.prepare(
        "INSERT INTO sites (id, account_id, user_id, target, host, zone_id, seed, state, revision, created_at, updated_at) VALUES ('race', ?, 1, 'srace', 'l.example.com', 'zone1', 'seed', 'active', 0, 0, 0)",
      )
        .bind(accountId)
        .run();
    };
    expect((await setHost('l.example.com')).status).toBe(409);
    expect((await call('GET', `/v1/accounts/${accountId}`)).body.account.link_host).toMatchObject({ host: 'go.example.com', state: 'active' });
    expect(routes().map((x) => x.pattern)).toEqual(['go.example.com/*']);
  });

  it('a route Cloudflare could not make now is made by the cron', async () => {
    fakeCf.failOnce.add('/workers/routes');
    expect((await setHost('go.example.com')).body.link_host.state).toBe('route_pending');
    await env.DB.prepare('UPDATE link_hosts SET updated_at = 0').run();
    expect(await runLinkHosts(env)).toBe(1);
    expect((await call('GET', `/v1/accounts/${accountId}`)).body.account.link_host.state).toBe('active');
  });

  it('a host a link points at cannot become the link host', async () => {
    await setHost('go.example.com');
    await addLink({ code: 'promo', url: 'https://l.example.com/x' });
    expect(await setHost('l.example.com')).toMatchObject({ status: 409, body: { error: { details: { field: 'host' } } } });
    expect(routes().map((x) => x.pattern)).toEqual(['go.example.com/*']);
  });

  it('disconnect removes the link host route with the rest', async () => {
    await setHost('go.example.com');
    const r = await call('DELETE', `/v1/accounts/${accountId}`);
    expect(r.body.left).toEqual([]);
    expect(routes()).toEqual([]);
  });
});

describe('links', () => {
  beforeEach(async () => void (await setHost('go.example.com')));

  it('needs a link host first', async () => {
    await env.DB.prepare('DELETE FROM link_hosts').run();
    expect((await addLink({ url: 'https://example.org/' })).body.error.code).toBe('link_host_required');
  });

  it('a click: 302 to the URL, no-store, nothing else; counted as a view of the link', async () => {
    const r = await addLink({ code: 'promo', url: 'https://shop.example.org/sale?x=1' });
    expect(r.status).toBe(201);
    // Answered before the sync, which runs after it.
    expect(r.body.link).toMatchObject({ code: 'promo', short_url: 'https://go.example.com/promo', url: 'https://shop.example.org/sale?x=1', state: 'active', config: 'pending' });
    expect((await call('GET', `/v1/links/${r.body.link.id}`)).body.link.config).toBe('synced');
    const res = await visit('https://go.example.com/promo', { referer: 'https://news.example.net/item' });
    expect(res).toMatchObject({ status: 302, body: '', origin: false });
    expect(Object.fromEntries(res.headers)).toEqual({ location: 'https://shop.example.org/sale?x=1', 'cache-control': 'no-store' });
    const t = (await env.DB.prepare('SELECT target FROM links').first<string>('target'))!;
    expect(userDb().prepare('SELECT views FROM totals WHERE target = ?').get(t)).toEqual({ views: 1 });
    expect(userDb().prepare('SELECT page, source, country, device FROM views_hourly WHERE target = ?').all(t)).toEqual([{ page: '', source: 'news.example.net', country: 'RS', device: 'desktop' }]);
    expect(userDb().prepare('SELECT count(*) AS n FROM visitors_daily WHERE target = ?').get(t)).toEqual({ n: 1 });
  });

  it("the QR code's ?q is source qr; a HEAD is redirected but not counted; other methods are 404", async () => {
    await addLink({ code: 'promo', url: 'https://shop.example.org/' });
    expect(await visit('https://go.example.com/promo?q')).toMatchObject({ status: 302 });
    expect((await viaWorker('https://go.example.com/promo', { method: 'HEAD' })).status).toBe(302);
    expect((await viaWorker('https://go.example.com/promo', { method: 'POST' })).status).toBe(404);
    expect(userDb().prepare("SELECT source, views FROM views_hourly WHERE target LIKE 'l%'").all()).toEqual([{ source: 'qr', views: 1 }]);
  });

  it('a bot is redirected too and counted as a bot', async () => {
    await addLink({ code: 'promo', url: 'https://shop.example.org/' });
    expect((await visit('https://go.example.com/promo', { 'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' })).status).toBe(302);
    expect(userDb().prepare("SELECT views, bots FROM totals WHERE target LIKE 'l%'").get()).toEqual({ views: 0, bots: 1 });
  });

  it('rules: the first match by country and device wins, else the URL', async () => {
    await addLink({
      code: 'app',
      url: 'https://example.org/',
      rules: [
        { countries: ['DE', 'AT'], devices: ['mobile'], url: 'https://example.org/de-mobile' },
        { countries: ['DE'], url: 'https://example.org/de' },
        { devices: ['mobile'], url: 'https://example.org/mobile' },
      ],
    });
    const where = async (ua: string, country: string) => (await visit('https://go.example.com/app', { 'user-agent': ua }, country)).headers.get('location');
    expect(await where(IPHONE, 'AT')).toBe('https://example.org/de-mobile');
    expect(await where(CHROME, 'DE')).toBe('https://example.org/de');
    expect(await where(IPHONE, 'RS')).toBe('https://example.org/mobile');
    expect(await where(CHROME, 'RS')).toBe('https://example.org/');
  });

  it('a random 6-character code unless chosen; a taken code is link_exists, a deleted one is free again', async () => {
    const r = await addLink({ url: 'https://example.org/' });
    expect(r.body.link.code).toMatch(/^[A-Za-z0-9]{6}$/u);
    await addLink({ code: 'promo', url: 'https://example.org/a' });
    expect((await addLink({ code: 'promo', url: 'https://example.org/b' })).body.error.code).toBe('link_exists');
    const id = (await call('GET', '/v1/links')).body.links.find((l: { code: string }) => l.code === 'promo').id;
    expect((await call('DELETE', `/v1/links/${id}`)).body.link.state).toBe('deleted');
    expect(await visit('https://go.example.com/promo')).toMatchObject({ status: 404, origin: false });
    expect((await addLink({ code: 'promo', url: 'https://example.org/c' })).status).toBe(201);
    expect((await visit('https://go.example.com/promo')).headers.get('location')).toBe('https://example.org/c');
  });

  it('a code deleted and added again before the sync: one row per key, the live one', async () => {
    await addLink({ code: 'promo', url: 'https://example.org/a' });
    fakeCf.failSql = /INSERT INTO cfg/u;
    const id = (await call('GET', '/v1/links')).body.links[0].id;
    await call('DELETE', `/v1/links/${id}`);
    await addLink({ code: 'promo', url: 'https://example.org/b' });
    fakeCf.failSql = null;
    expect((await runSites(env)).synced).toBe(1);
    expect((await visit('https://go.example.com/promo')).headers.get('location')).toBe('https://example.org/b');
  });

  it('targets: https only, at most 2048 characters, never the link host; rules are checked', async () => {
    for (const url of ['http://example.org/', 'javascript:alert(1)', `https://example.org/${'x'.repeat(2048)}`, 'https://go.example.com/loop', 'https://user:pw@example.org/'])
      expect((await addLink({ url })).body.error).toMatchObject({ code: 'invalid_request', details: { field: 'url' } });
    expect((await addLink({ code: 'a', url: 'https://example.org/' })).body.error.details.field).toBe('code');
    for (const rules of [[{ url: 'https://example.org/' }], [{ countries: ['de'], url: 'https://example.org/' }], [{ devices: ['tablet'], url: 'https://example.org/' }], [{ countries: ['DE'], url: 'https://go.example.com/x' }]])
      expect((await addLink({ url: 'https://example.org/', rules })).body.error.code).toBe('invalid_request');
    expect((await addLink({ url: 'https://example.org/', rules: Array.from({ length: 11 }, () => ({ devices: ['mobile'], url: 'https://example.org/m' })) })).body.error.details.field).toBe('rules');
  });

  it('a change of URL or rules reaches the worker; the code stays', async () => {
    const id = (await addLink({ code: 'promo', url: 'https://example.org/a' })).body.link.id;
    expect((await call('PATCH', `/v1/links/${id}`, { body: { code: 'other' } })).body.error.details.field).toBe('code');
    const r = await call('PATCH', `/v1/links/${id}`, { body: { url: 'https://example.org/b', rules: [{ countries: ['RS'], url: 'https://example.org/rs' }] } });
    expect(r.body.link).toMatchObject({ url: 'https://example.org/b', rules: [{ countries: ['RS'], url: 'https://example.org/rs' }] });
    expect((await visit('https://go.example.com/promo', {}, 'RS')).headers.get('location')).toBe('https://example.org/rs');
    expect((await visit('https://go.example.com/promo', {}, 'DE')).headers.get('location')).toBe('https://example.org/b');
  });

  it('the QR code: an SVG of the address with ?q; size on request; none for a deleted link', async () => {
    const id = (await addLink({ code: 'promo', url: 'https://example.org/' })).body.link.id;
    const get = async (q = '') => {
      const res = await app.request(`https://clx.cx/v1/links/${id}/qr.svg${q}`, { headers: { authorization: await session(1), 'cf-connecting-ip': '10.4.2.1' } }, env);
      return { status: res.status, type: res.headers.get('content-type'), disposition: res.headers.get('content-disposition'), cache: res.headers.get('cache-control'), body: await res.text() };
    };
    // A key without the links scope gets no QR code.
    await env.DB.prepare("UPDATE users SET plan = 'api' WHERE id = 1").run();
    const issued = await call('POST', '/v1/keys', { body: { scopes: ['reports'] } });
    const denied = await app.request(`https://clx.cx/v1/links/${id}/qr.svg`, { headers: { authorization: `Bearer ${issued.body.key}`, 'cf-connecting-ip': '10.4.2.2' } }, env);
    expect(((await denied.json()) as { error: { code: string } }).error.code).toBe('scope_required');
    const r = await get();
    expect(r).toMatchObject({ status: 200, type: 'image/svg+xml', disposition: 'inline; filename="promo.svg"', cache: 'no-store' });
    expect(r.body).toBe(renderSvg(generateMatrix('https://go.example.com/promo?q', { ecc: 'M' })));
    expect((await get('?size=256')).body).toContain('width="256" height="256"');
    expect((await get('?size=10')).status).toBe(400);
    await call('DELETE', `/v1/links/${id}`);
    expect((await get()).status).toBe(404);
  });

  it('the free plan stops at its link limit', async () => {
    await env.DB.prepare(
      "INSERT INTO links (id, account_id, user_id, target, code, url, url_host, state, revision, created_at, updated_at) SELECT 'x' || value, ?1, 1, 'lx' || value, 'c' || value || 'xx', 'https://example.org/', 'example.org', 'active', 0, 0, 0 FROM json_each(?2)",
    )
      .bind(accountId, JSON.stringify(Array.from({ length: 200 }, (_, i) => i)))
      .run();
    expect((await addLink({ url: 'https://example.org/' })).body.error).toMatchObject({ code: 'limit_reached', details: { limit: 200 } });
  });
});

describe('the report of a link', () => {
  beforeEach(async () => {
    clearReportCache();
    await setHost('go.example.com');
  });

  it('today live from the account: clicks by hour, the open hour included; with breakdowns', async () => {
    const id = (await addLink({ code: 'promo', url: 'https://example.org/' })).body.link.id;
    await visit('https://go.example.com/promo?q');
    await visit('https://go.example.com/promo', { 'user-agent': IPHONE, 'cf-connecting-ip': '198.51.100.8' });
    const r = (await call('GET', `/v1/links/${id}/report?period=today&breakdowns=1`)).body.report;
    expect(r).toMatchObject({ period: 'today', totals: { views: 2, bots: 0, visitors: 2 }, incomplete: false });
    expect(r.as_of).not.toBeNull();
    expect(r.series).toHaveLength(new Date().getUTCHours() + 1);
    expect(r.series.at(-1)).toMatchObject({ views: 2 });
    expect(r.breakdowns.sources).toEqual([
      { key: '', n: 1 },
      { key: 'qr', n: 1 },
    ]);
    expect(r.breakdowns.devices).toEqual([
      { key: 'desktop', n: 1 },
      { key: 'mobile', n: 1 },
    ]);
  });

  it('closed days from clx.cx, today from the account; the 7 days add up', async () => {
    const id = (await addLink({ code: 'promo', url: 'https://example.org/' })).body.link.id;
    const t = (await env.DB.prepare('SELECT target FROM links').first<string>('target'))!;
    const day = Math.floor(Date.now() / 86_400_000);
    await env.DB.prepare('INSERT INTO daily (account_id, target, day, as_of_hour, final, views, bots, visitors) VALUES (?1, ?2, ?3, ?3 * 24 + 23, 1, 7, 2, 5)').bind(accountId, t, day - 2).run();
    await visit('https://go.example.com/promo');
    const r = (await call('GET', `/v1/links/${id}/report?period=7d`)).body.report;
    expect(r.totals).toEqual({ views: 8, bots: 2, visitors: 6 });
    expect(r.series.map((p: { views: number }) => p.views)).toEqual([0, 0, 0, 0, 7, 0, 1]);
    // The list shows the clicks of the last 7 closed days.
    expect((await call('GET', '/v1/links')).body.links[0].clicks_7d).toBe(7);
  });

  it('a day closed in the account but not sent yet: read live, its visitors from final_days', async () => {
    const id = (await addLink({ code: 'promo', url: 'https://example.org/' })).body.link.id;
    const t = (await env.DB.prepare('SELECT target FROM links').first<string>('target'))!;
    const day = Math.floor(Date.now() / 86_400_000);
    userDb().prepare('INSERT INTO totals (target, day, views, bots) VALUES (?, ?, 4, 1)').run(t, day - 1);
    userDb().prepare('INSERT INTO final_days (target, day, views, bots, visitors) VALUES (?, ?, 4, 1, 3)').run(t, day - 1);
    const r = (await call('GET', `/v1/links/${id}/report?period=7d`)).body.report;
    expect(r.totals).toEqual({ views: 4, bots: 1, visitors: 3 });
  });

  it('a cached read is as old as it is: as_of does not move with the request', async () => {
    await addLink({ code: 'promo', url: 'https://example.org/' });
    const t = (await env.DB.prepare('SELECT target FROM links').first<string>('target'))!;
    const edge = (await env.DB.prepare('SELECT * FROM edge_accounts').first<EdgeAccount>())!;
    // Ten minutes into the hour: a minute later is the same hour, so the same read (a new hour is a
    // new read — the cache key holds it).
    const now = Math.floor(Date.now() / 3_600_000) * 3_600_000 + 10 * 60_000;
    const first = await linkReport(env, { id: 1, plan: 'free' }, edge, t, 'today', false, now);
    const later = await linkReport(env, { id: 1, plan: 'free' }, edge, t, 'today', false, now + 60_000);
    expect(later.as_of).toBe(first.as_of);
    expect(first.as_of).toBe(new Date(now).toISOString());
  });

  it('totals and breakdowns of one answer are of the same moment, whatever was cached before', async () => {
    const id = (await addLink({ code: 'promo', url: 'https://example.org/' })).body.link.id;
    await visit('https://go.example.com/promo');
    expect((await call('GET', `/v1/links/${id}/report?period=today`)).body.report.totals.views).toBe(1);
    await visit('https://go.example.com/promo', { 'cf-connecting-ip': '198.51.100.9' });
    const r = (await call('GET', `/v1/links/${id}/report?period=today&breakdowns=1`)).body.report;
    expect(r.totals.views).toBe(2);
    expect(r.breakdowns.devices.reduce((n: number, d: { n: number }) => n + d.n, 0)).toBe(2);
  });

  it('a key without the reports scope lists links without their clicks', async () => {
    await env.DB.prepare("UPDATE users SET plan = 'api' WHERE id = 1").run();
    await addLink({ code: 'promo', url: 'https://example.org/' });
    const issued = await call('POST', '/v1/keys', { body: { scopes: ['links'] } });
    const res = await app.request('https://clx.cx/v1/links', { headers: { authorization: `Bearer ${issued.body.key}`, 'cf-connecting-ip': '10.4.1.1' } }, env);
    const links = ((await res.json()) as { links: Record<string, unknown>[] }).links;
    expect(links).toHaveLength(1);
    expect(links[0]).not.toHaveProperty('clicks_7d');
    expect((await call('GET', '/v1/links')).body.links[0]).toHaveProperty('clicks_7d', 0);
  });

  it("the account's database unreachable: clx.cx's days, today unavailable with the reason", async () => {
    const id = (await addLink({ code: 'promo', url: 'https://example.org/' })).body.link.id;
    const t = (await env.DB.prepare('SELECT target FROM links').first<string>('target'))!;
    const day = Math.floor(Date.now() / 86_400_000);
    await env.DB.prepare('INSERT INTO daily (account_id, target, day, as_of_hour, final, views, bots, visitors) VALUES (?1, ?2, ?3, ?3 * 24 + 23, 1, 3, 0, 3)').bind(accountId, t, day - 1).run();
    fakeCf.failSql = /FROM totals t/u;
    const r = (await call('GET', `/v1/links/${id}/report?period=7d&breakdowns=1`)).body.report;
    expect(r).toMatchObject({ totals: { views: 3 }, as_of: null, breakdowns: null, unavailable: 'cloudflare' });
    expect((await call('GET', `/v1/links/${id}/report?period=today`)).body.report).toMatchObject({ series: [], unavailable: 'cloudflare' });
  });
});

describe('totals of links', () => {
  it('a link sends only its final days: hours and running snapshots of it are refused', async () => {
    await setHost('go.example.com');
    await addLink({ code: 'promo', url: 'https://example.org/' });
    const t = (await env.DB.prepare('SELECT target FROM links').first<string>('target'))!;
    const edge = (await env.DB.prepare('SELECT * FROM edge_accounts').first<EdgeAccount>())!;
    const now = Date.now();
    const day = Math.floor(now / 86_400_000);
    const r = await receive(env.DB, edge, {
      v: 1,
      bundle: 'x',
      schema: 4,
      queue: 0,
      revision: 0,
      items: [
        { id: 1, target: t, day: day - 1, final: true, views: 5, bots: 1, visitors: 4 },
        { id: 2, target: t, hour: Math.floor(now / 3_600_000) - 1, views: 1, bots: 0 },
        { id: 3, target: t, day, as_of_hour: Math.floor(now / 3_600_000) - 1, final: false, views: 1, bots: 0, visitors: 1 },
      ],
    } as never, now);
    expect(r).toEqual({ accepted: [1], rejected: [{ id: 2, reason: 'invalid' }, { id: 3, reason: 'invalid' }] });
    expect(await env.DB.prepare('SELECT views, visitors, final FROM daily WHERE target = ?').bind(t).first()).toEqual({ views: 5, visitors: 4, final: 1 });
  });
});

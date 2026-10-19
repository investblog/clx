// Short links and the link host (docs/spec.md §6), against the fake Cloudflare; the worker itself
// (edge/worker.ts) redirects and counts from the config clx wrote into the fake account's database.
import type { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDestination } from '../edge/contract';
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

/** The latest link host made (setHost): links are added on it. */
let hostId = '';
const setHost = async (host: string) => {
  const r = await call('POST', '/v1/link-hosts', { body: { account_id: accountId, host } });
  if (r.body.link_host?.id) hostId = r.body.link_host.id;
  return r;
};
const addLink = (body: Record<string, unknown>) => call('POST', '/v1/links', { body: { link_host_id: hostId, ...body } });
const routes = () => fakeCf.routes.get('zone1') ?? [];
const domains = () => [...fakeCf.domains.values()];
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

describe('the worker with its config unreadable (D1 down, the reads used up)', () => {
  async function unreadable(url: string, method = 'GET') {
    vi.resetModules();
    const worker = (await import('../edge/worker')).default;
    let origin = false;
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async () => ((origin = true), new Response('the origin')));
    try {
      const down = { prepare: () => ({ bind: () => ({ first: () => Promise.reject(new Error('D1 down')) }) }) };
      const res = await worker.fetch(new Request(url, { method }), { DB: down } as never, fakeCtx().ctx);
      return { status: res.status, retry: res.headers.get('retry-after'), origin };
    } finally {
      vi.stubGlobal('fetch', realFetch);
    }
  }

  it("a link's address is asked again later; a site's path still passes through", async () => {
    expect(await unreadable('https://go.example.com/promo')).toEqual({ status: 503, retry: '30', origin: false });
    expect(await unreadable('https://go.example.com/promo', 'HEAD')).toMatchObject({ status: 503 });
    // Not a link's address: a site's counter path, another method.
    expect(await unreadable('https://example.com/abcd/efgh.js')).toMatchObject({ origin: true });
    expect(await unreadable('https://go.example.com/promo', 'POST')).toMatchObject({ origin: true });
  });
});

describe('link hosts', () => {
  it('a named host becomes a custom domain of clx-edge — no route, no DNS record to make — and reaches the worker', async () => {
    const r = await setHost('go.example.com');
    expect(r.status).toBe(202);
    expect(r.body.link_host).toMatchObject({ host: 'go.example.com', state: 'active', site_id: null, account_id: accountId });
    expect(domains()).toEqual([expect.objectContaining({ hostname: 'go.example.com', service: 'clx-edge', zone_id: 'zone1' })]);
    expect(routes()).toEqual([]);
    expect((await call('GET', `/v1/link-hosts/${hostId}`)).body.link_host).toMatchObject({ state: 'active', config: 'synced' });
    expect((await call('GET', `/v1/accounts/${accountId}`)).body.account.link_hosts).toEqual([expect.objectContaining({ host: 'go.example.com' })]);
    // Nothing on it passes through: there is no origin behind a link host.
    expect(await visit('https://go.example.com/')).toMatchObject({ status: 404, body: '', origin: false });
    expect(await visit('https://go.example.com/nope')).toMatchObject({ status: 404, body: '', origin: false });
    // Another host of the zone is not a link host: passed through.
    expect(await visit('https://example.com/nope')).toMatchObject({ origin: true });
  });

  it('one per site: a random 3-character label under the site’s host, www. dropped; the sites’ links share nothing', async () => {
    const a = (await call('POST', '/v1/sites', { body: { account_id: accountId, host: 'www.example.com' } })).body.site;
    const b = (await call('POST', '/v1/sites', { body: { account_id: accountId, host: 'blog.example.com' } })).body.site;
    const ha = (await call('POST', '/v1/link-hosts', { body: { site_id: a.id } })).body.link_host;
    const hb = (await call('POST', '/v1/link-hosts', { body: { site_id: b.id } })).body.link_host;
    expect(ha).toMatchObject({ site_id: a.id, state: 'active', host: expect.stringMatching(/^[a-z0-9]{3}\.example\.com$/u) });
    expect(hb.host).toMatch(/^[a-z0-9]{3}\.blog\.example\.com$/u);
    // The same code on two hosts: two links, each on its own host.
    for (const h of [ha, hb]) expect((await call('POST', '/v1/links', { body: { link_host_id: h.id, code: 'promo', url: `https://${h.host === ha.host ? 'a' : 'b'}.example.org/` } })).status).toBe(201);
    expect((await visit(`https://${ha.host}/promo`)).headers.get('location')).toBe('https://a.example.org/');
    expect((await visit(`https://${hb.host}/promo`)).headers.get('location')).toBe('https://b.example.org/');
    expect((await call('GET', `/v1/link-hosts?account_id=${accountId}`)).body.link_hosts).toHaveLength(2);
  });

  it('a host with someone’s DNS record is never taken over: a site’s random label takes another, a named host is conflict', async () => {
    const site = (await call('POST', '/v1/sites', { body: { account_id: accountId, host: 'example.com' } })).body.site;
    // The first label drawn already has a record: the host ends on the next one.
    const real = crypto.getRandomValues.bind(crypto);
    let n = 0;
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(a: T): T => {
      if (a instanceof Uint8Array && a.length === 3) a.set(n++ < 1 ? [0, 0, 0] : [1, 1, 1]);
      else real(a as never);
      return a;
    });
    fakeCf.dnsRecords.add('aaa.example.com');
    try {
      expect((await call('POST', '/v1/link-hosts', { body: { site_id: site.id } })).body.link_host).toMatchObject({ host: 'bbb.example.com', state: 'active' });
    } finally {
      vi.restoreAllMocks();
    }
    fakeCf.dnsRecords.add('go.example.com');
    expect((await setHost('go.example.com')).body.link_host).toMatchObject({ state: 'conflict', error: { code: 'dns_record_exists', host: 'go.example.com' } });
    expect([...fakeCf.domains.values()].map((d) => d.hostname)).toEqual(['bbb.example.com']);
    await runSites(env);
    expect(await visit('https://go.example.com/x1y2z3')).toMatchObject({ origin: true });
  });

  it('a pending host is not in the worker’s config and takes no links; a site’s random host on another worker’s domain takes the next label', async () => {
    const hold = (until: number | null) => env.DB.prepare("UPDATE edge_accounts SET lease_until = ?, lease_owner = 'other'").bind(until).run();
    await hold(Date.now() + 60_000);
    expect((await setHost('go.example.com')).body.link_host.state).toBe('pending');
    expect(await addLink({ code: 'promo', url: 'https://shop.example.org/' })).toMatchObject({ status: 409, body: { error: { code: 'link_host_not_ready' } } });
    await runSites(env);
    expect(await visit('https://go.example.com/x1y2z3')).toMatchObject({ origin: true });
    await hold(null);
    const site = (await call('POST', '/v1/sites', { body: { account_id: accountId, host: 'example.com' } })).body.site;
    const real = crypto.getRandomValues.bind(crypto);
    let n = 0;
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(a: T): T => {
      if (a instanceof Uint8Array && a.length === 3) a.set(n++ < 1 ? [2, 2, 2] : [3, 3, 3]);
      else real(a as never);
      return a;
    });
    fakeCf.domains.set('dx', { id: 'dx', hostname: 'ccc.example.com', service: 'their-worker', zone_id: 'zone1' });
    try {
      expect((await call('POST', '/v1/link-hosts', { body: { site_id: site.id } })).body.link_host).toMatchObject({ host: 'ddd.example.com', state: 'active' });
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('a deleted host’s name stays taken until its custom domain is removed', async () => {
    await setHost('go.example.com');
    const hold = (until: number | null) => env.DB.prepare("UPDATE edge_accounts SET lease_until = ?, lease_owner = 'other'").bind(until).run();
    await hold(Date.now() + 60_000);
    expect((await call('DELETE', `/v1/link-hosts/${hostId}`)).body.link_host).toMatchObject({ state: 'deleted' });
    expect(domains()).toHaveLength(1);
    expect((await setHost('go.example.com')).status).toBe(409);
    await hold(null);
    // Still serving, it is no link's target either — a rule's included.
    await setHost('l.example.com');
    expect(await addLink({ url: 'https://shop.example.org/', rules: [{ devices: ['mobile'], url: 'https://go.example.com/x' }] })).toMatchObject({ status: 400, body: { error: { details: { field: 'rules[0].url' } } } });
    await env.DB.prepare('UPDATE link_hosts SET updated_at = 0').run();
    await runLinkHosts(env);
    expect(domains().map((d) => d.hostname)).toEqual(['l.example.com']);
    expect((await setHost('go.example.com')).body.link_host).toMatchObject({ host: 'go.example.com', state: 'active' });
  });

  it('{} or half of a named host is refused as such', async () => {
    expect((await call('POST', '/v1/link-hosts', { body: {} })).body.error).toMatchObject({ code: 'invalid_request', details: { field: 'account_id' } });
    expect((await call('POST', '/v1/link-hosts', { body: { account_id: accountId } })).body.error).toMatchObject({ code: 'invalid_request', details: { field: 'host' } });
  });

  it('another worker’s custom domain on the host is conflict, never adopted', async () => {
    fakeCf.domains.set('dx', { id: 'dx', hostname: 'go.example.com', service: 'their-worker', zone_id: 'zone1' });
    expect((await setHost('go.example.com')).body.link_host).toMatchObject({ state: 'conflict', error: { code: 'domain_taken', worker: 'their-worker' } });
  });

  it('a host in no zone, a site’s host, a host a link points at, a second time: refused', async () => {
    expect((await setHost('go.nowhere.net')).body.error.code).toBe('zone_not_found');
    expect((await call('POST', '/v1/sites', { body: { account_id: accountId, host: 'example.com' } })).status).toBe(202);
    expect(await setHost('example.com')).toMatchObject({ status: 409, body: { error: { details: { field: 'host' } } } });
    await setHost('go.example.com');
    expect(await call('POST', '/v1/sites', { body: { account_id: accountId, host: 'go.example.com' } })).toMatchObject({ status: 409, body: { error: { details: { field: 'host' } } } });
    expect(await setHost('go.example.com')).toMatchObject({ status: 409, body: { error: { details: { field: 'host' } } } });
    await addLink({ code: 'promo', url: 'https://l.example.com/x' });
    expect(await setHost('l.example.com')).toMatchObject({ status: 409, body: { error: { details: { field: 'host' } } } });
    expect(await call('POST', '/v1/link-hosts', { body: { site_id: 'nope' } })).toMatchObject({ status: 404, body: { error: { details: { field: 'site_id' } } } });
  });

  it('as many as the plan has sites, counted per user', async () => {
    for (let i = 0; i < 10; i++) expect((await setHost(`h${i}.example.com`)).status).toBe(202);
    expect((await setHost('h10.example.com')).body.error).toMatchObject({ code: 'limit_reached', details: { limit: 10 } });
  });

  it('while another operation holds the account the domain waits; the cron makes it after; one Cloudflare could not make now too', async () => {
    const hold = (until: number | null) => env.DB.prepare("UPDATE edge_accounts SET lease_until = ?, lease_owner = 'other'").bind(until).run();
    await hold(Date.now() + 60_000);
    expect((await setHost('go.example.com')).body.link_host.state).toBe('pending');
    expect(domains()).toEqual([]);
    await hold(null);
    await runLinkHosts(env, Date.now() + 61_000);
    expect((await call('GET', `/v1/link-hosts/${hostId}`)).body.link_host.state).toBe('active');
    fakeCf.failOnce.add('/workers/domains');
    expect((await setHost('l.example.com')).body.link_host.state).toBe('pending');
    await env.DB.prepare('UPDATE link_hosts SET updated_at = 0').run();
    await runLinkHosts(env);
    expect((await call('GET', `/v1/link-hosts/${hostId}`)).body.link_host.state).toBe('active');
  });

  it('deleting one: refused while links are on it; then its custom domain goes, and the host stops answering', async () => {
    await setHost('go.example.com');
    const link = (await addLink({ code: 'promo', url: 'https://shop.example.org/' })).body.link;
    expect(await call('DELETE', `/v1/link-hosts/${hostId}`)).toMatchObject({ status: 409, body: { error: { code: 'link_host_in_use', details: { links: 1 } } } });
    await call('DELETE', `/v1/links/${link.id}`);
    expect((await call('DELETE', `/v1/link-hosts/${hostId}`)).body.link_host.state).toBe('deleted');
    expect(domains()).toEqual([]);
    await runSites(env);
    expect(await visit('https://go.example.com/promo')).toMatchObject({ origin: true });
    // A custom domain someone pointed at another worker is left, and said so.
    await setHost('l.example.com');
    fakeCf.domains.get(domains()[0]!.id)!.service = 'their-worker';
    expect((await call('DELETE', `/v1/link-hosts/${hostId}`)).body.link_host).toMatchObject({ state: 'deleted', error: { code: 'domain_not_ours' } });
    expect(domains()).toHaveLength(1);
  });

  it('deleting a site leaves its link host; disconnect removes the custom domains with the rest', async () => {
    const site = (await call('POST', '/v1/sites', { body: { account_id: accountId, host: 'example.com' } })).body.site;
    await call('POST', '/v1/link-hosts', { body: { site_id: site.id } });
    await call('DELETE', `/v1/sites/${site.id}`);
    expect(domains()).toHaveLength(1);
    const r = await call('DELETE', `/v1/accounts/${accountId}`);
    expect(r.body.left).toEqual([]);
    expect(domains()).toEqual([]);
  });
});

describe('links', () => {
  beforeEach(async () => void (await setHost('go.example.com')));

  it('needs a link host of the caller', async () => {
    await env.DB.prepare('DELETE FROM link_hosts').run();
    expect((await addLink({ url: 'https://example.org/' })).body.error).toMatchObject({ code: 'not_found', details: { field: 'link_host_id' } });
  });

  it('a click: 302 to the URL, no-store, nothing else; counted as a view of the link, with where it went', async () => {
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
    expect(userDb().prepare('SELECT page, source, country, device FROM views_hourly WHERE target = ?').all(t)).toEqual([{ page: '>https://shop.example.org/sale?x=1', source: 'news.example.net', country: 'RS', device: 'desktop' }]);
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

  it('flows: the clicks by source and by the rule that sent them — a rule to the main URL apart from it; 512 characters kept', async () => {
    const long = `https://example.org/${'x'.repeat(600)}`;
    const rules = [{ countries: ['DE'], url: 'https://example.org/de' }, { devices: ['mobile'], url: long }, { countries: ['RS'], url: 'https://example.org/' }];
    const id = (await addLink({ code: 'promo', url: 'https://example.org/', rules })).body.link.id;
    await visit('https://go.example.com/promo?q', {}, 'DE');
    await visit('https://go.example.com/promo', { referer: 'https://news.example.net/a', 'cf-connecting-ip': '198.51.100.8' }, 'DE');
    await visit('https://go.example.com/promo', { referer: 'https://news.example.net/b', 'cf-connecting-ip': '198.51.100.9' }, 'RS');
    // A phone in Serbia: the phone rule comes first.
    await visit('https://go.example.com/promo', { 'user-agent': IPHONE, 'cf-connecting-ip': '198.51.100.10' }, 'RS');
    await visit('https://go.example.com/promo', { referer: 'https://news.example.net/c', 'cf-connecting-ip': '198.51.100.11' }, 'US');
    const b = (await call('GET', `/v1/links/${id}/report?period=today&breakdowns=1`)).body.report.breakdowns;
    const phone = `;mobile>${long}`.slice(0, 512);
    expect(b.flows).toEqual([
      { source: '', to: phone, n: 1 },
      { source: 'news.example.net', to: '>https://example.org/', n: 1 },
      { source: 'news.example.net', to: 'DE;>https://example.org/de', n: 1 },
      { source: 'news.example.net', to: 'RS;>https://example.org/', n: 1 },
      { source: 'qr', to: 'DE;>https://example.org/de', n: 1 },
    ]);
    expect(b.pages).toEqual([
      { key: 'DE;>https://example.org/de', n: 2 },
      { key: phone, n: 1 },
      { key: '>https://example.org/', n: 1 },
      { key: 'RS;>https://example.org/', n: 1 },
    ]);
    expect(b.flows.map((f: { to: string }) => parseDestination(f.to))).toContainEqual({ rule: { countries: [], devices: ['mobile'] }, url: long.slice(0, 504) });
  });

  it('the views beyond the detail caps are other in every breakdown, not Direct or Unknown', async () => {
    const id = (await addLink({ code: 'promo', url: 'https://example.org/' })).body.link.id;
    await visit('https://go.example.com/promo');
    const t = (await env.DB.prepare('SELECT target FROM links').first<string>('target'))!;
    userDb()
      .prepare("INSERT INTO views_hourly (target, hour, page, source, country, device, browser, os, views) VALUES (?, ?, '(other)', '', '', '', '', '', 3)")
      .run(t, Math.floor(Date.now() / 3_600_000));
    const b = (await call('GET', `/v1/links/${id}/report?period=today&breakdowns=1`)).body.report.breakdowns;
    for (const dim of ['pages', 'sources', 'countries', 'devices', 'browsers', 'os']) {
      expect(b[dim]).toContainEqual({ key: '(other)', n: 3 });
      expect(b[dim].reduce((n: number, e: { n: number }) => n + e.n, 0)).toBe(4);
    }
    expect(b.sources).toContainEqual({ key: '', n: 1 }); // the one direct click
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

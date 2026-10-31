#!/usr/bin/env node
// node scripts/probe-external.mjs [page host, default httpbin.org] [base URL, default https://clx.cx]
//
// The live check of external sites (docs/spec.md §5, ADR 0037): a site whose host is in no zone of
// the account, counted by the account's own clx-edge on a collector host of its zone. The collector
// host is clx-probe.<test zone> — first `node scripts/probe-pages.mjs up`, after `… down`. On the
// throwaway account of .secrets/test-cloudflare.env, as .secrets/user-probe@clx.cx.txt (Pro):
//   1. connect and install clx-edge;
//   2. POST /v1/sites {host, collector_host} → external, the config synced; the script answers on
//      the collector host; beacons with no Origin or a foreign one answer 204 without
//      access-control-allow-origin and count nothing;
//   3. the snippet goes to temp/probe-external.snippet.json, and the probe waits (up to 40 minutes)
//      for a real browser on the page host to send views — at least two pages and two sources;
//   4. delete: the route is gone; disconnect removes routes, worker and database.
// Nothing secret is printed.
import fs from 'node:fs';
import { lockSecrets } from './secrets-dir.mjs';

const PAGE_HOST = process.argv[2] ?? 'httpbin.org';
const BASE = process.argv[3] ?? 'https://clx.cx';
const CF = 'https://api.cloudflare.com/client/v4';
const OUT = 'temp/probe-external.snippet.json';
lockSecrets();
const env = Object.fromEntries(
  fs
    .readFileSync('.secrets/test-cloudflare.env', 'utf8')
    .split(/\r?\n/u)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/u, '$2')]),
);
const [email, password] = fs.readFileSync('.secrets/user-probe@clx.cx.txt', 'utf8').split(/\r?\n/u);
const account = env.CF_ACCOUNT_ID;
const admin = { 'X-Auth-Email': env.CF_EMAIL, 'X-Auth-Key': env.CF_GLOBAL_API_KEY };

async function cfAdmin(method, path, body) {
  const init = { method, headers: { ...admin } };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const json = await (await fetch(`${CF}${path}`, init)).json();
  if (!json.success) throw new Error(`${method} ${path} → ${JSON.stringify(json.errors)}`);
  return json.result;
}
async function clx(method, path, auth, body, idem) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { authorization: auth, ...(body ? { 'content-type': 'application/json' } : {}), ...(idem ? { 'idempotency-key': idem } : {}) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
let failed = 0;
const step = (what, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? ` — ${extra}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(read, done, minutes) {
  const end = Date.now() + minutes * 60_000;
  for (;;) {
    const v = await read();
    if (done(v) || Date.now() > end) return v;
    await sleep(10_000);
  }
}

const zone = await cfAdmin('GET', `/zones/${env.CF_ZONE_ID}`);
const collectorHost = `clx-probe.${zone.name}`;
const home = await until(() => fetch(`https://${collectorHost}/`).then((r) => r.status), (s) => s === 200, 10);
step(`the collector host answers through Cloudflare: ${collectorHost} (probe-pages.mjs up)`, home === 200, String(home));

const login = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
const session = `Bearer ${(await login.json()).access_token}`;
const run = Date.now().toString(36);
const issued = await clx('POST', '/v1/keys', session, { scopes: ['accounts', 'sites'], allow_accounts: [account] }, `probe-key-${run}`);
step('sign in, API key (accounts, sites)', login.ok && issued.status === 201, issued.body.prefix);
const key = `Bearer ${issued.body.key}`;

let boot = null;
let accountId = null;
try {
  const groups = await cfAdmin('GET', `/accounts/${account}/tokens/permission_groups`);
  const id = (name) => groups.find((g) => g.name === name).id;
  boot = await cfAdmin('POST', `/accounts/${account}/tokens`, {
    name: `probe-bootstrap-${run}`,
    expires_on: new Date(Date.now() + 86_400_000).toISOString().replace(/\.\d{3}Z$/u, 'Z'),
    policies: [{ effect: 'allow', resources: { [`com.cloudflare.api.account.${account}`]: '*' }, permission_groups: [{ id: id('Account Settings Read') }, { id: id('Account API Tokens Write') }] }],
  });
  const connected = await clx('POST', '/v1/accounts', key, { cf_account_id: account, bootstrap_token: boot.value }, `probe-connect-${run}`);
  accountId = connected.body.account?.id;
  step('POST /v1/accounts', Boolean(accountId), `${connected.status} ${accountId ? connected.body.account.state : JSON.stringify(connected.body.error)}`);
  const t0 = Date.now();
  const acc = await until(async () => (await clx('GET', `/v1/accounts/${accountId}`, key)).body.account, (a) => a?.state !== 'installing', 16);
  step('connected and installed', acc?.state === 'ready', `${acc?.state} in ${Math.round((Date.now() - t0) / 1000)} s ${acc?.error ? JSON.stringify(acc.error) : ''}`);

  // 2. The external site.
  const inZone = await clx('POST', '/v1/sites', key, { account_id: accountId, host: `other.${zone.name}`, collector_host: collectorHost }, `probe-inzone-${run}`);
  step('a host in a zone of the account with collector_host → 400', inZone.status === 400 && inZone.body.error?.code === 'invalid_request' && inZone.body.error?.details?.field === 'host', `${inZone.status} ${JSON.stringify(inZone.body.error)}`);
  const added = await clx('POST', '/v1/sites', key, { account_id: accountId, host: PAGE_HOST, collector_host: collectorHost }, `probe-site-${run}`);
  const siteId = added.body.site?.id;
  step('POST /v1/sites, external', added.status === 202 && added.body.site?.kind === 'external' && added.body.site?.collector_host === collectorHost, `${added.status} ${added.body.site?.state ?? JSON.stringify(added.body.error)}`);
  const site = await until(async () => (await clx('GET', `/v1/sites/${siteId}`, key)).body.site, (s) => s?.config === 'synced', 3);
  step('config synced to the worker', site?.config === 'synced');
  const code = site.snippet.inline.replace(/^<script>|<\/script>$/gu, '');
  const src = site.snippet.script_tag.match(/src="([^"]+)"/u)[1];
  const collector = code.match(/["'](https:\/\/[^"']+)["']/u)[1];
  step('the snippet names the collector host, absolute', src.startsWith(`https://${collectorHost}${site.path}/`) && collector.startsWith(`https://${collectorHost}${site.path}/`), `${site.path} ${site.snippet.inline.length} bytes`);

  const js = await until(() => fetch(src).then(async (r) => ({ status: r.status, body: await r.text() })), (r) => r.status === 200, 2);
  step('the script answers on the collector host, the snippet\'s own code', js.status === 200 && js.body === code, String(js.status));
  const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
  const beacon = (origin) => fetch(collector, { method: 'POST', body: '/forged\nhttps://forged.example/', headers: { 'content-type': 'text/plain', 'user-agent': CHROME, ...(origin ? { origin } : {}) } });
  const none = await until(() => beacon(), (r) => r.status === 204, 2);
  const foreign = await beacon('https://evil.example');
  const ported = await beacon(`https://${PAGE_HOST}:8443`);
  step('no Origin, a foreign one, a port: 204 without access-control-allow-origin', [none, foreign, ported].every((r) => r.status === 204 && !r.headers.get('access-control-allow-origin')), [none, foreign, ported].map((r) => r.status).join(', '));
  const db = (await cfAdmin('GET', `/accounts/${account}/d1/database?name=clx-edge`)).find((d) => d.name === 'clx-edge');
  const sql = async (q) => (await cfAdmin('POST', `/accounts/${account}/d1/database/${db.uuid}/query`, { sql: q }))[0].results;
  await sleep(5_000);
  const nothing = await sql("SELECT coalesce(sum(views), 0) AS views, coalesce(sum(bots), 0) AS bots, (SELECT count(*) FROM views_hourly) AS n FROM totals");
  step('… and counted nothing', nothing[0].views === 0 && nothing[0].bots === 0 && nothing[0].n === 0, JSON.stringify(nothing[0]));

  // 3. A real browser on the page host.
  fs.mkdirSync('temp', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ page_host: PAGE_HOST, collector_host: collectorHost, script_tag: site.snippet.script_tag, inline: site.snippet.inline, code, src, collector }, null, 2));
  console.log(`waiting for a browser on https://${PAGE_HOST}/ — the snippet is in ${OUT}`);
  // The database is this run's own (made by the install above, dropped by the disconnect below), and
  // the site is its only one: every row must carry one target — the site's (the API does not show it).
  const detailQ = 'SELECT target, page, source, country, device, browser, views FROM views_hourly ORDER BY page, source';
  const detail = await until(() => sql(detailQ), (rows) => new Set(rows.map((r) => r.page)).size >= 2 && new Set(rows.map((r) => r.source)).size >= 2, 40);
  const totals = await sql('SELECT target, views, bots FROM totals');
  step('a real browser counted: two pages, two sources, one target', new Set(detail.map((r) => r.page)).size >= 2 && new Set(detail.map((r) => r.source)).size >= 2 && !detail.some((r) => r.page === '/forged') && new Set([...detail, ...totals].map((r) => r.target)).size === 1,
    `totals ${JSON.stringify(totals)}, detail ${JSON.stringify(detail)}`);
  step('… as a desktop Chrome with a country', detail.every((r) => r.device === 'desktop' && r.browser === 'chrome' && /^[A-Z]{2}$/u.test(r.country)));

  // 4. Delete, disconnect.
  const deleted = await clx('DELETE', `/v1/sites/${siteId}`, key, undefined, `probe-delete-${run}`);
  step('DELETE /v1/sites/{id}', deleted.status === 200 && deleted.body.site?.state === 'deleted');
  const routes = await until(() => cfAdmin('GET', `/zones/${zone.id}/workers/routes`), (rs) => !rs.some((r) => r.pattern.startsWith(`${collectorHost}${site.path}`)), 3);
  step('no clx-edge route left on the collector host', !routes.some((r) => r.pattern.startsWith(`${collectorHost}${site.path}`)));
  const gone = await clx('DELETE', `/v1/accounts/${accountId}`, key, undefined, `probe-disconnect-${run}`);
  step('disconnect', gone.status === 200 && gone.body.left?.length === 0, JSON.stringify(gone.body.left ?? gone.body.error));
  if (gone.status === 200) accountId = null;
} finally {
  // Each cleanup step on its own: one that throws must not skip the rest.
  const tidy = async (what, f) => {
    try {
      await f();
    } catch (e) {
      step(`cleanup: ${what}`, false, e.message);
    }
  };
  await tidy('the snippet file', () => fs.rmSync(OUT, { force: true }));
  if (accountId) {
    await tidy('disconnect', async () => {
      const r = await clx('DELETE', `/v1/accounts/${accountId}`, key, undefined, `probe-cleanup-${run}`);
      if (r.status !== 200 || r.body.left?.length !== 0) throw new Error(`${r.status} ${JSON.stringify(r.body.left ?? r.body.error)} — run node scripts/probe-cleanup.mjs`);
    });
  }
  let tokens = [];
  await tidy('tokens', async () => {
    tokens = (await cfAdmin('GET', `/accounts/${account}/tokens?per_page=50`)).filter((t) => t.id === boot?.id || t.name === `probe-bootstrap-${run}` || /^clx-[A-Za-z0-9_-]{22}$/u.test(t.name));
  });
  for (const t of tokens) await tidy(`token ${t.name}`, () => cfAdmin('DELETE', `/accounts/${account}/tokens/${t.id}`));
  await tidy('key', async () => {
    const revoked = await clx('DELETE', `/v1/keys/${issued.body.id}`, session, undefined, `probe-revoke-${run}`);
    if (revoked.status !== 200) throw new Error(String(revoked.status));
  });
  await tidy('no clx-edge left', async () => {
    const scripts = await cfAdmin('GET', `/accounts/${account}/workers/scripts`);
    step('cleanup: tokens, key; no clx-edge left', !scripts.some((s) => s.id === 'clx-edge'));
  });
  if (failed) process.exitCode = 1;
}

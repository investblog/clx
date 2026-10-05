#!/usr/bin/env node
// node scripts/probe-sites.mjs [base URL, default https://clx.cx]
//
// The stage 4a live check (docs/spec.md §14): a site added through the API on a host served by
// Cloudflare Pages. First `node scripts/probe-pages.mjs up` (the Pages project on
// clx-probe.<test zone>); after, `node scripts/probe-pages.mjs down`. On the throwaway account of
// .secrets/test-cloudflare.env, as .secrets/user-probe@clx.cx.txt (plan api):
//   1. connect and install clx-edge (up to ~16 minutes: a new script's first cron is late);
//   2. POST /v1/sites for the Pages host → the route, the config synced;
//   3. on the site itself: the script is the snippet's code, the collector answers 204, anything
//      else under the path — and the page — is the Pages project's own answer;
//   4. rotate: the new path answers, the old one still does; delete: neither does;
//   5. disconnect removes routes, worker and database.
// Nothing secret is printed.
import fs from 'node:fs';
import { lockSecrets } from './secrets-dir.mjs';

const BASE = process.argv[2] ?? 'https://clx.cx';
const CF = 'https://api.cloudflare.com/client/v4';
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
/** A request to the site itself, as a visitor makes it. */
async function visit(path, init = {}) {
  const res = await fetch(`https://${host}${path}`, { redirect: 'manual', ...init });
  return { status: res.status, body: await res.text(), headers: res.headers };
}

const zone = await cfAdmin('GET', `/zones/${env.CF_ZONE_ID}`);
const host = `clx-probe.${zone.name}`;
// A custom domain just attached answers 52x for a while: wait for the site itself first.
const pagesHome = await until(() => visit('/'), (r) => r.status === 200, 10);
step(`the Pages site answers on ${host} (probe-pages.mjs up)`, pagesHome.status === 200 && pagesHome.body.includes('pages index'), String(pagesHome.status));
const pages404 = await visit('/no-such-page-here');

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
  const t0 = Date.now();
  const acc = await until(async () => (await clx('GET', `/v1/accounts/${accountId}`, key)).body.account, (a) => a?.state !== 'installing', 16);
  step('connected and installed', acc?.state === 'ready', `${acc?.state} in ${Math.round((Date.now() - t0) / 1000)} s ${acc?.error ? JSON.stringify(acc.error) : ''}`);

  // 2. The site.
  const added = await clx('POST', '/v1/sites', key, { account_id: accountId, host }, `probe-site-${run}`);
  step('POST /v1/sites', added.status === 202 && added.body.site?.state === 'active', `${added.status} ${added.body.site?.state ?? JSON.stringify(added.body.error)}`);
  const siteId = added.body.site?.id;
  const site = await until(async () => (await clx('GET', `/v1/sites/${siteId}`, key)).body.site, (s) => s?.config === 'synced', 3);
  step('config synced to the worker', site?.config === 'synced');
  const code = site.snippet.inline.replace(/^<script>|<\/script>$/gu, '');
  const src = site.snippet.script_tag.match(/src="([^"]+)"/u)[1];
  const collector = code.match(/["'](\/[a-z/]+)["']/u)[1];
  step('the snippet is per-site and short', site.snippet.inline.length < 600 && !/clx/iu.test(site.snippet.inline + site.snippet.script_tag), `${site.path} ${site.snippet.inline.length} bytes`);

  // 3. On the site.
  const js = await until(() => visit(src), (r) => r.status === 200, 2);
  step('the script answers on the site, the snippet\'s own code', js.status === 200 && js.body === code, `${js.status} ${js.headers.get('content-type')}`);
  step('… with no clx header', ![...js.headers.keys()].some((h) => /clx/iu.test(h)) && js.headers.get('cache-control') === 'public, max-age=86400');
  // Isolates that looked before the sync may still hold "no such site" for a few seconds.
  const beacon = await until(() => visit(collector, { method: 'POST', body: 'https://ref.example/', headers: { 'content-type': 'text/plain' } }), (r) => r.status === 204, 2);
  step('the collector answers 204 no-store', beacon.status === 204 && beacon.headers.get('cache-control') === 'no-store', String(beacon.status));
  const probe = await visit(`${site.path}/anything-else`);
  step("a probe under the path gets the site's own 404", probe.status === pages404.status && probe.body === pages404.body, String(probe.status));
  const getCollector = await visit(collector);
  step("GET on the collector is the site's own answer too", getCollector.status === pages404.status && getCollector.body === pages404.body, String(getCollector.status));
  step('the page itself is untouched', (await visit('/')).body === pagesHome.body);

  // 4. Rotate, then delete.
  const rotated = await clx('POST', `/v1/sites/${siteId}/rotate`, key, undefined, `probe-rotate-${run}`);
  const newSrc = rotated.body.site?.snippet?.script_tag.match(/src="([^"]+)"/u)?.[1];
  step('rotate: a new path', rotated.status === 200 && newSrc && newSrc !== src, rotated.body.site?.path);
  const newJs = await until(() => visit(newSrc), (r) => r.status === 200, 3);
  step('… the new path answers, the old one still does', newJs.status === 200 && (await visit(src)).status === 200);
  const deleted = await clx('DELETE', `/v1/sites/${siteId}`, key, undefined, `probe-delete-${run}`);
  step('DELETE /v1/sites/{id}', deleted.status === 200 && deleted.body.site?.state === 'deleted');
  const after = await until(async () => [await visit(src), await visit(newSrc)], ([a, b]) => a.status === pages404.status && b.status === pages404.status, 3);
  step("after delete both paths are the site's own 404", after.every((r) => r.status === pages404.status && r.body === pages404.body), after.map((r) => r.status).join(', '));
  const routes = await cfAdmin('GET', `/zones/${zone.id}/workers/routes`);
  step('no clx-edge route left on the host', !routes.some((r) => r.pattern.startsWith(`${host}/`) && r.script === 'clx-edge'));

  // 5. Disconnect.
  const gone = await clx('DELETE', `/v1/accounts/${accountId}`, key, undefined, `probe-disconnect-${run}`);
  step('disconnect', gone.status === 200 && gone.body.left?.length === 0, JSON.stringify(gone.body.left ?? gone.body.error));
  accountId = null;
} finally {
  if (accountId) await clx('DELETE', `/v1/accounts/${accountId}`, key, undefined, `probe-cleanup-${run}`).catch(() => undefined);
  const left = (await cfAdmin('GET', `/accounts/${account}/tokens?per_page=50`)).filter((t) => t.id === boot?.id || /^clx-[A-Za-z0-9_-]{22}$/u.test(t.name));
  for (const t of left) await cfAdmin('DELETE', `/accounts/${account}/tokens/${t.id}`);
  const revoked = await clx('DELETE', `/v1/keys/${issued.body.id}`, session, undefined, `probe-revoke-${run}`);
  const scripts = await cfAdmin('GET', `/accounts/${account}/workers/scripts`);
  step('cleanup: tokens, key; no clx-edge left', revoked.status === 200 && !scripts.some((s) => s.id === 'clx-edge'));
  if (failed) process.exitCode = 1;
}

#!/usr/bin/env node
// node scripts/probe-links.mjs [base URL, default https://clx.cx]  > temp/probe-links.log
//
// The stage 5a live check (docs/spec.md §6): short links on the user's own link host. On the
// throwaway account of .secrets/test-cloudflare.env, as .secrets/user-probe@clx.cx.txt:
//   1. connect and install; a fresh host of the test zone gets a proxied `AAAA 100::` record (stand
//      prep with the Global key — clx does not make DNS records, §13 item 2);
//   2. that host becomes the link host (the route made with the working token); a link with a rule
//      by country and device;
//   3. clicks: 302 with no-store and no body, the rules by the visitor's country and device, `?q` as
//      source qr, a plain 404 for anything else; the clicks in the account's own D1;
//   4. a change of the URL reaches the worker, a delete makes it a 404;
//   5. disconnect (the link host route goes with it), the DNS record deleted, cleanup.
// A few minutes; no cron is waited for. Write the output to a file, never through `| head` — a cut
// pipe stops the probe before its cleanup. Nothing secret is printed.
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
  console.log(`${new Date().toISOString().slice(11, 19)} ${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? ` — ${extra}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(read, done, minutes, every = 5_000) {
  const end = Date.now() + minutes * 60_000;
  for (;;) {
    const v = await read().catch((e) => ({ error: String(e) }));
    if (done(v) || Date.now() > end) return v;
    await sleep(every);
  }
}

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
/** One request to the link host, redirects not followed. */
async function hit(url, ua = CHROME, method = 'GET') {
  const res = await fetch(url, { method, redirect: 'manual', headers: { 'user-agent': ua } });
  return { status: res.status, location: res.headers.get('location'), cache: res.headers.get('cache-control'), body: await res.text(), headers: [...res.headers.keys()] };
}

const zone = await cfAdmin('GET', `/zones/${env.CF_ZONE_ID}`);
const run = Date.now().toString(36);
// A fresh name each run: a resolver never cached its absence.
const host = `clx-go-${run}.${zone.name}`;
const login = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
const session = `Bearer ${(await login.json()).access_token}`;
const issued = await clx('POST', '/v1/keys', session, { scopes: ['accounts', 'sites', 'links', 'reports'], allow_accounts: [account] }, `probe-key-${run}`);
step('sign in, API key', login.ok && issued.status === 201, issued.body.prefix);
const key = `Bearer ${issued.body.key}`;

let boot = null;
let accountId = null;
let record = null;
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
  const acc = await until(async () => (await clx('GET', `/v1/accounts/${accountId}`, key)).body.account, (a) => a?.state !== 'installing', 5);
  step('connected and installed', acc?.state === 'ready', acc?.state);

  record = await cfAdmin('POST', `/zones/${zone.id}/dns_records`, { type: 'AAAA', name: host, content: '100::', proxied: true, ttl: 1 });
  step('stand: a proxied AAAA 100:: record', Boolean(record?.id), host);

  const set = await clx('PUT', `/v1/accounts/${accountId}/link-host`, key, { host }, `probe-host-${run}`);
  const lh = await until(async () => (await clx('GET', `/v1/accounts/${accountId}`, key)).body.account?.link_host, (h) => h?.config === 'synced', 2);
  step('the link host: route made, synced', set.status === 202 && lh?.state === 'active' && lh?.config === 'synced', JSON.stringify(lh ?? set.body));

  // The visitor's country as Cloudflare sees this machine, for a rule that must match it.
  const loc = (await (await fetch(`https://${host}/cdn-cgi/trace`)).text()).match(/^loc=([A-Z]{2})$/mu)?.[1] ?? 'XX';
  const made = await clx(
    'POST',
    '/v1/links',
    key,
    {
      account_id: accountId,
      code: `p${run}`,
      url: 'https://example.com/a',
      rules: [
        { countries: [loc], devices: ['mobile'], url: `https://example.com/mobile-${loc}` },
        { devices: ['mobile'], url: 'https://example.com/mobile' },
      ],
    },
    `probe-link-${run}`,
  );
  const linkId = made.body.link?.id;
  const short = made.body.link?.short_url;
  const synced = await until(async () => (await clx('GET', `/v1/links/${linkId}`, key)).body.link, (l) => l?.config === 'synced', 2);
  step('a link with rules, synced', made.status === 201 && synced?.config === 'synced', short);

  // An isolate that looked before the sync keeps "none" for 5 s: wait for the first redirect.
  const first = await until(() => hit(short), (r) => r.status === 302, 2, 3000);
  step('a click: 302 to the URL, no-store, no body', first.status === 302 && first.location === 'https://example.com/a' && first.cache === 'no-store' && first.body === '', JSON.stringify(first));
  const phone = await hit(short, IPHONE);
  step(`… the rule by country (${loc}) and device`, phone.location === `https://example.com/mobile-${loc}`, phone.location);
  const qr = await hit(`${short}?q`);
  step('… the QR address redirects too', qr.status === 302 && qr.location === 'https://example.com/a', qr.location);
  const misses = [await hit(`https://${host}/nope-${run}`), await hit(`https://${host}/`), await hit(short, CHROME, 'POST')];
  step('anything else on the link host: a plain 404', misses.every((r) => r.status === 404 && r.body === ''), misses.map((r) => r.status).join(', '));

  // The clicks in the account's own D1 (read with the Global key: only a check).
  const dbs = await cfAdmin('GET', `/accounts/${account}/d1/database?name=clx-edge`);
  const db = dbs.find((d) => d.name === 'clx-edge');
  const q = async (sql) => (await cfAdmin('POST', `/accounts/${account}/d1/database/${db.uuid}/query`, { sql }))[0].results;
  const target = (await q(`SELECT data FROM cfg WHERE key = 'link:p${run}' ORDER BY revision DESC LIMIT 1`)).map((r) => JSON.parse(r.data).t)[0];
  const totals = await until(() => q(`SELECT views, bots FROM totals WHERE target = '${target}'`), (r) => r?.[0]?.views >= 3, 1);
  const detail = await q(`SELECT source, device, country, views FROM views_hourly WHERE target = '${target}' ORDER BY source, device`);
  step('the clicks counted in the account: 3 views, one from the QR, one from a phone', totals?.[0]?.views === 3 && detail.some((r) => r.source === 'qr') && detail.some((r) => r.device === 'mobile' && r.country === loc), JSON.stringify(detail));

  // The worker caches a link for 60 s: a change shows within that.
  const changed = await clx('PATCH', `/v1/links/${linkId}`, key, { url: 'https://example.com/b' }, `probe-patch-${run}`);
  const moved = await until(() => hit(short), (r) => r.location === 'https://example.com/b', 2, 5000);
  step('a new URL reaches the worker', changed.status === 200 && moved.location === 'https://example.com/b', moved.location);
  await clx('DELETE', `/v1/links/${linkId}`, key, undefined, `probe-delete-${run}`);
  const deleted = await until(() => hit(short), (r) => r.status === 404, 2, 5000);
  step('a deleted link is a 404', deleted.status === 404, String(deleted.status));

  const gone = await clx('DELETE', `/v1/accounts/${accountId}`, key, undefined, `probe-disconnect-${run}`);
  const routes = await cfAdmin('GET', `/zones/${zone.id}/workers/routes`);
  step('disconnect: the link host route goes too', gone.status === 200 && gone.body.left?.length === 0 && !routes.some((r) => r.pattern === `${host}/*`), JSON.stringify(gone.body.left ?? gone.body.error));
  accountId = null;
} finally {
  if (accountId) await clx('DELETE', `/v1/accounts/${accountId}`, key, undefined, `probe-cleanup-${run}`).catch(() => undefined);
  if (record?.id) await cfAdmin('DELETE', `/zones/${zone.id}/dns_records/${record.id}`).catch((e) => step('DNS record deleted', false, String(e)));
  const left = (await cfAdmin('GET', `/accounts/${account}/tokens?per_page=50`)).filter((t) => t.id === boot?.id || /^clx-[A-Za-z0-9_-]{22}$/u.test(t.name));
  for (const t of left) await cfAdmin('DELETE', `/accounts/${account}/tokens/${t.id}`);
  const again = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const revoked = await clx('DELETE', `/v1/keys/${issued.body.id}`, `Bearer ${(await again.json()).access_token}`, undefined, `probe-revoke-${run}`);
  const scripts = await cfAdmin('GET', `/accounts/${account}/workers/scripts`);
  step('cleanup: DNS record, tokens, key; no clx-edge left', revoked.status === 200 && !scripts.some((s) => s.id === 'clx-edge'));
  if (failed) process.exitCode = 1;
}

#!/usr/bin/env node
// node scripts/probe-totals.mjs [base URL, default https://clx.cx]  > temp/probe-totals.log
//
// The stage 4c live check (docs/spec.md §7): totals travel from the user's worker to clx.cx. On the
// Pages host of `probe-pages.mjs up`, on the throwaway account of .secrets/test-cloudflare.env, as
// .secrets/user-probe@clx.cx.txt:
//   1. connect, install, add the site, send two views of one visitor and a bot;
//   2. wait for the worker's hourly run (its working cron, at :05, set once the install is
//      confirmed or after 15 minutes) — up to ~80 minutes;
//   3. clx.cx has the closed hour and the running day of the site (read from its D1 through
//      wrangler), the account shows the worker's heartbeat;
//   4. disconnect, and clean up.
// Write the output to a file, never through `| head` — a cut pipe stops the probe before its cleanup.
// Nothing secret is printed.
import { execFileSync } from 'node:child_process';
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
/** clx.cx's own D1, read through wrangler (the deploy token). */
function clxDb(sql) {
  const out = execFileSync(process.execPath, ['scripts/wrangler.mjs', 'd1', 'execute', 'clx', '--remote', '--json', '--command', sql], { encoding: 'utf8' });
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
}
let failed = 0;
const step = (what, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${new Date().toISOString().slice(11, 19)} ${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? ` — ${extra}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(read, done, minutes, every = 10_000) {
  const end = Date.now() + minutes * 60_000;
  for (;;) {
    const v = await read();
    if (done(v) || Date.now() > end) return v;
    await sleep(every);
  }
}

const zone = await cfAdmin('GET', `/zones/${env.CF_ZONE_ID}`);
const host = `clx-probe.${zone.name}`;
const home = await until(() => fetch(`https://${host}/`).then((r) => r.status), (s) => s === 200, 10);
step(`the Pages site answers on ${host}`, home === 200, String(home));

const login = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
const session = `Bearer ${(await login.json()).access_token}`;
const run = Date.now().toString(36);
const issued = await clx('POST', '/v1/keys', session, { scopes: ['accounts', 'sites'], allow_accounts: [account] }, `probe-key-${run}`);
step('sign in, API key', login.ok && issued.status === 201, issued.body.prefix);
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
  const acc = await until(async () => (await clx('GET', `/v1/accounts/${accountId}`, key)).body.account, (a) => a?.state !== 'installing', 5);
  step('installed', acc?.state === 'ready', acc?.state);

  const added = await clx('POST', '/v1/sites', key, { account_id: accountId, host }, `probe-site-${run}`);
  const siteId = added.body.site?.id;
  const site = await until(async () => (await clx('GET', `/v1/sites/${siteId}`, key)).body.site, (s) => s?.config === 'synced', 3);
  step('site added and synced', site?.config === 'synced', site?.path);
  const collector = site.snippet.inline.replace(/^<script>|<\/script>$/gu, '').match(/["'](\/[a-z/]+)["']/u)[1];
  const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
  const send = (ua) => fetch(`https://${host}${collector}`, { method: 'POST', body: 'https://www.google.com/', headers: { 'content-type': 'text/plain', 'user-agent': ua, referer: `https://${host}/page` } }).then((r) => r.status);
  // Isolates that looked before the sync may hold "no such site" for a few seconds.
  await until(() => send('probe-warmup-bot'), (s) => s === 204, 2, 3000);
  const sentAt = Date.now();
  const statuses = [await send(CHROME), await send(CHROME), await send('curl/8.5.0')];
  step('two views and a bot sent', statuses.every((s) => s === 204), statuses.join(', '));
  const hour = Math.floor(sentAt / 3_600_000);
  const day = Math.floor(sentAt / 86_400_000);

  // The worker's hourly run: after the confirmation (or the 15-minute fallback), at :05.
  const t0 = Date.now();
  const pushed = await until(async () => (await clx('GET', `/v1/accounts/${accountId}`, key)).body.account, (a) => a?.push && Date.parse(a.push.at) > sentAt && Math.floor(Date.parse(a.push.at) / 3_600_000) > hour, 80, 30_000);
  step('the worker pushed after the hour closed', Boolean(pushed?.push), `${pushed?.push?.at ?? 'no push'} after ${Math.round((Date.now() - t0) / 60_000)} min; confirmed: ${!pushed?.error?.warnings?.includes('not_confirmed')}`);
  step('… its heartbeat: this bundle, schema 4, no error', pushed?.push?.bundle === pushed?.edge?.bundle && pushed?.push?.schema === 4 && !pushed?.push?.error, JSON.stringify(pushed?.push));

  const target = clxDb(`SELECT target FROM sites WHERE id = '${siteId}'`)[0]?.target;
  const hours = clxDb(`SELECT hour, views, bots FROM hourly WHERE account_id = '${accountId}' AND target = '${target}'`);
  const days = clxDb(`SELECT day, as_of_hour, final, views, bots, visitors FROM daily WHERE account_id = '${accountId}' AND target = '${target}'`);
  const h = hours.find((r) => r.hour === hour);
  step('clx.cx has the closed hour: 2 views, the bots', h?.views === 2 && h?.bots >= 2, JSON.stringify(hours));
  const d = days.find((r) => r.day === day);
  // Past midnight UTC the same run closes the day, and clx.cx gets its final total instead.
  const closed = hour % 24 === 23;
  step(`… and the ${closed ? 'closed' : 'running'} day: 2 views, 1 visitor`, d?.views === 2 && d?.visitors === 1 && d?.final === (closed ? 1 : 0), JSON.stringify(days));

  const gone = await clx('DELETE', `/v1/accounts/${accountId}`, key, undefined, `probe-disconnect-${run}`);
  step('disconnect', gone.status === 200 && gone.body.left?.length === 0, JSON.stringify(gone.body.left ?? gone.body.error));
  accountId = null;
  step('… its totals are kept for 30 days', clxDb(`SELECT count(*) AS n FROM departed WHERE account_id = '${connected.body.account.id}'`)[0]?.n === 1);
} finally {
  if (accountId) await clx('DELETE', `/v1/accounts/${accountId}`, key, undefined, `probe-cleanup-${run}`).catch(() => undefined);
  const left = (await cfAdmin('GET', `/accounts/${account}/tokens?per_page=50`)).filter((t) => t.id === boot?.id || /^clx-[A-Za-z0-9_-]{22}$/u.test(t.name));
  for (const t of left) await cfAdmin('DELETE', `/accounts/${account}/tokens/${t.id}`);
  // The probe can outlive its sign-in: sign in again to revoke the key.
  const again = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const revoked = await clx('DELETE', `/v1/keys/${issued.body.id}`, `Bearer ${(await again.json()).access_token}`, undefined, `probe-revoke-${run}`);
  const scripts = await cfAdmin('GET', `/accounts/${account}/workers/scripts`);
  step('cleanup: tokens, key; no clx-edge left', revoked.status === 200 && !scripts.some((s) => s.id === 'clx-edge'));
  if (failed) process.exitCode = 1;
}

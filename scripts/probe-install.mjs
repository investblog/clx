#!/usr/bin/env node
// node scripts/probe-install.mjs [base URL, default https://clx.cx]
//
// The stage 3 live check (docs/spec.md §14): on the throwaway Cloudflare account of
// .secrets/test-cloudflare.env, as the clx user of .secrets/user-probe@clx.cx.txt (an `api` plan
// user, admin on for the rollout: `node scripts/user.mjs admin probe@clx.cx on`).
//   1. a clx-edge worker clx did not make is left alone (name_taken);
//   2. with it gone, the install runs to `ready`: the worker is the committed bundle, the self-check
//      cron gave way to the working one, the database has the schema;
//   3. an admin rollout (force) updates it to a new version and back to `ready`, keeping the key;
//   4. disconnect deletes the worker and the database; the working token is deleted here.
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
const BUNDLE = fs.readFileSync('edge/bundle.gen.ts', 'utf8').match(/EDGE_SHA256 = '([0-9a-f]{64})'/u)[1];
const account = env.CF_ACCOUNT_ID;
const admin = { 'X-Auth-Email': env.CF_EMAIL, 'X-Auth-Key': env.CF_GLOBAL_API_KEY };

async function cfAdmin(method, path, body, { ok404 = false } = {}) {
  const init = { method, headers: { ...admin } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${CF}${path}`, init);
  if (ok404 && res.status === 404) return null;
  const json = await res.json();
  if (!json.success) throw new Error(`${method} ${path} → ${JSON.stringify(json.errors)}`);
  return json.result;
}
/** sha256 of the worker.js part of the script, or null when there is none. */
async function digest() {
  const res = await fetch(`${CF}/accounts/${account}/workers/scripts/clx-edge`, { headers: admin });
  if (res.status === 404) return null;
  const boundary = /boundary="?([^";]+)"?/iu.exec(res.headers.get('content-type'))[1];
  const part = (await res.text()).split(`--${boundary}`).find((p) => p.includes('name="worker.js"'));
  const body = part.slice(part.indexOf('\r\n\r\n') + 4).replace(/\r\n$/u, '');
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const crons = async () => ((await cfAdmin('GET', `/accounts/${account}/workers/scripts/clx-edge/schedules`, undefined, { ok404: true }))?.schedules ?? []).map((s) => s.cron);
const databases = async () => (await cfAdmin('GET', `/accounts/${account}/d1/database?name=clx-edge`)).filter((d) => d.name === 'clx-edge');
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

/** Poll the account until `until` holds or the time is up; the per-minute cron drives the install. */
async function poll(id, auth, until, minutes = 16) {
  const end = Date.now() + minutes * 60_000;
  for (;;) {
    const a = (await clx('GET', `/v1/accounts/${id}`, auth)).body.account;
    if (until(a) || Date.now() > end) return a;
    await sleep(10_000);
  }
}

const login = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
const session = `Bearer ${(await login.json()).access_token}`;
step('sign in', login.ok);
const run = Date.now().toString(36);
const issued = await clx('POST', '/v1/keys', session, { scopes: ['accounts'], allow_accounts: [account] }, `probe-key-${run}`);
step('API key issued', issued.status === 201, issued.body.prefix);
const key = `Bearer ${issued.body.key}`;
step('the account has no clx-edge yet', (await digest()) === null && (await databases()).length === 0);

let boot = null;
let accountId = null;
try {
  // 1. Someone else's clx-edge worker is in place.
  const foreign = 'export default { fetch() { return new Response("not clx"); } };';
  const form = new FormData();
  form.append('worker.js', new Blob([foreign], { type: 'application/javascript+module' }), 'worker.js');
  form.append('metadata', new Blob([JSON.stringify({ main_module: 'worker.js', compatibility_date: '2026-09-01' })], { type: 'application/json' }));
  await cfAdmin('PUT', `/accounts/${account}/workers/scripts/clx-edge`, form);
  const foreignDigest = await digest();

  const groups = await cfAdmin('GET', `/accounts/${account}/tokens/permission_groups`);
  const id = (name) => groups.find((g) => g.name === name).id;
  boot = await cfAdmin('POST', `/accounts/${account}/tokens`, {
    name: `probe-bootstrap-${run}`,
    expires_on: new Date(Date.now() + 86_400_000).toISOString().replace(/\.\d{3}Z$/u, 'Z'),
    policies: [{ effect: 'allow', resources: { [`com.cloudflare.api.account.${account}`]: '*' }, permission_groups: [{ id: id('Account Settings Read') }, { id: id('Account API Tokens Write') }] }],
  });
  const connected = await clx('POST', '/v1/accounts', key, { cf_account_id: account, bootstrap_token: boot.value }, `probe-connect-${run}`);
  accountId = connected.body.account?.id;
  step('POST /v1/accounts', connected.status === 202, `${connected.status} ${connected.body.account?.state ?? JSON.stringify(connected.body.error)}`);
  const taken = await poll(accountId, key, (a) => a.state !== 'installing', 3);
  step('a clx-edge worker clx did not make: name_taken', taken.state === 'connected' && taken.error?.code === 'name_taken', `${taken.state} ${JSON.stringify(taken.error)}`);
  step('… and it is untouched, no database made', (await digest()) === foreignDigest && (await databases()).length === 0);
  await cfAdmin('DELETE', `/accounts/${account}/workers/scripts/clx-edge?force=true`);

  // 2. The install, through to the worker's own setup_ok.
  const t0 = Date.now();
  const started = await clx('POST', `/v1/accounts/${accountId}/install`, key, undefined, `probe-install-${run}`);
  step('POST /v1/accounts/{id}/install', started.status === 202, started.body.account?.state ?? JSON.stringify(started.body.error));
  const inService = await poll(accountId, key, (a) => a.state !== 'installing');
  step('ready (in service)', inService.state === 'ready', `${inService.state} in ${Math.round((Date.now() - t0) / 1000)} s`);
  // The worker's own confirmation comes with its first cron, which for a new script can be late
  // or never (docs/cloudflare-facts.md): either way the working cron must end up set.
  const done = await poll(accountId, key, (a) => a.operation?.kind === 'install' && a.operation.state !== 'running');
  const confirmed = !done.error?.warnings?.includes('not_confirmed');
  step(confirmed ? 'confirmed by the worker' : 'not confirmed in 15 min — working cron set anyway', done.state === 'ready' && done.operation?.state === 'done', `after ${Math.round((Date.now() - t0) / 1000)} s`);
  step('the worker is the committed bundle', (await digest()) === BUNDLE && done.edge?.bundle === BUNDLE, BUNDLE.slice(0, 12));
  step('working cron only', JSON.stringify(await crons()) === JSON.stringify(['5 * * * *']), (await crons()).join(', '));
  const [db] = await databases();
  const schema = db ? (await cfAdmin('POST', `/accounts/${account}/d1/database/${db.uuid}/query`, { sql: "SELECT value FROM meta WHERE key = 'schema'" }))[0].results[0]?.value : null;
  step('the database has the schema', schema === done.edge?.schema && schema >= 1, `schema ${schema}`);

  // 3. A rollout of the same bundle (force): a new version, the key kept, ready again.
  const before = (await cfAdmin('GET', `/accounts/${account}/workers/scripts/clx-edge/deployments`)).deployments[0].versions[0].version_id;
  const rollout = await clx('POST', '/admin/edge/rollout', session, { accounts: [accountId], force: true });
  step('admin rollout started', rollout.status === 202 && rollout.body.accounts?.[0]?.operation, JSON.stringify(rollout.body.accounts ?? rollout.body.error));
  const updated = await poll(accountId, key, (a) => a.operation?.kind === 'update' && a.operation.state !== 'running');
  const after = (await cfAdmin('GET', `/accounts/${account}/workers/scripts/clx-edge/deployments`)).deployments[0].versions[0].version_id;
  step('update confirmed by the worker', updated.state === 'ready' && updated.operation?.state === 'done' && after !== before, `${updated.state} ${updated.operation?.state} ${JSON.stringify(updated.operation?.error)}`);
  step('working cron restored', JSON.stringify(await crons()) === JSON.stringify(['5 * * * *']));

  // 4. Disconnect: worker and database gone.
  const gone = await clx('DELETE', `/v1/accounts/${accountId}`, key, undefined, `probe-disconnect-${run}`);
  step('DELETE /v1/accounts/{id}', gone.status === 200 && gone.body.left?.length === 0, JSON.stringify(gone.body.left ?? gone.body.error));
  accountId = null;
  step('worker and database removed', (await digest()) === null && (await databases()).length === 0);
} finally {
  if (accountId) await clx('DELETE', `/v1/accounts/${accountId}`, key, undefined, `probe-cleanup-${run}`).catch(() => undefined);
  const left = (await cfAdmin('GET', `/accounts/${account}/tokens?per_page=50`)).filter((t) => t.id === boot?.id || /^clx-[A-Za-z0-9_-]{22}$/u.test(t.name));
  for (const t of left) await cfAdmin('DELETE', `/accounts/${account}/tokens/${t.id}`);
  await cfAdmin('DELETE', `/accounts/${account}/workers/scripts/clx-edge?force=true`, undefined, { ok404: true }).catch(() => undefined);
  for (const db of await databases()) await cfAdmin('DELETE', `/accounts/${account}/d1/database/${db.uuid}`);
  const revoked = await clx('DELETE', `/v1/keys/${issued.body.id}`, session, undefined, `probe-revoke-${run}`);
  step('cleanup: tokens, worker, database, key', revoked.status === 200 && (await digest()) === null && (await databases()).length === 0);
  if (failed) process.exitCode = 1;
}

#!/usr/bin/env node
// node scripts/probe-connect.mjs [base URL, default https://clx.cx]
//
// The stage 2 live check (docs/spec.md §14): on the throwaway Cloudflare account of
// .secrets/test-cloudflare.env, as the clx user of .secrets/user-probe@clx.cx.txt (an `api` plan
// user made with scripts/user.mjs). It signs in, issues an API key, mints a bootstrap token with the
// Global API Key, connects the account through POST /v1/accounts with the key, checks the result
// in Cloudflare (bootstrap gone, one `clx-…` working token), replays the call, then disconnects,
// deletes the working token and revokes the key. Nothing secret is printed.
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
const admin = { 'X-Auth-Email': env.CF_EMAIL, 'X-Auth-Key': env.CF_GLOBAL_API_KEY, 'Content-Type': 'application/json' };

async function cfAdmin(method, path, body) {
  const json = await (await fetch(`${CF}${path}`, { method, headers: admin, body: body && JSON.stringify(body) })).json();
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
const step = (what, ok, extra = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? ` — ${extra}` : ''}`);
const clxTokens = async () => (await cfAdmin('GET', `/accounts/${account}/tokens?per_page=50`)).filter((t) => /^clx-[A-Za-z0-9_-]{22}$/u.test(t.name));

// 1. Sign in, issue a key with the accounts scope only.
const login = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
const session = `Bearer ${(await login.json()).access_token}`;
step('sign in', login.ok);
const run = Date.now().toString(36);
const issued = await clx('POST', '/v1/keys', session, { scopes: ['accounts'], allow_accounts: [account] }, `probe-key-${run}`);
step('API key issued (accounts scope, this account only)', issued.status === 201, issued.body.prefix);
const key = `Bearer ${issued.body.key}`;

let boot = null;
try {
  // 2. A bootstrap token, as a user would make it: two rights, one day.
  const groups = await cfAdmin('GET', `/accounts/${account}/tokens/permission_groups`);
  const id = (name) => groups.find((g) => g.name === name).id;
  boot = await cfAdmin('POST', `/accounts/${account}/tokens`, {
    name: `probe-bootstrap-${run}`,
    expires_on: new Date(Date.now() + 86_400_000).toISOString().replace(/\.\d{3}Z$/u, 'Z'),
    policies: [{ effect: 'allow', resources: { [`com.cloudflare.api.account.${account}`]: '*' }, permission_groups: [{ id: id('Account Settings Read') }, { id: id('Account API Tokens Write') }] }],
  });
  step('bootstrap token minted', true, boot.name);

  // 3. Connect through the API with the key.
  const t0 = Date.now();
  const connected = await clx('POST', '/v1/accounts', key, { cf_account_id: account, bootstrap_token: boot.value }, `probe-connect-${run}`);
  step('POST /v1/accounts', connected.status === 202, `${connected.status} ${connected.body.account?.state ?? JSON.stringify(connected.body.error)} in ${Date.now() - t0} ms`);
  const tokens = await cfAdmin('GET', `/accounts/${account}/tokens?per_page=50`);
  step('bootstrap token deleted', !tokens.some((t) => t.id === boot.id));
  const working = await clxTokens();
  step('one working token, named clx-<operation>', working.length === 1 && working[0].name === connected.body.account?.token?.name, working.map((t) => t.name).join(', '));
  const replay = await clx('POST', '/v1/accounts', key, { cf_account_id: account, bootstrap_token: boot.value }, `probe-connect-${run}`);
  step('replay returns the first answer', JSON.stringify(replay.body) === JSON.stringify(connected.body));
  step('still one working token', (await clxTokens()).length === 1);

  // 4. Disconnect, then the working token is deleted here (clx cannot delete it — §4).
  const gone = await clx('DELETE', `/v1/accounts/${connected.body.account.id}`, key, undefined, `probe-disconnect-${run}`);
  step('DELETE /v1/accounts/{id}', gone.status === 200, `revoke ${gone.body.revoke_token}`);
} finally {
  // The bootstrap token too, if a failed connect left it: it can mint tokens for a day.
  const left = (await cfAdmin('GET', `/accounts/${account}/tokens?per_page=50`)).filter((t) => t.id === boot?.id || /^clx-[A-Za-z0-9_-]{22}$/u.test(t.name));
  for (const t of left) await cfAdmin('DELETE', `/accounts/${account}/tokens/${t.id}`);
  const revoked = await clx('DELETE', `/v1/keys/${issued.body.id}`, session, undefined, `probe-revoke-${run}`);
  step('cleanup: clx tokens deleted, key revoked', revoked.status === 200 && (await clxTokens()).length === 0);
}

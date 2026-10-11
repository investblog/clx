#!/usr/bin/env node
// node scripts/probe-mcp.mjs [base URL, default https://clx.cx]  > temp/probe-mcp.log
//
// The live check of the MCP server (docs/spec.md §15, ADR 0023). On the throwaway account of
// .secrets/test-cloudflare.env, as .secrets/user-probe@clx.cx.txt, everything through /mcp:
//   1. the server card; both eras (initialize; server/discover with the mirrored headers); the
//      tools listed without a key; a call without one is 401;
//   2. whoami with the key; connect_account twice with one idempotency_key (one account), polled
//      with get_account until ready; list_zones; add_site and its snippet; delete_site;
//   3. disconnect_account, then cleanup: tokens, the key.
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

let seq = 0;
/** One MCP request of the 2026-07-28 era; `auth` the bearer value or none. */
async function mcp(method, params = {}, auth = null) {
  const body = { jsonrpc: '2.0', id: ++seq, method, params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} } } };
  const headers = { 'content-type': 'application/json', 'mcp-protocol-version': '2026-07-28', 'mcp-method': method, ...(typeof params.name === 'string' ? { 'mcp-name': params.name } : {}), ...(auth ? { authorization: auth } : {}) };
  const res = await fetch(`${BASE}/mcp`, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, auth: res.headers.get('www-authenticate'), body: await res.json() };
}
const tool = async (name, args, auth) => (await mcp('tools/call', { name, arguments: args }, auth)).body.result;

const zone = await cfAdmin('GET', `/zones/${env.CF_ZONE_ID}`);
const run = Date.now().toString(36);
const login = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
const session = `Bearer ${(await login.json()).access_token}`;
const issued = await clx('POST', '/v1/keys', session, { scopes: ['accounts', 'sites', 'links', 'reports'], allow_accounts: [account] }, `probe-mcp-key-${run}`);
step('sign in, API key', login.ok && issued.status === 201, issued.body.prefix);
const key = `Bearer ${issued.body.key}`;

let boot = null;
let accountId = null;
try {
  const card = await (await fetch(`${BASE}/.well-known/mcp/server-card.json`)).json().catch(() => null);
  step('the server card names the server', card?.url === `${BASE}/mcp` && card?.transport === 'streamable-http', card?.name);
  const init = await fetch(`${BASE}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'probe', version: '1' } } }) });
  const initBody = await init.json();
  step('older era: initialize', initBody.result?.protocolVersion === '2025-06-18' && !init.headers.get('mcp-session-id'), initBody.result?.serverInfo?.version);
  const discover = await mcp('server/discover');
  step('2026-07-28: server/discover', discover.body.result?.supportedVersions?.[0] === '2026-07-28');
  const list = await mcp('tools/list');
  step('the tools, listed without a key', list.body.result?.tools?.length === 23, String(list.body.result?.tools?.length));
  const anon = await mcp('tools/call', { name: 'whoami', arguments: {} });
  step('a call without a key: 401 and WWW-Authenticate', anon.status === 401 && /^Bearer /u.test(anon.auth ?? ''), anon.auth);
  const me = await tool('whoami', {}, key);
  step('whoami with the key', me?.isError === false && me.structuredContent?.via === 'key', me?.structuredContent?.plan);

  const groups = await cfAdmin('GET', `/accounts/${account}/tokens/permission_groups`);
  const id = (name) => groups.find((g) => g.name === name).id;
  boot = await cfAdmin('POST', `/accounts/${account}/tokens`, {
    name: `probe-bootstrap-${run}`,
    expires_on: new Date(Date.now() + 86_400_000).toISOString().replace(/\.\d{3}Z$/u, 'Z'),
    policies: [{ effect: 'allow', resources: { [`com.cloudflare.api.account.${account}`]: '*' }, permission_groups: [{ id: id('Account Settings Read') }, { id: id('Account API Tokens Write') }] }],
  });
  const args = { cf_account_id: account, bootstrap_token: boot.value, idempotency_key: `probe-mcp-connect-${run}` };
  const first = await tool('connect_account', args, key);
  const again = await tool('connect_account', args, key);
  accountId = first?.structuredContent?.account?.id;
  step('connect_account, twice with one idempotency_key: one account', first?.isError === false && again?.structuredContent?.account?.id === accountId, first?.structuredContent?.account?.state ?? first?.content?.[0]?.text);
  const acc = await until(async () => (await tool('get_account', { id: accountId }, key)).structuredContent?.account, (a) => a?.state !== 'installing', 5);
  step('get_account until installed', acc?.state === 'ready', acc?.state);
  const zones = await tool('list_zones', { id: accountId }, key);
  step('list_zones', zones?.structuredContent?.zones?.some((z) => z.name === zone.name), String(zones?.structuredContent?.zones?.length));

  const site = await tool('add_site', { account_id: accountId, host: `clx-mcp-${run}.${zone.name}`, idempotency_key: `probe-mcp-site-${run}` }, key);
  const siteId = site?.structuredContent?.site?.id;
  step('add_site: the site and its snippet', site?.isError === false && typeof site.structuredContent.site?.snippet?.inline === 'string', site?.structuredContent?.site?.state ?? site?.content?.[0]?.text);
  const removed = await tool('delete_site', { id: siteId, idempotency_key: `probe-mcp-site-delete-${run}` }, key);
  step('delete_site', removed?.isError === false, removed?.structuredContent?.site?.state ?? removed?.content?.[0]?.text);

  // The site's removal may still hold the account: retry while it says so, as /agents tells an agent.
  const busy = (r) => r?.structuredContent?.error?.code === 'operation_in_progress';
  const gone = await until(() => tool('disconnect_account', { id: accountId, idempotency_key: `probe-mcp-disconnect-${run}` }, key), (r) => !busy(r), 2, 3_000);
  step('disconnect_account', gone?.isError === false && gone.structuredContent?.left?.length === 0, JSON.stringify(gone?.structuredContent?.left ?? gone?.content?.[0]?.text));
  if (gone?.isError === false) accountId = null;
} finally {
  // Disconnected before the tokens go: without its working token clx cannot remove its worker.
  if (accountId) await until(() => clx('DELETE', `/v1/accounts/${accountId}`, key, undefined, `probe-mcp-cleanup-${run}`), (r) => r.status !== 409, 2, 3_000).catch(() => undefined);
  const left = (await cfAdmin('GET', `/accounts/${account}/tokens?per_page=50`)).filter((t) => t.id === boot?.id || /^clx-[A-Za-z0-9_-]{22}$/u.test(t.name));
  for (const t of left) await cfAdmin('DELETE', `/accounts/${account}/tokens/${t.id}`);
  const relog = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const revoked = await clx('DELETE', `/v1/keys/${issued.body.id}`, `Bearer ${(await relog.json()).access_token}`, undefined, `probe-mcp-revoke-${run}`);
  const scripts = await cfAdmin('GET', `/accounts/${account}/workers/scripts`);
  step('cleanup: tokens, key; no clx-edge left', revoked.status === 200 && !scripts.some((s) => s.id === 'clx-edge'));
  if (failed) process.exitCode = 1;
}

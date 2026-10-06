#!/usr/bin/env node
// node scripts/probe-cleanup.mjs [base]
//
// Cleans the test Cloudflare account after a probe that was stopped before its own cleanup (the
// system kills idle background jobs when memory runs low): disconnects every clx account of the
// probe user, deletes leftover bootstrap and working tokens and the link hosts' DNS records, revokes
// the probe user's API keys, and prints what is left. Same secrets as the probes (.secrets/test-cloudflare.env and the probe
// user's file); nothing secret is printed.
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
const cfAdmin = async (method, path) => {
  const json = await (await fetch(`${CF}${path}`, { method, headers: admin })).json();
  if (!json.success) throw new Error(`${method} ${path} → ${JSON.stringify(json.errors)}`);
  return json.result;
};
const login = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
const session = `Bearer ${(await login.json()).access_token}`;
const clx = async (method, path) => {
  const res = await fetch(`${BASE}${path}`, { method, headers: { authorization: session } });
  return { status: res.status, body: await res.json() };
};

for (const a of (await clx('GET', '/v1/accounts')).body.accounts ?? []) {
  const r = await clx('DELETE', `/v1/accounts/${a.id}`);
  console.log('disconnect', a.id, a.state, '→', r.status, JSON.stringify(r.body.left ?? r.body.error));
}
for (const t of (await cfAdmin('GET', `/accounts/${account}/tokens?per_page=50`)).filter((t) => /^probe-bootstrap-|^clx-[A-Za-z0-9_-]{22}$/u.test(t.name))) {
  await cfAdmin('DELETE', `/accounts/${account}/tokens/${t.id}`);
  console.log('token deleted', t.name.slice(0, 16));
}
// The link hosts' DNS records of probe-links.mjs.
for (const r of (await cfAdmin('GET', `/zones/${env.CF_ZONE_ID}/dns_records?per_page=100`)).filter((r) => /^clx-go-[a-z0-9]+\./u.test(r.name))) {
  await cfAdmin('DELETE', `/zones/${env.CF_ZONE_ID}/dns_records/${r.id}`);
  console.log('DNS record deleted', r.name);
}
for (const k of (await clx('GET', '/v1/keys')).body.keys ?? []) {
  const r = await clx('DELETE', `/v1/keys/${k.id}`);
  console.log('key revoked', k.prefix, '→', r.status);
}
const scripts = (await cfAdmin('GET', `/accounts/${account}/workers/scripts`)).map((s) => s.id);
const dbs = (await cfAdmin('GET', `/accounts/${account}/d1/database?per_page=100`)).map((d) => d.name);
const routes = (await cfAdmin('GET', `/zones/${env.CF_ZONE_ID}/workers/routes`)).map((r) => `${r.pattern} → ${r.script}`);
console.log('left: scripts', scripts, 'dbs', dbs, 'routes', routes);
if (scripts.includes('clx-edge') || dbs.includes('clx-edge')) process.exitCode = 1;

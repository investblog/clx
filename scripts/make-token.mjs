#!/usr/bin/env node
// node scripts/make-token.mjs [--dry-run]
//
// The scoped API token clx deploys with, made from the owner's Global API Key of the clx.cx account
// (.secrets/cloudflare-global.env: CF_EMAIL, CF_GLOBAL_API_KEY, CF_ACCOUNT_ID — put there by the
// owner) and written to .secrets/cloudflare.env as CLOUDFLARE_API_TOKEN and
// CLOUDFLARE_ACCOUNT_ID. Nothing secret is printed: only group names, ids and the token's id.
//
// Rights, checked against Cloudflare's catalog by name: on the account — Workers Scripts Write, D1
// Write, Workers KV Storage Write, Account Settings Read; on the zone clx.cx — Workers Routes Write,
// Zone Read. Run again to replace the token (the older one of this name is deleted).
import fs from 'node:fs';
import { lockSecrets } from './secrets-dir.mjs';

const SOURCE = '.secrets/cloudflare-global.env';
const OUT = '.secrets/cloudflare.env';
const NAME = 'clx-deploy';
const API = 'https://api.cloudflare.com/client/v4';
const ACCOUNT_RIGHTS = ['Workers Scripts Write', 'D1 Write', 'Workers KV Storage Write', 'Account Settings Read'];
const ZONE_RIGHTS = ['Workers Routes Write', 'Zone Read'];
const dry = process.argv.includes('--dry-run');

lockSecrets(); // before the Global API Key is read, not after

const env = Object.fromEntries(
  fs
    .readFileSync(SOURCE, 'utf8')
    .split(/\r?\n/u)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/u, '$2')]),
);
for (const k of ['CF_EMAIL', 'CF_GLOBAL_API_KEY', 'CF_ACCOUNT_ID']) if (!env[k]) throw new Error(`${SOURCE}: ${k} is missing`);
const account = env.CF_ACCOUNT_ID;
if (!/^[0-9a-f]{32}$/u.test(account)) throw new Error('CF_ACCOUNT_ID must be 32 hex characters');

const must = async (method, route, body) => {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: { 'X-Auth-Email': env.CF_EMAIL, 'X-Auth-Key': env.CF_GLOBAL_API_KEY, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(`${method} ${route.split('?')[0]} → ${(json.errors ?? []).map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${res.status}`}`);
  return json.result;
};

const zone = (await must('GET', `/zones?name=clx.cx&account.id=${account}`))[0];
if (!zone) throw new Error(`no zone clx.cx in account ${account}`);
const catalog = await must('GET', '/user/tokens/permission_groups');
const pick = (names, scope) =>
  names.map((name) => {
    const g = catalog.find((x) => x.name === name && (x.scopes ?? []).includes(scope));
    if (!g) throw new Error(`not in Cloudflare's catalog: ${name}`);
    return { id: g.id };
  });
const accountGroups = pick(ACCOUNT_RIGHTS, 'com.cloudflare.api.account');
const zoneGroups = pick(ZONE_RIGHTS, 'com.cloudflare.api.account.zone');
console.log(`account ${account}: ${ACCOUNT_RIGHTS.join(', ')}; zone clx.cx (${zone.id}): ${ZONE_RIGHTS.join(', ')}`);
const previous = (await must('GET', '/user/tokens?per_page=50')).filter((t) => t.name === NAME);
if (dry) {
  console.log(`dry run — would create "${NAME}"${previous.length ? ` and delete ${previous.length} older one(s)` : ''}`);
  process.exit(0);
}
const token = await must('POST', '/user/tokens', {
  name: NAME,
  policies: [
    { effect: 'allow', permission_groups: accountGroups, resources: { [`com.cloudflare.api.account.${account}`]: '*' } },
    { effect: 'allow', permission_groups: zoneGroups, resources: { [`com.cloudflare.api.account.zone.${zone.id}`]: '*' } },
  ],
});
fs.mkdirSync('.secrets', { recursive: true });
lockSecrets();
fs.writeFileSync(OUT, `CLOUDFLARE_API_TOKEN=${token.value}\nCLOUDFLARE_ACCOUNT_ID=${account}\n`, { mode: 0o600 });
lockSecrets();
console.log(`token created: id ${token.id}, saved to ${OUT} (value not shown)`);
for (const t of previous) {
  await must('DELETE', `/user/tokens/${t.id}`);
  console.log(`older token ${t.id} deleted`);
}

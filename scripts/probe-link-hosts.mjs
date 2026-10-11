#!/usr/bin/env node
// node scripts/probe-link-hosts.mjs  > temp/probe-link-hosts.log
//
// Which way gives a link host its DNS record (docs/spec.md §13 item 2, ADR 0024), tried on the
// throwaway account of .secrets/test-cloudflare.env with tokens of clx's own rights
// (src/cf/connect.ts ACCOUNT_RIGHTS + ZONE_RIGHTS) and, where they fall short, one right more:
//   A. Workers Custom Domains (`PUT /accounts/{id}/workers/domains`): Cloudflare makes the record and
//      the certificate — with clx's rights, then with each extra right that might be the missing one;
//   B. a proxied `AAAA 100::` made by clx (DNS Write) and a route `<host>/*`.
// For each that works: the time until the host answers with the worker over HTTPS, and whether a
// removal leaves anything. A throwaway script answers `probe-ok`. The stand is made and removed
// with the Global key; what is tried is tried with the scoped tokens. Nothing secret is printed.
import fs from 'node:fs';
import { lockSecrets } from './secrets-dir.mjs';

// clx's rights, read from src/cf/connect.ts (its imports have no extension: Node cannot load it).
const source = fs.readFileSync('src/cf/connect.ts', 'utf8');
const rights = (name) => JSON.parse(source.match(new RegExp(`export const ${name} = (\\[[^\\]]*\\]);`, 'u'))[1].replaceAll("'", '"'));
const ACCOUNT_RIGHTS = rights('ACCOUNT_RIGHTS');
const ZONE_RIGHTS = rights('ZONE_RIGHTS');

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
const account = env.CF_ACCOUNT_ID;
const admin = { 'X-Auth-Email': env.CF_EMAIL, 'X-Auth-Key': env.CF_GLOBAL_API_KEY };

/** A call; `auth` the Global key headers or a bearer token. Never throws: the envelope as it came. */
async function cf(auth, method, path, body) {
  const headers = typeof auth === 'string' ? { authorization: `Bearer ${auth}` } : { ...auth };
  const init = { method, headers };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${CF}${path}`, init);
  const text = await res.text();
  // A success may come with no body at all (deleting a custom domain: 200 and nothing).
  if (res.ok && !text.trim()) return { status: res.status, success: true, result: null };
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { success: false, errors: [{ message: `HTTP ${res.status}, not JSON` }] };
  }
  return { status: res.status, ...json };
}
const must = async (...a) => {
  const r = await cf(admin, ...a);
  if (!r.success) throw new Error(`${a[0]} ${a[1]} → ${JSON.stringify(r.errors)}`);
  return r.result;
};
const say = (what, extra = '') => console.log(`${new Date().toISOString().slice(11, 19)} ${what}${extra ? ` — ${extra}` : ''}`);
const errs = (r) => JSON.stringify((r.errors ?? []).map((e) => `${e.code}: ${e.message}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Seconds until https://host/ answers `probe-ok`, or null after `limit` seconds. */
async function served(host, limit = 300) {
  const t0 = Date.now();
  while (Date.now() - t0 < limit * 1000) {
    const body = await fetch(`https://${host}/`, { redirect: 'manual' })
      .then((r) => r.text())
      .catch(() => '');
    if (body.includes('probe-ok')) return Math.round((Date.now() - t0) / 1000);
    await sleep(5000);
  }
  return null;
}

const run = Date.now().toString(36).slice(-5);
const zone = await must('GET', `/zones/${env.CF_ZONE_ID}`);
const script = `clx-probe-lh-${run}`;
const tokens = [];
const domains = [];
const records = [];
const routes = [];

try {
  // The stand: a worker that answers probe-ok.
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({ main_module: 'w.js', compatibility_date: '2026-09-01' })], { type: 'application/json' }));
  form.append('w.js', new Blob(['export default { fetch() { return new Response("probe-ok"); } };'], { type: 'application/javascript+module' }), 'w.js');
  await must('PUT', `/accounts/${account}/workers/scripts/${script}`, form);
  say('stand: script uploaded', script);

  const catalog = await must('GET', `/accounts/${account}/tokens/permission_groups`);
  const id = (name, scope) => catalog.find((g) => g.name === name && (g.scopes ?? []).includes(scope))?.id;
  const accScope = 'com.cloudflare.api.account';
  const zoneScope = 'com.cloudflare.api.account.zone';
  /** A token of clx's rights plus `extra` ([name, 'account'|'zone']). */
  async function token(label, extra = []) {
    const acc = [...ACCOUNT_RIGHTS, ...extra.filter((e) => e[1] === 'account').map((e) => e[0])].map((n) => id(n, accScope));
    const zon = [...ZONE_RIGHTS, ...extra.filter((e) => e[1] === 'zone').map((e) => e[0])].map((n) => id(n, zoneScope));
    if ([...acc, ...zon].some((x) => !x)) throw new Error(`a right of ${label} is not in the catalog: ${JSON.stringify(extra)}`);
    const t = await must('POST', `/accounts/${account}/tokens`, {
      name: `probe-lh-${label}-${run}`,
      expires_on: new Date(Date.now() + 3_600_000).toISOString().replace(/\.\d{3}Z$/u, 'Z'),
      policies: [
        { effect: 'allow', resources: { [`com.cloudflare.api.account.${account}`]: '*' }, permission_groups: acc.map((g) => ({ id: g })) },
        { effect: 'allow', resources: { [`com.cloudflare.api.account.${account}`]: { 'com.cloudflare.api.account.zone.*': '*' } }, permission_groups: zon.map((g) => ({ id: g })) },
      ],
    });
    tokens.push(t.id);
    await sleep(3000); // a new token takes a moment to be accepted
    return t.value;
  }

  // A. Workers Custom Domains, with clx's rights and then one right more at a time.
  const tries = [
    ['clx', []],
    ['dns', [['DNS Write', 'zone']]],
    ['ssl', [['SSL and Certificates Write', 'zone']]],
    ['dns-ssl', [['DNS Write', 'zone'], ['SSL and Certificates Write', 'zone']]],
  ];
  let customDomainToken = null;
  for (const [label, extra] of tries) {
    const t = await token(label, extra);
    const host = `cd${label.replace(/-/gu, '')}${run}.${zone.name}`;
    const r = await cf(t, 'PUT', `/accounts/${account}/workers/domains`, { zone_id: zone.id, hostname: host, service: script, environment: 'production' });
    say(`A. custom domain with ${label === 'clx' ? 'clx’s rights' : `clx’s rights + ${extra.map((e) => e[0]).join(' + ')}`}`, r.success ? `ok, ${host}` : `${r.status} ${errs(r)}`);
    if (!r.success) continue;
    domains.push(r.result.id);
    customDomainToken = t;
    const rec = (await must('GET', `/zones/${zone.id}/dns_records?name=${host}`)).map((x) => `${x.type} ${x.content} proxied=${x.proxied}`);
    say('   its DNS record, as Cloudflare made it', JSON.stringify(rec));
    say('   served over HTTPS after', `${await served(host)} s`);
    const list = await cf(t, 'GET', `/accounts/${account}/workers/domains?hostname=${host}`);
    say('   listed with the same token', list.success ? `${list.result.length}` : errs(list));
    const del = await cf(t, 'DELETE', `/accounts/${account}/workers/domains/${r.result.id}`);
    say('   removed with the same token', del.success ? 'ok' : errs(del));
    if (del.success) domains.pop();
    await sleep(5000);
    const left = await must('GET', `/zones/${zone.id}/dns_records?name=${host}`);
    say('   DNS record after the removal', left.length ? JSON.stringify(left.map((x) => x.type)) : 'none');
    // A host that already has a record (someone else's): what Cloudflare answers.
    const taken = `tk${run}.${zone.name}`;
    const own = await must('POST', `/zones/${zone.id}/dns_records`, { type: 'A', name: taken, content: '192.0.2.1', proxied: true, ttl: 1 });
    records.push(own.id);
    const clash = await cf(t, 'PUT', `/accounts/${account}/workers/domains`, { zone_id: zone.id, hostname: taken, service: script, environment: 'production' });
    say('   a host with a record already', clash.success ? `ok (attached over it: ${JSON.stringify((await must('GET', `/zones/${zone.id}/dns_records?name=${taken}`)).map((x) => `${x.type} ${x.content}`))})` : `${clash.status} ${errs(clash)}`);
    if (clash.success) domains.push(clash.result.id);
    break;
  }

  // B. A proxied AAAA 100:: made by clx (DNS Write) and a route.
  const t = await token('b', [['DNS Write', 'zone']]);
  const host = `rt${run}.${zone.name}`;
  const rec = await cf(t, 'POST', `/zones/${zone.id}/dns_records`, { type: 'AAAA', name: host, content: '100::', proxied: true, ttl: 1, comment: 'clx link host (probe)' });
  say('B. proxied AAAA 100:: with clx’s rights + DNS Write', rec.success ? 'ok' : `${rec.status} ${errs(rec)}`);
  if (rec.success) records.push(rec.result.id);
  const route = await cf(t, 'POST', `/zones/${zone.id}/workers/routes`, { pattern: `${host}/*`, script });
  say('   route', route.success ? 'ok' : errs(route));
  if (route.success) routes.push(route.result.id);
  if (rec.success && route.success) say('   served over HTTPS after', `${await served(host)} s`);
  // What clx without DNS Write can and cannot do with a record.
  const plain = await token('plain');
  const noDns = await cf(plain, 'POST', `/zones/${zone.id}/dns_records`, { type: 'AAAA', name: `nd${run}.${zone.name}`, content: '100::', proxied: true, ttl: 1 });
  say('   the same record with clx’s rights alone', noDns.success ? 'ok (unexpected)' : `${noDns.status} ${errs(noDns)}`);
  if (noDns.success) records.push(noDns.result.id);
  void customDomainToken;
} finally {
  for (const d of domains) await cf(admin, 'DELETE', `/accounts/${account}/workers/domains/${d}`);
  for (const r of routes) await cf(admin, 'DELETE', `/zones/${env.CF_ZONE_ID}/workers/routes/${r}`);
  for (const r of records) await cf(admin, 'DELETE', `/zones/${env.CF_ZONE_ID}/dns_records/${r}`);
  await cf(admin, 'DELETE', `/accounts/${account}/workers/scripts/${script}?force=true`);
  for (const t of tokens) await cf(admin, 'DELETE', `/accounts/${account}/tokens/${t}`);
  const leftScripts = (await must('GET', `/accounts/${account}/workers/scripts`)).filter((s) => s.id === script).length;
  const leftTokens = (await must('GET', `/accounts/${account}/tokens?per_page=50`)).filter((x) => x.name.startsWith('probe-lh-')).length;
  const leftDns = (await must('GET', `/zones/${env.CF_ZONE_ID}/dns_records?per_page=100`)).filter((x) => x.name.endsWith(`${run}.${zone.name}`)).length;
  say('cleanup', `script ${leftScripts}, tokens ${leftTokens}, dns ${leftDns} left`);
}

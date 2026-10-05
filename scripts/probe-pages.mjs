#!/usr/bin/env node
// node scripts/probe-pages.mjs zones | up | check | down
//
// docs/spec.md §13 item 9, on a throwaway Cloudflare account: does a worker route
// `<host>/<path>/*` run on a host served by a Pages custom domain, and does a pass-through
// `fetch(request)` from that worker reach the Pages project (its own 404)? The account comes from
// .secrets/test-cloudflare.env (CF_EMAIL, CF_GLOBAL_API_KEY, CF_ACCOUNT_ID, CF_ZONE_ID); nothing
// secret is printed. `up` builds a Pages project, a custom domain and a worker with a route on
// `clx-probe.<zone>`; `check` asks the host who answers; `down` removes all of it.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { lockSecrets } from './secrets-dir.mjs';

const SOURCE = '.secrets/test-cloudflare.env';
const API = 'https://api.cloudflare.com/client/v4';
const PROJECT = 'clx-probe';
const SCRIPT = 'clx-probe-edge';
const PATH = 'k7q2';

lockSecrets();
const env = Object.fromEntries(
  fs
    .readFileSync(SOURCE, 'utf8')
    .split(/\r?\n/u)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/u, '$2')]),
);
for (const k of ['CF_EMAIL', 'CF_GLOBAL_API_KEY', 'CF_ACCOUNT_ID', 'CF_ZONE_ID']) if (!env[k]) throw new Error(`${SOURCE}: ${k} is missing`);
const account = env.CF_ACCOUNT_ID;
const auth = { 'X-Auth-Email': env.CF_EMAIL, 'X-Auth-Key': env.CF_GLOBAL_API_KEY };

async function cf(method, route, body, { raw = false, ok404 = false } = {}) {
  const init = { method, headers: { ...auth } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${API}${route}`, init);
  const json = await res.json().catch(() => ({}));
  if (ok404 && res.status === 404) return null;
  if (!json.success) throw new Error(`${method} ${route.split('?')[0]} → ${(json.errors ?? []).map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${res.status}`}`);
  return raw ? json : json.result;
}

const zone = await cf('GET', `/zones/${env.CF_ZONE_ID}`);
const host = `clx-probe.${zone.name}`;

/** The worker under test: the collector and the script on its own path, everything else passed on. */
const WORKER = `export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/${PATH}/c') return new Response(null, { status: 204, headers: { 'cache-control': 'no-store', 'x-probe': 'worker' } });
    if (request.method === 'GET' && url.pathname === '/${PATH}/s.js') return new Response('void 0;', { headers: { 'content-type': 'text/javascript', 'x-probe': 'worker' } });
    return fetch(request);
  },
};`;

function wrangler(args) {
  // wrangler with the test account only: the Global API Key goes in the child's environment, not
  // on its command line.
  const child = { ...process.env, CLOUDFLARE_EMAIL: env.CF_EMAIL, CLOUDFLARE_API_KEY: env.CF_GLOBAL_API_KEY, CLOUDFLARE_ACCOUNT_ID: account };
  delete child.CLOUDFLARE_API_TOKEN;
  const r = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], { env: child, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`wrangler ${args[0]} ${args[1] ?? ''} failed: ${(r.stderr || r.stdout).slice(-600)}`);
  return r.stdout;
}

async function up() {
  fs.mkdirSync('temp/probe-site', { recursive: true });
  fs.writeFileSync('temp/probe-site/index.html', '<!doctype html><title>probe</title><p>pages index</p>');
  fs.writeFileSync('temp/probe-site/404.html', '<!doctype html><title>404</title><p>pages own 404</p>');
  if (!(await cf('GET', `/accounts/${account}/pages/projects/${PROJECT}`, undefined, { ok404: true })))
    await cf('POST', `/accounts/${account}/pages/projects`, { name: PROJECT, production_branch: 'main' });
  wrangler(['pages', 'deploy', 'temp/probe-site', '--project-name', PROJECT, '--branch', 'main', '--commit-dirty=true']);
  console.log(`pages: ${PROJECT} deployed`);
  const domains = await cf('GET', `/accounts/${account}/pages/projects/${PROJECT}/domains`);
  if (!domains.some((d) => d.name === host)) await cf('POST', `/accounts/${account}/pages/projects/${PROJECT}/domains`, { name: host });
  const records = await cf('GET', `/zones/${zone.id}/dns_records?name=${host}`);
  if (!records.length) await cf('POST', `/zones/${zone.id}/dns_records`, { type: 'CNAME', name: host, content: `${PROJECT}.pages.dev`, proxied: true, comment: 'clx probe' });
  console.log(`pages custom domain: ${host}`);
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({ main_module: 'worker.js', compatibility_date: '2026-09-01' })], { type: 'application/json' }));
  form.append('worker.js', new Blob([WORKER], { type: 'application/javascript+module' }), 'worker.js');
  await cf('PUT', `/accounts/${account}/workers/scripts/${SCRIPT}`, form);
  console.log(`worker: ${SCRIPT}`);
  const routes = await cf('GET', `/zones/${zone.id}/workers/routes`);
  if (!routes.some((r) => r.pattern === `${host}/${PATH}/*`)) await cf('POST', `/zones/${zone.id}/workers/routes`, { pattern: `${host}/${PATH}/*`, script: SCRIPT });
  console.log(`route: ${host}/${PATH}/* → ${SCRIPT}`);
}

async function check() {
  const status = (await cf('GET', `/accounts/${account}/pages/projects/${PROJECT}/domains`)).find((d) => d.name === host);
  console.log(`custom domain status: ${status?.status ?? 'missing'}`);
  const probes = [
    ['GET', '/', 'the Pages index, not the worker'],
    ['POST', `/${PATH}/c`, '204 from the worker'],
    ['GET', `/${PATH}/s.js`, 'the script from the worker'],
    ['GET', `/${PATH}/nothing-here`, "passed through: the Pages project's own 404"],
    ['PUT', `/${PATH}/c`, 'another method, passed through'],
    ['GET', '/nothing-here', "outside the route: Pages' own 404"],
  ];
  for (const [method, path, want] of probes) {
    const res = await fetch(`https://${host}${path}`, { method, body: method === 'GET' ? undefined : 'https://example.com/', redirect: 'manual' });
    const text = await res.text();
    const who = res.headers.get('x-probe') ?? (text.includes('pages own 404') ? 'pages-404' : text.includes('pages index') ? 'pages-index' : 'other');
    console.log(`${method} ${path} → ${res.status} ${who}   (want: ${want})`);
  }
}

async function down() {
  for (const r of (await cf('GET', `/zones/${zone.id}/workers/routes`)).filter((r) => r.pattern.startsWith(`${host}/`))) await cf('DELETE', `/zones/${zone.id}/workers/routes/${r.id}`);
  await cf('DELETE', `/accounts/${account}/workers/scripts/${SCRIPT}`, undefined, { ok404: true });
  if (await cf('GET', `/accounts/${account}/pages/projects/${PROJECT}`, undefined, { ok404: true })) {
    await cf('DELETE', `/accounts/${account}/pages/projects/${PROJECT}/domains/${host}`, undefined, { ok404: true });
    await cf('DELETE', `/accounts/${account}/pages/projects/${PROJECT}`);
  }
  for (const r of await cf('GET', `/zones/${zone.id}/dns_records?name=${host}`)) await cf('DELETE', `/zones/${zone.id}/dns_records/${r.id}`);
  fs.rmSync('temp/probe-site', { recursive: true, force: true });
  console.log('removed: route, worker, Pages project and domain, DNS record');
}

/** §8 upgrade advice: which GraphQL Analytics datasets a Free account answers. */
async function analytics() {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const until = new Date().toISOString();
  const day = since.slice(0, 10);
  const today = until.slice(0, 10);
  const queries = {
    workersInvocationsAdaptive: `workersInvocationsAdaptive(limit: 50, filter: { datetime_geq: "${since}", datetime_leq: "${until}" }) { sum { requests errors } dimensions { scriptName } }`,
    d1AnalyticsAdaptiveGroups: `d1AnalyticsAdaptiveGroups(limit: 50, filter: { date_geq: "${day}", date_leq: "${today}" }) { sum { rowsRead rowsWritten } dimensions { databaseId date } }`,
    d1StorageAdaptiveGroups: `d1StorageAdaptiveGroups(limit: 50, filter: { date_geq: "${day}", date_leq: "${today}" }) { max { databaseSizeBytes } dimensions { databaseId date } }`,
  };
  for (const [name, q] of Object.entries(queries)) {
    // GraphQL answers {data, errors}, not the REST envelope cf() expects.
    const res = await fetch(`${API}/graphql`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: `{ viewer { accounts(filter: { accountTag: "${account}" }) { ${q} } } }` }) });
    const json = await res.json();
    if (json.errors?.length) console.log(`${name}: ERROR ${json.errors.map((e) => e.message).join('; ')}`);
    else console.log(`${name}: ok ${JSON.stringify(json.data.viewer.accounts[0]?.[name] ?? null)}`);
  }
}

/** A throwaway D1 with a few writes, so the D1 datasets have something to show. */
async function d1(remove) {
  const found = (await cf('GET', `/accounts/${account}/d1/database?name=clx-probe-d1`)).find((d) => d.name === 'clx-probe-d1');
  if (remove) {
    if (found) await cf('DELETE', `/accounts/${account}/d1/database/${found.uuid}`);
    console.log('d1: removed');
    return;
  }
  const db = found ?? (await cf('POST', `/accounts/${account}/d1/database`, { name: 'clx-probe-d1' }));
  await cf('POST', `/accounts/${account}/d1/database/${db.uuid}/query`, { sql: 'CREATE TABLE IF NOT EXISTS t (n INTEGER); INSERT INTO t VALUES (1), (2), (3), (4), (5);' });
  const info = await cf('GET', `/accounts/${account}/d1/database/${db.uuid}`);
  console.log(`d1: ${db.uuid} written; REST file_size = ${info.file_size}`);
}

const cmd = process.argv[2];
if (cmd === 'groups') {
  // The permission groups the working token (§3) needs, as Cloudflare's catalog names them.
  const want = /^(Account Settings Read|D1 (Read|Write|Edit)|Workers Scripts (Read|Write|Edit)|Account Analytics Read|Zone Read|Workers Routes (Read|Write|Edit)|Account API Tokens (Read|Write|Edit)|API Tokens (Read|Write|Edit))$/u;
  for (const g of await cf('GET', `/accounts/${account}/tokens/permission_groups`)) if (want.test(g.name)) console.log(`${g.name}\t${(g.scopes ?? []).join(',')}`);
} else if (cmd === 'analytics') await analytics();
else if (cmd === 'd1') await d1(false);
else if (cmd === 'd1-down') await d1(true);
else if (cmd === 'zones') {
  const zones = await cf('GET', `/zones?account.id=${account}&per_page=50`);
  for (const z of zones) console.log(`${z.name}\t${z.status}\t${z.plan?.name ?? ''}${z.id === zone.id ? '\t← CF_ZONE_ID' : ''}`);
} else if (cmd === 'up') await up();
else if (cmd === 'check') await check();
else if (cmd === 'down') await down();
else {
  console.error('usage: node scripts/probe-pages.mjs zones | up | check | down');
  process.exit(2);
}

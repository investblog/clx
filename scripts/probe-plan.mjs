#!/usr/bin/env node
// node scripts/probe-plan.mjs
//
// Can clx tell a Cloudflare account on Workers Paid from one on Free, with the rights of its working
// token? On the clx.cx account (Workers Paid; .secrets/cloudflare-global.env) and the test account
// (Free; .secrets/test-cloudflare.env) it makes a short-lived token with exactly the working
// token's account rights (src/cf/connect.ts ACCOUNT_RIGHTS), asks Cloudflare the places a plan could
// show in, and prints status and shape side by side; then deletes the tokens. The Global API Key
// only prepares and cleans up, and answers the same questions once for reference — what the token
// can read is what counts. Nothing secret is printed.
import fs from 'node:fs';
import { lockSecrets } from './secrets-dir.mjs';

const API = 'https://api.cloudflare.com/client/v4';
const ACCOUNT_RIGHTS = ['Account Settings Read', 'Account Analytics Read', 'D1 Read', 'D1 Write', 'Workers Scripts Read', 'Workers Scripts Write'];
const NAME = 'clx-probe-plan';

lockSecrets();
const readEnv = (file) =>
  Object.fromEntries(
    fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/u)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/u, '$2')]),
  );

const SOURCES = [
  ['paid (clx.cx)', '.secrets/cloudflare-global.env'],
  ['free (test)', '.secrets/test-cloudflare.env'],
];

/** The shape of an answer: keys, and short scalar values that name a plan or a limit. */
function shape(v, depth = 0) {
  if (v === null || typeof v !== 'object') return typeof v === 'string' && v.length > 60 ? `"${v.slice(0, 60)}…"` : JSON.stringify(v);
  if (depth >= 3) return Array.isArray(v) ? `[${v.length}]` : '{…}';
  if (Array.isArray(v)) return `[${v.length}] ${v.length ? shape(v[0], depth + 1) : ''}`;
  return `{ ${Object.entries(v)
    .map(([k, x]) => `${k}: ${shape(x, depth + 1)}`)
    .join(', ')} }`;
}

async function ask(headers, method, route, body) {
  const res = await fetch(`${API}${route}`, { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: !!json.success || (res.ok && !json.errors?.length), errors: (json.errors ?? []).map((e) => `${e.code}: ${e.message}`).join('; '), result: json.result ?? json.data ?? null };
}

const GRAPHQL_SETTINGS = `query($a: string!) { viewer { accounts(filter: { accountTag: $a }) {
  settings { workersInvocationsAdaptive { maxDuration maxNumberOfFields maxPageSize notOlderThan availableFields }
             d1AnalyticsAdaptiveGroups { maxDuration notOlderThan } } } } }`;

const questions = (account) => [
  ['GET subscriptions', 'GET', `/accounts/${account}/subscriptions`],
  ['GET account', 'GET', `/accounts/${account}`],
  ['GET workers/account-settings', 'GET', `/accounts/${account}/workers/account-settings`],
  ['GET workers/scripts (usage_model)', 'GET', `/accounts/${account}/workers/scripts`],
  ['GET workers/subdomain', 'GET', `/accounts/${account}/workers/subdomain`],
  ['GET billing/profile', 'GET', `/accounts/${account}/billing/profile`],
  ['GET entitlements', 'GET', `/accounts/${account}/entitlements`],
  ['GraphQL settings', 'POST', '/graphql', { query: GRAPHQL_SETTINGS, variables: { a: account } }],
];

function report(label, r) {
  const brief = label.startsWith('GET workers/scripts')
    ? shape((r.result ?? []).map?.((s) => ({ id: s.id, usage_model: s.usage_model, limits: s.limits, placement_mode: s.placement_mode })) ?? r.result)
    : label === 'GET account'
      ? shape({ type: r.result?.type, settings: r.result?.settings, legacy_flags: r.result?.legacy_flags })
      : label === 'GET subscriptions'
        ? shape((r.result ?? []).map?.((s) => ({ rate_plan: s.rate_plan, product: s.product, component_values: s.component_values, state: s.state })) ?? r.result)
        : label === 'GET entitlements'
          ? (r.result ?? []).map?.((e) => `${e.feature?.key}=${JSON.stringify(e.allocation?.value)}`).sort().join(' ') ?? shape(r.result)
          : shape(r.result, -2);
  console.log(`  ${label}: ${r.status}${r.errors ? ` — ${r.errors}` : ''}\n    ${brief.slice(0, 8000)}`);
}

for (const [label, file] of SOURCES) {
  const env = readEnv(file);
  const account = env.CF_ACCOUNT_ID;
  const admin = { 'X-Auth-Email': env.CF_EMAIL, 'X-Auth-Key': env.CF_GLOBAL_API_KEY };
  console.log(`\n=== ${label}`);
  const catalog = (await ask(admin, 'GET', '/user/tokens/permission_groups')).result;
  const groups = ACCOUNT_RIGHTS.map((n) => {
    const g = catalog.find((x) => x.name === n && (x.scopes ?? []).includes('com.cloudflare.api.account'));
    if (!g) throw new Error(`not in the catalog: ${n}`);
    return { id: g.id };
  });
  for (const t of (await ask(admin, 'GET', '/user/tokens?per_page=50')).result.filter((x) => x.name === NAME)) await ask(admin, 'DELETE', `/user/tokens/${t.id}`);
  const made = await ask(admin, 'POST', '/user/tokens', {
    name: NAME,
    expires_on: new Date(Date.now() + 3_600_000).toISOString().replace(/\.\d{3}Z$/u, 'Z'),
    policies: [{ effect: 'allow', permission_groups: groups, resources: { [`com.cloudflare.api.account.${account}`]: '*' } }],
  });
  if (!made.ok) throw new Error(`token not made: ${made.errors}`);
  try {
    await new Promise((r) => setTimeout(r, 5000));
    const bearer = { Authorization: `Bearer ${made.result.value}` };
    console.log('-- working-token rights');
    for (const [q, m, route, body] of questions(account)) report(q, await ask(bearer, m, route, body));
    console.log('-- Global API Key (reference only)');
    for (const [q, m, route, body] of questions(account).filter(([q]) => q === 'GET subscriptions' || q === 'GET entitlements')) report(q, await ask(admin, m, route, body));
  } finally {
    // Deleted for sure: a few tries, then the token list must not hold it, or the run fails.
    let gone = false;
    for (let i = 0; i < 5 && !gone; i++) {
      if (i) await new Promise((r) => setTimeout(r, 2000 * i));
      await ask(admin, 'DELETE', `/user/tokens/${made.result.id}`).catch(() => null);
      const list = await ask(admin, 'GET', '/user/tokens?per_page=50').catch(() => null);
      gone = !!list?.ok && !list.result.some((t) => t.id === made.result.id);
    }
    console.log(`-- probe token deleted: ${gone}`);
    if (!gone) {
      console.error(`the token "${NAME}" (id ${made.result.id}) may be left: delete it in Cloudflare`);
      process.exitCode = 1;
    }
  }
}

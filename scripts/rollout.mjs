// The rollout of a new clx-edge bundle to the installed accounts (docs/spec.md §4, ADR 0032), in the
// order that keeps a broken bundle from reaching every account at once:
//   1. GET /admin/edge/bundle-info: what clx.cx serves is the committed bundle, and released;
//   2. a dry run: the accounts that would be updated;
//   3. one account (the oldest) first; its update must end `done` with the worker on the new bundle
//      and `ready` — an update that fails is rolled back by clx.cx itself (§4) — or the rollout stops;
//   4. then every other account not on the bundle yet, each confirmed the same way.
// Run after `pnpm run deploy`, as an admin: `node scripts/user.mjs admin probe@clx.cx on` before,
// `off` after. The operations are read from the live D1; nothing secret is printed.
//   node scripts/rollout.mjs [--dry-run]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { lockSecrets } from './secrets-dir.mjs';

const BASE = 'https://clx.cx';
const DRY = process.argv.includes('--dry-run');
lockSecrets();
const [email, password] = fs.readFileSync('.secrets/user-probe@clx.cx.txt', 'utf8').split(/\r?\n/u);
const BUNDLE = fs.readFileSync('edge/bundle.gen.ts', 'utf8').match(/EDGE_SHA256 = '([0-9a-f]{64})'/u)[1];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (sha) => (sha ? sha.slice(0, 12) : '-');

function d1(sql) {
  const out = execFileSync(process.execPath, ['scripts/wrangler.mjs', 'd1', 'execute', 'clx', '--remote', '--json', `--command=${sql}`], { encoding: 'utf8' });
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
}
async function clx(method, path, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { authorization: session, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

/** Start the update of exactly these accounts. One the endpoint skips (no longer ready, gone) or
 *  could not start is a failure of the stage, so a stage never passes on fewer than it names. */
async function start(ids) {
  const r = await clx('POST', '/admin/edge/rollout', { accounts: ids });
  const got = r.status === 202 ? r.body.accounts.filter((a) => a.operation) : [];
  const missing = ids.filter((id) => !got.some((a) => a.id === id));
  for (const id of missing) console.log(`FAIL ${id}: not started (${r.body.accounts?.find((a) => a.id === id)?.error ?? `skipped, ${r.status}`})`);
  return { got, missing: missing.length };
}

/** Wait until none of the operations runs (the per-minute cron drives them), then say how each
 *  ended: the operation by its id, the account by its clx id — never by Cloudflare's, which a
 *  reconnected account shares with the one before. */
async function settle(started, minutes = 20) {
  const list = (xs) => xs.map((x) => `'${x}'`).join(', ');
  const end = Date.now() + minutes * 60_000;
  for (;;) {
    const ops = d1(`SELECT id, state, step FROM operations WHERE id IN (${list(started.map((s) => s.operation))})`);
    if (ops.every((o) => o.state !== 'running') || Date.now() > end) {
      const accounts = d1(`SELECT id, state, bundle FROM edge_accounts WHERE id IN (${list(started.map((s) => s.id))})`);
      return started.map((s) => ({ id: s.id, op: ops.find((o) => o.id === s.operation), account: accounts.find((a) => a.id === s.id) }));
    }
    await sleep(20_000);
  }
}
function report(rows) {
  let bad = 0;
  for (const { id, op, account } of rows) {
    const ok = op?.state === 'done' && op.step === 'done' && account?.state === 'ready' && account.bundle === BUNDLE;
    if (!ok) bad++;
    const note = op?.state === 'running' ? ' — still running: the cron carries it on; see its row in operations (a new run would start a fresh update of an account it left on the old bundle)' : '';
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${id}: operation ${op ? `${op.state}/${op.step}` : 'missing'}, account ${account?.state ?? 'gone'}, bundle ${short(account?.bundle)}${note}`);
  }
  return bad;
}

const login = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
if (!login.ok) throw new Error(`sign in: ${login.status}`);
const session = `Bearer ${(await login.json()).access_token}`;

const info = await clx('GET', '/admin/edge/bundle-info');
if (info.status !== 200) throw new Error(`bundle-info: ${info.status} ${JSON.stringify(info.body.error)} (admin on?)`);
if (info.body.sha256 !== BUNDLE || !info.body.released.includes(BUNDLE) || !(info.body.size > 0)) throw new Error(`clx.cx serves ${short(info.body.sha256)}, the tree has ${short(BUNDLE)}: deploy first`);
console.log(`bundle ${short(BUNDLE)}, ${info.body.size} bytes, schema ${info.body.schema}`);

const plan = (await clx('POST', '/admin/edge/rollout', { dry_run: true })).body.accounts;
console.log(`to update: ${plan.length}${plan.length ? ` (${plan.map((a) => `${a.id} from ${short(a.from)}`).join(', ')})` : ''}`);
if (DRY || !plan.length) process.exit(0);

const [first, ...rest] = plan;
/** One stage: start, wait, report; the number of accounts that did not take the bundle. */
async function stage(ids) {
  const { got, missing } = await start(ids);
  return missing + (got.length ? report(await settle(got)) : 0);
}
console.log(`first: ${first.id}`);
if (await stage([first.id])) {
  console.log('stopped: the first account did not take the bundle; the others are left as they are');
  process.exit(1);
}
process.exit(rest.length && (await stage(rest.map((a) => a.id))) ? 1 : 0);

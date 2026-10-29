// The balance and Pro (docs/spec.md §18, ADR 0034): periods charged by the UTC day, grace, the
// plan given by hand, what is beyond free paused, the delete refused while money is left.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccess } from '../src/auth/jwt';
import fs from 'node:fs';
import { applyPlan, reconcilePlans } from '../src/billing/pause';
import { DAY_PRICE, dayOf, GRACE_MS, lowBalances, markLowTold, proOff, proOn, runCharges, setComp, settleUser } from '../src/billing/pro';
import { app } from '../src/index';
import { sha256 } from '../src/lib/crypto';
import type { Env } from '../src/types';
import { fakeCtx, testEnv } from './env';

let env: Env;
let dispose: () => Promise<void>;
beforeAll(async () => ({ env, dispose } = await testEnv()));
afterAll(() => dispose());

const DAY = 86_400_000;
/** Noon of a fixed UTC day, so a test's "today" never crosses midnight. */
const T0 = Date.UTC(2026, 9, 1, 12);
const today = dayOf(T0);

beforeEach(async () => {
  for (const t of ['ledger', 'pro_periods', 'billing_archive', 'links', 'link_hosts', 'sites', 'edge_accounts', 'idempotency', 'api_keys', 'users']) await env.DB.prepare(`DELETE FROM ${t}`).run();
  await env.DB.prepare("INSERT INTO users (id, email, password_hash, created_at, email_confirmed_at, plan) VALUES (1, 'a@example.com', 'x', 0, 0, 'free'), (2, 'b@example.com', 'x', 0, NULL, 'free')").run();
});

const deposit = (user: number, usd: number, invoice = `inv-${Math.random()}`) =>
  env.DB.prepare("INSERT INTO ledger (user_id, type, amount, invoice_id, created_at) VALUES (?, 'deposit', ?, ?, 0)").bind(user, usd * 1_000_000, invoice).run();
const balance = async (user: number) => (await env.DB.prepare('SELECT coalesce(sum(amount), 0) AS b FROM ledger WHERE user_id = ?').bind(user).first<{ b: number }>())!.b;
const charges = async (user: number) => (await env.DB.prepare("SELECT day FROM ledger WHERE user_id = ? AND type = 'charge' ORDER BY day").bind(user).all<{ day: number }>()).results.map((r) => r.day);
const plan = async (user: number) => (await env.DB.prepare('SELECT plan FROM users WHERE id = ?').bind(user).first<{ plan: string }>())!.plan;
const periods = async (user: number) => (await env.DB.prepare('SELECT start_day, end_day FROM pro_periods WHERE user_id = ? ORDER BY id').bind(user).all<{ start_day: number; end_day: number | null }>()).results;

const session = async (user: number) => `Bearer ${await signAccess('test-jwt-secret', user, Date.now())}`;
async function call(method: string, path: string, auth: string, body?: unknown, key?: string) {
  const headers: Record<string, string> = { authorization: auth };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (key) headers['idempotency-key'] = key;
  const { ctx, settle } = fakeCtx();
  const res = await app.request(`https://clx.cx${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env, ctx);
  await settle();
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe('Pro on and off', () => {
  it('needs a confirmed address and $9; on charges today and makes the plan api', async () => {
    await expect(proOn(env, 2, T0)).rejects.toMatchObject({ code: 'email_unconfirmed' });
    await deposit(1, 8);
    await expect(proOn(env, 1, T0)).rejects.toMatchObject({ code: 'insufficient_balance', status: 402 });
    await deposit(1, 1);
    await proOn(env, 1, T0);
    expect(await charges(1)).toEqual([today]);
    expect(await balance(1)).toBe(9_000_000 - DAY_PRICE);
    expect(await plan(1)).toBe('api');
    // Again: one period, one charge.
    await proOn(env, 1, T0 + 1000);
    expect(await periods(1)).toEqual([{ start_day: today, end_day: null }]);
    expect(await charges(1)).toEqual([today]);
  });

  it('off ends after today; on again the same day needs $9 again and charges nothing twice', async () => {
    await deposit(1, 9);
    await proOn(env, 1, T0);
    await proOff(env, 1, T0 + 1000);
    expect(await periods(1)).toEqual([{ start_day: today, end_day: today + 1 }]);
    expect(await plan(1)).toBe('free');
    // $8.70 left: not enough to switch on again.
    await expect(proOn(env, 1, T0 + 2000)).rejects.toMatchObject({ code: 'insufficient_balance' });
    await deposit(1, 1);
    await proOn(env, 1, T0 + 3000);
    expect(await periods(1)).toEqual([
      { start_day: today, end_day: today + 1 },
      { start_day: today, end_day: null },
    ]);
    expect(await charges(1)).toEqual([today]);
    // Off and on another day: a new period, that day charged.
    await proOff(env, 1, T0 + 4000);
    await deposit(1, 9);
    await proOn(env, 1, T0 + 2 * DAY);
    expect(await charges(1)).toEqual([today, today + 2]);
  });

  it('a period closed or given by hand is not charged by a settle that read it open', async () => {
    await deposit(1, 20);
    await proOn(env, 1, T0);
    await proOff(env, 1, T0 + 1000);
    expect(await settleUser(env, 1, T0 + DAY)).toBe('none');
    await proOn(env, 1, T0 + 2 * DAY);
    await env.DB.prepare('UPDATE users SET plan_comp = 1 WHERE id = 1').run();
    await settleUser(env, 1, T0 + 3 * DAY);
    expect(await charges(1)).toEqual([today, today + 2]);
  });

  it('a period older than any window: every unpaid day is charged, oldest first', async () => {
    await deposit(1, 30);
    await env.DB.prepare('INSERT INTO pro_periods (user_id, start_day, created_at) VALUES (1, ?, 0)').bind(today - 60).run();
    await settleUser(env, 1, T0);
    expect(await charges(1)).toEqual([...Array(61).keys()].map((i) => today - 60 + i));
    expect((await call('GET', '/v1/billing', await session(1))).body.pro.paid_through).toBe(new Date(T0).toISOString().slice(0, 10));
  });

  it('the API: GET and POST /v1/billing/pro with the billing scope', async () => {
    await deposit(1, 9);
    const on = await call('POST', '/v1/billing/pro', await session(1), { on: true }, 'p1');
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ balance_micro_usd: 9_000_000 - DAY_PRICE, pro: { on: true, given: false, price_micro_usd: 9_000_000, day_micro_usd: 300_000, grace_until: null } });
    expect(on.body.journal.map((r: { type: string }) => r.type)).toEqual(['charge', 'deposit']);
    expect((await call('GET', '/v1/me', await session(1))).body.plan).toBe('api');
    expect((await call('POST', '/v1/billing/pro', await session(1), { on: 'yes' })).body.error.code).toBe('invalid_request');
  });
});

describe('the cron', () => {
  it('charges each day once, however often it runs', async () => {
    await deposit(1, 9);
    await proOn(env, 1, T0);
    await runCharges(env, T0 + 60_000);
    await runCharges(env, T0 + DAY);
    await runCharges(env, T0 + DAY + 60_000);
    expect(await charges(1)).toEqual([today, today + 1]);
  });

  it('a short balance starts a grace; 3 days on the period closes at its first unpaid day, which nobody owes', async () => {
    await deposit(1, 9);
    await proOn(env, 1, T0);
    // Spend all but half a day: the next day is short.
    await env.DB.prepare("INSERT INTO ledger (user_id, type, amount, created_at) VALUES (1, 'adjustment', ?, 0)").bind(-(9_000_000 - DAY_PRICE - DAY_PRICE / 2)).run();
    const first = await runCharges(env, T0 + DAY);
    expect(first.grace).toEqual([1]);
    expect(await plan(1)).toBe('api');
    // Within the grace: still Pro, no new notice.
    expect((await runCharges(env, T0 + 2 * DAY)).grace).toEqual([]);
    const done = await runCharges(env, T0 + DAY + GRACE_MS + 1);
    expect(done.closed).toEqual([1]);
    expect(await periods(1)).toEqual([{ start_day: today, end_day: today + 1 }]);
    expect(await plan(1)).toBe('free');
    expect(await env.DB.prepare('SELECT grace_since FROM users WHERE id = 1').first('grace_since')).toBeNull();
    // Money later pays nothing of those days.
    await deposit(1, 9);
    await settleUser(env, 1, T0 + 5 * DAY);
    expect(await charges(1)).toEqual([today]);
  });

  it('a top-up within the grace pays the missed days, oldest first, and ends it', async () => {
    await deposit(1, 9);
    await proOn(env, 1, T0);
    await env.DB.prepare("INSERT INTO ledger (user_id, type, amount, created_at) VALUES (1, 'adjustment', ?, 0)").bind(-(9_000_000 - DAY_PRICE)).run();
    await runCharges(env, T0 + DAY);
    await runCharges(env, T0 + 2 * DAY);
    await deposit(1, 9);
    expect(await settleUser(env, 1, T0 + 2 * DAY + 1000)).toBe('paid');
    expect(await charges(1)).toEqual([today, today + 1, today + 2]);
    expect(await env.DB.prepare('SELECT grace_since FROM users WHERE id = 1').first('grace_since')).toBeNull();
  });

  it('a user being deleted is not charged', async () => {
    await deposit(1, 9);
    await proOn(env, 1, T0);
    await env.DB.prepare('UPDATE users SET deleting_at = ? WHERE id = 1').bind(T0).run();
    await runCharges(env, T0 + DAY);
    expect(await charges(1)).toEqual([today]);
  });
});

describe('notices and the hourly check', () => {
  it('a balance under 14 days of Pro is told once, and again only after it was above', async () => {
    await deposit(1, 9);
    await proOn(env, 1, T0);
    // $8.70 covers 29 days: nothing yet.
    expect(await lowBalances(env)).toEqual([]);
    await env.DB.prepare("INSERT INTO ledger (user_id, type, amount, created_at) VALUES (1, 'adjustment', -5000000, 0)").run();
    expect(await lowBalances(env)).toEqual([1]);
    // Not told yet (the notice failed): asked again next hour.
    expect(await lowBalances(env)).toEqual([1]);
    await markLowTold(env, 1);
    expect(await lowBalances(env)).toEqual([]);
    await deposit(1, 9);
    expect(await lowBalances(env)).toEqual([]);
    await env.DB.prepare("INSERT INTO ledger (user_id, type, amount, created_at) VALUES (1, 'adjustment', -9000000, 0)").run();
    expect(await lowBalances(env)).toEqual([1]);
  });

  it('users on api before billing get $9 and Pro from the migration', async () => {
    await env.DB.prepare("UPDATE users SET plan = 'api' WHERE id = 1").run();
    const sql = fs.readFileSync('migrations/0015_billing.sql', 'utf8').replace(/--.*$/gmu, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter((s) => s.startsWith('INSERT'))) await env.DB.prepare(stmt).run();
    expect(await balance(1)).toBe(9_000_000);
    expect((await periods(1)).map((p) => p.end_day)).toEqual([null]);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM ledger WHERE user_id = 2').first('n')).toBe(0);
    await runCharges(env);
    expect((await charges(1)).length).toBe(1);
  });

  it('the hourly check puts a stored plan back in line and pauses what a free user has beyond free', async () => {
    await env.DB.prepare("UPDATE users SET plan = 'api' WHERE id = 1").run();
    await env.DB.prepare("INSERT INTO edge_accounts (id, user_id, cf_account_id, state, created_at, updated_at) VALUES ('ea1', 2, 'c1', 'ready', 1, 1), ('ea2', 2, 'c2', 'ready', 2, 2)").run();
    expect(await reconcilePlans(env, T0)).toBe(2);
    expect(await plan(1)).toBe('free');
    expect(await env.DB.prepare("SELECT paused_at FROM edge_accounts WHERE id = 'ea2'").first('paused_at')).toBe(T0);
    expect(await reconcilePlans(env, T0)).toBe(0);
    // A delete that died after it: the mark leaves the user to the check, which resumes the next one.
    await env.DB.prepare("DELETE FROM edge_accounts WHERE id = 'ea1'").run();
    await env.DB.prepare('UPDATE users SET replan_at = 1, grace_since = 1 WHERE id = 2').run();
    expect(await reconcilePlans(env, T0)).toBe(1);
    expect(await env.DB.prepare("SELECT paused_at FROM edge_accounts WHERE id = 'ea2'").first('paused_at')).toBeNull();
    // No period, no grace.
    expect(await env.DB.prepare('SELECT replan_at, grace_since FROM users WHERE id = 2').first()).toEqual({ replan_at: null, grace_since: null });
  });

  it('the hourly check pauses an external site a free user still has, though under ten sites (§5)', async () => {
    // As when an add began on Pro and the downgrade finished first.
    await env.DB.prepare("INSERT INTO edge_accounts (id, user_id, cf_account_id, state, created_at, updated_at) VALUES ('ea1', 2, 'c1', 'ready', 1, 1)").run();
    await env.DB.prepare(
      "INSERT INTO sites (id, account_id, user_id, target, host, kind, collector_host, zone_id, seed, state, revision, created_at, updated_at) VALUES ('z1', 'ea1', 2, 'sz', 'example.com', 'zone', NULL, 'zone1', 'a', 'active', 0, 1, 1), ('x1', 'ea1', 2, 'sx', 'othersite.net', 'external', 'example.com', 'zone1', 'b', 'active', 0, 2, 2)",
    ).run();
    expect(await reconcilePlans(env, T0)).toBe(1);
    expect((await env.DB.prepare('SELECT id, paused_at FROM sites ORDER BY id').all()).results).toEqual([
      { id: 'x1', paused_at: T0 },
      { id: 'z1', paused_at: null },
    ]);
    expect(await reconcilePlans(env, T0)).toBe(0);
  });
});

describe('a plan given by hand', () => {
  it('is never charged, settles the paid period, and taken back leaves free', async () => {
    await deposit(1, 9);
    await proOn(env, 1, T0);
    expect(await setComp(env, 1, true, T0 + 1000)).toBe('api');
    expect(await periods(1)).toEqual([{ start_day: today, end_day: today + 1 }]);
    await runCharges(env, T0 + 3 * DAY);
    expect(await charges(1)).toEqual([today]);
    expect((await call('GET', '/v1/billing', await session(1))).body.pro).toMatchObject({ on: true, given: true });
    expect(await setComp(env, 1, false, T0 + 3 * DAY)).toBe('free');
  });
});

describe('beyond free, paused (ADR 0034)', () => {
  async function estate() {
    const at = (n: number) => n * 1000;
    await env.DB.batch([
      // The newer account is the one in service: it is kept, the older one (not ready) paused.
      env.DB.prepare("INSERT INTO edge_accounts (id, user_id, cf_account_id, state, created_at, updated_at) VALUES ('ea1', 1, 'c1', 'connected', 1, 1), ('ea2', 1, 'c2', 'ready', 2, 2)"),
      env.DB.prepare(
        "INSERT INTO sites (id, account_id, user_id, target, host, zone_id, seed, excluded, state, revision, created_at, updated_at) SELECT 's' || value, 'ea2', 1, 't' || value, 'h' || value || '.example.com', 'z', 'seed' || value, '[]', 'active', 0, ?1 + value, 0 FROM json_each(?2)",
      ).bind(at(10), JSON.stringify([...Array(12).keys()])),
      env.DB.prepare("INSERT INTO sites (id, account_id, user_id, target, host, zone_id, seed, excluded, state, revision, created_at, updated_at) VALUES ('sx', 'ea1', 1, 'tx', 'x.example.com', 'z', 'seedx', '[]', 'active', 0, 1, 0)"),
    ]);
    for (const k of ['k1', 'k2', 'k3'])
      await env.DB.prepare("INSERT INTO api_keys (id, user_id, prefix, key_hash, scopes, created_at) VALUES (?, 1, 'clx_xxxx', ?, 'sites', ?)").bind(k, await sha256(`clx_${k}`), Number(k.slice(1))).run();
  }
  const paused = async (table: string) => (await env.DB.prepare(`SELECT id FROM ${table} WHERE paused_at IS NOT NULL ORDER BY id`).all<{ id: string }>()).results.map((r) => r.id);

  it('keeps the account in service, its 10 oldest sites and the oldest key; Pro resumes all', async () => {
    await estate();
    await env.DB.prepare("UPDATE users SET plan = 'api' WHERE id = 1").run();
    expect(await applyPlan(env, 1, T0)).toBe('free');
    expect(await paused('edge_accounts')).toEqual(['ea1']);
    expect(await paused('sites')).toEqual(['s10', 's11', 'sx']);
    expect(await paused('api_keys')).toEqual(['k2', 'k3']);
    // The worker is told: each changed account is a revision ahead and its sites carry it.
    const rev = await env.DB.prepare("SELECT config_revision FROM edge_accounts WHERE id = 'ea2'").first<number>('config_revision');
    expect(await env.DB.prepare("SELECT revision FROM sites WHERE id = 's10'").first('revision')).toBe(rev);
    // Again: nothing more is written.
    await applyPlan(env, 1, T0);
    expect(await env.DB.prepare("SELECT config_revision FROM edge_accounts WHERE id = 'ea2'").first('config_revision')).toBe(rev);

    // A paused key is refused; a paused site is read, not changed.
    expect((await call('GET', '/v1/me', 'Bearer clx_k2')).status).toBe(401);
    expect((await call('GET', '/v1/me', 'Bearer clx_k1')).status).toBe(200);
    const s = await call('PATCH', '/v1/sites/s11', await session(1), { excluded_paths: [] });
    expect(s.body.error.code).toBe('paused');
    expect((await call('GET', '/v1/sites/s11', await session(1))).body.site.paused_at).toEqual(new Date(T0).toISOString());
    // The limits count what works only.
    expect((await call('GET', '/v1/me', await session(1))).body.use).toEqual({ cf_accounts: 1, api_keys: 1 });

    // A kept site deleted: the next paused one works again.
    expect((await call('DELETE', '/v1/sites/s0', await session(1), undefined, 'del-s0')).status).toBe(200);
    expect(await paused('sites')).toEqual(['s11', 'sx']);
    // Paused things are refused everywhere they could change: the key's lists, the account.
    expect((await call('PATCH', '/v1/keys/k2', await session(1), { allow_ips: null })).body.error.code).toBe('paused');
    expect((await call('POST', '/v1/accounts/ea1/install', await session(1))).body.error.code).toBe('paused');

    await deposit(1, 9);
    await proOn(env, 1, T0);
    expect(await paused('edge_accounts')).toEqual([]);
    expect(await paused('sites')).toEqual([]);
    expect(await paused('api_keys')).toEqual([]);
  });
});

describe('deleting the account (§18)', () => {
  it('is refused with money on the balance; without, the journal is archived without the address', async () => {
    const { hashPassword } = await import('../src/auth/password');
    await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = 1').bind(await hashPassword('correct horse battery')).run();
    await deposit(1, 9, 'inv-a');
    const refused = await call('DELETE', '/v1/me', await session(1), { password: 'correct horse battery' }, 'd1');
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({ code: 'balance_not_empty', details: { balance_micro_usd: 9_000_000 } });
    expect(await env.DB.prepare('SELECT deleting_at FROM users WHERE id = 1').first('deleting_at')).toBeNull();

    await env.DB.prepare("INSERT INTO ledger (user_id, type, amount, invoice_id, created_at) VALUES (1, 'refund', -9000000, 'inv-a', 0)").run();
    const gone = await call('DELETE', '/v1/me', await session(1), { password: 'correct horse battery' }, 'd2');
    expect(gone.status).toBe(200);
    expect(await env.DB.prepare('SELECT 1 FROM users WHERE id = 1').first()).toBeNull();
    expect(await env.DB.prepare('SELECT count(*) AS n FROM ledger').first('n')).toBe(0);
    const archived = await env.DB.prepare('SELECT data FROM billing_archive').first<{ data: string }>();
    expect(JSON.parse(archived!.data).ledger.map((r: { type: string; id: number }) => [r.type, typeof r.id]).sort()).toEqual([['deposit', 'number'], ['refund', 'number']]);
    expect(archived!.data).not.toContain('a@example.com');
  });
});

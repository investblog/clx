// Crypto top-ups (docs/spec.md §18, ADR 0035): invoices at a fake Trybit, the signed webhook as a
// signal only, crediting what arrived once, partial payments to an operator, the reconcile run.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { signAccess } from '../src/auth/jwt';
import { operatorCredit, operatorVoid, reconcile } from '../src/billing/invoices';
import { proOn } from '../src/billing/pro';
import { toMicro } from '../src/billing/trybit';
import { app } from '../src/index';
import type { Env } from '../src/types';
import { fakeCtx, testEnv } from './env';

let env: Env;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ env, dispose } = await testEnv());
  Object.assign(env, { PAYMENTS_API_KEY: 'key', PAYMENTS_SHOP_ID: 'shop', PAYMENTS_API_URL: 'https://trybit.test/api', PAYMENTS_WEBHOOK_SECRET: 'whsec' });
});
afterAll(() => dispose());

/** Trybit as far as clx uses it: create, and info for up to 100 ids. */
const trybit = {
  invoices: new Map<string, { order_id: string; amount_usd: number; status: string; received_usd: number | null; amount_paid_usd: number | null }>(),
  next429: 0,
  failCreate: false,
  calls: 0,
};
const realFetch = globalThis.fetch;
beforeEach(async () => {
  for (const t of ['ledger', 'pro_periods', 'invoices', 'billing_meta', 'idempotency', 'users']) await env.DB.prepare(`DELETE FROM ${t}`).run();
  await env.DB.prepare("INSERT INTO users (id, email, password_hash, created_at, email_confirmed_at, plan) VALUES (1, 'a@example.com', 'x', 0, 0, 'free'), (2, 'b@example.com', 'x', 0, NULL, 'free')").run();
  trybit.invoices.clear();
  trybit.next429 = 0;
  trybit.failCreate = false;
  trybit.calls = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('https://trybit.test/')) return realFetch(input, init);
    trybit.calls++;
    const body = JSON.parse(String(init?.body)) as Record<string, any>;
    if (url.endsWith('/invoice/create')) {
      if (trybit.failCreate) return ((trybit.failCreate = false), new Response('down', { status: 500 }));
      const uuid = `INV-${trybit.invoices.size + 1}`;
      trybit.invoices.set(uuid, { order_id: body.order_id, amount_usd: body.amount, status: 'created', received_usd: 0, amount_paid_usd: 0 });
      return Response.json({ result: { uuid, link: `https://pay.test/${uuid}`, address: 'TXaddr', amount: body.amount, fee: 1.4, side_commission: 'client', service_fee: 0.15, side_commission_service: 'client', currency: { fullcode: body.add_fields.cryptocurrency } } });
    }
    if (trybit.next429) {
      trybit.next429--;
      return new Response('slow down', { status: 429, headers: { 'retry-after': '120' } });
    }
    const result = (body.uuids as string[]).filter((u) => trybit.invoices.has(u)).map((u) => ({ uuid: u, ...trybit.invoices.get(u)! }));
    return Response.json({ result });
  });
});
afterEach(() => vi.restoreAllMocks());

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
const b64url = (b: Uint8Array | string) => btoa(typeof b === 'string' ? b : String.fromCharCode(...b)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
async function token(id: string, secret = 'whsec', alg = 'HS256', exp = Math.floor(Date.now() / 1000) + 300) {
  const head = `${b64url(JSON.stringify({ alg, typ: 'JWT' }))}.${b64url(JSON.stringify({ id: id.replace('INV-', ''), exp }))}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `${head}.${b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(head))))}`;
}
const notify = async (invoiceId: string, given: string | null | 'signed' = 'signed', extra: Record<string, unknown> = {}) => {
  const tok = given === 'signed' ? await token(invoiceId) : given;
  const res = await app.request('https://clx.cx/hook/trybit', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.2.3.4' }, body: JSON.stringify({ invoice_id: invoiceId.replace('INV-', ''), status: 'paid', amount: 1000, token: tok ?? undefined, ...extra }) }, env);
  return { status: res.status, body: (await res.json()) as Record<string, any> };
};
const balance = async (user = 1) => (await env.DB.prepare('SELECT coalesce(sum(amount), 0) AS b FROM ledger WHERE user_id = ?').bind(user).first<{ b: number }>())!.b;
const status = async (id: string) => (await env.DB.prepare('SELECT status FROM invoices WHERE id = ?').bind(id).first<{ status: string }>())!.status;
const top = async (usd = 10, key = `t${Math.random()}`) => (await call('POST', '/v1/billing/invoices', await session(1), { usd, coin: 'USDT_TRC20' }, key)).body.invoice;

describe('making an invoice', () => {
  it('whole dollars 9 to 1,000, a known coin, a confirmed address, three pending at most', async () => {
    const bad = (body: unknown) => call('POST', '/v1/billing/invoices', session1, body);
    const session1 = await session(1);
    expect((await bad({ usd: 8, coin: 'USDT_TRC20' })).body.error.details.field).toBe('usd');
    expect((await bad({ usd: 9.5, coin: 'USDT_TRC20' })).body.error.code).toBe('invalid_request');
    expect((await bad({ usd: 9, coin: 'BTC' })).body.error.details.field).toBe('coin');
    expect((await call('POST', '/v1/billing/invoices', await session(2), { usd: 9, coin: 'USDT_TRC20' })).body.error.code).toBe('email_unconfirmed');
    const inv = await top(20);
    expect(inv).toMatchObject({ rail: 'crypto', usd_micro_usd: 20_000_000, coin: 'USDT_TRC20', status: 'pending', address: 'TXaddr', amount: '21.55', pay_url: expect.stringContaining('pay.test') });
    await top();
    await top();
    expect((await call('POST', '/v1/billing/invoices', session1, { usd: 9, coin: 'USDT_TRC20' })).body.error.code).toBe('invoice_limit');
    expect((await call('GET', `/v1/billing/invoices/${inv.id}`, session1)).body.invoice.id).toBe(inv.id);
    expect((await call('GET', `/v1/billing/invoices/${inv.id}`, await session(2))).status).toBe(404);
  });

  it('without the processor set up, none is made', async () => {
    const saved = env.PAYMENTS_API_KEY;
    env.PAYMENTS_API_KEY = undefined;
    expect((await call('POST', '/v1/billing/invoices', await session(1), { usd: 9, coin: 'USDT_TRC20' })).body.error.code).toBe('payments_unavailable');
    env.PAYMENTS_API_KEY = saved;
  });
});

describe('the webhook', () => {
  it('is refused without a valid token and never believed: what Trybit says arrived is credited, once', async () => {
    const inv = await top(10);
    const theirs = [...trybit.invoices.keys()][0]!;
    expect((await notify(theirs, null)).status).toBe(401);
    expect((await notify(theirs, await token(theirs, 'wrong'))).status).toBe(401);
    expect((await notify(theirs, await token(theirs, 'whsec', 'none'))).status).toBe(401);
    expect((await notify(theirs, await token(theirs, 'whsec', 'HS256', 1))).status).toBe(401);
    // Signed, but Trybit says nothing arrived: nothing credited, whatever the body claimed.
    expect((await notify(theirs)).body.note).toBe('not_paid');
    expect(await balance()).toBe(0);
    Object.assign(trybit.invoices.get(theirs)!, { status: 'paid', received_usd: 9.85, amount_paid_usd: 11.55 });
    expect((await notify(theirs)).body.note).toBe('credited');
    expect((await notify(theirs)).body.note).toBe('already');
    expect(await balance()).toBe(9_850_000);
    expect(await status(inv.id)).toBe('paid');
    const row = await env.DB.prepare("SELECT note FROM ledger WHERE type = 'deposit'").first<{ note: string }>();
    expect(row!.note).toContain('$9.85 credited');
    expect(row!.note).toContain('fees $1.70');
  });

  it('takes a notification the size Trybit sends: its whole invoice inside, well past 2 KB', async () => {
    // A test notification of 24.10 was 1.6 KB with no address, token or transactions.
    await top(10);
    const theirs = [...trybit.invoices.keys()][0]!;
    Object.assign(trybit.invoices.get(theirs)!, { status: 'paid', received_usd: 10, amount_paid_usd: 11.4 });
    const tx = { hash: 'f'.repeat(64), amount: 11.4, network: 'TRC20', confirmations: 20, status: 'confirmed' };
    const invoice_info = { uuid: theirs, address: 'T'.repeat(34), tx_list: Array.from({ length: 8 }, () => tx), aml_checks: [], note: 'x'.repeat(1500) };
    expect((await notify(theirs, 'signed', { invoice_info })).body.note).toBe('credited');
  });

  it('a deposit pays the days Pro owes at once', async () => {
    await env.DB.prepare("INSERT INTO ledger (user_id, type, amount, created_at) VALUES (1, 'bonus', 9000000, 0)").run();
    await proOn(env, 1);
    await env.DB.prepare("INSERT INTO ledger (user_id, type, amount, created_at) VALUES (1, 'adjustment', -8700000, 0)").run();
    // Two days ago the period started: the days since are unpaid, grace on.
    await env.DB.prepare('UPDATE pro_periods SET start_day = start_day - 2').run();
    await env.DB.prepare('UPDATE users SET grace_since = 1 WHERE id = 1').run();
    await top(10);
    const theirs = [...trybit.invoices.keys()][0]!;
    Object.assign(trybit.invoices.get(theirs)!, { status: 'paid', received_usd: 10, amount_paid_usd: 10 });
    await notify(theirs);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM ledger WHERE type = 'charge'").first('n')).toBe(3);
    expect(await env.DB.prepare('SELECT grace_since FROM users WHERE id = 1').first('grace_since')).toBeNull();
  });

  it('a partial payment goes to review and an operator; a wrong nominal too', async () => {
    const a = await top(10);
    const b = await top(20);
    const [ta, tb] = [...trybit.invoices.keys()];
    Object.assign(trybit.invoices.get(ta!)!, { status: 'partial', received_usd: 6, amount_paid_usd: 6 });
    Object.assign(trybit.invoices.get(tb!)!, { status: 'paid', received_usd: 20, amount_paid_usd: 20, amount_usd: 2 });
    expect((await notify(ta!)).body.note).toBe('partial');
    expect((await notify(tb!)).body.note).toBe('review');
    expect([await status(a.id), await status(b.id)]).toEqual(['review', 'review']);
    expect(await balance()).toBe(0);
    const by = { tg: 7, name: '@op' };
    expect(await operatorCredit(env, a.id, '6', by)).toContain('$6.00 credited');
    expect(await operatorCredit(env, a.id, '6', by)).toContain('is paid');
    expect(await balance()).toBe(6_000_000);
    expect(await env.DB.prepare("SELECT by_tg, by_name FROM ledger WHERE type = 'deposit'").first()).toEqual({ by_tg: 7, by_name: '@op' });
    expect(await operatorVoid(env, b.id)).toContain('void');
    expect(await status(b.id)).toBe('void');
    // The payer adds the rest of a partial one: Trybit reports it paid, and it is credited from review.
    const c = await top(10);
    const tc = [...trybit.invoices.keys()][2]!;
    Object.assign(trybit.invoices.get(tc)!, { status: 'partial', received_usd: 5, amount_paid_usd: 5 });
    await notify(tc);
    Object.assign(trybit.invoices.get(tc)!, { status: 'paid', received_usd: 10, amount_paid_usd: 10 });
    expect((await notify(tc)).body.note).toBe('credited');
    expect(await status(c.id)).toBe('paid');
  });
});

describe('what a review of stage 3 found', () => {
  it("a valid token replayed with another invoice's id is refused before anything is looked up", async () => {
    await top(10);
    await top(10);
    const [ta, tb] = [...trybit.invoices.keys()];
    Object.assign(trybit.invoices.get(tb!)!, { status: 'paid', received_usd: 10, amount_paid_usd: 10 });
    const calls = trybit.calls;
    expect((await notify(tb!, await token(ta!))).status).toBe(401);
    expect(trybit.calls).toBe(calls);
    expect(await balance()).toBe(0);
  });

  it('a partial payment with a nominal not ours goes to review, not round and round', async () => {
    const a = await top(10);
    const ta = [...trybit.invoices.keys()][0]!;
    Object.assign(trybit.invoices.get(ta)!, { status: 'partial', received_usd: 4, amount_paid_usd: 4, amount_usd: 3 });
    expect((await notify(ta)).body.note).toBe('review');
    expect(await status(a.id)).toBe('review');
  });

  it('a retry with the same Idempotency-Key after a death resumes the same invoice', async () => {
    // As if the call died after its insert: the row without Trybit's id, the idempotency record gone.
    const first = await top(10, 'same-key');
    await env.DB.prepare('UPDATE invoices SET processor_id = NULL WHERE id = ?').bind(first.id).run();
    await env.DB.prepare('DELETE FROM idempotency').run();
    const again = await top(10, 'same-key');
    expect(again.id).toBe(first.id);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM invoices').first('n')).toBe(1);
  });

  it('the webhook, the reconcile run and an operator at once credit one deposit', async () => {
    const a = await top(10);
    const ta = [...trybit.invoices.keys()][0]!;
    Object.assign(trybit.invoices.get(ta)!, { status: 'paid', received_usd: 10, amount_paid_usd: 10 });
    await env.DB.prepare('UPDATE invoices SET created_at = created_at - 3600000').run();
    await Promise.all([notify(ta), notify(ta), reconcile(env), operatorCredit(env, a.id, '10', { tg: 1, name: 'op' })]);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM ledger WHERE type = 'deposit'").first('n')).toBe(1);
    expect(await balance()).toBe(10_000_000);
  });

  it('an operator crediting a review invoice while Trybit reports it paid: one deposit', async () => {
    const a = await top(10);
    const ta = [...trybit.invoices.keys()][0]!;
    await env.DB.prepare("UPDATE invoices SET status = 'review' WHERE id = ?").bind(a.id).run();
    Object.assign(trybit.invoices.get(ta)!, { status: 'paid', received_usd: 10, amount_paid_usd: 10 });
    await Promise.all([operatorCredit(env, a.id, '9.5', { tg: 1, name: 'op' }), notify(ta), operatorCredit(env, a.id, '9.5', { tg: 1, name: 'op' })]);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM ledger WHERE type = 'deposit'").first('n')).toBe(1);
    // A void one is not handed back for the same key: the retry tries Trybit again.
    trybit.failCreate = true;
    const failed = await call('POST', '/v1/billing/invoices', await session(1), { usd: 9, coin: 'USDT_TRC20' }, 'k-void');
    expect(failed.body.error.code).toBe('payments_unavailable');
    await env.DB.prepare('DELETE FROM idempotency').run();
    const again = await call('POST', '/v1/billing/invoices', await session(1), { usd: 9, coin: 'USDT_TRC20' }, 'k-void');
    expect(again.status).toBe(201);
    expect(again.body.invoice.status).toBe('pending');
  });

  it('a user being deleted is credited nothing; amounts are read exactly, a zero refused', async () => {
    await top(10);
    const ta = [...trybit.invoices.keys()][0]!;
    Object.assign(trybit.invoices.get(ta)!, { status: 'paid', received_usd: '9.9999999', amount_paid_usd: 10 });
    await env.DB.prepare('UPDATE users SET deleting_at = ? WHERE id = 1').bind(Date.now()).run();
    expect((await notify(ta)).body.note).toBe('already');
    expect(await balance()).toBe(0);
    await env.DB.prepare('UPDATE users SET deleting_at = NULL WHERE id = 1').run();
    expect((await notify(ta)).body.note).toBe('credited');
    // 9.9999999 is 9.999999 rounded down, never 10.
    expect(await balance()).toBe(9_999_999);
    expect(toMicro('9.9999999')).toBe(9_999_999);
    expect(toMicro(9.85)).toBe(9_850_000);
    expect(toMicro('1e-7')).toBeNull();
    const b = await top(10);
    await env.DB.prepare("UPDATE invoices SET status = 'review' WHERE id = ?").bind(b.id).run();
    expect(await operatorCredit(env, b.id, '0.0000001', { tg: 1, name: 'op' })).toContain('Use:');
    expect(await operatorCredit(env, b.id, '0', { tg: 1, name: 'op' })).toContain('Use:');
  });
});

describe('the reconcile run', () => {
  it('settles what the webhook never told, waits out a 429, and lets an unpaid one expire', async () => {
    const a = await top(10);
    const b = await top(10);
    const [ta] = [...trybit.invoices.keys()];
    Object.assign(trybit.invoices.get(ta!)!, { status: 'paid', received_usd: 10, amount_paid_usd: 10 });
    const now = Date.now();
    // Too fresh: left to the webhook.
    expect(await reconcile(env, now)).toEqual({});
    trybit.next429 = 1;
    expect(await reconcile(env, now + 21 * 60_000)).toEqual({ api_failed: 1 });
    const calls = trybit.calls;
    expect(await reconcile(env, now + 22 * 60_000)).toEqual({});
    expect(trybit.calls).toBe(calls);
    expect(await reconcile(env, now + 25 * 60_000)).toEqual({ credited: 1, not_paid: 1 });
    expect(await status(a.id)).toBe('paid');
    expect(await status(b.id)).toBe('pending');
    await reconcile(env, now + 26 * 3_600_000);
    expect(await status(b.id)).toBe('expired');
    // Crypto that comes late to an expired invoice is still credited.
    Object.assign(trybit.invoices.get([...trybit.invoices.keys()][1]!)!, { status: 'paid', received_usd: 10, amount_paid_usd: 10 });
    await reconcile(env, now + 27 * 3_600_000);
    expect(await status(b.id)).toBe('paid');
    expect(await balance()).toBe(20_000_000);
  });
});

describe('deleting the account', () => {
  it('waits for an open top-up', async () => {
    const { hashPassword } = await import('../src/auth/password');
    await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = 1').bind(await hashPassword('correct horse battery')).run();
    await top(10);
    const r = await call('DELETE', '/v1/me', await session(1), { password: 'correct horse battery' }, 'del');
    expect(r.body.error.code).toBe('balance_not_empty');
    expect(r.body.error.message).toContain('still open');
  });
});

// Partners and promo codes (docs/spec.md §19, ADR 0036): the code from `?ref=`, sign-up and the bot,
// 30% of each deposit held 30 days, clawbacks on refunds, the wallet, payouts, promo bonuses, and what
// a partner's account holds up its delete with.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { signAccess } from '../src/auth/jwt';
import { hashPassword } from '../src/auth/password';
import { credit, invoiceById } from '../src/billing/invoices';
import { balanceOf } from '../src/billing/pro';
import { operatorRefund } from '../src/billing/refunds';
import { app } from '../src/index';
import { sha256 } from '../src/lib/crypto';
import { HOLD_DAYS, sweepAccruals } from '../src/partners/accrue';
import { operatorPaid, operatorPayouts, operatorPromo, operatorReject, tellPayouts } from '../src/partners/wallet';
import type { Env } from '../src/types';
import { fakeCtx, testEnv } from './env';
import { fakeTg, useFakeCloudflare } from './fake-cf';

const GROUP = -100779;
const by = { tg: 9201, name: '@op' };
const DAY = 86_400_000;
const TRON = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
let env: Env;
let dispose: () => Promise<void>;
const mail: { to: string; text: string }[] = [];
beforeAll(async () => {
  ({ env, dispose } = await testEnv());
  env = {
    ...env,
    TURNSTILE_SECRET: 'turnstile-test',
    TELEGRAM_BOT_TOKEN: '123:bot',
    TELEGRAM_WEBHOOK_SECRET: 'hook-secret',
    TELEGRAM_CODE_KEY: 'code-key',
    TELEGRAM_SUPPORT_CHAT: String(GROUP),
    EMAIL: { send: async (m) => (mail.push(m), { messageId: `m${mail.length}` }) },
  };
});
afterAll(() => dispose());
useFakeCloudflare();

let ip = 0;
beforeEach(async () => {
  for (const t of ['partner_ledger', 'partner_payouts', 'promo_redemptions', 'refunds', 'ledger', 'pro_periods', 'invoices', 'api_keys', 'tg_identities', 'tg_states', 'tg_updates', 'email_tokens', 'email_sends', 'idempotency', 'users', 'promo_codes']) await env.DB.prepare(`DELETE FROM ${t}`).run();
  // 1 is the partner (code "partner1"), 2 their referral, 3 nobody's.
  await env.DB.prepare(
    "INSERT INTO users (id, email, password_hash, created_at, email_confirmed_at, plan, ref_code, referred_by) VALUES (1, 'p@example.com', 'x', 0, 0, 'free', 'partner1', NULL), (2, 'r@example.com', 'x', 0, 0, 'free', 'refer002', 1), (3, 'n@example.com', 'x', 0, 0, 'free', 'nobody03', NULL)",
  ).run();
  mail.length = 0;
  fakeTg.reset();
  vi.restoreAllMocks();
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url !== 'https://challenges.cloudflare.com/turnstile/v0/siteverify') return realFetch(input, init);
    return Response.json({ success: (init!.body as FormData).get('response') === 'human' });
  });
});

/** A paid top-up of `micro` for `user`, credited by the one way money comes in. */
async function deposit(user: number, micro: number, at?: number): Promise<string> {
  const id = `inv${Math.random().toString(36).slice(2, 10)}`;
  const now = Date.now();
  await env.DB.prepare("INSERT INTO invoices (id, user_id, rail, usd, coin, status, created_at, expires_at) VALUES (?, ?, 'crypto', ?, 'USDT_TRC20', 'pending', ?, ?)").bind(id, user, micro, now, now + 3_600_000).run();
  expect(await credit(env, (await invoiceById(env.DB, id))!, micro, 'test', ['pending'])).toBe(true);
  if (at !== undefined) await env.DB.prepare("UPDATE ledger SET created_at = ? WHERE invoice_id = ? AND type = 'deposit'").bind(at, id).run();
  return id;
}
const wallet = (user: number) => env.DB.prepare('SELECT type, amount, invoice_id, rate_bp, matures_at FROM partner_ledger WHERE user_id = ? ORDER BY id').bind(user).all<Record<string, any>>().then((r) => r.results);
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
async function signup(email: string, extra: Record<string, unknown> = {}, cookie?: string) {
  const { ctx, settle } = fakeCtx();
  const res = await app.request('https://clx.cx/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.9.0.${++ip}`, ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ email, password: 'a-long-password', turnstile: 'human', ...extra }) }, env, ctx);
  await settle();
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}
const userBy = (email: string) => env.DB.prepare('SELECT id, ref_code, referred_by, promo_id FROM users WHERE email = ?').bind(email).first<Record<string, any>>();

describe('attribution', () => {
  it('?ref= on a page: 302 without it, the cookie for a valid code on a navigation only', async () => {
    const visit = (q: string, headers: Record<string, string> = {}) => app.request(`https://clx.cx/${q}`, { headers: { 'cf-connecting-ip': '10.1.1.1', ...headers } }, env, fakeCtx().ctx);
    const ok = await visit('?ref=PARTNER1&utm=x', { 'sec-fetch-dest': 'document' });
    expect(ok.status).toBe(302);
    expect(ok.headers.get('location')).toBe('/?utm=x');
    expect(ok.headers.get('set-cookie')).toMatch(/^clx_ref=partner1; Max-Age=2592000; Path=\/; SameSite=Lax; Secure$/u);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    const bad = await visit('?ref=nosuch');
    expect(bad.status).toBe(302);
    expect(bad.headers.get('set-cookie')).toBeNull();
    expect((await visit('?ref=partner1', { 'sec-fetch-dest': 'image' })).headers.get('set-cookie')).toBeNull();
    // The API is not a page: ?ref= means nothing there.
    expect((await app.request('https://clx.cx/v1/me?ref=partner1', {}, env)).status).toBe(401);
  });

  it('sign-up: a typed code wins over the cookie, a typed non-code is refused, the referrer written once', async () => {
    expect((await signup('typo@example.com', { code: 'nosuch' })).body.error).toBe('invalid_code');
    await signup('cookie@example.com', {}, 'clx_ref=partner1');
    expect(await userBy('cookie@example.com')).toMatchObject({ referred_by: 1 });
    await signup('typed@example.com', { code: 'NOBODY03' }, 'clx_ref=partner1');
    expect(await userBy('typed@example.com')).toMatchObject({ referred_by: 3 });
    expect((await userBy('typed@example.com'))!.ref_code).toMatch(/^[a-z0-9]{8}$/u);
    // A known address: nothing changes, the answer is the same.
    expect((await signup('typed@example.com', { code: 'partner1' })).status).toBe(202);
    expect(await userBy('typed@example.com')).toMatchObject({ referred_by: 3 });
    await signup('stale@example.com', {}, 'clx_ref=gone');
    expect(await userBy('stale@example.com')).toMatchObject({ referred_by: null });
  });

  it('the bot: start=ref_CODE is kept until the account is made', async () => {
    let update = 9000;
    const say = async (text: string) => {
      const { ctx, settle } = fakeCtx();
      await app.request('https://clx.cx/hook/telegram', { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'hook-secret' }, body: JSON.stringify({ update_id: ++update, message: { message_id: update, from: { id: 777, language_code: 'en' }, chat: { id: 777, type: 'private' }, text } }) }, env, ctx);
      await settle();
    };
    await say('/start ref_partner1');
    await say('bot@example.com');
    await say(mail.at(-1)!.text.match(/\b(\d{6})\b/u)![1]!);
    expect(await userBy('bot@example.com')).toMatchObject({ referred_by: 1 });
    // /partner: the code and the wallet, read only.
    await say('/partner');
    const code = (await userBy('bot@example.com'))!.ref_code as string;
    expect(fakeTg.said(777)).toContain(`<code>${code}</code>`);
    expect(fakeTg.said(777)).toContain(`start=ref_${code}`);
    expect(await env.DB.prepare("SELECT source FROM users WHERE email = 'bot@example.com'").first('source')).toBeNull();
  });
});

describe('commission', () => {
  it('30% of each deposit, held 30 days from it, written once by whatever credits it', async () => {
    const inv = await deposit(2, 10_000_000);
    await deposit(3, 10_000_000);
    const rows = await wallet(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'commission', amount: 3_000_000, invoice_id: inv, rate_bp: 3000 });
    const dep = (await env.DB.prepare("SELECT created_at FROM ledger WHERE invoice_id = ? AND type = 'deposit'").bind(inv).first<number>('created_at'))!;
    expect(rows[0]!.matures_at).toBe(dep + HOLD_DAYS * DAY);
    expect(await credit(env, (await invoiceById(env.DB, inv))!, 10_000_000, 'again', ['pending'])).toBe(false);
    expect(await sweepAccruals(env.DB)).toBe(0);
    expect(await wallet(1)).toHaveLength(1);
    const view = (await call('GET', '/v1/partner', await session(1))).body;
    expect(view).toMatchObject({ code: 'partner1', referrals: 1, wallet: { total_micro_usd: 3_000_000, available_micro_usd: 0, held_micro_usd: 3_000_000 } });
    expect(view.links.site).toMatch(/\?ref=partner1$/u);
  });

  it('none while the partner is being deleted; the cron writes it once the delete failed', async () => {
    await env.DB.prepare('UPDATE users SET deleting_at = 1 WHERE id = 1').run();
    await deposit(2, 9_000_000);
    expect(await wallet(1)).toHaveLength(0);
    expect(await sweepAccruals(env.DB)).toBe(0);
    await env.DB.prepare('UPDATE users SET deleting_at = NULL WHERE id = 1').run();
    expect(await sweepAccruals(env.DB)).toBe(1);
    expect((await wallet(1))[0]).toMatchObject({ type: 'commission', amount: 2_700_000 });
  });

  it('a refund claws back the rate times all refunded, after the hold too, before the commission even', async () => {
    const inv = await deposit(2, 10_000_000);
    // The commission lost (it is written again by the cron): the clawback is written all the same.
    await env.DB.prepare("DELETE FROM partner_ledger WHERE type = 'commission'").run();
    const ask = async () => (await call('POST', '/v1/billing/refunds', await session(2), { invoice_id: inv, address: TRON })).body.refund.id as string;
    await operatorRefund(env, await ask(), '3.33', by);
    await env.DB.prepare("UPDATE refunds SET status = 'done'").run();
    await sweepAccruals(env.DB);
    await operatorRefund(env, await ask(), '3.33', by);
    const rows = await wallet(1);
    expect(rows.map((r) => [r.type, r.amount])).toEqual([
      ['clawback', -999_000],
      ['commission', 3_000_000],
      ['clawback', -999_000],
    ]);
    // Commission and clawbacks: the rate times what the deposit kept.
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(Math.floor(((10_000_000 - 6_660_000) * 3000) / 10_000));
  });
});

describe('the wallet', () => {
  async function matured(micro: number) {
    await deposit(2, (micro * 10) / 3);
    await env.DB.prepare("UPDATE partner_ledger SET matures_at = 0 WHERE type = 'commission'").run();
  }

  it('moves what is available to the balance, at once in both journals; a key cannot', async () => {
    await matured(30_000_000);
    await env.DB.prepare("INSERT INTO api_keys (id, user_id, prefix, key_hash, scopes, created_at) VALUES ('pk1', 1, 'clx_pk1', ?, 'billing', 0)").bind(await sha256('clx_pk1')).run();
    expect((await call('GET', '/v1/partner', 'Bearer clx_pk1')).status).toBe(200);
    expect((await call('POST', '/v1/partner/transfer', 'Bearer clx_pk1', { usd: 1 }, 'k1')).body.error.code).toBe('session_required');
    expect((await call('POST', '/v1/partner/transfer', await session(1), { usd: 1 })).body.error.code).toBe('invalid_request');
    expect((await call('POST', '/v1/partner/transfer', await session(1), { usd: 1.005 }, 't0')).body.error.details.field).toBe('usd');
    expect((await call('POST', '/v1/partner/transfer', await session(1), { usd: 31 }, 't1')).body.error.code).toBe('insufficient_balance');
    const moved = await call('POST', '/v1/partner/transfer', await session(1), { usd: 12.5 }, 't2');
    expect(moved.body.wallet.available_micro_usd).toBe(17_500_000);
    expect(await balanceOf(env.DB, 1)).toBe(12_500_000);
    // The same key again: the same answer, nothing moved twice.
    await call('POST', '/v1/partner/transfer', await session(1), { usd: 12.5 }, 't2');
    expect(await balanceOf(env.DB, 1)).toBe(12_500_000);
  });

  it('a payout reserves its money at once; a transfer racing it never takes the wallet below zero', async () => {
    await matured(30_000_000);
    expect((await call('POST', '/v1/partner/payouts', await session(1), { usd: 19, address: TRON }, 'p0')).body.error.details.field).toBe('usd');
    expect((await call('POST', '/v1/partner/payouts', await session(1), { usd: 20, address: '0x52908400098527886E0F7030069857D2E4169EE7' }, 'p1')).body.error.details.field).toBe('address');
    const [a, b] = await Promise.all([call('POST', '/v1/partner/payouts', await session(1), { usd: 25, address: TRON }, 'p2'), call('POST', '/v1/partner/transfer', await session(1), { usd: 25 }, 't3')]);
    // One of them wins; the other finds the money gone.
    expect([a.status === 201, b.status === 200].filter(Boolean)).toHaveLength(1);
    expect([a.status, b.status]).toContain(409);
    const total = (await wallet(1)).reduce((s, r) => s + r.amount, 0);
    expect(total).toBe(5_000_000);
    if (a.status === 201) {
      expect(fakeTg.sent.at(-1)!.text).toContain(`/paid ${a.body.payout_id}`);
      expect(await operatorPayouts(env)).toContain(`#${a.body.payout_id}`);
      expect(await operatorReject(env, String(a.body.payout_id), by)).toContain('back in the wallet');
      expect(await operatorReject(env, String(a.body.payout_id), by)).toContain('nothing changed');
      expect((await wallet(1)).reduce((s, r) => s + r.amount, 0)).toBe(30_000_000);
      expect(await operatorPaid(env, String(a.body.payout_id), 'a'.repeat(64), by)).toContain('not waiting');
    }
    const paid = await call('POST', '/v1/partner/payouts', await session(1), { usd: 20, address: TRON }, 'p3');
    if (paid.status === 201) expect(await operatorPaid(env, String(paid.body.payout_id), 'b'.repeat(64), by)).toContain('paid');
  });

  it('a retry after a Worker that died before its answer was stored moves no money twice', async () => {
    await matured(30_000_000);
    await call('POST', '/v1/partner/transfer', await session(1), { usd: 5 }, 'lost1');
    const first = (await call('POST', '/v1/partner/payouts', await session(1), { usd: 20, address: TRON }, 'lost2')).body.payout_id;
    // The stored answers gone, as if the Worker died after the batch.
    await env.DB.prepare('DELETE FROM idempotency').run();
    expect((await call('POST', '/v1/partner/transfer', await session(1), { usd: 5 }, 'lost1')).status).toBe(200);
    expect((await call('POST', '/v1/partner/payouts', await session(1), { usd: 20, address: TRON }, 'lost2')).body.payout_id).toBe(first);
    expect(await balanceOf(env.DB, 1)).toBe(5_000_000);
    expect((await wallet(1)).reduce((s, r) => s + r.amount, 0)).toBe(5_000_000);
    // The key for another request, or past its 24 hours: a conflict, never a silent no-op.
    await env.DB.prepare('DELETE FROM idempotency').run();
    expect((await call('POST', '/v1/partner/transfer', await session(1), { usd: 4 }, 'lost1')).body.error.code).toBe('idempotency_conflict');
    expect((await call('POST', '/v1/partner/payouts', await session(1), { usd: 20, address: 'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7' }, 'lost2')).body.error.code).toBe('idempotency_conflict');
    await env.DB.prepare("UPDATE partner_ledger SET created_at = 0 WHERE op_key LIKE 'transfer:%'").run();
    await env.DB.prepare('DELETE FROM idempotency').run();
    expect((await call('POST', '/v1/partner/transfer', await session(1), { usd: 5 }, 'lost1')).body.error.code).toBe('idempotency_conflict');
    expect(await operatorPaid(env, String(first), 'not-a-tron-tx'.padEnd(64, 'z'), by)).toContain('Use:');
    expect(await operatorPaid(env, String(first), 'b'.repeat(64), by)).toContain('paid');
    expect(await operatorReject(env, String(first), by)).toContain('nothing changed');
  });

  it('a payout the support group did not hear of is told again by the cron', async () => {
    await matured(30_000_000);
    fakeTg.blocked.add(GROUP);
    const id = (await call('POST', '/v1/partner/payouts', await session(1), { usd: 20, address: TRON }, 'pt')).body.payout_id;
    expect(await tellPayouts(env)).toBe(0);
    fakeTg.blocked.delete(GROUP);
    expect(await tellPayouts(env)).toBe(1);
    expect(fakeTg.sent.at(-1)!.text).toContain(`/paid ${id}`);
    expect(await tellPayouts(env)).toBe(0);
  });

  it('a clawback below zero stops everything leaving', async () => {
    const inv = await deposit(2, 30_000_000);
    await env.DB.prepare("UPDATE partner_ledger SET matures_at = 0 WHERE type = 'commission'").run();
    await call('POST', '/v1/partner/transfer', await session(1), { usd: 9 }, 't4');
    const id = (await call('POST', '/v1/billing/refunds', await session(2), { invoice_id: inv, address: TRON })).body.refund.id as string;
    await operatorRefund(env, id, '30', by);
    expect((await call('GET', '/v1/partner', await session(1))).body.wallet.available_micro_usd).toBe(-9_000_000);
    expect((await call('POST', '/v1/partner/transfer', await session(1), { usd: 0.01 }, 't5')).body.error.code).toBe('insufficient_balance');
  });
});

describe('promo codes', () => {
  it('made by an operator in one name space with partner codes', async () => {
    expect(await operatorPromo(env, ['partner1', 'first_deposit', '3'], by)).toContain("partner's code");
    expect(await operatorPromo(env, ['spring', 'any_deposit', '3'], by)).toContain('needs an end date');
    expect(await operatorPromo(env, ['Welcome', 'first_deposit', '3', '2'], by)).toContain('Promo welcome: first_deposit, $3.00, 2 uses');
    expect(await operatorPromo(env, ['welcome', 'signup_credit', '1'], by)).toContain('exists already');
  });

  it('a first-deposit bonus on the first deposit of $9 or more, once; max uses counted when granted', async () => {
    await operatorPromo(env, ['welcome', 'first_deposit', '3', '1'], by);
    await signup('a@example.com', { code: 'welcome' });
    await signup('b@example.com', { code: 'welcome' });
    const a = (await userBy('a@example.com'))!.id as number;
    const b = (await userBy('b@example.com'))!.id as number;
    await env.DB.prepare('UPDATE users SET email_confirmed_at = 0 WHERE id IN (?, ?)').bind(a, b).run();
    await deposit(a, 9_000_000);
    await deposit(a, 9_000_000);
    expect(await balanceOf(env.DB, a)).toBe(21_000_000);
    // The one use went to a: b's code was bound but is spent now.
    await deposit(b, 9_000_000);
    expect(await balanceOf(env.DB, b)).toBe(9_000_000);
    expect((await signup('c@example.com', { code: 'welcome' })).body.error).toBe('invalid_code');
  });

  it('an any-deposit bonus up to its end; a start credit spent or ended does not hold the cron up', async () => {
    await operatorPromo(env, ['spring', 'any_deposit', '2', '2030-01-01'], by);
    await env.DB.prepare("UPDATE users SET promo_id = (SELECT id FROM promo_codes WHERE code = 'spring') WHERE id = 3").run();
    await deposit(3, 9_000_000);
    expect(await balanceOf(env.DB, 3)).toBe(11_000_000);
    // Ended: another user's deposit earns nothing.
    await env.DB.prepare("UPDATE promo_codes SET until = ? WHERE code = 'spring'").bind(Date.now() - 1).run();
    await env.DB.prepare("UPDATE users SET promo_id = (SELECT id FROM promo_codes WHERE code = 'spring') WHERE id = 2").run();
    await deposit(2, 9_000_000);
    expect(await balanceOf(env.DB, 2)).toBe(9_000_000);
    // 60 confirmed users on a spent start credit, then one on an open one: the sweep reaches it.
    await operatorPromo(env, ['spent', 'signup_credit', '1', '1'], by);
    await operatorPromo(env, ['open', 'signup_credit', '1'], by);
    await env.DB.prepare("INSERT INTO promo_redemptions (promo_id, user_id, amount, created_at) SELECT id, 1, 1, 0 FROM promo_codes WHERE code = 'spent'").run();
    for (let i = 0; i < 60; i++) await env.DB.prepare("INSERT INTO users (email, password_hash, created_at, email_confirmed_at, promo_id) SELECT ?, 'x', 0, 1, id FROM promo_codes WHERE code = 'spent'").bind(`spent${i}@example.com`).run();
    await env.DB.prepare("INSERT INTO users (email, password_hash, created_at, email_confirmed_at, promo_id) SELECT 'late@example.com', 'x', 0, 2, id FROM promo_codes WHERE code = 'open'").run();
    expect(await sweepAccruals(env.DB)).toBe(1);
    expect(await balanceOf(env.DB, (await userBy('late@example.com'))!.id)).toBe(1_000_000);
  });

  it('a start credit when the e-mail is confirmed — never refunded with a deposit', async () => {
    await operatorPromo(env, ['hello', 'signup_credit', '5'], by);
    await signup('s@example.com', { code: 'hello' });
    const s = (await userBy('s@example.com'))!.id as number;
    // The test's session carries version 0.
    await env.DB.prepare('UPDATE users SET session_version = 0 WHERE id = ?').bind(s).run();
    expect(await balanceOf(env.DB, s)).toBe(0);
    const token = mail.find((m) => m.to === 's@example.com')!.text.match(/[?&]t=([A-Za-z0-9_-]{43})/u)![1];
    await app.request('https://clx.cx/auth/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) }, env);
    expect(await balanceOf(env.DB, s)).toBe(5_000_000);
    expect(await sweepAccruals(env.DB)).toBe(0);
    // $9 in, $6 spent on Pro: only $8 of the balance is the deposit's — the credit stays.
    const inv = await deposit(s, 9_000_000);
    await env.DB.prepare("INSERT INTO ledger (user_id, type, amount, day, created_at) VALUES (?, 'charge', -6000000, 1, 0)").bind(s).run();
    const id = (await call('POST', '/v1/billing/refunds', await session(s), { invoice_id: inv, address: TRON })).body.refund.id as string;
    expect(await operatorRefund(env, id, '9', by)).toContain('allows $3.00');
    expect(await operatorRefund(env, id, '3', by)).toContain('taken from the balance');
    expect(await balanceOf(env.DB, s)).toBe(5_000_000);
  });

  it('a refund takes the deposit bonus back in proportion, and the balance must hold both', async () => {
    await operatorPromo(env, ['plus3', 'first_deposit', '3'], by);
    await env.DB.prepare("UPDATE users SET promo_id = (SELECT id FROM promo_codes WHERE code = 'plus3') WHERE id = 3").run();
    const inv = await deposit(3, 9_000_000);
    expect(await balanceOf(env.DB, 3)).toBe(12_000_000);
    // Three days of Pro: $0.90 spent.
    await env.DB.prepare("INSERT INTO ledger (user_id, type, amount, day, created_at) VALUES (3, 'charge', -900000, 1, 0)").run();
    const id = (await call('POST', '/v1/billing/refunds', await session(3), { invoice_id: inv, address: TRON })).body.refund.id as string;
    expect(await operatorRefund(env, id, '9', by)).toContain('$3.00 of promo bonus goes back');
    expect(await operatorRefund(env, id, '4.5', by)).toContain('taken from the balance');
    // Half refunded: half the bonus back.
    expect(await balanceOf(env.DB, 3)).toBe(12_000_000 - 900_000 - 4_500_000 - 1_500_000);
    expect(await balanceOf(env.DB, 3)).toBeGreaterThanOrEqual(0);
  });
});

describe('deleting a partner', () => {
  async function del(user: number) {
    await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword('pw-pw-pw-pw'), user).run();
    return call('DELETE', '/v1/me', await session(user), { password: 'pw-pw-pw-pw' });
  }

  it('is refused while a referral topped up under 90 days ago or the wallet holds money; then the referrals are let go', async () => {
    await deposit(2, 9_000_000, Date.now() - 10 * DAY);
    expect((await del(1)).body.error.message).toContain('partner wallet');
    // 91 days on, the commission moved out: nothing holds it.
    await env.DB.prepare("UPDATE ledger SET created_at = ? WHERE type = 'deposit'").bind(Date.now() - 91 * DAY).run();
    await env.DB.prepare("UPDATE partner_ledger SET matures_at = 0 WHERE type = 'commission'").run();
    expect((await del(1)).body.error.message).toContain('partner wallet');
    await call('POST', '/v1/partner/transfer', await session(1), { usd: 2.7 }, 'td');
    await env.DB.prepare("INSERT INTO ledger (user_id, type, amount, created_at) VALUES (1, 'charge', -2700000, 0)").run();
    expect((await del(1)).status).toBe(200);
    expect(await env.DB.prepare('SELECT referred_by FROM users WHERE id = 2').first('referred_by')).toBeNull();
    const archived = JSON.parse((await env.DB.prepare('SELECT data FROM billing_archive ORDER BY id DESC LIMIT 1').first<string>('data'))!);
    expect(archived.partner_ledger.map((r: { type: string }) => r.type)).toEqual(['commission', 'transfer']);
  });
});

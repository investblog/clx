// Refunds and corrections (docs/spec.md §18, ADR 0035): the user asks from a page, an operator makes
// it in the support group, each refund tied to one deposit and written to the journal before any
// money leaves; Stars go back whole through Telegram (a fake, test/fake-cf.ts).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccess, signBot } from '../src/auth/jwt';
import { hashPassword } from '../src/auth/password';
import { balanceOf } from '../src/billing/pro';
import { operatorCredit } from '../src/billing/invoices';
import { isAddressFor, operatorAdjust, operatorDecline, operatorRefund, operatorRefunded, operatorRefundStars, tellRefunds } from '../src/billing/refunds';
import { app } from '../src/index';
import type { Env } from '../src/types';
import { fakeCtx, testEnv } from './env';
import { fakeTg, useFakeCloudflare } from './fake-cf';

const GROUP = -100778;
const ADMIN = 9101;
let env: Env;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ env, dispose } = await testEnv());
  env = { ...env, TELEGRAM_BOT_TOKEN: '123:bot', TELEGRAM_WEBHOOK_SECRET: 'hook-secret', TELEGRAM_CODE_KEY: 'code-key', TELEGRAM_SUPPORT_CHAT: String(GROUP) };
});
afterAll(() => dispose());
useFakeCloudflare();

const TRON = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const EVM = '0x52908400098527886E0F7030069857D2E4169EE7';
const by = { tg: ADMIN, name: '@op' };
const DAY = 86_400_000;

beforeEach(async () => {
  for (const t of ['ledger', 'pro_periods', 'invoices', 'refunds', 'star_payments', 'tg_identities', 'tg_updates', 'idempotency', 'users']) await env.DB.prepare(`DELETE FROM ${t}`).run();
  await env.DB.prepare("INSERT INTO users (id, email, password_hash, created_at, email_confirmed_at, plan) VALUES (1, 'a@example.com', 'x', 0, 0, 'free'), (2, 'b@example.com', 'x', 0, 0, 'free')").run();
  fakeTg.reset();
});

/** A paid top-up of `micro`, credited `ago` ms ago; a Stars one with its payment kept by charge id. */
async function paid(opts: { user?: number; micro?: number; rail?: 'crypto' | 'stars'; coin?: string; ago?: number } = {}): Promise<string> {
  const { user = 1, micro = 10_000_000, rail = 'crypto', coin = rail === 'stars' ? 'XTR' : 'USDT_TRC20', ago = DAY } = opts;
  const id = `inv${Math.random().toString(36).slice(2, 10)}`;
  const at = Date.now() - ago;
  const charge = rail === 'stars' ? `ch-${id}` : `INV-${id}`;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO invoices (id, user_id, rail, usd, coin, stars, status, processor_id, created_at, expires_at, paid_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'paid', ?7, ?8, ?8, ?8)").bind(id, user, rail, micro, coin, rail === 'stars' ? 750 : null, charge, at),
    env.DB.prepare("INSERT INTO ledger (user_id, type, amount, invoice_id, created_at) VALUES (?, 'deposit', ?, ?, ?)").bind(user, micro, id, at),
  ]);
  if (rail === 'stars') await env.DB.prepare("INSERT INTO star_payments (charge_id, tg_user_id, invoice_id, stars, currency, state, created_at) VALUES (?, 4242, ?, 750, 'XTR', 'credited', ?)").bind(charge, id, at).run();
  return id;
}

async function ask(body: unknown, user = 1, auth?: string) {
  const { ctx, settle } = fakeCtx();
  const res = await app.request('https://clx.cx/v1/billing/refunds', { method: 'POST', headers: { authorization: auth ?? `Bearer ${await signAccess('test-jwt-secret', user, Date.now())}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }, env, ctx);
  await settle();
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}
const refundOf = (id: string) => env.DB.prepare('SELECT * FROM refunds WHERE id = ?').bind(id).first<Record<string, any>>();
const refundRows = (invoice: string) => env.DB.prepare("SELECT amount, op_key, by_tg FROM ledger WHERE invoice_id = ? AND type = 'refund'").bind(invoice).all<Record<string, any>>().then((r) => r.results);
const toGroup = () => fakeTg.sent.filter((m) => m.chat_id === GROUP).map((m) => m.text);

describe('addresses', () => {
  it('Tron by its Base58Check, the others as 0x and 40 hex digits', async () => {
    expect(await isAddressFor('USDT_TRC20', TRON)).toBe(true);
    expect(await isAddressFor('USDT_TRC20', `${TRON.slice(0, -1)}u`)).toBe(false);
    expect(await isAddressFor('USDT_TRC20', EVM)).toBe(false);
    expect(await isAddressFor('USDT_ERC20', EVM)).toBe(true);
    expect(await isAddressFor('USDT_BSC', TRON)).toBe(false);
    expect(await isAddressFor('USDC_ERC20', `${EVM}0`)).toBe(false);
  });
});

describe('asking for a refund', () => {
  it('from a page only, for a credited top-up of ones own under 90 days old, with an address of its network', async () => {
    const inv = await paid();
    const bot = await signBot(env.JWT_SECRET, 1, { tg: 4242, linkedAt: 0 }, Date.now(), 0);
    expect((await ask({ invoice_id: inv, address: TRON }, 1, `Bearer ${bot}`)).body.error.code).toBe('session_required');
    expect((await ask({ invoice_id: inv, address: TRON }, 2)).status).toBe(404);
    expect((await ask({ invoice_id: inv })).body.error.details.field).toBe('address');
    expect((await ask({ invoice_id: inv, address: EVM })).body.error.details.field).toBe('address');
    expect((await ask({ invoice_id: await paid({ ago: 91 * DAY }), address: TRON })).body.error.code).toBe('refund_unavailable');
    const asked = await ask({ invoice_id: inv, address: ` ${TRON} ` });
    expect(asked.status).toBe(201);
    expect(asked.body.refund).toMatchObject({ invoice_id: inv, rail: 'crypto', address: TRON, status: 'requested', amount_micro_usd: null });
    expect(toGroup().at(-1)).toContain(`/refund ${asked.body.refund.id}`);
    expect(toGroup().at(-1)).toContain('refundable $10.00');
    // One open request per top-up; nothing moved yet.
    expect((await ask({ invoice_id: inv, address: TRON })).body.error.code).toBe('refund_open');
    expect(await balanceOf(env.DB, 1)).toBe(20_000_000);
    const view = await app.request('https://clx.cx/v1/billing', { headers: { authorization: `Bearer ${await signAccess('test-jwt-secret', 1, Date.now())}` } }, env);
    expect(((await view.json()) as any).refunds[0].id).toBe(asked.body.refund.id);
  });

  it('a request the support group did not hear of is told again by the cron', async () => {
    fakeTg.blocked.add(GROUP);
    const id = (await ask({ invoice_id: await paid(), address: TRON })).body.refund.id as string;
    expect(await refundOf(id)).toMatchObject({ status: 'requested', told_at: null });
    expect(await tellRefunds(env)).toBe(0);
    fakeTg.blocked.delete(GROUP);
    expect(await tellRefunds(env)).toBe(1);
    expect(toGroup().at(-1)).toContain(`/refund ${id}`);
    expect((await refundOf(id))!.told_at).not.toBeNull();
    expect(await tellRefunds(env)).toBe(0);
  });

  it('Stars take no address', async () => {
    const inv = await paid({ rail: 'stars', micro: 9_000_000 });
    expect((await ask({ invoice_id: inv, address: TRON })).body.error.details.field).toBe('address');
    expect((await ask({ invoice_id: inv })).body.refund).toMatchObject({ rail: 'stars', address: null });
  });
});

describe('a crypto refund', () => {
  it('takes at most what the deposit has left and what the balance holds, in one journal row, then waits for the txid', async () => {
    const inv = await paid({ micro: 10_000_000 });
    const id = (await ask({ invoice_id: inv, address: TRON })).body.refund.id as string;
    // Spent on Pro meanwhile: the balance holds less than the deposit.
    await env.DB.prepare("INSERT INTO ledger (user_id, type, amount, day, created_at) VALUES (1, 'charge', -3000000, 1, 0)").run();
    expect(await operatorRefund(env, id, '9', by)).toContain('the balance holds $7.00');
    expect(await operatorRefund(env, id, '11', by)).toContain('at most $10.00');
    expect(await operatorRefund(env, id, 'lots', by)).toContain('Use:');
    expect(await refundRows(inv)).toHaveLength(0);
    expect(await operatorRefund(env, id, '6.5', by)).toContain(`$6.50 taken from the balance`);
    expect(await refundRows(inv)).toEqual([{ amount: -6_500_000, op_key: `refund:${id}`, by_tg: ADMIN }]);
    expect(await balanceOf(env.DB, 1)).toBe(500_000);
    expect(await refundOf(id)).toMatchObject({ status: 'pending', amount: 6_500_000 });
    // Again: nothing more is written.
    expect(await operatorRefund(env, id, '0.5', by)).toContain('Do NOT send again');
    expect(await refundRows(inv)).toHaveLength(1);
    expect(await operatorRefunded(env, id, 'short')).toContain('Use:');
    expect(await operatorRefunded(env, id, 'a'.repeat(64))).toContain('done');
    expect(await refundOf(id)).toMatchObject({ status: 'done', txid: 'a'.repeat(64) });
    expect(await operatorRefunded(env, id, 'b'.repeat(64))).toContain('nothing changed');
    // A second request on the same deposit: only what is left of it.
    await env.DB.prepare("INSERT INTO ledger (user_id, type, amount, created_at) VALUES (1, 'bonus', 20000000, 0)").run();
    const second = (await ask({ invoice_id: inv, address: TRON })).body.refund.id as string;
    expect(await operatorRefund(env, second, '4', by)).toContain('at most $3.50');
    expect(await operatorRefund(env, second, '3.5', by)).toContain('taken from the balance');
    // Nothing is left of it now.
    expect((await ask({ invoice_id: inv, address: TRON })).body.error.code).toBe('refund_unavailable');
  });

  it('two /refund at once write one row', async () => {
    const inv = await paid();
    const id = (await ask({ invoice_id: inv, address: TRON })).body.refund.id as string;
    await Promise.all([operatorRefund(env, id, '5', by), operatorRefund(env, id, '5', by), operatorRefund(env, id, '4', by)]);
    expect(await refundRows(inv)).toHaveLength(1);
  });

  it('a declined request moves nothing and lets the account go', async () => {
    const inv = await paid();
    const id = (await ask({ invoice_id: inv, address: TRON })).body.refund.id as string;
    expect(await operatorDecline(env, id)).toContain('declined');
    expect(await operatorRefund(env, id, '5', by)).toContain('is declined');
    expect(await operatorDecline(env, id)).toContain('nothing changed');
    expect(await balanceOf(env.DB, 1)).toBe(10_000_000);
  });
});

describe('a Stars refund', () => {
  it('is whole only, written first, then Telegram; a failed call is retried by /refund; "already refunded" is done', async () => {
    const inv = await paid({ rail: 'stars', micro: 9_000_000 });
    const id = (await ask({ invoice_id: inv })).body.refund.id as string;
    expect(await operatorRefund(env, id, '5', by)).toContain('refunded whole');
    fakeTg.refundDown = true;
    expect(await operatorRefund(env, id, undefined, by)).toContain('Telegram refused');
    expect(await refundRows(inv)).toHaveLength(1);
    expect(await refundOf(id)).toMatchObject({ status: 'pending', amount: 9_000_000 });
    expect(await balanceOf(env.DB, 1)).toBe(0);
    fakeTg.refundDown = false;
    // Telegram did refund on a call whose answer was lost: its refusal as "already refunded" is done.
    fakeTg.refunded.push({ user_id: 4242, telegram_payment_charge_id: `ch-${inv}` });
    expect(await operatorRefund(env, id, undefined, by)).toContain('750★ refunded');
    expect(await refundRows(inv)).toHaveLength(1);
    expect(await refundOf(id)).toMatchObject({ status: 'done' });
    expect(await env.DB.prepare('SELECT state FROM star_payments WHERE charge_id = ?').bind(`ch-${inv}`).first('state')).toBe('refunded');
  });

  it('is refused while the balance holds less than the whole payment', async () => {
    const inv = await paid({ rail: 'stars', micro: 9_000_000 });
    await env.DB.prepare("INSERT INTO ledger (user_id, type, amount, day, created_at) VALUES (1, 'charge', -300000, 1, 0)").run();
    const id = (await ask({ invoice_id: inv })).body.refund.id as string;
    expect(await operatorRefund(env, id, undefined, by)).toContain('Stars are refunded whole, so not now');
    expect(fakeTg.refunded).toHaveLength(0);
  });

  it('a payment in review, never credited, goes back by its charge id; its invoice is void first', async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO invoices (id, user_id, rail, usd, coin, stars, status, processor_id, created_at, expires_at) VALUES ('held', 1, 'stars', 9000000, 'XTR', 750, 'review', 'ch-held', 0, 0)"),
      env.DB.prepare("INSERT INTO star_payments (charge_id, tg_user_id, invoice_id, stars, currency, state, created_at) VALUES ('ch-held', 4242, 'held', 750, 'XTR', 'review', 0), ('ch-ok', 4242, 'x', 750, 'XTR', 'credited', 0)"),
    ]);
    expect(await operatorRefundStars(env, 'ch-ok')).toContain('not in review');
    expect(await operatorRefundStars(env, 'nope')).toContain('No Stars payment');
    fakeTg.refundDown = true;
    expect(await operatorRefundStars(env, 'ch-held')).toContain('Telegram refused');
    fakeTg.refundDown = false;
    expect(await operatorRefundStars(env, 'ch-held')).toContain('750★ refunded');
    expect(fakeTg.refunded).toEqual([{ user_id: 4242, telegram_payment_charge_id: 'ch-held' }]);
    expect(await env.DB.prepare("SELECT status FROM invoices WHERE id = 'held'").first('status')).toBe('void');
    expect(await operatorRefundStars(env, 'ch-held')).toContain('refunded already');
    expect(await balanceOf(env.DB, 1)).toBe(0);
  });

  it('one credited by hand is credited in its own record too: never refunded, even once its invoice is gone', async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO invoices (id, user_id, rail, usd, coin, stars, status, processor_id, created_at, expires_at) VALUES ('byhand', 1, 'stars', 9000000, 'XTR', 750, 'review', 'ch-byhand', 0, 0)"),
      env.DB.prepare("INSERT INTO star_payments (charge_id, tg_user_id, invoice_id, stars, currency, state, created_at) VALUES ('ch-byhand', 4242, 'byhand', 750, 'XTR', 'review', 0)"),
    ]);
    expect(await operatorCredit(env, 'byhand', '9', by)).toContain('credited');
    expect(await env.DB.prepare("SELECT state FROM star_payments WHERE charge_id = 'ch-byhand'").first('state')).toBe('credited');
    // The account deleted: the invoice goes, the payment's record stays.
    await env.DB.prepare("DELETE FROM invoices WHERE id = 'byhand'").run();
    expect(await operatorRefundStars(env, 'ch-byhand')).toContain('not in review');
    expect(fakeTg.refunded).toHaveLength(0);
  });

  it('/credit and /refundstars at once: the stars are credited or given back, never both', async () => {
    for (let i = 0; i < 5; i++) {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO invoices (id, user_id, rail, usd, coin, stars, status, processor_id, created_at, expires_at) VALUES (?1, 1, 'stars', 9000000, 'XTR', 750, 'review', ?2, 0, 0)").bind(`race${i}`, `ch-race${i}`),
        env.DB.prepare("INSERT INTO star_payments (charge_id, tg_user_id, invoice_id, stars, currency, state, created_at) VALUES (?1, 4242, ?2, 700, 'XTR', 'review', 0)").bind(`ch-race${i}`, `race${i}`),
      ]);
      const [, back] = await Promise.all([operatorCredit(env, `race${i}`, '8.4', by), operatorRefundStars(env, `ch-race${i}`)]);
      const credited = (await env.DB.prepare("SELECT count(*) AS n FROM ledger WHERE invoice_id = ? AND type = 'deposit'").bind(`race${i}`).first<number>('n'))!;
      const refunded = fakeTg.refunded.some((r) => r.telegram_payment_charge_id === `ch-race${i}`);
      expect(credited + (refunded ? 1 : 0)).toBe(1);
      if (refunded) expect(back).toContain('700★ refunded');
    }
  });

  it('one whose invoice was credited meanwhile is not refunded', async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO invoices (id, user_id, rail, usd, coin, stars, status, processor_id, created_at, expires_at) VALUES ('raced', 1, 'stars', 9000000, 'XTR', 750, 'paid', 'ch-raced', 0, 0)"),
      env.DB.prepare("INSERT INTO star_payments (charge_id, tg_user_id, invoice_id, stars, currency, state, created_at) VALUES ('ch-raced', 4242, 'raced', 750, 'XTR', 'review', 0)"),
    ]);
    expect(await operatorRefundStars(env, 'ch-raced')).toContain('credited meanwhile');
    expect(fakeTg.refunded).toHaveLength(0);
  });
});

describe('/adjust', () => {
  it('either way, never below zero, once per command message', async () => {
    expect(await operatorAdjust(env, 'a@example.com', '2.5', 'goodwill', by, 'g:1')).toContain('+$2.50');
    expect(await operatorAdjust(env, 'a@example.com', '2.5', 'goodwill', by, 'g:1')).toContain('Written already');
    expect(await operatorAdjust(env, 'a@example.com', '-3', 'fix', by, 'g:2')).toContain('below zero');
    expect(await operatorAdjust(env, 'a@example.com', '-1', 'fix', by, 'g:3')).toContain('−$1.00');
    expect(await operatorAdjust(env, 'a@example.com', '1', '', by, 'g:4')).toContain('Use:');
    expect(await operatorAdjust(env, 'zz@example.com', '1', 'x', by, 'g:5')).toContain('No account');
    expect(await balanceOf(env.DB, 1)).toBe(1_500_000);
    const row = await env.DB.prepare("SELECT by_tg, by_name, note FROM ledger WHERE type = 'adjustment' ORDER BY id LIMIT 1").first();
    expect(row).toEqual({ by_tg: ADMIN, by_name: '@op', note: 'goodwill' });
  });
});

describe('in the support group', () => {
  it('admins run the refund commands; a delivered-twice /adjust writes once', async () => {
    fakeTg.admins.add(`${GROUP}:${ADMIN}`);
    const inv = await paid();
    const id = (await ask({ invoice_id: inv, address: TRON })).body.refund.id as string;
    let updateId = 7000;
    const inGroup = async (from: number, text: string, update = ++updateId, messageId = update) => {
      const { ctx, settle } = fakeCtx();
      await app.request('https://clx.cx/hook/telegram', { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'hook-secret' }, body: JSON.stringify({ update_id: update, message: { message_id: messageId, from: { id: from, username: 'op' }, chat: { id: GROUP, type: 'supergroup' }, text } }) }, env, ctx);
      await settle();
    };
    await inGroup(9999, `/refund ${id} 5`);
    expect(await refundRows(inv)).toHaveLength(0);
    await inGroup(ADMIN, `/refund ${id} 5`);    expect(await refundRows(inv)).toEqual([{ amount: -5_000_000, op_key: `refund:${id}`, by_tg: ADMIN }]);
    await inGroup(ADMIN, `/refunded ${id} ${'d'.repeat(64)}`);
    expect(await refundOf(id)).toMatchObject({ status: 'done' });
    // The same command message in a second update (Telegram retried): one row.
    await inGroup(ADMIN, '/adjust a@example.com 1 goodwill note', 7100, 55);
    await inGroup(ADMIN, '/adjust a@example.com 1 goodwill note', 7101, 55);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM ledger WHERE type = 'adjustment'").first('n')).toBe(1);
    expect(await env.DB.prepare("SELECT note FROM ledger WHERE type = 'adjustment'").first('note')).toBe('goodwill note');
    await inGroup(ADMIN, '/help');
    expect(toGroup().at(-1)).toContain('/refundstars');
  });
});

describe('deleting the account', () => {
  it('is refused while a refund is open, and keeps the refunds in the archive', async () => {
    const inv = await paid();
    const id = (await ask({ invoice_id: inv, address: TRON })).body.refund.id as string;
    await operatorRefund(env, id, '10', by);
    expect(await balanceOf(env.DB, 1)).toBe(0);
    await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = 1').bind(await hashPassword('pw-pw-pw-pw')).run();
    const del = async () => {
      const { ctx, settle } = fakeCtx();
      const res = await app.request('https://clx.cx/v1/me', { method: 'DELETE', headers: { authorization: `Bearer ${await signAccess('test-jwt-secret', 1, Date.now())}`, 'content-type': 'application/json' }, body: JSON.stringify({ password: 'pw-pw-pw-pw' }) }, env, ctx);
      await settle();
      return { status: res.status, body: (await res.json()) as Record<string, any> };
    };
    const refused = await del();
    expect(refused.body.error.code).toBe('balance_not_empty');
    expect(refused.body.error.message).toContain('refund');
    await operatorRefunded(env, id, 'e'.repeat(64));
    expect((await del()).status).toBe(200);
    const archived = JSON.parse((await env.DB.prepare('SELECT data FROM billing_archive ORDER BY id DESC LIMIT 1').first<string>('data'))!);
    expect(archived.refunds).toEqual([expect.objectContaining({ id, status: 'done', amount: 10_000_000 })]);
    expect(JSON.stringify(archived)).not.toContain(TRON);
  });
});

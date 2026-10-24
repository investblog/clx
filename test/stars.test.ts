// Top-ups in Telegram Stars (docs/spec.md §18, ADR 0035): /pay in the bot, the invoice it sends, the
// pre-checkout answered from reads, the payment credited once per charge id or put before an
// operator, and Stars invoices that can no longer be paid expiring. Telegram is a fake
// (test/fake-cf.ts).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccess, signBot } from '../src/auth/jwt';
import { balanceOf } from '../src/billing/pro';
import { expireStars, STARS_GRACE, tellStarsReviews } from '../src/billing/stars';
import { app } from '../src/index';
import type { Env } from '../src/types';
import { fakeCtx, testEnv } from './env';
import { fakeTg, useFakeCloudflare } from './fake-cf';

const GROUP = -100777;
let env: Env;
let dispose: () => Promise<void>;
const mail: { to: string; text: string }[] = [];
beforeAll(async () => {
  ({ env, dispose } = await testEnv());
  env = {
    ...env,
    TELEGRAM_BOT_TOKEN: '123:bot',
    TELEGRAM_WEBHOOK_SECRET: 'hook-secret',
    TELEGRAM_CODE_KEY: 'code-key',
    TELEGRAM_SUPPORT_CHAT: String(GROUP),
    EMAIL: { send: async (m) => (mail.push(m), { messageId: `m${mail.length}` }) },
  };
});
afterAll(() => dispose());
useFakeCloudflare();

beforeEach(async () => {
  for (const t of ['tg_identities', 'tg_states', 'tg_updates', 'email_tokens', 'email_sends', 'ledger', 'pro_periods', 'invoices', 'star_payments', 'idempotency', 'users']) await env.DB.prepare(`DELETE FROM ${t}`).run();
  mail.length = 0;
  fakeTg.reset();
});

let updateId = 5000;
let tgSeq = 900;
const nextTg = () => ++tgSeq;

async function hook(update: Record<string, unknown>): Promise<number> {
  const { ctx, settle } = fakeCtx();
  const res = await app.request('https://clx.cx/hook/telegram', { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'hook-secret' }, body: JSON.stringify({ update_id: ++updateId, ...update }) }, env, ctx);
  await settle();
  return res.status;
}

const say = (from: number, text: string) => hook({ message: { message_id: updateId + 1, from: { id: from, username: `u${from}`, language_code: 'en' }, chat: { id: from, type: 'private' }, text } });
const last = (chat: number) => fakeTg.sent.filter((m) => m.chat_id === chat).at(-1)?.text ?? '';
const toGroup = () => fakeTg.sent.filter((m) => m.chat_id === GROUP).map((m) => m.text);

/** A linked Telegram user: the account made by the bot's sign-in. */
async function signIn(tg: number): Promise<number> {
  const email = `s${tg}@example.com`;
  await say(tg, '/start');
  await say(tg, email);
  await say(tg, mail.filter((m) => m.to === email).at(-1)!.text.match(/\b(\d{6})\b/u)![1]!);
  return (await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<number>('id'))!;
}

/** /pay and the pack's number: the invoice Telegram was asked to send. */
async function invoiceFor(tg: number, pick = '1'): Promise<{ id: string; stars: number }> {
  await say(tg, '/pay');
  await say(tg, pick);
  const sent = fakeTg.invoices.at(-1)!;
  return { id: String(sent.payload), stars: (sent.prices as { amount: number }[])[0]!.amount };
}

const preCheckout = (tg: number, payload: string, total: number, currency = 'XTR') => hook({ pre_checkout_query: { id: `q${updateId}`, from: { id: tg }, currency, total_amount: total, invoice_payload: payload } });
const pays = (tg: number, payload: string, total: number, charge: string, currency = 'XTR') =>
  hook({ message: { message_id: updateId + 1, from: { id: tg }, chat: { id: tg, type: 'private' }, successful_payment: { currency, total_amount: total, invoice_payload: payload, telegram_payment_charge_id: charge, provider_payment_charge_id: '' } } });
const deposits = (userId: number) => env.DB.prepare("SELECT count(*) AS n FROM ledger WHERE user_id = ? AND type = 'deposit'").bind(userId).first<number>('n');
const invoice = (id: string) => env.DB.prepare('SELECT * FROM invoices WHERE id = ?').bind(id).first<Record<string, any>>();

describe('/pay', () => {
  it('shows the balance and Pro, sends a Stars invoice for the pack picked, with our invoice id as its payload', async () => {
    const tg = nextTg();
    const userId = await signIn(tg);
    await say(tg, '/pay');
    expect(last(tg)).toContain('$0.00');
    expect(last(tg)).toContain('1. 750★ → $9.00');
    expect(last(tg)).toContain('2. 2500★ → $30.00');
    expect(last(tg)).toContain('3. Switch Pro on');
    await say(tg, '2');
    const sent = fakeTg.invoices.at(-1)!;
    expect(sent).toMatchObject({ chat_id: tg, currency: 'XTR', provider_token: '', prices: [{ amount: 2500 }] });
    const row = (await invoice(String(sent.payload)))!;
    expect(row).toMatchObject({ user_id: userId, rail: 'stars', coin: 'XTR', stars: 2500, usd: 30_000_000, status: 'pending' });
    expect(last(tg)).toContain('@PremiumBot');
  });

  it('a session or a key cannot make a Stars invoice; the bot cannot make a crypto one', async () => {
    const tg = nextTg();
    const userId = await signIn(tg);
    const ver = (await env.DB.prepare('SELECT session_version FROM users WHERE id = ?').bind(userId).first<number>('session_version'))!;
    const linkedAt = (await env.DB.prepare('SELECT linked_at FROM tg_identities WHERE tg_user_id = ?').bind(tg).first<number>('linked_at'))!;
    const call = async (token: string, body: unknown) => {
      const { ctx, settle } = fakeCtx();
      const res = await app.request('https://clx.cx/v1/billing/invoices', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': `k${++updateId}` }, body: JSON.stringify(body) }, env, ctx);
      await settle();
      return { status: res.status, body: (await res.json()) as Record<string, any> };
    };
    const session = await signAccess(env.JWT_SECRET, userId, Date.now(), ver);
    expect((await call(session, { stars: 750 })).body.error.details.field).toBe('stars');
    const bot = await signBot(env.JWT_SECRET, userId, { tg, linkedAt }, Date.now(), ver);
    expect((await call(bot, { usd: 10, coin: 'USDT_TRC20' })).body.error.details.field).toBe('stars');
    expect((await call(bot, { stars: 1000 })).body.error.details.field).toBe('stars');
    expect((await call(bot, { stars: 750 })).status).toBe(201);
  });

  it('an invoice Telegram did not take stays pending — a lost answer looks the same, and it may yet be paid', async () => {
    const tg = nextTg();
    await signIn(tg);
    fakeTg.invoiceDown = true;
    await say(tg, '/pay');
    await say(tg, '1');
    expect(last(tg)).toContain('did not take the invoice');
    expect(await env.DB.prepare("SELECT status FROM invoices WHERE rail = 'stars'").first<string>('status')).toBe('pending');
  });
});

describe('paying', () => {
  it('the pre-checkout passes only for the owner, the exact stars, XTR, an open invoice', async () => {
    const tg = nextTg();
    const other = nextTg();
    await signIn(tg);
    await signIn(other);
    const inv = await invoiceFor(tg);
    const answers = async (...a: Parameters<typeof preCheckout>) => (await preCheckout(...a), fakeTg.preCheckouts.at(-1)!);
    expect((await answers(tg, inv.id, 750)).ok).toBe(true);
    expect((await answers(other, inv.id, 750)).ok).toBe(false);
    expect((await answers(tg, inv.id, 749)).ok).toBe(false);
    expect((await answers(tg, inv.id, 750, 'USD')).ok).toBe(false);
    expect((await answers(tg, 'nope', 750)).ok).toBe(false);
    expect((await answers(nextTg(), inv.id, 750)).error_message).toContain('/pay');
    await env.DB.prepare('UPDATE invoices SET expires_at = ? WHERE id = ?').bind(Date.now() - 1000, inv.id).run();
    expect((await answers(tg, inv.id, 750)).ok).toBe(false);
    // Nothing is written by a pre-checkout.
    expect((await invoice(inv.id))!.status).toBe('pending');
  });

  it('a payment credits the invoice once — a redelivered update, or the same charge again, write nothing', async () => {
    const tg = nextTg();
    const userId = await signIn(tg);
    const inv = await invoiceFor(tg);
    expect(await pays(tg, inv.id, 750, 'ch-1')).toBe(200);
    expect(await balanceOf(env.DB, userId)).toBe(9_000_000);
    expect(last(tg)).toContain('$9.00 is on the balance, $9.00 now');
    expect(last(tg)).toContain('/pay switches it on');
    expect(await invoice(inv.id)).toMatchObject({ status: 'paid', processor_id: 'ch-1' });
    const said = fakeTg.sent.length;
    await pays(tg, inv.id, 750, 'ch-1');
    expect(await deposits(userId)).toBe(1);
    expect(fakeTg.sent.length).toBe(said);
    // Pro from /pay, paid by that deposit.
    await say(tg, '/pay');
    await say(tg, '3');
    expect(last(tg)).toContain('Pro is on');
    expect(await balanceOf(env.DB, userId)).toBe(9_000_000 - 300_000);
  });

  it('a payment just after the invoice ran out is credited within the grace; past it, review', async () => {
    const tg = nextTg();
    const userId = await signIn(tg);
    const a = await invoiceFor(tg);
    const b = await invoiceFor(tg);
    await env.DB.prepare('UPDATE invoices SET expires_at = ? WHERE id = ?').bind(Date.now() - 60_000, a.id).run();
    await env.DB.prepare('UPDATE invoices SET expires_at = ? WHERE id = ?').bind(Date.now() - STARS_GRACE - 60_000, b.id).run();
    await pays(tg, a.id, 750, 'ch-a');
    await pays(tg, b.id, 750, 'ch-b');
    expect(await balanceOf(env.DB, userId)).toBe(9_000_000);
    expect(await invoice(b.id)).toMatchObject({ status: 'review', review_reason: 'expired', processor_id: 'ch-b' });
    expect(toGroup().at(-1)).toContain('ch-b');
  });

  it('stars that do not match the invoice go to review with the charge id, and an operator credits them', async () => {
    const tg = nextTg();
    const userId = await signIn(tg);
    const inv = await invoiceFor(tg);
    await pays(tg, inv.id, 700, 'ch-x');
    expect(await deposits(userId)).toBe(0);
    expect(await invoice(inv.id)).toMatchObject({ status: 'review', review_reason: 'amount_mismatch', processor_id: 'ch-x' });
    expect(last(tg)).toContain('did not match');
    expect(toGroup().at(-1)).toContain(`/credit ${inv.id}`);
    // A redelivery finds the charge and says nothing more.
    const told = toGroup().length;
    await pays(tg, inv.id, 700, 'ch-x');
    expect(toGroup().length).toBe(told);
  });

  it('one invoice paid twice: the second charge is told to the operators, credited once', async () => {
    const tg = nextTg();
    const userId = await signIn(tg);
    const inv = await invoiceFor(tg);
    await pays(tg, inv.id, 750, 'ch-1');
    await pays(tg, inv.id, 750, 'ch-2');
    expect(await deposits(userId)).toBe(1);
    expect(toGroup().at(-1)).toContain('ch-2');
    expect(toGroup().at(-1)).toContain('paid twice');
  });

  it("a payment for someone else's invoice, or none, is not credited and reaches the operators", async () => {
    const tg = nextTg();
    const other = nextTg();
    const owner = await signIn(tg);
    await signIn(other);
    const inv = await invoiceFor(tg);
    await pays(other, inv.id, 750, 'ch-o');
    await pays(other, 'nope', 750, 'ch-n');
    expect(await deposits(owner)).toBe(0);
    expect((await invoice(inv.id))!.status).toBe('pending');
    expect(toGroup().join('\n')).toContain('ch-o');
    expect(toGroup().join('\n')).toContain('ch-n');
  });

  it('every payment is kept by its charge id, whether or not the support message goes, and after the account is gone', async () => {
    const tg = nextTg();
    const other = nextTg();
    const owner = await signIn(tg);
    await signIn(other);
    const inv = await invoiceFor(tg);
    await pays(tg, inv.id, 750, 'ch-1');
    fakeTg.blocked.add(GROUP);
    await pays(tg, inv.id, 750, 'ch-2');
    await pays(other, inv.id, 750, 'ch-3');
    await pays(other, 'nope', 750, 'ch-4');
    expect(toGroup()).toEqual([]);
    const rows = (await env.DB.prepare('SELECT charge_id, state, reason FROM star_payments ORDER BY charge_id').all()).results;
    expect(rows).toEqual([
      { charge_id: 'ch-1', state: 'credited', reason: null },
      { charge_id: 'ch-2', state: 'review', reason: 'invoice_paid' },
      { charge_id: 'ch-3', state: 'review', reason: 'not_linked' },
      { charge_id: 'ch-4', state: 'review', reason: 'no_invoice' },
    ]);
    // The messages that did not go are sent by the cron once the group takes them, each once.
    expect(await tellStarsReviews(env)).toBe(0);
    fakeTg.blocked.delete(GROUP);
    expect(await tellStarsReviews(env)).toBe(3);
    expect(await tellStarsReviews(env)).toBe(0);
    expect(toGroup().join('\n')).toContain('ch-4');
    // A payment delivered after the account is gone is kept all the same.
    await env.DB.prepare('DELETE FROM ledger WHERE user_id = ?').bind(owner).run();
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(owner).run();
    await pays(tg, inv.id, 750, 'ch-5');
    expect(await env.DB.prepare('SELECT state, reason FROM star_payments WHERE charge_id = ?').bind('ch-5').first()).toEqual({ state: 'review', reason: 'no_invoice' });
    expect(await env.DB.prepare('SELECT count(*) AS n FROM star_payments').first<number>('n')).toBe(5);
  });

  it('two deliveries of one charge at once: one credits, the other is sent back and then finds it done', async () => {
    const tg = nextTg();
    const userId = await signIn(tg);
    const inv = await invoiceFor(tg);
    const statuses = await Promise.all([pays(tg, inv.id, 750, 'ch-c'), pays(tg, inv.id, 750, 'ch-c')]);
    expect(await deposits(userId)).toBe(1);
    if (statuses.includes(500)) expect(await pays(tg, inv.id, 750, 'ch-c')).toBe(200);
    expect(await deposits(userId)).toBe(1);
    expect(toGroup()).toEqual([]);
  });

  it('a payment whose handling died after the credit is settled by its redelivery, not called a double payment', async () => {
    const tg = nextTg();
    const userId = await signIn(tg);
    const inv = await invoiceFor(tg);
    await pays(tg, inv.id, 750, 'ch-d');
    // Its claim is fresh: the redelivery is sent back. A minute on, it is taken over.
    await env.DB.prepare("UPDATE star_payments SET state = 'received', settled_at = NULL, claimed_at = ? WHERE charge_id = 'ch-d'").bind(Date.now()).run();
    expect(await pays(tg, inv.id, 750, 'ch-d')).toBe(500);
    await env.DB.prepare("UPDATE star_payments SET claimed_at = ? WHERE charge_id = 'ch-d'").bind(Date.now() - 61_000).run();
    expect(await pays(tg, inv.id, 750, 'ch-d')).toBe(200);
    expect(await deposits(userId)).toBe(1);
    expect(toGroup()).toEqual([]);
    expect(await env.DB.prepare("SELECT state FROM star_payments WHERE charge_id = 'ch-d'").first<string>('state')).toBe('credited');
  });

  it('a pending Stars invoice expires once its grace has passed, not before', async () => {
    const tg = nextTg();
    await signIn(tg);
    const inv = await invoiceFor(tg);
    expect(await expireStars(env)).toBe(0);
    expect(await expireStars(env, Date.now() + 3_600_000 + STARS_GRACE + 1000)).toBe(1);
    expect((await invoice(inv.id))!.status).toBe('expired');
  });
});

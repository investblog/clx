// The upgrade advice (docs/spec.md §8): levels and the trend on their own, then the hourly job
// reading the fake account's analytics and the size of its database.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { advise, assessCounter, assessSize } from '../src/advice';
import { signAccess } from '../src/auth/jwt';
import worker, { app } from '../src/index';
import type { Env } from '../src/types';
import { fakeCtx, testEnv } from './env';
import { ACC, BOOT, fakeCf, useFakeCloudflare } from './fake-cf';

const H = 3_600_000;
const D = 24 * H;
const MB = 1024 * 1024;

describe('levels', () => {
  const first = 100;
  const today = first + 7;
  it('the busiest of the 7 days against the Free limit: 60% watch, 80% upgrade soon, 100% over', () => {
    expect(assessCounter([10, 20, 59_000, 30, 0, 0, 0], first, 100_000, today)).toMatchObject({ level: 'ok', busiest: { value: 59_000 } });
    expect(assessCounter([0, 0, 60_000, 0, 0, 0, 0], first, 100_000, today).level).toBe('watch');
    expect(assessCounter([0, 0, 84_000, 0, 0, 0, 0], first, 100_000, today)).toMatchObject({ level: 'upgrade_soon', busiest: { day: new Date((first + 2) * D).toISOString().slice(0, 10), value: 84_000 } });
    expect(assessCounter([0, 0, 0, 0, 0, 0, 100_000], first, 100_000, today).level).toBe('over');
  });

  it('a rising trend over at least 4 days forecasts the day the limit is reached', () => {
    // +10,000 a day from day 3: 100,000 is reached on day 9, two days from today.
    const up = assessCounter([0, 0, 0, 40_000, 50_000, 60_000, 70_000], first, 100_000, today);
    expect(up).toMatchObject({ level: 'upgrade_soon', forecast: new Date((first + 9) * D).toISOString().slice(0, 10) });
    // Slower, +3,000 a day: about 20 days away — watch; +2,000 a day: 32 days — beyond the horizon.
    expect(assessCounter([0, 0, 0, 30_000, 33_000, 36_000, 39_000], first, 100_000, today)).toMatchObject({ level: 'watch', forecast: new Date((first + 27) * D).toISOString().slice(0, 10) });
    expect(assessCounter([0, 0, 0, 30_000, 32_000, 34_000, 36_000], first, 100_000, today)).toMatchObject({ level: 'ok', forecast: null });
    // Three days of use, or a falling line, or a limit beyond 30 days: no forecast.
    expect(assessCounter([0, 0, 0, 0, 40_000, 50_000, 55_000], first, 100_000, today).forecast).toBeNull();
    expect(assessCounter([50_000, 45_000, 40_000, 35_000, 30_000, 25_000, 20_000], first, 100_000, today).forecast).toBeNull();
    expect(assessCounter([1_000, 1_100, 1_200, 1_300, 1_400, 1_500, 1_600], first, 100_000, today)).toMatchObject({ level: 'ok', forecast: null });
  });

  it('size: backpressure (400 MB) is over; size alone offers shorter hourly retention', () => {
    expect(assessSize(400 * MB).level).toBe('over');
    expect(assessSize(300 * MB).level).toBe('watch');
    const quiet = { requests: Array(7).fill(10), writes: Array(7).fill(10), reads: Array(7).fill(10) };
    expect(advise(quiet, 320 * MB, first, today, 0)).toMatchObject({ level: 'watch', metric: 'size', suggest: 'shorter_hourly_retention' });
    expect(advise({ ...quiet, writes: [0, 0, 0, 0, 0, 0, 90_000] }, 320 * MB, first, today, 0)).toMatchObject({ level: 'upgrade_soon', metric: 'writes' });
    expect(advise({ ...quiet, writes: [0, 0, 0, 0, 0, 0, 90_000] }, 320 * MB, first, today, 0).suggest).toBeUndefined();
    expect(advise(null, 10 * MB, first, today, 0)).toMatchObject({ level: 'ok', unavailable: ['analytics'], metrics: { size: { level: 'ok' } } });
  });
});

describe('the hourly job', () => {
  let env: Env;
  let dispose: () => Promise<void>;
  beforeAll(async () => ({ env, dispose } = await testEnv()));
  afterAll(() => dispose());
  useFakeCloudflare();

  const D0 = Date.UTC(2026, 9, 12);
  const at = (t: number) => vi.setSystemTime(t);
  let accountId = '';
  let idem = 0;
  async function call(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { authorization: `Bearer ${await signAccess('test-jwt-secret', 1, Date.now())}`, 'cf-connecting-ip': '10.4.0.1' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET') headers['idempotency-key'] = `a${++idem}`;
    const { ctx, settle } = fakeCtx();
    const res = await app.request(`https://clx.cx${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env, ctx);
    await settle();
    return (await res.json()) as Record<string, any>;
  }
  const account = async () => (await call('GET', `/v1/accounts/${accountId}`)).account;
  async function job(t: number) {
    at(t);
    const { ctx, settle } = fakeCtx();
    await worker.scheduled({ scheduledTime: t, cron: '* * * * *' } as ScheduledController, env, ctx);
    await settle();
  }
  const day = (back: number) => new Date(D0 - back * D).toISOString().slice(0, 10);

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at(D0 + 9 * H);
    for (const t of ['sites', 'cf_calls', 'edge_accounts', 'operations', 'idempotency', 'api_keys', 'email_sends', 'users']) await env.DB.prepare(`DELETE FROM ${t}`).run();
    await env.DB.prepare("INSERT INTO users (id, email, password_hash, created_at, email_confirmed_at, plan) VALUES (1, 'free@example.com', 'x', 0, 0, 'free')").run();
    fakeCf.reset();
    accountId = (await call('POST', '/v1/accounts', { cf_account_id: ACC, bootstrap_token: BOOT })).account.id;
    expect((await account()).edge).not.toBeNull();
  });
  afterEach(() => vi.useRealTimers());

  it("reads the account's analytics and database size once a day; today is not used", async () => {
    fakeCf.analytics = { [day(3)]: { requests: 20_000, writes: 84_000, reads: 100_000 }, [day(1)]: { requests: 5_000, writes: 9_000, reads: 1_000 }, [day(0)]: { requests: 1, writes: 100_000, reads: 0 } };
    await job(D0 + 10 * H + 20 * 60_000);
    const a = (await account()).advice;
    expect(a).toMatchObject({ level: 'upgrade_soon', metric: 'writes', metrics: { writes: { busiest: { day: day(3), value: 84_000 } }, requests: { level: 'ok' }, size: { level: 'ok', busiest: { value: 1_000_000 } } } });
    expect(a.unavailable).toBeUndefined();
    // Not again within 20 hours, nor twice in a UTC day.
    fakeCf.analytics = {};
    await job(D0 + 11 * H + 20 * 60_000);
    await job(D0 + 29 * H + 20 * 60_000);
    expect((await account()).advice.level).toBe('upgrade_soon');
    await job(D0 + 31 * H + 20 * 60_000);
    expect((await account()).advice.level).toBe('ok');
    // A revoked account is not measured any more: its last advice is not shown.
    await env.DB.prepare("UPDATE edge_accounts SET state = 'revoked' WHERE id = ?").bind(accountId).run();
    expect((await account()).advice).toBeNull();
  });

  it('e-mails: upgrade_soon once a week at most, over at once, quiet again once back to ok', async () => {
    const mail: { to: string; subject: string }[] = [];
    const real = env;
    env = { ...env, EMAIL: { send: async (m) => (mail.push(m), {}) } };
    try {
      fakeCf.analytics = { [day(3)]: { requests: 1, writes: 84_000, reads: 1 } };
      await job(D0 + 10 * H + 20 * 60_000);
      expect(mail).toEqual([expect.objectContaining({ to: 'free@example.com', subject: expect.stringContaining('will soon hit') })]);
      // The next day, the same level: no e-mail within the week.
      await job(D0 + 34 * H + 20 * 60_000);
      expect((await account()).advice.level).toBe('upgrade_soon');
      expect(mail).toHaveLength(1);
      // A higher level goes at once.
      fakeCf.analytics = { [day(3)]: { requests: 1, writes: 84_000, reads: 1 }, [day(-1)]: { requests: 1, writes: 100_000, reads: 1 } };
      await job(D0 + 58 * H + 20 * 60_000);
      expect((await account()).advice.level).toBe('over');
      const advice = () => mail.filter((m) => m.subject.includes('Cloudflare limit'));
      expect(advice().at(-1)!.subject).toMatch(/" hit a Cloudflare limit$/u);
      // Back to ok: the last level is cleared, so a new rise is written about at once.
      fakeCf.analytics = {};
      await job(D0 + 82 * H + 20 * 60_000);
      expect(await env.DB.prepare('SELECT advice_mailed_level FROM edge_accounts').first('advice_mailed_level')).toBeNull();
      expect(advice()).toHaveLength(2);
    } finally {
      env = real;
    }
  });

  it('"renew the connection" 30 days before the token expires, once per token', async () => {
    const mail: { subject: string }[] = [];
    const real = env;
    env = { ...env, EMAIL: { send: async (m) => (mail.push(m), {}) } };
    const renew = () => mail.filter((m) => m.subject.includes('renew the connection'));
    try {
      await env.DB.prepare('UPDATE edge_accounts SET token_expires_at = ?').bind(D0 + 40 * D).run();
      await job(D0 + 10 * H + 20 * 60_000);
      expect(renew()).toHaveLength(0);
      await env.DB.prepare('UPDATE edge_accounts SET token_expires_at = ?').bind(D0 + 20 * D).run();
      // A send that fails is tried again the next hour.
      const send = env.EMAIL!.send;
      env.EMAIL!.send = () => Promise.reject(new Error('down'));
      await job(D0 + 11 * H + 20 * 60_000);
      env.EMAIL!.send = send;
      expect(renew()).toHaveLength(0);
      await job(D0 + 12 * H + 20 * 60_000);
      expect(renew()).toHaveLength(1);
      // A renewed token expires a year later and is written about again then.
      await env.DB.prepare('UPDATE edge_accounts SET token_expires_at = ?').bind(D0 + 13 * H + 20 * D + 365 * D).run();
      await job(D0 + 13 * H + 20 * 60_000);
      expect(renew()).toHaveLength(1);
    } finally {
      env = real;
    }
  });

  it('analytics refused (403): the advice says so and still judges the size', async () => {
    fakeCf.denyWorking.add('/graphql');
    fakeCf.dbSize = 410 * MB;
    await job(D0 + 10 * H + 20 * 60_000);
    expect((await account()).advice).toMatchObject({ level: 'over', metric: 'size', unavailable: ['analytics'] });
  });

  it('a revoked token (401) gives no advice and sends the account to the token check', async () => {
    fakeCf.rejectWorking.add('/graphql');
    await job(D0 + 10 * H + 20 * 60_000);
    expect((await account()).advice).toBeNull();
    expect(await env.DB.prepare('SELECT token_checked_at, advice_at FROM edge_accounts WHERE id = ?').bind(accountId).first()).toEqual({ token_checked_at: 0, advice_at: D0 + 11 * H + 20 * 60_000 });
  });

  it('Cloudflare failing in passing: no advice yet, tried again the next hour', async () => {
    fakeCf.failOnce.add('/graphql');
    await job(D0 + 10 * H + 20 * 60_000);
    expect((await account()).advice).toBeNull();
    await job(D0 + 11 * H + 20 * 60_000);
    expect((await account()).advice).toMatchObject({ level: 'ok' });
  });
});

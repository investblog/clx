// The Telegram bot (docs/spec.md §17, ADR 0030): the webhook, sign-in by a mailed code, the bot's
// principal and what it may call, the totals, adding a site, connecting an account, the link's
// undoing and the notices. Telegram and Cloudflare are fakes (test/fake-cf.ts); e-mail goes to a
// fake EMAIL binding.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccess, signBot } from '../src/auth/jwt';
import { app } from '../src/index';
import { sendNotice } from '../src/mail';
import type { Env } from '../src/types';
import { fakeCtx, testEnv } from './env';
import { ACC, BOOT, fakeCf, fakeTg, useFakeCloudflare } from './fake-cf';

/** The support group (§17); the bot's own id is the token's '123'. */
const GROUP = -100777;
const BOT_ID = 123;
let env: Env;
let dispose: () => Promise<void>;
const mail: { to: string; subject: string; text: string }[] = [];
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
  for (const t of ['tg_identities', 'tg_states', 'tg_updates', 'email_tokens', 'email_sends', 'sites', 'cf_calls', 'edge_accounts', 'operations', 'idempotency', 'api_keys', 'users']) await env.DB.prepare(`DELETE FROM ${t}`).run();
  mail.length = 0;
  fakeTg.reset();
  fakeCf.reset();
});

let updateId = 1000;
/** A Telegram user per test, so the per-minute limit of one does not reach another. */
let tgSeq = 500;
const nextTg = () => ++tgSeq;

async function hook(update: unknown, secret = 'hook-secret', e: Env = env): Promise<number> {
  const { ctx, settle } = fakeCtx();
  const res = await app.request('https://clx.cx/hook/telegram', { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret }, body: JSON.stringify(update) }, e, ctx);
  await settle();
  return res.status;
}

/** A private message from `from`; its update id is returned with the status. */
async function say(from: number, text: string, extra: { chat?: string; lang?: string } = {}): Promise<{ status: number; id: number }> {
  const id = ++updateId;
  const status = await hook({ update_id: id, message: { message_id: id, from: { id: from, username: `u${from}`, language_code: extra.lang ?? 'en' }, chat: { id: from, type: extra.chat ?? 'private' }, text } });
  return { status, id };
}

const codeIn = (m: { text: string } | undefined) => m?.text.match(/\b(\d{6})\b/u)?.[1] ?? '';
const last = (chat: number) => fakeTg.sent.filter((m) => m.chat_id === chat).at(-1)?.text ?? '';

/** /start, the address, the mailed code: the Telegram user linked to the address's account. */
async function signIn(tg: number, email = `p${tg}@example.com`): Promise<number> {
  await say(tg, '/start');
  await say(tg, email);
  await say(tg, codeIn(mail.filter((m) => m.to === email).at(-1)));
  return (await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<number>('id'))!;
}

describe('the webhook', () => {
  it('without its secrets it is off; a wrong secret is 401; group chats are ignored', async () => {
    expect(await hook({ update_id: 1 }, 'hook-secret', { ...env, TELEGRAM_CODE_KEY: undefined })).toBe(503);
    expect(await hook({ update_id: 1 }, 'wrong')).toBe(401);
    const tg = nextTg();
    expect((await say(tg, '/help', { chat: 'group' })).status).toBe(200);
    expect(fakeTg.sent).toEqual([]);
  });

  it('an update is handled once; a command ends a pending question', async () => {
    const tg = nextTg();
    const id = ++updateId;
    const update = { update_id: id, message: { message_id: id, from: { id: tg }, chat: { id: tg, type: 'private' }, text: '/help' } };
    await hook(update);
    await hook(update);
    expect(fakeTg.sent).toHaveLength(1);
    await say(tg, '/start');
    await say(tg, '/cancel');
    await say(tg, 'someone@example.com');
    expect(last(tg)).toContain('waiting for a command');
    expect(mail).toEqual([]);
  });

  it('two deliveries of one update at once: handled once', async () => {
    const tg = nextTg();
    await say(tg, '/start');
    const id = ++updateId;
    const update = { update_id: id, message: { message_id: id, from: { id: tg }, chat: { id: tg, type: 'private' }, text: 'twice@example.com' } };
    await Promise.all([hook(update), hook(update)]);
    expect(mail.filter((m) => m.to === 'twice@example.com')).toHaveLength(1);
    // The code that went is the one the dialog holds.
    await say(tg, codeIn(mail.at(-1)));
    expect(last(tg)).toContain('linked to <b>twice@example.com</b>');
  });

  it('a delivery of an update still running is not acknowledged; a claim a minute old is taken over', async () => {
    const tg = nextTg();
    const id = ++updateId;
    const update = { update_id: id, message: { message_id: id, from: { id: tg }, chat: { id: tg, type: 'private' }, text: '/help' } };
    await env.DB.prepare("INSERT INTO tg_updates (update_id, at, claim) VALUES (?, ?, 'another')").bind(id, Date.now()).run();
    expect(await hook(update)).toBe(500);
    expect(fakeTg.sent).toEqual([]);
    await env.DB.prepare('UPDATE tg_updates SET at = ? WHERE update_id = ?').bind(Date.now() - 120_000, id).run();
    expect(await hook(update)).toBe(200);
    expect(fakeTg.sent).toHaveLength(1);
    expect(await hook(update)).toBe(200);
    expect(fakeTg.sent).toHaveLength(1);
  });

  it('a passing failure answers 500 and gives the update back; its redelivery does the work once', async () => {
    const tg = nextTg();
    const userId = await signIn(tg);
    await readyAccount(userId);
    fakeCf.failOnce.add('/zones');
    const id = ++updateId;
    const update = { update_id: id, message: { message_id: id, from: { id: tg }, chat: { id: tg, type: 'private' }, text: '/site example.com' } };
    expect(await hook(update)).toBe(500);
    expect(await hook(update)).toBe(200);
    expect(await hook(update)).toBe(200);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM sites').first<number>('n')).toBe(1);
    expect(fakeTg.said(tg).match(/Site <b>example.com<\/b> added/gu)).toHaveLength(1);
  });

  it('30 messages a minute per Telegram user; past that the bot is silent', async () => {
    const tg = nextTg();
    // The binding counts in fixed one-minute windows: a burst that crosses a window's edge gets two
    // windows' worth, never more.
    for (let i = 0; i < 70; i++) await say(tg, '/help');
    const answered = fakeTg.sent.filter((m) => m.chat_id === tg).length;
    expect(answered).toBeGreaterThanOrEqual(30);
    expect(answered).toBeLessThanOrEqual(60);
  });
});

describe('signing in', () => {
  it('a new address makes a confirmed account without a password, linked, and the owner is mailed a way to undo it', async () => {
    const tg = nextTg();
    await say(tg, '/start');
    await say(tg, 'New@Example.com');
    expect(last(tg)).toContain('If the address can receive mail');
    const code = codeIn(mail[0]);
    expect(mail[0]!.to).toBe('new@example.com');
    await say(tg, code === '000000' ? '111111' : '000000');
    expect(last(tg)).toContain('The code is wrong');
    await say(tg, code);
    expect(last(tg)).toContain('linked to <b>new@example.com</b>');
    const user = await env.DB.prepare('SELECT id, password_hash, email_confirmed_at, locale FROM users WHERE email = ?').bind('new@example.com').first<{ id: number; password_hash: string; email_confirmed_at: number | null; locale: string }>();
    expect(user).toMatchObject({ locale: 'en' });
    // Well-formed but matching no password: a sign-in against it takes as long as any.
    expect(user!.password_hash).toMatch(/^[A-Za-z0-9+/]{22}==:[A-Za-z0-9+/]{43}=$/u);
    expect(user!.email_confirmed_at).not.toBeNull();
    expect(await env.DB.prepare('SELECT user_id, username FROM tg_identities WHERE tg_user_id = ?').bind(tg).first()).toEqual({ user_id: user!.id, username: `u${tg}` });
    expect(mail.at(-1)!.subject).toBe('clx: a Telegram is linked to your account');
    expect(mail.at(-1)!.text).toMatch(/#\/telegram-unlink\?t=[A-Za-z0-9_-]{43}/u);
    // No password: the site's sign-in refuses any until a reset sets one.
    const login = await app.request('https://clx.cx/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.9.0.1' }, body: JSON.stringify({ email: 'new@example.com', password: '!' }) }, env);
    expect(login.status).toBe(401);
  });

  it('a known address answers the same and links to its account; a Russian Telegram is answered in Russian', async () => {
    await env.DB.prepare("INSERT INTO users (id, email, password_hash, created_at, locale) VALUES (7, 'known@example.com', 'x', 0, 'ru')").run();
    const a = nextTg();
    const b = nextTg();
    await say(a, '/start');
    await say(a, 'known@example.com');
    await say(b, '/start');
    await say(b, 'unknown@example.com');
    expect(last(a)).toBe(last(b));
    await say(a, codeIn(mail.find((m) => m.to === 'known@example.com')));
    expect(await env.DB.prepare('SELECT user_id FROM tg_identities WHERE tg_user_id = ?').bind(a).first<number>('user_id')).toBe(7);
    // From here the bot speaks the account's language.
    expect(last(a)).toContain('привязан к');
    const c = nextTg();
    await say(c, '/start', { lang: 'ru' });
    expect(last(c)).toContain('Пришлите адрес почты');
  });

  it('three wrong tries end the code; a code of a cancelled dialog does not pass', async () => {
    const tg = nextTg();
    await say(tg, '/start');
    await say(tg, 'tries@example.com');
    const code = codeIn(mail[0]);
    const wrong = code === '000000' ? '111111' : '000000';
    await say(tg, wrong);
    await say(tg, wrong);
    await say(tg, wrong);
    expect(last(tg)).toContain('no longer works');
    await say(tg, code);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM tg_identities').first<number>('n')).toBe(0);
  });

  it('an account linked to another Telegram is not taken over', async () => {
    const first = nextTg();
    await signIn(first, 'shared@example.com');
    const second = nextTg();
    // The address's own limit is one e-mail per 10 minutes: the second code comes later.
    await env.DB.prepare('DELETE FROM email_sends').run();
    await signIn(second, 'shared@example.com');
    expect(last(second)).toContain('already linked to another Telegram');
    expect(await env.DB.prepare('SELECT tg_user_id FROM tg_identities').first<number>('tg_user_id')).toBe(first);
  });

  it('codes are limited per Telegram user before the address', async () => {
    const tg = nextTg();
    for (let i = 0; i < 6; i++) {
      await say(tg, '/start');
      await say(tg, `limit${i}@example.com`);
    }
    expect(last(tg)).toContain('Too many codes');
    expect(mail).toHaveLength(5);
  });
});

describe("the bot's principal", () => {
  const v1 = async (token: string, method: string, path: string, body?: unknown) => {
    const { ctx, settle } = fakeCtx();
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, 'cf-connecting-ip': '10.9.0.2' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET') headers['idempotency-key'] = `k${++updateId}`;
    const res = await app.request(`https://clx.cx${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env, ctx);
    await settle();
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };

  it('reads and adds, never issues keys or deletes; ends with the link and with a reset', async () => {
    const tg = nextTg();
    const userId = await signIn(tg);
    const ver = (await env.DB.prepare('SELECT session_version FROM users WHERE id = ?').bind(userId).first<number>('session_version'))!;
    const linkedAt = (await env.DB.prepare('SELECT linked_at FROM tg_identities WHERE tg_user_id = ?').bind(tg).first<number>('linked_at'))!;
    const token = await signBot(env.JWT_SECRET, userId, { tg, linkedAt }, Date.now(), ver);
    expect((await v1(token, 'GET', '/v1/me')).body.via).toBe('telegram');
    expect((await v1(token, 'GET', '/v1/sites')).status).toBe(200);
    // Everything that deletes, disconnects, rotates, renews, issues keys or touches the password is
    // refused before its handler runs.
    for (const [method, path] of [
      ['POST', '/v1/keys'],
      ['GET', '/v1/keys'],
      ['DELETE', '/v1/me'],
      ['DELETE', '/v1/me/telegram'],
      ['DELETE', '/v1/accounts/x'],
      ['POST', '/v1/accounts/x/token'],
      ['POST', '/v1/accounts/x/install'],
      ['PATCH', '/v1/sites/x'],
      ['DELETE', '/v1/sites/x'],
      ['POST', '/v1/sites/x/rotate'],
      ['PATCH', '/v1/links/x'],
      ['DELETE', '/v1/links/x'],
      ['DELETE', '/v1/link-hosts/x'],
    ])
      expect((await v1(token, method!, path!, method === 'GET' ? undefined : {})).body.error.code).toBe('session_required');
    expect((await v1(token, 'PATCH', '/v1/me', { locale: 'ru' })).status).toBe(200);
    // Its token is for another Telegram's link, or for an earlier link of this one: refused.
    expect((await v1(await signBot(env.JWT_SECRET, userId, { tg: tg + 1, linkedAt }, Date.now(), ver), 'GET', '/v1/me')).status).toBe(401);
    expect((await v1(await signBot(env.JWT_SECRET, userId, { tg, linkedAt: linkedAt - 1 }, Date.now(), ver), 'GET', '/v1/me')).status).toBe(401);
    // A page's access token is not the bot's and the bot's is not a page's.
    expect((await v1(await signAccess(env.JWT_SECRET, userId, Date.now(), ver), 'GET', '/v1/me')).body.via).toBe('session');

    // A reset ends the link along with the sessions.
    const reset = 'r'.repeat(43);
    const { sha256 } = await import('../src/lib/crypto');
    await env.DB.prepare("INSERT INTO email_tokens (token_hash, user_id, kind, expires_at) VALUES (?, ?, 'reset', ?)").bind(await sha256(reset), userId, Date.now() + 60_000).run();
    const r = await app.request('https://clx.cx/auth/reset/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: reset, password: 'a-new-password-1' }) }, env);
    expect(r.status).toBe(200);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM tg_identities').first<number>('n')).toBe(0);
    expect((await v1(token, 'GET', '/v1/me')).status).toBe(401);
  });

  it('the app unlinks it; so does the e-mail link, once, and only by its POST', async () => {
    const tg = nextTg();
    const userId = await signIn(tg);
    const session = await signAccess(env.JWT_SECRET, userId, Date.now(), (await env.DB.prepare('SELECT session_version FROM users WHERE id = ?').bind(userId).first<number>('session_version'))!);
    expect((await v1(session, 'GET', '/v1/me')).body.telegram).toMatchObject({ id: tg, username: `u${tg}` });
    // A question asked before the unlink is not answered after it.
    await say(tg, '/connect');
    expect((await v1(session, 'DELETE', '/v1/me/telegram')).status).toBe(200);
    expect((await v1(session, 'GET', '/v1/me')).body.telegram).toBeNull();
    expect((await say(tg, codeIn(mail.at(-1)))).status).toBe(200);
    expect(last(tg)).toContain('waiting for a command');
    await say(tg, '/sites');
    expect(last(tg)).toContain('Sign in first');

    await env.DB.prepare('DELETE FROM email_sends').run();
    await signIn(tg);
    const token = mail.at(-1)!.text.match(/t=([A-Za-z0-9_-]{43})/u)![1];
    const unlink = () => app.request('https://clx.cx/auth/telegram/unlink', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) }, env);
    expect((await unlink()).status).toBe(200);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM tg_identities').first<number>('n')).toBe(0);
    expect((await unlink()).status).toBe(400);
  });
});

/** Connect and confirm the install of the fake account for `userId`, as the worker's self-check would. */
async function readyAccount(userId: number): Promise<string> {
  const { ctx, settle } = fakeCtx();
  const auth = `Bearer ${await signAccess(env.JWT_SECRET, userId, Date.now(), (await env.DB.prepare('SELECT session_version FROM users WHERE id = ?').bind(userId).first<number>('session_version'))!)}`;
  const res = await app.request('https://clx.cx/v1/accounts', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json', 'idempotency-key': 'ready', 'cf-connecting-ip': '10.9.0.3' }, body: JSON.stringify({ cf_account_id: ACC, bootstrap_token: BOOT }) }, env, ctx);
  await settle();
  const { account } = (await res.json()) as { account: { id: string } };
  const script = fakeCf.scripts.get('clx-edge')!;
  const text = (n: string) => script.bindings.find((b) => b.name === n)?.text;
  const db = script.bindings.find((b) => b.name === 'DB')!.id!;
  await app.request(
    'https://clx.cx/hook/setup',
    { method: 'POST', headers: { authorization: `Bearer ${script.secrets.get('EDGE_KEY')}` }, body: JSON.stringify({ deployment_id: text('DEPLOYMENT_ID'), bundle: text('BUNDLE'), schema: fakeCf.schemaOf(db) }) },
    env,
  );
  return account.id;
}

describe('the commands', () => {
  it('/site adds a site and sends its snippet; /sites shows its week as a sparkline', async () => {
    const tg = nextTg();
    const userId = await signIn(tg);
    await say(tg, '/site example.com');
    expect(last(tg)).toContain('No account has the worker installed');
    const accountId = await readyAccount(userId);
    await say(tg, '/site example.com');
    const said = fakeTg.said(tg);
    expect(said).toContain('Site <b>example.com</b> added');
    expect(said).toMatch(/<pre>&lt;script[^]*&lt;\/script&gt;<\/pre>/u);
    const target = (await env.DB.prepare('SELECT target FROM sites').first<string>('target'))!;
    const day = Math.floor(Date.now() / 86_400_000);
    await env.DB.prepare('INSERT INTO daily (account_id, target, day, as_of_hour, final, views, bots, visitors) VALUES (?1, ?2, ?3, ?3 * 24 + 23, 1, ?4, 0, 1)').bind(accountId, target, day - 1, 12).run();
    await env.DB.prepare('INSERT INTO daily (account_id, target, day, as_of_hour, final, views, bots, visitors) VALUES (?1, ?2, ?3, ?3 * 24 + 5, 0, ?4, 0, 1)').bind(accountId, target, day, 3).run();
    await say(tg, '/sites');
    expect(last(tg)).toContain('<code>▁▁▁▁▁▁█</code> 12 · 3');
    await say(tg, '/accounts');
    expect(last(tg)).toContain('works');
  });

  it('/site as a question: the answer adds the site and ends the question', async () => {
    const tg = nextTg();
    await readyAccount(await signIn(tg));
    await say(tg, '/site');
    expect(last(tg)).toContain('Which host?');
    await say(tg, 'example.com');
    expect(fakeTg.said(tg)).toContain('Site <b>example.com</b> added');
    await say(tg, 'blog.example.com');
    expect(last(tg)).toContain('waiting for a command');
    expect(await env.DB.prepare('SELECT count(*) AS n FROM sites').first<number>('n')).toBe(1);
  });

  it('/connect: a failure after the token is sent is final — the token is called possibly alive', async () => {
    const tg = nextTg();
    await signIn(tg, 'fails@example.com');
    await say(tg, '/connect');
    await say(tg, codeIn(mail.filter((m) => m.to === 'fails@example.com').at(-1)));
    await say(tg, ACC);
    fakeCf.failOnce.add('/tokens/verify');
    expect((await say(tg, BOOT)).status).toBe(200);
    expect(last(tg)).toContain('may still be valid');
    expect(last(tg)).toContain(`https://dash.cloudflare.com/${ACC}/api-tokens`);
  });

  it('/connect: a mailed code first, then the account ID and the token; the token message is deleted', async () => {
    const tg = nextTg();
    await signIn(tg, 'owner@example.com');
    await say(tg, '/connect');
    expect(last(tg)).toContain('needs a code from your e-mail');
    const code = codeIn(mail.filter((m) => m.to === 'owner@example.com').at(-1));
    expect(mail.at(-1)!.text).toContain('connect a Cloudflare account');
    await say(tg, code);
    await say(tg, ACC);
    expect(last(tg)).toContain('bootstrap token');
    const sent = await say(tg, BOOT);
    expect(fakeTg.deleted).toEqual([{ chat_id: tg, message_id: sent.id }]);
    expect(last(tg)).toContain('Connected');
    expect(await env.DB.prepare('SELECT count(*) AS n FROM edge_accounts').first<number>('n')).toBe(1);
  });

  it('/connect: a sign-in code does not pass for it', async () => {
    const tg = nextTg();
    await signIn(tg, 'owner2@example.com');
    const signInCode = codeIn(mail.find((m) => m.subject.startsWith('clx: code')));
    await say(tg, '/connect');
    const connectCode = codeIn(mail.filter((m) => m.subject.startsWith('clx: code')).at(-1));
    if (signInCode !== connectCode) {
      await say(tg, signInCode);
      expect(last(tg)).toContain('The code is wrong');
    }
  });

  it('/lang changes the account language and the bot answers in it', async () => {
    const tg = nextTg();
    const userId = await signIn(tg);
    await say(tg, '/lang ru');
    expect(last(tg)).toContain('по-русски');
    expect(await env.DB.prepare('SELECT locale FROM users WHERE id = ?').bind(userId).first<string>('locale')).toBe('ru');
    await say(tg, '/help');
    expect(last(tg)).toContain('Команды');
  });

  it('plain text with no question pending is not called an unknown command', async () => {
    const tg = nextTg();
    await say(tg, 'otp.pink');
    expect(last(tg)).toContain('waiting for a command');
    await say(tg, '/nonsense');
    expect(last(tg)).toContain('No such command');
  });
});

describe('notices', () => {
  it("what is mailed to the user goes to the linked Telegram too, the e-mail's fate unchanged", async () => {
    const tg = nextTg();
    const userId = await signIn(tg, 'notice@example.com');
    fakeTg.sent = [];
    expect(await sendNotice(env, { id: userId, email: 'notice@example.com' }, 'clx: something', 'Hello,\n\nThe <worker> is silent.\n', Date.now())).toBe(true);
    expect(last(tg)).toBe('<b>clx: something</b>\n\nThe &lt;worker&gt; is silent.');
    fakeTg.down = true;
    expect(await sendNotice(env, { id: userId, email: 'notice@example.com' }, 'clx: again', 'Hello,\n\nAgain.\n', Date.now())).toBe(true);
    // An e-mail that did not go is tried again next hour: the Telegram message waits for it.
    fakeTg.down = false;
    const send = env.EMAIL!.send;
    env.EMAIL!.send = async () => Promise.reject(new Error('Email Sending is down'));
    try {
      expect(await sendNotice(env, { id: userId, email: 'notice@example.com' }, 'clx: later', 'Hello,\n\nLater.\n', Date.now())).toBe(false);
    } finally {
      env.EMAIL!.send = send;
    }
    expect(fakeTg.said(tg)).not.toContain('clx: later');
  });
});

/** A message in the support group from `from`, optionally a reply to a message of `reply.from`. */
async function inGroup(from: number, text: string, reply?: { from: number; text: string }): Promise<number> {
  const id = ++updateId;
  return hook({ update_id: id, message: { message_id: id, from: { id: from }, chat: { id: GROUP, type: 'supergroup' }, text, ...(reply ? { reply_to_message: { from: { id: reply.from }, text: reply.text } } : {}) } });
}
const toGroup = () => fakeTg.sent.filter((m) => m.chat_id === GROUP);

describe('support', () => {
  it('/support takes a question signed in or not; it lands in the group with who asked', async () => {
    const stranger = nextTg();
    await say(stranger, '/support');
    expect(last(stranger)).toContain('Write your question');
    await say(stranger, 'Cannot sign in <help>');
    expect(last(stranger)).toContain('Sent to support');
    expect(toGroup().at(-1)!.text).toBe(`🆘 #u${stranger} #en\n@u${stranger} · not signed in\n\nCannot sign in &lt;help&gt;`);
    // The question is over: the next text is not sent again.
    await say(stranger, 'more');
    expect(toGroup()).toHaveLength(1);
    const tg = nextTg();
    const userId = await signIn(tg, 'asks@example.com');
    await env.DB.prepare("UPDATE users SET source = 'zenno' WHERE id = ?").bind(userId).run();
    await say(tg, '/support I need the api plan for 40 sites');
    expect(toGroup().at(-1)!.text).toBe(`🆘 #u${tg} #en\n@u${tg} · asks@example.com · plan free · source zenno\n\nI need the api plan for 40 sites`);
  });

  it('without a support group /support says so; a group that does not take it is told to the person', async () => {
    const tg = nextTg();
    const id = ++updateId;
    await hook({ update_id: id, message: { message_id: id, from: { id: tg }, chat: { id: tg, type: 'private' }, text: '/support hi' } }, 'hook-secret', { ...env, TELEGRAM_SUPPORT_CHAT: '' });
    expect(last(tg)).toContain('not set up yet');
    fakeTg.blocked.add(GROUP);
    await say(tg, '/support hi');
    expect(last(tg)).toContain('did not reach support');
  });

  it("an admin's reply to the bot's message goes to the person, in their language; others are not heard", async () => {
    const tg = nextTg();
    await say(tg, '/support вопрос', { lang: 'ru' });
    const question = toGroup().at(-1)!.text;
    expect(question).toContain(`#u${tg} #ru`);
    const admin = 9001;
    const member = 9002;
    fakeTg.admins.add(`${GROUP}:${admin}`);
    // A member's reply, an admin's reply to someone else, talk without a reply: silence.
    await inGroup(member, 'I am not support', { from: BOT_ID, text: question });
    await inGroup(admin, 'a note', { from: member, text: question });
    await inGroup(admin, 'just talking');
    expect(fakeTg.said(tg)).not.toContain('Поддержка');
    await inGroup(admin, 'Ответ <b>', { from: BOT_ID, text: question });
    expect(last(tg)).toBe('<b>Поддержка:</b>\nОтвет &lt;b&gt;');
    expect(toGroup().at(-1)!.text).toBe(`✓ sent to #u${tg}`);
    // A tag the bot echoed in another answer routes nothing: only a question's header does.
    const victim = nextTg();
    await inGroup(admin, `/user #u${victim} #en`);
    const echo = toGroup().at(-1)!.text;
    expect(echo).toContain(`#u${victim}`);
    await inGroup(admin, 'phish', { from: BOT_ID, text: echo });
    expect(fakeTg.said(victim)).toBe('');
    fakeTg.blocked.add(tg);
    await inGroup(admin, 'again', { from: BOT_ID, text: question });
    expect(toGroup().at(-1)!.text).toContain('not delivered');
  });

  it('a long question that escaping stretches stays one message with its header', async () => {
    const tg = nextTg();
    await say(tg, `/support ${'<&'.repeat(1400)}`);
    expect(toGroup()).toHaveLength(1);
    expect(toGroup()[0]!.text.length).toBeLessThanOrEqual(4096);
    expect(toGroup()[0]!.text).toMatch(new RegExp(`^🆘 #u${tg} #en\\n`, 'u'));
    // Never cut inside an entity.
    expect(toGroup()[0]!.text).not.toMatch(/&(?!amp;|lt;|gt;)/u);
  });

  it('operator commands: admins only; /plan switches it and tells the person; /user and /sources', async () => {
    const tg = nextTg();
    await say(tg, '/start zenno');
    await say(tg, 'Op@Example.com');
    await say(tg, codeIn(mail.filter((m) => m.to === 'op@example.com').at(-1)));
    expect(await env.DB.prepare("SELECT source FROM users WHERE email = 'op@example.com'").first<string>('source')).toBe('zenno');
    const admin = 9003;
    await inGroup(admin, '/plan op@example.com api');
    expect(toGroup()).toEqual([]);
    expect(await env.DB.prepare("SELECT plan FROM users WHERE email = 'op@example.com'").first<string>('plan')).toBe('free');
    fakeTg.admins.add(`${GROUP}:${admin}`);
    // A command for another bot of the group is not ours.
    await inGroup(admin, '/plan@other_bot op@example.com api');
    expect(await env.DB.prepare("SELECT plan FROM users WHERE email = 'op@example.com'").first<string>('plan')).toBe('free');
    await inGroup(admin, '/plan@ClxCxBot Op@example.com api');
    expect(await env.DB.prepare("SELECT plan FROM users WHERE email = 'op@example.com'").first<string>('plan')).toBe('api');
    expect(last(tg)).toContain('Your plan is now <b>api</b>: up to 50 Cloudflare accounts');
    expect(toGroup().at(-1)!.text).toBe('op@example.com: plan api — told in Telegram');
    await inGroup(admin, '/plan op@example.com gold');
    expect(toGroup().at(-1)!.text).toContain('Use: /plan');
    await inGroup(admin, '/user op@example.com');
    expect(toGroup().at(-1)!.text).toContain('plan api');
    expect(toGroup().at(-1)!.text).toContain(`#u${tg} · source zenno`);
    await inGroup(admin, '/user nobody@example.com');
    expect(toGroup().at(-1)!.text).toContain('No account');
    await env.DB.prepare("INSERT INTO users (email, password_hash, created_at) VALUES ('site@example.com', 'x', ?)").bind(Date.now()).run();
    await inGroup(admin, '/sources');
    expect(toGroup().at(-1)!.text).toContain('zenno — 1');
    expect(toGroup().at(-1)!.text).toContain('— — 1');
    await inGroup(admin, '/help');
    expect(toGroup().at(-1)!.text).toContain('Operator commands');
  });

  it('a start parameter is kept only for an account the bot makes, and only if it is well-formed', async () => {
    await env.DB.prepare("INSERT INTO users (email, password_hash, created_at) VALUES ('old@example.com', 'x', 0)").run();
    const a = nextTg();
    await say(a, '/start forum');
    await say(a, 'old@example.com');
    await say(a, codeIn(mail.filter((m) => m.to === 'old@example.com').at(-1)));
    expect(await env.DB.prepare("SELECT source FROM users WHERE email = 'old@example.com'").first<string | null>('source')).toBeNull();
    const b = nextTg();
    await say(b, '/start bad.param!');
    await say(b, 'fresh@example.com');
    await say(b, codeIn(mail.filter((m) => m.to === 'fresh@example.com').at(-1)));
    expect(await env.DB.prepare("SELECT source FROM users WHERE email = 'fresh@example.com'").first<string | null>('source')).toBeNull();
  });

  it('/terms answers with the short terms, signed in or not; any other group is still ignored', async () => {
    const tg = nextTg();
    await say(tg, '/terms');
    expect(last(tg)).toContain('https://clx.cx/terms');
    const other = nextTg();
    expect((await say(other, '/support hi', { chat: 'group' })).status).toBe(200);
    expect(fakeTg.said(other)).toBe('');
    expect(toGroup()).toEqual([]);
  });
});

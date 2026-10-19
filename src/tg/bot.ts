// The Telegram bot's conversation (docs/spec.md §17, ADR 0030): commands and dialog steps. Every
// action goes through the /v1 handlers in process, as the `telegram` principal of the linked user
// (src/v1/auth.ts), with the Idempotency-Key `tg-<update_id>`: a redelivered update repeats the
// stored answer instead of acting twice.
import type { Context } from 'hono';
import { signBot } from '../auth/jwt';
import { overLimit } from '../auth/ratelimit';
import { unusableHash } from '../auth/password';
import { issueToken } from '../auth/signup';
import { deliverMail, reserveMail } from '../mail';
import { appUrl, localeOf, MAIL, type Locale } from '../mail-text';
import type { Env } from '../types';
import { deleteMessage, esc, sendMessage } from './api';
import { advance, advanceSpending, dialogOf, endDialog, endDialogIf, identityOf, issueCode, startDialog, stillHolds, tryCode, type Dialog, type Identity } from './state';
import { operatorMessage, supportChat, toSupport } from './support';
import { BOT, sparkline, type BotText } from './text';

type Ctx = Context['executionCtx'];
export type Fetcher = (request: Request, env: Env, ctx: Ctx) => Response | Promise<Response>;

export interface TgMessage {
  message_id: number;
  from?: { id: number; is_bot?: boolean; username?: string; first_name?: string; language_code?: string };
  chat: { id: number; type: string };
  text?: string;
  /** In the support group: the message an admin answers. */
  reply_to_message?: { from?: { id: number }; text?: string };
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/u;
/** A start parameter kept as the account's source: Telegram allows A–Z, a–z, 0–9, _ and - (§17). */
const SOURCE = /^[A-Za-z0-9_-]{1,32}$/u;
/** Mailed codes per Telegram user a day — checked before the address's own limit. */
const CODES_A_DAY = { max: 5, windowSec: 86_400 };
/** How many sites or links a list shows; the rest are in the app. */
const LIST_MAX = 20;

interface Turn {
  env: Env;
  exec: Ctx;
  fetcher: Fetcher;
  updateId: number;
  msg: TgMessage;
  tg: number;
  who: string;
  lang: Locale;
  t: BotText;
  me: (Identity & { email: string; locale: Locale; session_version: number }) | null;
  now: number;
}

const say = (turn: Turn, text: string) => sendMessage(turn.env, turn.msg.chat.id, text);

/** A /v1 call as the linked user: the answer's status and body. */
async function api(turn: Turn, method: string, path: string, body?: unknown): Promise<{ status: number; body: Record<string, any> }> {
  const me = turn.me!;
  const token = await signBot(turn.env.JWT_SECRET, me.user_id, { tg: turn.tg, linkedAt: me.linked_at }, turn.now, me.session_version);
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  // One action per update: the key is the update's, and the path tells the actions of one update apart.
  if (method !== 'GET') headers['idempotency-key'] = `tg-${turn.updateId}`;
  const res = await turn.fetcher(new Request(`${new URL(turn.env.HOOK_URL).origin}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), turn.env, turn.exec);
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
}

/** The API's own words for a refusal; a server failure is thrown, so Telegram delivers the update again. */
function refusal(turn: Turn, r: { status: number; body: Record<string, any> }): string {
  if (r.status >= 500) throw new Error(`api ${r.status}`);
  return turn.t.failed(esc(String(r.body.error?.message ?? r.status)));
}

export async function handleMessage(env: Env, exec: Ctx, fetcher: Fetcher, updateId: number, msg: TgMessage): Promise<void> {
  const from = msg.from;
  if (!from || from.is_bot) return;
  // The support group: its admins' replies and operator commands (support.ts).
  if (msg.chat.id === supportChat(env)) return typeof msg.text === 'string' ? operatorMessage(env, msg, Date.now()) : undefined;
  // Otherwise private chats only: answers carry snippets and codes, and a group would read them.
  if (msg.chat.type !== 'private') return;
  // A photo, a sticker, a file: nothing the bot asked for. It changes no question and spends no try.
  if (typeof msg.text !== 'string') return;
  const now = Date.now();
  const id = await identityOf(env, from.id);
  const user = id ? await env.DB.prepare('SELECT email, locale, session_version FROM users WHERE id = ?').bind(id.user_id).first<{ email: string; locale: Locale; session_version: number }>() : null;
  const me = id && user ? { ...id, ...user } : null;
  const lang = me ? localeOf(me.locale) : from.language_code === 'ru' ? 'ru' : 'en';
  const who = from.username ? `@${from.username}` : `${from.first_name ?? ''} (id ${from.id})`.trim();
  const turn: Turn = { env, exec, fetcher, updateId, msg, tg: from.id, who, lang, t: BOT[lang], me, now };
  // A username changed since the link: kept current for the e-mails and the app.
  if (me && (from.username ?? null) !== me.username) await env.DB.prepare('UPDATE tg_identities SET username = ? WHERE tg_user_id = ?').bind(from.username ?? null, from.id).run();

  const text = (msg.text ?? '').trim();
  if (text.startsWith('/')) {
    const [head = '', ...rest] = text.split(/\s+/u);
    const command = head.slice(1).replace(/@.*$/u, '').toLowerCase();
    // A command ends the dialog it interrupts — otherwise the next plain text would answer a stale
    // question (catchall.in's lesson). /help changes nothing.
    if (command !== 'help') await endDialog(env, from.id);
    return command_(turn, command, rest.join(' ').trim());
  }
  const d = await dialogOf(env, from.id, now);
  if (!d) return void (await say(turn, turn.t.idle));
  return step(turn, d, text);
}

async function command_(turn: Turn, command: string, arg: string): Promise<void> {
  const { t } = turn;
  if (command === 'help') return void (await say(turn, t.help));
  if (command === 'cancel') return void (await say(turn, t.cancelled));
  if (command === 'terms') return void (await say(turn, t.terms));
  // Support takes a question signed in or not: one who cannot sign in needs it most.
  if (command === 'support') {
    if (supportChat(turn.env) === null) return void (await say(turn, t.supportOff));
    return arg ? question(turn, arg) : ask(turn, 'support', {}, t.askSupport);
  }
  if (command === 'start') {
    if (turn.me) return void (await say(turn, t.help));
    // t.me/<bot>?start=<source>: where the person came from, kept if the bot makes the account.
    const source = SOURCE.test(arg) ? arg.toLowerCase() : null;
    await startDialog(turn.env, turn.tg, 'email', source ? { source } : {}, turn.now);
    return void (await say(turn, t.hello));
  }
  if (!turn.me) return void (await say(turn, command === 'lang' || Object.hasOwn(COMMANDS, command) ? t.needLink : t.unknownCommand));
  if (command === 'lang') return lang(turn, arg);
  if (command === 'unlink') return unlink(turn);
  const run = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined;
  if (!run) return void (await say(turn, t.unknownCommand));
  return run(turn, arg);
}

const COMMANDS: Record<string, (turn: Turn, arg: string) => Promise<void>> = {
  sites: listSites,
  links: listLinks,
  accounts: listAccounts,
  site: (turn, arg) => (arg ? siteHost(turn, arg) : ask(turn, 'site_host', {}, turn.t.askHost)),
  link: (turn, arg) => (arg ? linkUrl(turn, arg) : ask(turn, 'link_url', {}, turn.t.askUrl)),
  connect: connectStart,
  unlink,
};

/** A question to the support group, with who asks: the account if the Telegram is linked. The
 *  question ends (`end`) before it is sent, as the token's step does: a failure after the send
 *  must not bring the same message back to a live question and post it twice. */
async function question(turn: Turn, text: string, end?: () => Promise<unknown>): Promise<void> {
  const me = turn.me;
  const account = me ? await turn.env.DB.prepare('SELECT plan, source FROM users WHERE id = ?').bind(me.user_id).first<{ plan: string; source: string | null }>() : null;
  await end?.();
  const sent = await toSupport(turn.env, { tg: turn.tg, who: turn.who, lang: turn.lang, email: me?.email ?? null, plan: account?.plan ?? null, source: account?.source ?? null }, text);
  await say(turn, sent ? turn.t.supportSent : turn.t.supportFailed);
}

async function ask(turn: Turn, stepName: string, data: Record<string, unknown>, question: string): Promise<void> {
  await startDialog(turn.env, turn.tg, stepName, data, turn.now);
  await say(turn, question);
}

async function step(turn: Turn, d: Dialog, text: string): Promise<void> {
  const { t } = turn;
  switch (d.step) {
    case 'email':
      return emailStep(turn, d, text);
    case 'link_code':
      return linkCode(turn, d, text);
    case 'support':
      return question(turn, text, () => endDialogIf(turn.env, turn.tg, d.nonce));
  }
  if (!turn.me) return void (await say(turn, t.needLink));
  // An answer that acts ends its question after the action: a passing failure leaves the question,
  // and the redelivered answer repeats the same call (the same Idempotency-Key). A choice the
  // action asked next (a numbered list) is a new instance, and stays.
  const done = () => endDialogIf(turn.env, turn.tg, d.nonce);
  switch (d.step) {
    case 'site_host':
      await siteHost(turn, text);
      return void (await done());
    case 'link_url':
      await linkUrl(turn, text);
      return void (await done());
    case 'pick': {
      const n = Number(text);
      const ids = d.data.ids as string[];
      if (!Number.isInteger(n) || n < 1 || n > ids.length) return void (await say(turn, t.badPick));
      await picked(turn, d.data, ids[n - 1]!);
      return void (await done());
    }
    case 'connect_code':
      return connectCode(turn, d, text);
    case 'connect_account': {
      const account = text.toLowerCase();
      if (!/^[0-9a-f]{32}$/u.test(account)) return void (await say(turn, t.badAccountId));
      if (await advance(turn.env, turn.tg, d.nonce, 'connect_token', { ...d.data, account }, turn.now)) await say(turn, t.askToken);
      return;
    }
    case 'connect_token':
      return connectToken(turn, d, text);
  }
  await endDialog(turn.env, turn.tg);
  await say(turn, t.idle);
}

// ---- sign-in: an address, a mailed code, the link ----

async function emailStep(turn: Turn, d: Dialog, text: string): Promise<void> {
  const { env, t } = turn;
  const email = text.toLowerCase();
  const source = typeof d.data.source === 'string' ? d.data.source : null;
  if (!EMAIL.test(email) || new TextEncoder().encode(email).length > 254) return void (await say(turn, t.badEmail));
  // The Telegram user's own limit first: one who is over it cannot use up an address's.
  if (await overLimit(env, `tg:code:${turn.tg}`, CODES_A_DAY, turn.now)) return void (await say(turn, t.tooManyCodes));
  // Over the address's limit no e-mail goes, and the answer is the same: it tells nothing about the address.
  if (await reserveMail(env, email, turn.now)) {
    const code = await issueCode(env, turn.tg, 'link', 'link_code', { email, lang: turn.lang, source }, turn.now);
    const mail = MAIL[turn.lang].tgCode(code, 'link');
    await deliverMail(env, email, mail.subject, mail.text);
  } else await startDialog(env, turn.tg, 'link_code', { email, purpose: 'link', source }, turn.now);
  await say(turn, t.codeSent);
}

async function linkCode(turn: Turn, d: Dialog, text: string): Promise<void> {
  const { env, t } = turn;
  const r = await tryCode(env, turn.tg, d, 'link', text.replace(/\s+/gu, ''), turn.now);
  if (r === 'wrong') return void (await say(turn, t.wrongCode));
  if (r === 'over') {
    await endDialog(env, turn.tg);
    return void (await say(turn, t.codeOver));
  }
  const email = String(d.data.email);
  const lang = localeOf(d.data.lang);
  const db = env.DB;
  const code = [turn.tg, d.nonce, d.code_hash];
  // One transaction, each statement only while the code is unspent, the code spent last: a failure
  // leaves everything as it was, and the redelivered code does it all. The code proved the mailbox:
  // the account is found or made, its address confirmed. An account made here has no password (an
  // unusable hash); the reset request sets one for the site.
  const [made, linked, spent] = await db.batch([
    db
      .prepare(
        // The source only for an account made here (ON CONFLICT leaves an old one's as it was).
        `INSERT INTO users (email, password_hash, created_at, session_version, locale, email_confirmed_at, source) SELECT ?1, ?4, ?2, ?2, ?3, ?2, ?5 WHERE ${stillHolds} ON CONFLICT (email) DO UPDATE SET email_confirmed_at = coalesce(email_confirmed_at, ?2) RETURNING id, locale`,
      )
      .bind(email, turn.now, lang, unusableHash(), typeof d.data.source === 'string' ? d.data.source : null, ...code),
    db
      .prepare(`INSERT INTO tg_identities (tg_user_id, user_id, username, linked_at) SELECT ?, id, ?, ? FROM users WHERE email = ? AND ${stillHolds} ON CONFLICT DO NOTHING`)
      .bind(turn.tg, turn.msg.from?.username ?? null, turn.now, email, ...code),
    db.prepare('DELETE FROM tg_states WHERE tg_user_id = ? AND nonce = ? AND code_hash = ?').bind(...code),
  ]);
  if (!spent!.meta.changes) return void (await say(turn, t.codeOver));
  if (!linked!.meta.changes) return void (await say(turn, t.linkedElsewhere));
  // From the same transaction: nothing after the commit can fail before the answer but the notice.
  const user = made!.results[0] as { id: number; locale: Locale };
  const locale = localeOf(user.locale);
  // The owner hears of every link, with a way to undo it from the mailbox — best effort: the link
  // is made, and a failure here must not make Telegram deliver the spent code again.
  try {
    const { token, settle } = await issueToken(db, user.id, 'tg_unlink', turn.now);
    const mail = MAIL[locale].tgLinked(turn.who, appUrl(env, locale, `#/telegram-unlink?t=${token}`));
    // The notice takes no place of the address's limits: the code just used one.
    await settle(await deliverMail(env, email, mail.subject, mail.text));
  } catch (e) {
    console.error('telegram link notice', user.id, e instanceof Error ? e.message : e);
  }
  // From here the bot speaks the account's language.
  await say(turn, BOT[locale].linked(esc(email)) + BOT[locale].help);
}

async function unlink(turn: Turn): Promise<void> {
  const { env } = turn;
  await env.DB.prepare('DELETE FROM tg_identities WHERE tg_user_id = ?').bind(turn.tg).run();
  const mail = MAIL[localeOf(turn.me!.locale)].tgUnlinked(turn.who);
  await deliverMail(env, turn.me!.email, mail.subject, mail.text);
  await say(turn, turn.t.unlinked);
}

async function lang(turn: Turn, arg: string): Promise<void> {
  if (arg !== 'ru' && arg !== 'en') return void (await say(turn, turn.t.langUsage));
  const r = await api(turn, 'PATCH', '/v1/me', { locale: arg });
  await say(turn, r.status === 200 ? BOT[arg].lang : refusal(turn, r));
}

// ---- the totals ----

const num = (turn: Turn, n: number) => n.toLocaleString(turn.lang === 'ru' ? 'ru-RU' : 'en-US');
const stateOf = (turn: Turn, s: string) => turn.t.states[s] ?? s;

async function listSites(turn: Turn): Promise<void> {
  const { t } = turn;
  const r = await api(turn, 'GET', '/v1/sites');
  if (r.status !== 200) return void (await say(turn, refusal(turn, r)));
  const sites = r.body.sites as { id: string; host: string; state: string; views_7d: number[]; views_today: number; counted: boolean }[];
  if (!sites.length) return void (await say(turn, t.noSites));
  const lines = sites.slice(0, LIST_MAX).map((s) => {
    const week = s.views_7d.reduce((n, v) => n + v, 0);
    const state = s.state === 'active' ? '' : `(${stateOf(turn, s.state)})`;
    if (!s.counted) return `${esc(s.host)} ${state}\n${t.notCounted}`;
    return t.site(esc(s.host), state, sparkline(s.views_7d), num(turn, week), num(turn, s.views_today));
  });
  await say(turn, [t.sitesHead, ...lines, sites.length > LIST_MAX ? t.more(sites.length - LIST_MAX) : ''].filter(Boolean).join('\n\n'));
}

async function listLinks(turn: Turn): Promise<void> {
  const { t } = turn;
  const r = await api(turn, 'GET', '/v1/links');
  if (r.status !== 200) return void (await say(turn, refusal(turn, r)));
  const links = r.body.links as { code: string; short_url: string | null; url: string; clicks_7d?: number }[];
  if (!links.length) return void (await say(turn, t.noLinks));
  const lines = links.slice(0, LIST_MAX).map((l) => t.link(esc(l.short_url ?? l.code), esc(l.url), num(turn, l.clicks_7d ?? 0)));
  await say(turn, [t.linksHead, ...lines, links.length > LIST_MAX ? t.more(links.length - LIST_MAX) : ''].filter(Boolean).join('\n\n'));
}

async function listAccounts(turn: Turn): Promise<void> {
  const { t } = turn;
  const r = await api(turn, 'GET', '/v1/accounts');
  if (r.status !== 200) return void (await say(turn, refusal(turn, r)));
  const accounts = r.body.accounts as { name: string | null; cf_account_id: string; state: string }[];
  if (!accounts.length) return void (await say(turn, t.noAccounts));
  await say(turn, [t.accountsHead, ...accounts.map((a) => t.account(esc(a.name ?? a.cf_account_id), stateOf(turn, a.state)))].join('\n'));
}

// ---- adding a site, a link ----

type Pick = { kind: 'site'; host: string } | { kind: 'link'; url: string } | { kind: 'linkhost' };

/** Several to choose from: a numbered list, the choice in the next message. */
async function choose(turn: Turn, question: string, items: { id: string; label: string }[], data: Pick): Promise<void> {
  await startDialog(turn.env, turn.tg, 'pick', { ...data, ids: items.map((i) => i.id) }, turn.now);
  await say(turn, [question, ...items.map((i, n) => `${n + 1}. ${esc(i.label)}`)].join('\n'));
}

async function picked(turn: Turn, data: Record<string, unknown>, id: string): Promise<void> {
  if (data.kind === 'site') return addSite(turn, String(data.host), id);
  if (data.kind === 'link') return addLink(turn, String(data.url), id);
  if (data.kind === 'linkhost') return addLinkHost(turn, id);
}

const usable = (a: { state: string }) => a.state === 'ready' || a.state === 'no_connection';

async function siteHost(turn: Turn, host: string): Promise<void> {
  const r = await api(turn, 'GET', '/v1/accounts');
  if (r.status !== 200) return void (await say(turn, refusal(turn, r)));
  const accounts = (r.body.accounts as { id: string; name: string | null; cf_account_id: string; state: string }[]).filter(usable);
  if (!accounts.length) return void (await say(turn, turn.t.noUsableAccount));
  if (accounts.length === 1) return addSite(turn, host, accounts[0]!.id);
  await choose(turn, turn.t.pickAccount, accounts.map((a) => ({ id: a.id, label: a.name ?? a.cf_account_id })), { kind: 'site', host });
}

async function addSite(turn: Turn, host: string, accountId: string): Promise<void> {
  const { t } = turn;
  const r = await api(turn, 'POST', '/v1/sites', { account_id: accountId, host: host.trim().toLowerCase() });
  if (r.status !== 202) return void (await say(turn, refusal(turn, r)));
  const site = r.body.site as { host: string; snippet: { inline: string; script_tag: string } | null };
  await say(turn, t.siteAdded(esc(site.host)));
  if (site.snippet) {
    await say(turn, `${t.snippetInline}\n<pre>${esc(site.snippet.inline)}</pre>`);
    await say(turn, `${t.snippetFile}\n<pre>${esc(site.snippet.script_tag)}</pre>`);
  }
}

async function linkUrl(turn: Turn, url: string): Promise<void> {
  const { t } = turn;
  const r = await api(turn, 'GET', '/v1/link-hosts');
  if (r.status !== 200) return void (await say(turn, refusal(turn, r)));
  const hosts = r.body.link_hosts as { id: string; host: string; state: string }[];
  const active = hosts.filter((h) => h.state === 'active');
  if (active.length === 1) return addLink(turn, url, active[0]!.id);
  if (active.length > 1) return choose(turn, t.pickHost, active.map((h) => ({ id: h.id, label: h.host })), { kind: 'link', url });
  if (hosts.length) return void (await say(turn, t.hostNotReady(esc(hosts[0]!.host))));
  // No link host yet: one is made on a working site.
  const s = await api(turn, 'GET', '/v1/sites');
  if (s.status !== 200) return void (await say(turn, refusal(turn, s)));
  const sites = (s.body.sites as { id: string; host: string; state: string }[]).filter((x) => x.state === 'active');
  if (!sites.length) return void (await say(turn, t.noSiteForHost));
  await choose(turn, t.pickSiteForHost, sites.map((x) => ({ id: x.id, label: x.host })), { kind: 'linkhost' });
}

async function addLink(turn: Turn, url: string, hostId: string): Promise<void> {
  const r = await api(turn, 'POST', '/v1/links', { link_host_id: hostId, url: url.trim() });
  if (r.status !== 201) return void (await say(turn, refusal(turn, r)));
  const link = r.body.link as { short_url: string | null; code: string };
  await say(turn, turn.t.linkAdded(esc(link.short_url ?? link.code)));
}

async function addLinkHost(turn: Turn, siteId: string): Promise<void> {
  const r = await api(turn, 'POST', '/v1/link-hosts', { site_id: siteId });
  if (r.status >= 300) return void (await say(turn, refusal(turn, r)));
  await say(turn, turn.t.hostMaking(esc(String(r.body.link_host?.host ?? ''))));
}

// ---- connecting a Cloudflare account: a code from the mailbox, the account ID, the token ----

async function connectStart(turn: Turn): Promise<void> {
  const { env, t } = turn;
  if (await overLimit(env, `tg:code:${turn.tg}`, CODES_A_DAY, turn.now)) return void (await say(turn, t.tooManyCodes));
  const me = turn.me!;
  // The second channel: whoever holds this Telegram must also read the account's mail.
  const code = await issueCode(env, turn.tg, 'connect', 'connect_code', { user: me.user_id }, turn.now);
  const mail = MAIL[turn.lang].tgCode(code, 'connect');
  // A code asked for by the account itself: only the daily cap of the address applies.
  if (await reserveMail(env, me.email, turn.now, 0)) await deliverMail(env, me.email, mail.subject, mail.text);
  await say(turn, t.connectCodeSent);
}

async function connectCode(turn: Turn, d: Dialog, text: string): Promise<void> {
  const { env, t } = turn;
  // Bound to this user too: a link that changed hands since the code was mailed does not inherit it.
  if (d.data.user !== turn.me!.user_id) {
    await endDialog(env, turn.tg);
    return void (await say(turn, t.codeOver));
  }
  const r = await tryCode(env, turn.tg, d, 'connect', text.replace(/\s+/gu, ''), turn.now);
  if (r === 'wrong') return void (await say(turn, t.wrongCode));
  if (r === 'over') {
    await endDialog(env, turn.tg);
    return void (await say(turn, t.codeOver));
  }
  // The code is spent by the very statement that moves the dialog on.
  await say(turn, (await advanceSpending(env, turn.tg, d, 'connect_account', turn.now)) ? t.askAccountId : t.codeOver);
}

async function connectToken(turn: Turn, d: Dialog, text: string): Promise<void> {
  const { env, t } = turn;
  // The question ends first: if that fails, the 500 brings this same message back to this same
  // step. Once it has ended, the next message is never taken for a token.
  await endDialog(env, turn.tg);
  // The token leaves the chat, whatever happens next.
  await deleteMessage(env, turn.msg.chat.id, turn.msg.message_id);
  const account = String(d.data.account);
  // The one step whose failure is final, whatever it is: the bot keeps no token to try again with,
  // so a redelivery could not repeat the call — it says what to do with the token instead.
  const r = await api(turn, 'POST', '/v1/accounts', { cf_account_id: account, bootstrap_token: text }).catch((e: unknown) => {
    console.error('telegram connect', e instanceof Error ? e.message : e);
    return { status: 0, body: {} as Record<string, any> };
  });
  if (r.status !== 202) {
    // The connection did not finish: clx may not have reached the token's deletion.
    const why = t.failed(esc(String(r.body.error?.message ?? (r.status || 'no answer'))));
    return void (await say(turn, `${why}\n\n${t.tokenMayLive(account)}`));
  }
  const a = r.body.account as { name: string | null; cf_account_id: string; state: string; error: { warnings?: string[] } | null };
  const lost = a.error?.warnings?.includes('bootstrap_not_deleted');
  await say(turn, `${t.connected(esc(a.name ?? a.cf_account_id), stateOf(turn, a.state))}\n\n${lost ? t.tokenMayLive(account) : t.tokenDeleted}`);
}

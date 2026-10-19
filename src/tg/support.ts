// The support group (docs/spec.md §17, ADR 0031): /support lands there with who wrote it; an admin
// of the group answers by replying to it, and runs the operator commands there. Anyone else in the
// group, and every other group, gets silence.
import { localeOf, type Locale } from '../mail-text';
import { planOf } from '../limits';
import type { Env } from '../types';
import { botId, botName, esc, isChatAdmin, MESSAGE_MAX, sendMessage } from './api';
import type { TgMessage } from './bot';
import { BOT } from './text';

/** How much of a question goes to the group: one message with its header. */
export const QUESTION_MAX = 3000;

export const supportChat = (env: Env): number | null => (env.TELEGRAM_SUPPORT_CHAT && /^-?\d+$/u.test(env.TELEGRAM_SUPPORT_CHAT) ? Number(env.TELEGRAM_SUPPORT_CHAT) : null);

/** A question to the group. Its hashtags carry the way back: `#u<Telegram id>` and the language,
 *  read again from the message an admin replies to. Whether Telegram took it. */
export async function toSupport(env: Env, from: { tg: number; who: string; lang: Locale; email: string | null; plan: string | null; source: string | null }, text: string): Promise<boolean> {
  const chat = supportChat(env);
  if (chat === null) return false;
  const account = from.email ? `${esc(from.email)} · plan ${esc(from.plan ?? 'free')}${from.source ? ` · source ${esc(from.source)}` : ''}` : 'not signed in';
  const head = `🆘 #u${from.tg} #${from.lang}\n${esc(from.who)} · ${account}\n\n`;
  // One message, so the reply always lands on the header: cut by the escaped length, which `&` and
  // `<` stretch, and never inside an entity.
  let body = text.length > QUESTION_MAX ? `${text.slice(0, QUESTION_MAX)}…` : text;
  while (head.length + esc(body).length > MESSAGE_MAX) body = `${body.slice(0, Math.max(0, body.length - 200))}…`;
  return sendMessage(env, chat, head + esc(body));
}

/** The header of a question, the only message a reply is routed by: its first line, exactly. */
const HEADER = /^🆘 #u(\d+) #(ru|en)\n/u;

const HELP = [
  '<b>Operator commands</b> (admins of this group only)',
  'Reply to a 🆘 message — the reply goes to the person.',
  '/user email — the account: plan, sites, Telegram, source',
  '/plan email free|api — switch the plan; the person is told in Telegram',
  '/sources [days] — sign-ups by start parameter, 30 days by default',
].join('\n');

/** A message in the support group. */
export async function operatorMessage(env: Env, msg: TgMessage, now: number): Promise<void> {
  const from = msg.from!;
  const text = (msg.text ?? '').trim();
  const reply = msg.reply_to_message;
  const toBot = reply?.from?.id === botId(env);
  const [head = '', addressee] = text.startsWith('/') ? text.split(/\s+/u)[0]!.slice(1).split('@') : [];
  const command = head.toLowerCase();
  // Talk among the admins is theirs: only a reply to the bot or a command is the bot's business.
  if (!toBot && !command) return;
  // A command for another bot of the group is not ours.
  if (addressee !== undefined && addressee.toLowerCase() !== (await botName(env))) return;
  if (!(await isChatAdmin(env, msg.chat.id, from.id))) return;
  const say = (t: string) => sendMessage(env, msg.chat.id, t);
  if (!command && toBot) {
    // Only a question's own header routes a reply: a tag echoed in another answer of the bot
    // (/user #u123) must not make it write to anyone.
    const tag = reply?.text?.match(HEADER);
    if (!tag) return;
    const lang = localeOf(tag[2]);
    const ok = await sendMessage(env, Number(tag[1]), BOT[lang].supportReply(esc(text)));
    return void (await say(ok ? `✓ sent to #u${tag[1]}` : `✗ not delivered to #u${tag[1]} (the bot is blocked, or Telegram refused)`));
  }
  const args = text.split(/\s+/u).slice(1);
  if (command === 'user') return void (await say(await userCard(env, args[0] ?? '')));
  if (command === 'plan') return void (await say(await setPlan(env, args[0] ?? '', args[1] ?? '')));
  if (command === 'sources') return void (await say(await sources(env, args[0], now)));
  await say(HELP);
}

const emailOf = (s: string) => s.trim().toLowerCase();

async function userCard(env: Env, raw: string): Promise<string> {
  const u = await env.DB.prepare(
    `SELECT u.id, u.email, u.plan, u.created_at, u.email_confirmed_at, u.last_login_at, u.source, t.tg_user_id, t.username,
       (SELECT count(*) FROM sites s WHERE s.user_id = u.id AND s.state <> 'deleted') AS sites,
       (SELECT count(*) FROM edge_accounts a WHERE a.user_id = u.id) AS accounts
     FROM users u LEFT JOIN tg_identities t ON t.user_id = u.id WHERE u.email = ?`,
  )
    .bind(emailOf(raw))
    .first<{ email: string; plan: string; created_at: number; email_confirmed_at: number | null; last_login_at: number | null; source: string | null; tg_user_id: number | null; username: string | null; sites: number; accounts: number }>();
  if (!u) return `No account ${esc(raw)}. Use: /user email`;
  const day = (ms: number | null) => (ms ? new Date(ms).toISOString().slice(0, 10) : '—');
  return [
    `<b>${esc(u.email)}</b> · plan ${esc(u.plan)}`,
    `created ${day(u.created_at)} · confirmed ${day(u.email_confirmed_at)} · last sign-in ${day(u.last_login_at)}`,
    `Cloudflare accounts ${u.accounts} · sites ${u.sites}`,
    `Telegram ${u.tg_user_id ? `${u.username ? `@${esc(u.username)} ` : ''}#u${u.tg_user_id}` : '—'} · source ${esc(u.source ?? '—')}`,
  ].join('\n');
}

async function setPlan(env: Env, raw: string, plan: string): Promise<string> {
  if (plan !== 'free' && plan !== 'api') return 'Use: /plan email free|api';
  const u = await env.DB.prepare('UPDATE users SET plan = ? WHERE email = ? RETURNING id, locale').bind(plan, emailOf(raw)).first<{ id: number; locale: string }>();
  if (!u) return `No account ${esc(raw)}.`;
  const tg = await env.DB.prepare('SELECT tg_user_id FROM tg_identities WHERE user_id = ?').bind(u.id).first<number>('tg_user_id');
  const told = tg ? await sendMessage(env, tg, BOT[localeOf(u.locale)].planChanged(planOf(plan))) : false;
  return `${esc(emailOf(raw))}: plan ${plan}${tg ? (told ? ' — told in Telegram' : ' — the Telegram message did not go') : ' — no Telegram linked'}`;
}

async function sources(env: Env, rawDays: string | undefined, now: number): Promise<string> {
  const days = Math.min(Math.max(Number(rawDays) || 30, 1), 400);
  const { results } = await env.DB.prepare("SELECT coalesce(source, '—') AS source, count(*) AS n FROM users WHERE created_at > ? GROUP BY 1 ORDER BY n DESC LIMIT 50")
    .bind(now - days * 86_400_000)
    .all<{ source: string; n: number }>();
  if (!results.length) return `No sign-ups in ${days} days.`;
  return [`<b>Sign-ups in ${days} days</b> (— is the site or the bot without a parameter)`, ...results.map((r) => `${esc(r.source)} — ${r.n}`)].join('\n');
}

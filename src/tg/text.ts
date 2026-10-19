// The bot's words (docs/spec.md §17), one object per language with the same shape: a text missing
// in one language fails `tsc`. HTML: what comes from outside goes through `esc` at the call site.
import { LIMITS } from '../limits';
import type { Locale } from '../mail-text';

const API = LIMITS.api;

const CF_TOKENS = 'https://dash.cloudflare.com/?to=/:account/api-tokens';

export interface BotText {
  help: string;
  hello: string;
  askEmail: string;
  badEmail: string;
  codeSent: string;
  tooManyCodes: string;
  wrongCode: string;
  codeOver: string;
  linked(email: string): string;
  linkedElsewhere: string;
  idle: string;
  unknownCommand: string;
  cancelled: string;
  needLink: string;
  unlinked: string;
  lang: string;
  langUsage: string;
  failed(message: string): string;
  // the totals
  noSites: string;
  sitesHead: string;
  site(host: string, state: string, spark: string, week: string, today: string): string;
  notCounted: string;
  more(n: number): string;
  noLinks: string;
  linksHead: string;
  link(short: string, url: string, week: string): string;
  noAccounts: string;
  accountsHead: string;
  account(name: string, state: string): string;
  states: Record<string, string>;
  // adding
  askHost: string;
  noUsableAccount: string;
  pickAccount: string;
  badPick: string;
  siteAdded(host: string): string;
  snippetInline: string;
  snippetFile: string;
  askUrl: string;
  noSiteForHost: string;
  pickSiteForHost: string;
  hostMaking(host: string): string;
  hostNotReady(host: string): string;
  pickHost: string;
  linkAdded(short: string): string;
  // connecting
  connectCodeSent: string;
  askAccountId: string;
  badAccountId: string;
  askToken: string;
  connected(name: string, state: string): string;
  tokenDeleted: string;
  tokenMayLive(account: string): string;
  // support and the terms
  terms: string;
  askSupport: string;
  supportSent: string;
  supportOff: string;
  supportFailed: string;
  supportReply(text: string): string;
  planChanged(plan: string): string;
}

const en: BotText = {
  help:
    'Commands:\n/sites — sites with views of 7 days and today\n/links — short links with clicks of 7 days\n/accounts — Cloudflare accounts\n/site <code>host</code> — add a site, get its snippet\n/link <code>url</code> — make a short link\n/connect — connect a Cloudflare account\n/lang ru|en — the language\n/unlink — unlink this Telegram from the account\n/cancel — stop the current question\n/support — write to support (ask for the api plan here too)\n/terms — the terms and privacy\n\nThe rest — deleting, keys, the password — is in the app at clx.cx.',
  hello: 'clx: a visit counter and short links in your own Cloudflare account. Send your e-mail address — I will send a code to it.',
  askEmail: 'Send your e-mail address: I will send a code to it. A new address gets a new account.',
  badEmail: 'That does not look like an e-mail address. Send it once more, or /cancel.',
  codeSent: 'If the address can receive mail, a six-digit code is on its way (it works 15 minutes). Send it here.',
  tooManyCodes: 'Too many codes for this Telegram today. Try again tomorrow.',
  wrongCode: 'The code is wrong. Try once more.',
  codeOver: 'This code no longer works. Start again: /start',
  linked: (email) => `Done: this Telegram is linked to <b>${email}</b>.\n\n`,
  linkedElsewhere: 'This account is already linked to another Telegram. Unlink it in the app (Account) or with /unlink from that Telegram, then try again.',
  idle: 'I am waiting for a command — /help lists them. If this was an answer to my question, the question expired; ask again.',
  unknownCommand: 'No such command. /help lists them.',
  cancelled: 'Stopped.',
  needLink: 'Sign in first: /start',
  unlinked: 'This Telegram is unlinked from the account. /start links it again.',
  lang: 'I will speak English now.',
  langUsage: 'Use: /lang ru or /lang en',
  failed: (message) => `Did not work: ${message}`,
  noSites: 'No sites yet. Add one: /site example.com',
  sitesHead: '<b>Sites</b> — views in 7 days · today',
  site: (host, state, spark, week, today) => `${host} ${state}\n<code>${spark}</code> ${week} · ${today}`,
  notCounted: 'nothing counted yet',
  more: (n) => `…and ${n} more in the app.`,
  noLinks: 'No short links yet. Make one: /link https://example.com/page',
  linksHead: '<b>Short links</b> — clicks in 7 days',
  link: (short, url, week) => `${short} → ${url}\n${week}`,
  noAccounts: 'No Cloudflare account is connected. /connect',
  accountsHead: '<b>Cloudflare accounts</b>',
  account: (name, state) => `${name} — ${state}`,
  states: {
    pending: 'connecting',
    connected: 'installing the worker',
    ready: 'works',
    no_connection: 'no word from the worker',
    permission_error: 'the token lacks rights',
    revoked: 'the token no longer works',
    bootstrap_lost: 'the connection broke off',
    resource_drift: 'the worker was changed in Cloudflare',
    route_pending: 'making the route',
    active: 'works',
    route_conflict: 'the path is taken by another worker',
  },
  askHost: 'Which host? Send it like example.com or blog.example.com.',
  noUsableAccount: 'No account has the worker installed yet. /connect one first, or see /accounts.',
  pickAccount: 'Which Cloudflare account holds it? Send the number:',
  badPick: 'Send one of the numbers, or /cancel.',
  siteAdded: (host) => `Site <b>${host}</b> added. Put one of the two snippets into the template of every page — the counter answers on your own domain.`,
  snippetInline: 'An inline script:',
  snippetFile: 'Or a file, if the site has a CSP without inline scripts:',
  askUrl: 'Which address should the short link lead to? Send it like https://example.com/page.',
  noSiteForHost: 'Short links live on a link host of one of your sites, and there is no active site yet. Add a site first: /site',
  pickSiteForHost: 'There is no link host yet. On which site should clx make one? Send the number:',
  hostMaking: (host) => `The link host <b>${host}</b> is being made — usually a minute or two. Then send /link again.`,
  hostNotReady: (host) => `The link host <b>${host}</b> is not ready yet. Try /link again in a minute.`,
  pickHost: 'On which link host? Send the number:',
  linkAdded: (short) => `The short link: ${short}`,
  connectCodeSent: 'Connecting a Cloudflare account needs a code from your e-mail first: it is on its way to the account\'s address (15 minutes). Send it here.',
  askAccountId: `Now the Cloudflare account ID: 32 characters, it is in the dashboard's address (dash.cloudflare.com/<b>&lt;ID&gt;</b>/…). Send it here.`,
  badAccountId: 'An account ID is 32 characters of 0–9 and a–f. Send it once more, or /cancel.',
  askToken:
    `Last: a bootstrap token. Create it at ${CF_TOKENS} → Create Token → Custom token:\n1. Name: <code>clx bootstrap</code>\n2. Permissions: <code>Account API Tokens</code> — Edit, <code>Account Settings</code> — Read\n3. TTL: until tomorrow\n\nThen send it here. <b>The message stays in this chat's history</b>: I delete it at once, and clx deletes the token in Cloudflare as soon as it has made its own; if that does not work out, I will tell you to revoke it by hand.`,
  connected: (name, state) => `Connected: <b>${name}</b> — ${state}. The worker installs in the background; /accounts shows how it goes.`,
  tokenDeleted: 'The bootstrap token is deleted in Cloudflare.',
  tokenMayLive: (account) => `<b>The bootstrap token may still be valid.</b> Revoke it by hand: https://dash.cloudflare.com/${account}/api-tokens`,
  terms:
    'In short: clx is free; the counter and the links run in your own Cloudflare account, on its quotas; the counter sets no cookies and keeps no IP addresses; clx.cx keeps only the totals.\n\nThe terms: https://clx.cx/terms\nPrivacy: https://clx.cx/privacy',
  askSupport: 'Write your question in one message: what you did and what went wrong. For the api plan, say how many sites and Cloudflare accounts you need. /cancel to stop.',
  supportSent: 'Sent to support. The answer comes here, in this chat.',
  supportOff: 'Support in the bot is not set up yet. Try again later.',
  supportFailed: 'The question did not reach support. Try /support again in a few minutes.',
  supportReply: (text) => `<b>Support:</b>\n${text}`,
  planChanged: (plan) => (plan === 'api' ? `Your plan is now <b>api</b>: up to ${API.cfAccounts} Cloudflare accounts, ${API.sites} sites and ${API.apiKeys} API keys.` : 'Your plan is now <b>free</b>.'),
};

const ru: BotText = {
  help:
    'Команды:\n/sites — сайты: просмотры за 7 дней и сегодня\n/links — короткие ссылки: клики за 7 дней\n/accounts — аккаунты Cloudflare\n/site <code>хост</code> — добавить сайт и получить сниппет\n/link <code>адрес</code> — сделать короткую ссылку\n/connect — подключить аккаунт Cloudflare\n/lang ru|en — язык\n/unlink — отвязать этот Telegram от аккаунта\n/cancel — прервать текущий вопрос\n/support — написать в поддержку (план api просят тоже здесь)\n/terms — условия и конфиденциальность\n\nОстальное — удаление, ключи, пароль — в кабинете на clx.cx.',
  hello: 'clx: счётчик посещений и короткие ссылки в вашем собственном аккаунте Cloudflare. Пришлите адрес почты — я отправлю на него код.',
  askEmail: 'Пришлите адрес почты: я отправлю на него код. Для нового адреса заведу новый аккаунт.',
  badEmail: 'Это не похоже на адрес почты. Пришлите ещё раз или /cancel.',
  codeSent: 'Если на адрес доходит почта, код из шести цифр уже в пути (действует 15 минут). Пришлите его сюда.',
  tooManyCodes: 'Для этого Telegram сегодня слишком много кодов. Попробуйте завтра.',
  wrongCode: 'Код неверный. Попробуйте ещё раз.',
  codeOver: 'Этот код больше не действует. Начните заново: /start',
  linked: (email) => `Готово: этот Telegram привязан к <b>${email}</b>.\n\n`,
  linkedElsewhere: 'Этот аккаунт уже привязан к другому Telegram. Отвяжите его в кабинете (Учётка) или командой /unlink из того Telegram, потом повторите.',
  idle: 'Жду команду — список в /help. Если это был ответ на мой вопрос, он истёк; спросите заново.',
  unknownCommand: 'Такой команды нет. Список — /help.',
  cancelled: 'Прервал.',
  needLink: 'Сначала войдите: /start',
  unlinked: 'Этот Telegram отвязан от аккаунта. /start привяжет снова.',
  lang: 'Теперь говорю по-русски.',
  langUsage: 'Так: /lang ru или /lang en',
  failed: (message) => `Не вышло: ${message}`,
  noSites: 'Сайтов пока нет. Добавьте: /site example.com',
  sitesHead: '<b>Сайты</b> — просмотры за 7 дней · сегодня',
  site: (host, state, spark, week, today) => `${host} ${state}\n<code>${spark}</code> ${week} · ${today}`,
  notCounted: 'ещё не считал',
  more: (n) => `…и ещё ${n} в кабинете.`,
  noLinks: 'Коротких ссылок пока нет. Сделайте: /link https://example.com/page',
  linksHead: '<b>Короткие ссылки</b> — клики за 7 дней',
  link: (short, url, week) => `${short} → ${url}\n${week}`,
  noAccounts: 'Аккаунт Cloudflare не подключён. /connect',
  accountsHead: '<b>Аккаунты Cloudflare</b>',
  account: (name, state) => `${name} — ${state}`,
  states: {
    pending: 'подключается',
    connected: 'ставится воркер',
    ready: 'работает',
    no_connection: 'нет связи с воркером',
    permission_error: 'у токена не хватает прав',
    revoked: 'токен больше не работает',
    bootstrap_lost: 'подключение оборвалось',
    resource_drift: 'воркер изменён в Cloudflare',
    route_pending: 'маршрут создаётся',
    active: 'работает',
    route_conflict: 'путь занят другим воркером',
  },
  askHost: 'Какой хост? Пришлите так: example.com или blog.example.com.',
  noUsableAccount: 'Ни в одном аккаунте воркер ещё не установлен. Сначала /connect, состояние — /accounts.',
  pickAccount: 'В каком аккаунте Cloudflare этот домен? Пришлите номер:',
  badPick: 'Пришлите один из номеров или /cancel.',
  siteAdded: (host) => `Сайт <b>${host}</b> добавлен. Вставьте один из двух сниппетов в шаблон всех страниц — счётчик отвечает на вашем же домене.`,
  snippetInline: 'Встроенный скрипт:',
  snippetFile: 'Или файл, если на сайте CSP без inline-скриптов:',
  askUrl: 'Куда вести короткую ссылку? Пришлите адрес так: https://example.com/page.',
  noSiteForHost: 'Короткие ссылки живут на хосте ссылок одного из ваших сайтов, а работающего сайта пока нет. Сначала добавьте сайт: /site',
  pickSiteForHost: 'Хоста ссылок пока нет. На каком сайте его сделать? Пришлите номер:',
  hostMaking: (host) => `Хост ссылок <b>${host}</b> создаётся — обычно минуту-две. Потом пришлите /link ещё раз.`,
  hostNotReady: (host) => `Хост ссылок <b>${host}</b> ещё не готов. Повторите /link через минуту.`,
  pickHost: 'На каком хосте ссылок? Пришлите номер:',
  linkAdded: (short) => `Короткая ссылка: ${short}`,
  connectCodeSent: 'Для подключения аккаунта Cloudflare сначала нужен код из почты: он ушёл на адрес аккаунта (действует 15 минут). Пришлите его сюда.',
  askAccountId: `Теперь ID аккаунта Cloudflare: 32 символа, он в адресе панели (dash.cloudflare.com/<b>&lt;ID&gt;</b>/…). Пришлите его сюда.`,
  badAccountId: 'ID аккаунта — 32 символа из 0–9 и a–f. Пришлите ещё раз или /cancel.',
  askToken:
    `Последнее — bootstrap-токен. Создайте его на ${CF_TOKENS} → Create Token → Custom token:\n1. Имя: <code>clx bootstrap</code>\n2. Права: <code>Account API Tokens</code> — Edit, <code>Account Settings</code> — Read\n3. Срок: до завтра\n\nИ пришлите его сюда. <b>Сообщение останется в истории этого чата</b>: я сразу его удалю, а clx удалит токен в Cloudflare, как только выпустит свой; если это не получится, я скажу отозвать его вручную.`,
  connected: (name, state) => `Подключён: <b>${name}</b> — ${state}. Воркер ставится в фоне; как идёт — /accounts.`,
  tokenDeleted: 'Bootstrap-токен удалён в Cloudflare.',
  tokenMayLive: (account) => `<b>Bootstrap-токен, возможно, ещё действует.</b> Отзовите его вручную: https://dash.cloudflare.com/${account}/api-tokens`,
  terms:
    'Коротко: clx бесплатный; счётчик и ссылки работают в вашем собственном аккаунте Cloudflare, в его квотах; счётчик не ставит кук и не хранит IP-адресов; на clx.cx хранятся только итоги.\n\nУсловия: https://ru.clx.cx/terms\nКонфиденциальность: https://ru.clx.cx/privacy',
  askSupport: 'Напишите вопрос одним сообщением: что делали и что пошло не так. Для плана api — сколько нужно сайтов и аккаунтов Cloudflare. Прервать — /cancel.',
  supportSent: 'Отправил в поддержку. Ответ придёт сюда, в этот чат.',
  supportOff: 'Поддержка в боте ещё не настроена. Попробуйте позже.',
  supportFailed: 'Вопрос не дошёл до поддержки. Повторите /support через несколько минут.',
  supportReply: (text) => `<b>Поддержка:</b>\n${text}`,
  planChanged: (plan) => (plan === 'api' ? `Ваш план теперь <b>api</b>: до ${API.cfAccounts} аккаунтов Cloudflare, ${API.sites} сайтов и ${API.apiKeys} ключей API.` : 'Ваш план теперь <b>free</b>.'),
};

export const BOT: Record<Locale, BotText> = { en, ru };

/** A week as a line of blocks, one a day, scaled to its own peak. */
export function sparkline(values: number[]): string {
  const bars = '▁▂▃▄▅▆▇█';
  const max = Math.max(...values, 0);
  return values.map((v) => bars[max ? Math.round((v / max) * (bars.length - 1)) : 0]).join('');
}

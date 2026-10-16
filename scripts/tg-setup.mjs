#!/usr/bin/env node
// node scripts/tg-setup.mjs [setup | describe | info | delete]
//
// The Telegram bot (docs/spec.md §17). Its token is read from .secrets/telegram.env
// (TELEGRAM_BOT_TOKEN=…, put there by the owner); nothing secret is printed.
// - setup: puts TELEGRAM_BOT_TOKEN into the Worker, makes a new TELEGRAM_WEBHOOK_SECRET and
//   TELEGRAM_CODE_KEY and puts them too (values on stdin, through scripts/wrangler.mjs), then points
//   the webhook at <origin>/hook/telegram with that secret and sets the command menus (en, ru).
//   A new code key voids the codes mailed before it — they live 15 minutes.
// - describe: sets the profile texts (description, short description; en default, ru) only.
// - info: the webhook's state and the profile texts, without the token.
// - delete: takes the webhook off; the Worker's secrets stay.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { lockSecrets, SECRETS } from './secrets-dir.mjs';

const ORIGIN = process.env.CLX_ORIGIN ?? 'https://clx.cx';
const cmd = process.argv[2] ?? 'setup';
if (!['setup', 'describe', 'info', 'delete'].includes(cmd)) {
  console.error('usage: node scripts/tg-setup.mjs [setup | describe | info | delete]');
  process.exit(2);
}

lockSecrets();
const token = fs
  .readFileSync(`${SECRETS}/telegram.env`, 'utf8')
  .match(/^\s*TELEGRAM_BOT_TOKEN\s*=\s*"?([^"\r\n]+)"?/mu)?.[1]
  ?.trim();
if (!token) throw new Error(`no TELEGRAM_BOT_TOKEN in ${SECRETS}/telegram.env`);

/** One Bot API call; a connection that fails is tried again (api.telegram.org does not always
 *  answer from here on the first try). Telegram's own refusal is not. */
async function bot(method, payload = {}) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      if (attempt >= 6) throw new Error(`${method}: no connection to api.telegram.org (${e.cause?.code ?? e.message})`);
      await new Promise((r) => setTimeout(r, attempt * 3000));
      continue;
    }
    const body = await res.json();
    if (!body.ok) throw new Error(`${method}: ${body.description ?? res.status}`);
    return body.result;
  }
}

function putSecret(name, value) {
  const r = spawnSync(process.execPath, ['scripts/wrangler.mjs', 'secret', 'put', name], { input: value, stdio: ['pipe', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error(`wrangler secret put ${name} failed`);
  console.log(`${name}: set (value not shown)`);
}

const COMMANDS = {
  en: [
    ['sites', 'Sites: views of 7 days and today'],
    ['links', 'Short links: clicks of 7 days'],
    ['accounts', 'Cloudflare accounts'],
    ['site', 'Add a site: /site example.com'],
    ['link', 'Make a short link: /link https://…'],
    ['connect', 'Connect a Cloudflare account'],
    ['lang', 'Language: /lang ru or /lang en'],
    ['unlink', 'Unlink this Telegram'],
    ['cancel', 'Stop the current question'],
    ['help', 'What the bot can do'],
  ],
  ru: [
    ['sites', 'Сайты: просмотры за 7 дней и сегодня'],
    ['links', 'Короткие ссылки: клики за 7 дней'],
    ['accounts', 'Аккаунты Cloudflare'],
    ['site', 'Добавить сайт: /site example.com'],
    ['link', 'Короткая ссылка: /link https://…'],
    ['connect', 'Подключить аккаунт Cloudflare'],
    ['lang', 'Язык: /lang ru или /lang en'],
    ['unlink', 'Отвязать этот Telegram'],
    ['cancel', 'Прервать текущий вопрос'],
    ['help', 'Что умеет бот'],
  ],
};

// The profile texts: English for everyone, Russian for a Russian Telegram (the owner's wording).
const ABOUT = {
  en: {
    description: [
      'clx is an open visit counter and short-link service that runs in your own Cloudflare account. clx.cx keeps only the totals.',
      'In the bot you can:',
      '• sign in or sign up with a code from an e-mail;',
      "• see your sites' views and your links' clicks for today and 7 days;",
      '• add a site and get its counter code;',
      '• make a short link;',
      '• connect a Cloudflare account;',
      '• get notices about limits and the token.',
      '',
      'Works where clx.cx does not open.',
    ].join('\n'),
    short: 'A visit counter and short links in your own Cloudflare account. Stats and control → clx.cx',
  },
  ru: {
    description: [
      'clx — открытый счётчик посещений и короткие ссылки, которые работают в вашем собственном аккаунте Cloudflare. На clx.cx хранятся только итоги.',
      'В боте можно:',
      '• войти или зарегистрироваться по коду из письма;',
      '• смотреть просмотры сайтов и клики по ссылкам за сегодня и 7 дней;',
      '• добавить сайт и получить код счётчика;',
      '• создать короткую ссылку;',
      '• подключить аккаунт Cloudflare;',
      '• получать уведомления о лимитах и токене.',
      '',
      'Работает там, где clx.cx не открывается.',
    ].join('\n'),
    short: 'Счётчик посещений и короткие ссылки в вашем аккаунте Cloudflare. Статистика и управление → clx.cx',
  },
};

async function describe() {
  for (const [lang, t] of Object.entries(ABOUT)) {
    const q = lang === 'en' ? {} : { language_code: lang };
    await bot('setMyDescription', { ...q, description: t.description });
    await bot('setMyShortDescription', { ...q, short_description: t.short });
  }
}

if (cmd === 'describe') {
  await describe();
  console.log('description and short description set (en default, ru)');
} else if (cmd === 'info') {
  const me = await bot('getMe');
  const info = await bot('getWebhookInfo');
  console.log(`bot @${me.username}; webhook ${info.url || '(none)'}; pending ${info.pending_update_count}; last error ${info.last_error_message ?? '—'}`);
  for (const lang of ['', 'ru']) {
    const q = lang ? { language_code: lang } : {};
    console.log(`[${lang || 'default'}] description: ${(await bot('getMyDescription', q)).description || '—'}`);
    console.log(`[${lang || 'default'}] short: ${(await bot('getMyShortDescription', q)).short_description || '—'}`);
  }
} else if (cmd === 'delete') {
  await bot('deleteWebhook');
  console.log('webhook removed');
} else {
  const secret = crypto.randomBytes(32).toString('base64url');
  putSecret('TELEGRAM_BOT_TOKEN', token);
  putSecret('TELEGRAM_WEBHOOK_SECRET', secret);
  putSecret('TELEGRAM_CODE_KEY', crypto.randomBytes(32).toString('base64url'));
  // One connection: Telegram sends a user's updates one at a time and in order, so a later message
  // (/cancel) is never handled before an earlier one (the token it cancels).
  await bot('setWebhook', { url: `${ORIGIN}/hook/telegram`, secret_token: secret, allowed_updates: ['message'], max_connections: 1 });
  for (const [lang, list] of Object.entries(COMMANDS)) {
    const commands = list.map(([command, description]) => ({ command, description }));
    await bot('setMyCommands', lang === 'en' ? { commands } : { commands, language_code: lang });
  }
  const me = await bot('getMe');
  await describe();
  console.log(`webhook: ${ORIGIN}/hook/telegram for @${me.username}; commands and profile texts set (en, ru)`);
}

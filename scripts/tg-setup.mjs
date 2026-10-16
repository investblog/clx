#!/usr/bin/env node
// node scripts/tg-setup.mjs [setup | info | delete]
//
// The Telegram bot (docs/spec.md §17). Its token is read from .secrets/telegram.env
// (TELEGRAM_BOT_TOKEN=…, put there by the owner); nothing secret is printed.
// - setup: puts TELEGRAM_BOT_TOKEN into the Worker, makes a new TELEGRAM_WEBHOOK_SECRET and
//   TELEGRAM_CODE_KEY and puts them too (values on stdin, through scripts/wrangler.mjs), then points
//   the webhook at <origin>/hook/telegram with that secret and sets the command menus (en, ru).
//   A new code key voids the codes mailed before it — they live 15 minutes.
// - info: the webhook's state, without its URL's secrets (there are none in it) or the token.
// - delete: takes the webhook off; the Worker's secrets stay.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { lockSecrets, SECRETS } from './secrets-dir.mjs';

const ORIGIN = process.env.CLX_ORIGIN ?? 'https://clx.cx';
const cmd = process.argv[2] ?? 'setup';
if (!['setup', 'info', 'delete'].includes(cmd)) {
  console.error('usage: node scripts/tg-setup.mjs [setup | info | delete]');
  process.exit(2);
}

lockSecrets();
const token = fs
  .readFileSync(`${SECRETS}/telegram.env`, 'utf8')
  .match(/^\s*TELEGRAM_BOT_TOKEN\s*=\s*"?([^"\r\n]+)"?/mu)?.[1]
  ?.trim();
if (!token) throw new Error(`no TELEGRAM_BOT_TOKEN in ${SECRETS}/telegram.env`);

async function bot(method, payload = {}) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const body = await res.json();
  if (!body.ok) throw new Error(`${method}: ${body.description ?? res.status}`);
  return body.result;
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

if (cmd === 'info') {
  const me = await bot('getMe');
  const info = await bot('getWebhookInfo');
  console.log(`bot @${me.username}; webhook ${info.url || '(none)'}; pending ${info.pending_update_count}; last error ${info.last_error_message ?? '—'}`);
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
  console.log(`webhook: ${ORIGIN}/hook/telegram for @${me.username}; commands set (en, ru)`);
}

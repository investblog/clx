// The notices clx mails a user (§4, §8, §3 item 6) also go to the Telegram linked to the account
// (§17). Best effort beside the e-mail: a failed send is logged and changes nothing about the mail.
import type { Env } from '../types';
import { esc, sendMessage } from './api';

export async function notifyTelegram(env: Env, userId: number, subject: string, text: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const id = await env.DB.prepare('SELECT tg_user_id FROM tg_identities WHERE user_id = ?').bind(userId).first<number>('tg_user_id');
  if (!id) return;
  // The e-mail's greeting is not a message's.
  const body = text.replace(/^[^\n]*\n\n/u, '').trim();
  // In a private chat the chat's id is the user's.
  if (!(await sendMessage(env, id, `<b>${esc(subject)}</b>\n\n${esc(body)}`))) console.error('telegram notice not sent', userId);
}

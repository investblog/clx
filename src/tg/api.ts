// The Telegram Bot API (docs/spec.md §17): the few methods the bot uses. A message is HTML; what the
// bot did not write itself goes through `esc`.
import type { Env } from '../types';

/** Telegram's limit for one message's text. */
export const MESSAGE_MAX = 4096;

export const esc = (s: string) => s.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');

/** One Bot API call: its result, or null when Telegram refused it or did not answer. */
export async function tgCall<T>(env: Env, method: string, payload: Record<string, unknown>): Promise<T | null> {
  if (!env.TELEGRAM_BOT_TOKEN) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
    if (body?.ok) return (body.result ?? true) as T;
    console.error('telegram', method, res.status, body?.description ?? '');
    return null;
  } catch (e) {
    console.error('telegram', method, e instanceof Error ? e.message : e);
    return null;
  }
}

/** Long text is cut at line breaks into messages Telegram takes; whether every part went. */
export async function sendMessage(env: Env, chatId: number, text: string): Promise<boolean> {
  let ok = true;
  for (const part of split(text)) ok = (await tgCall(env, 'sendMessage', { chat_id: chatId, text: part, parse_mode: 'HTML', link_preview_options: { is_disabled: true } })) !== null && ok;
  return ok;
}

/** Whether `userId` is an admin of the chat, by Telegram's own answer; no answer is no. */
export async function isChatAdmin(env: Env, chatId: number, userId: number): Promise<boolean> {
  const m = await tgCall<{ status?: string }>(env, 'getChatMember', { chat_id: chatId, user_id: userId });
  return m?.status === 'creator' || m?.status === 'administrator';
}

/** The bot's username, lower case, from getMe; '' when Telegram does not answer. */
export const botName = async (env: Env) => ((await tgCall<{ username?: string }>(env, 'getMe', {}))?.username ?? '').toLowerCase();

/** The bot's own user id: the token's part before the colon. */
export const botId = (env: Env) => Number((env.TELEGRAM_BOT_TOKEN ?? '').split(':')[0]);

export const deleteMessage =(env: Env, chatId: number, messageId: number) => tgCall<boolean>(env, 'deleteMessage', { chat_id: chatId, message_id: messageId });

/** Parts of at most MESSAGE_MAX characters, cut between lines, so no tag is cut in two: the bot's
 *  lists put one record a line and never open a tag across lines. */
export function split(text: string): string[] {
  if (text.length <= MESSAGE_MAX) return [text];
  const parts: string[] = [];
  let part = '';
  for (const line of text.split('\n')) {
    if (part && part.length + 1 + line.length > MESSAGE_MAX) {
      parts.push(part);
      part = line;
    } else part = part ? `${part}\n${line}` : line;
  }
  if (part) parts.push(part);
  return parts;
}

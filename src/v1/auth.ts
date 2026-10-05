// Who is calling /v1 (docs/spec.md §15): `Authorization: Bearer <access token>` from a page session,
// or `Bearer clx_…` — an API key, looked up by its SHA-256. Checking a key writes at most once a
// day per key (last_used_day), never per call.
import type { Context } from 'hono';
import { verifyAccess } from '../auth/jwt';
import { sha256 } from '../lib/crypto';
import { SCOPES } from '../limits';
import type { Env, Principal } from '../types';
import { fail } from './http';

export const KEY_PREFIX = 'clx_';

interface KeyRow {
  id: string;
  user_id: number;
  scopes: string;
  allow_accounts: string | null;
  allow_ips: string | null;
  last_used_day: number | null;
  plan: string;
}

const list = (s: string | null): Set<string> | null => (s ? new Set(s.split(',').filter(Boolean)) : null);

export async function principalOf(c: Context<{ Bindings: Env }>): Promise<Principal> {
  const token = c.req.header('authorization')?.match(/^Bearer (.+)$/u)?.[1];
  if (!token) return fail(401, 'unauthorized', 'An access token or an API key is required.');
  if (!token.startsWith(KEY_PREFIX)) {
    const userId = await verifyAccess(c.env.JWT_SECRET, token, Date.now());
    if (!userId) return fail(401, 'unauthorized', 'The access token is invalid or expired.');
    const user = await c.env.DB.prepare('SELECT plan FROM users WHERE id = ?').bind(userId).first<{ plan: string }>();
    if (!user) return fail(401, 'unauthorized', 'The access token is invalid or expired.');
    return { id: `u:${userId}`, userId, plan: user.plan, via: 'session', scopes: new Set(SCOPES), allowAccounts: null };
  }
  const key = await c.env.DB.prepare(
    'SELECT k.id, k.user_id, k.scopes, k.allow_accounts, k.allow_ips, k.last_used_day, u.plan FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.key_hash = ? AND k.revoked_at IS NULL',
  )
    .bind(await sha256(token))
    .first<KeyRow>();
  if (!key) return fail(401, 'unauthorized', 'The API key is invalid or revoked.');
  if (key.plan !== 'api') return fail(403, 'plan_required', 'API keys work on the api plan only.');
  const ips = list(key.allow_ips);
  if (ips && !ips.has(c.req.header('cf-connecting-ip') ?? '')) return fail(401, 'unauthorized', 'The API key is not allowed from this address.');
  const { success } = await c.env.API_LIMIT.limit({ key: key.id });
  if (!success) {
    c.header('Retry-After', '60');
    return fail(429, 'rate_limited', 'Too many requests for this key; retry in a minute.');
  }
  const today = Math.floor(Date.now() / 86_400_000);
  // Conditional, so concurrent first calls of the day write once between them.
  if (key.last_used_day !== today) await c.env.DB.prepare('UPDATE api_keys SET last_used_day = ?1 WHERE id = ?2 AND (last_used_day IS NULL OR last_used_day < ?1)').bind(today, key.id).run();
  return { id: `k:${key.id}`, userId: key.user_id, plan: key.plan, via: 'key', scopes: new Set(key.scopes.split(',')), allowAccounts: list(key.allow_accounts) };
}

export function requireScope(p: Principal, scope: string): void {
  if (!p.scopes.has(scope)) fail(403, 'scope_required', `This call needs the "${scope}" scope.`, { scope });
}

export function requireSession(p: Principal): void {
  if (p.via !== 'session') fail(403, 'session_required', 'This call works from a signed-in page only, not with an API key.');
}

/** A key outside its allow list sees the account as missing (§15: 404, never 403). */
export function mayTouch(p: Principal, cfAccountId: string): boolean {
  return !p.allowAccounts || p.allowAccounts.has(cfAccountId);
}

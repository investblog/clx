// Partner and promo codes (docs/spec.md §19, ADR 0036): one name space, looked up case-insensitively,
// partner codes first. A visit by `?ref=CODE` sets the cookie `clx_ref` for 30 days (last touch).
import type { Context } from 'hono';
import type { Env } from '../types';

export const REF_COOKIE = 'clx_ref';
const COOKIE_DAYS = 30;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A new partner code: 8 random lowercase letters and digits. */
function randomCode(): string {
  let out = '';
  while (out.length < 8) for (const b of crypto.getRandomValues(new Uint8Array(16))) if (b < 252 && out.length < 8) out += ALPHABET[b % 36];
  return out;
}

/** A partner code no partner and no promo code has: one name space. */
export async function newRefCode(db: D1Database): Promise<string> {
  for (;;) {
    const code = randomCode();
    if (!(await db.prepare('SELECT 1 FROM users WHERE ref_code = ?1 UNION ALL SELECT 1 FROM promo_codes WHERE code = ?1').bind(code).first())) return code;
  }
}

/** A code as typed or carried: trimmed and lowercased, or null when it cannot be one. */
export const normalizeCode = (v: unknown): string | null => (typeof v === 'string' && /^[a-z0-9_-]{3,32}$/iu.test(v.trim()) ? v.trim().toLowerCase() : null);

export type Code = { kind: 'partner'; code: string } | { kind: 'promo'; promoId: number };

/** What a code is now: a partner's (not being deleted), or a promo code still open. */
export async function resolveCode(db: D1Database, raw: unknown, now = Date.now()): Promise<Code | null> {
  const code = normalizeCode(raw);
  if (!code) return null;
  const partner = await db.prepare('SELECT id FROM users WHERE ref_code = ? AND deleting_at IS NULL').bind(code).first<number>('id');
  if (partner) return { kind: 'partner', code };
  const promo = await db
    .prepare('SELECT p.id FROM promo_codes p WHERE p.code = ?1 AND (p.until IS NULL OR p.until > ?2) AND (p.max_uses IS NULL OR (SELECT count(*) FROM promo_redemptions r WHERE r.promo_id = p.id) < p.max_uses)')
    .bind(code, now)
    .first<number>('id');
  return promo ? { kind: 'promo', promoId: promo } : null;
}

/** The code of the `clx_ref` cookie, if any. */
export function refCookie(header: string | undefined): string | null {
  const m = /(?:^|;\s*)clx_ref=([^;]*)/u.exec(header ?? '');
  if (!m) return null;
  try {
    return normalizeCode(decodeURIComponent(m[1]!));
  } catch {
    return null;
  }
}

/** What a new account takes from a code: the partner's code, or the promo code bound to it. The
 *  partner is found again by code in the account's own INSERT (`REFERRER_SQL`), never carried as a
 *  user id: one deleted meanwhile may have its id given to someone else (ADR 0010). */
export const bindingOf = (code: Code | null) => ({ partnerCode: code?.kind === 'partner' ? code.code : null, promoId: code?.kind === 'promo' ? code.promoId : null });

/** The referrer of a new account by the partner's code, in its INSERT: none if that partner is gone
 *  or going. `?N` is the code's parameter. */
export const referrerSql = (n: number) => `(SELECT id FROM users WHERE ref_code = ?${n} AND deleting_at IS NULL)`;

/**
 * `?ref=CODE` on a page the Worker serves (the home page the Partners page links to): 302 to the
 * same address without it — never cached, so a second visit reaches the Worker again — and the
 * cookie only for a valid code, on a navigation (an `<img>` elsewhere does not spend the visitor's
 * lookups or overwrite their cookie). The lookup is limited per address.
 */
export async function refVisit(c: Context<{ Bindings: Env }>): Promise<Response | null> {
  const url = new URL(c.req.url);
  if ((c.req.method !== 'GET' && c.req.method !== 'HEAD') || !url.searchParams.has('ref')) return null;
  const raw = url.searchParams.get('ref');
  url.searchParams.delete('ref');
  const headers = new Headers({ location: url.pathname + url.search + url.hash, 'cache-control': 'no-store' });
  const dest = c.req.header('sec-fetch-dest');
  const code = normalizeCode(raw);
  if (code && c.req.method === 'GET' && (dest === undefined || dest === 'document')) {
    try {
      const { success } = await c.env.API_LIMIT.limit({ key: `ref:${c.req.header('cf-connecting-ip') ?? ''}` });
      if (success && (await resolveCode(c.env.DB, code))) headers.append('set-cookie', `${REF_COOKIE}=${code}; Max-Age=${COOKIE_DAYS * 86_400}; Path=/; SameSite=Lax; Secure`);
    } catch (e) {
      // The redirect goes either way: a failed lookup leaves no code in the address.
      console.error('ref visit', e instanceof Error ? e.message : e);
    }
  }
  return new Response(null, { status: 302, headers });
}

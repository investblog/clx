// Access tokens: HS256 JWT signed with the JWT_SECRET Worker secret, 15 minutes, kept by the page in
// memory only (as in the 301.st UI). 301.st's key table and fingerprint are left out:
// one secret is enough here, and a short-lived token bound to nothing loses nothing a refresh can't redo.
import { sameBytes } from './password';

export const ACCESS_TTL = 900;

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
const unb64url = (s: string): Uint8Array => Uint8Array.from(atob(s.replace(/-/gu, '+').replace(/_/gu, '/')), (ch) => ch.charCodeAt(0));
const HEADER = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export interface Access {
  typ: 'access';
  sub: number;
  /** the user's session version when it was issued: a password reset bumps it (users.session_version) */
  ver: number;
  iat: number;
  exp: number;
}

export async function signAccess(secret: string, userId: number, now: number, ver = 0): Promise<string> {
  const iat = Math.floor(now / 1000);
  const body = b64url(enc.encode(JSON.stringify({ typ: 'access', sub: userId, ver, iat, exp: iat + ACCESS_TTL } satisfies Access)));
  return `${HEADER}.${body}.${b64url(await hmac(secret, `${HEADER}.${body}`))}`;
}

/** The user id and session version of a valid, unexpired access token, or null. Whether the user's
 *  sessions were ended since (a password reset) is the caller's to check against the user row. A
 *  token from before versions existed counts as version 0. */
export async function accessOf(secret: string, token: string, now: number): Promise<{ sub: number; ver: number } | null> {
  const [header, body, sig] = token.split('.');
  if (header !== HEADER || !body || !sig) return null;
  try {
    if (!sameBytes(await hmac(secret, `${header}.${body}`), unb64url(sig))) return null;
    const p = JSON.parse(new TextDecoder().decode(unb64url(body))) as Partial<Access>;
    if (p.typ !== 'access' || typeof p.sub !== 'number' || typeof p.iat !== 'number' || typeof p.exp !== 'number' || p.exp <= Math.floor(now / 1000)) return null;
    return { sub: p.sub, ver: typeof p.ver === 'number' ? p.ver : 0 };
  } catch {
    return null;
  }
}

// Password hashes, as in 301.st: PBKDF2-SHA256, 100 000 rounds, 16-byte
// salt, stored as "<salt b64>:<hash b64>". scripts/user.mjs makes the same format in node.
const ITERATIONS = 100_000;
const KEY_BYTES = 32;

const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

async function derive(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ITERATIONS }, material, KEY_BYTES * 8);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `${b64(salt)}:${b64(await derive(password, salt))}`;
}

/** Same bytes, compared without an early exit. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

// Checked against when there is no such user, so a wrong e-mail costs the same time as a wrong password.
const DUMMY = 'AAAAAAAAAAAAAAAAAAAAAA==:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const [salt, hash] = (stored ?? DUMMY).split(':');
  if (!salt || !hash) return false;
  const ok = sameBytes(await derive(password, unb64(salt)), unb64(hash));
  return ok && stored !== null;
}

// Working tokens at rest (docs/spec.md §3 item 5): AES-GCM-256, a random 12-byte IV, AAD binding
// the ciphertext to its record. MASTER_KEYS is the keyring secret, "<id>:<base64 32 bytes>,…"; the
// first key encrypts, any key of the ring decrypts by the id stored with the ciphertext. Rotation
// (scripts/rekey.mjs, ADR 0038): a new key in MASTER_KEYS_NEXT goes in front of the ring, the cron
// re-encrypts (src/cf/rekey.ts), then the new key becomes MASTER_KEYS and the extra secret goes.

export interface Sealed {
  key_id: string;
  iv: string;
  data: string;
}

const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function ring(secret: string): [string, string][] {
  const keys = secret
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => [p.slice(0, p.indexOf(':')), p.slice(p.indexOf(':') + 1)] as [string, string]);
  if (!keys.length || keys.some(([id, k]) => !id || unb64(k).length !== 32)) throw new Error('MASTER_KEYS: expected "<id>:<base64 of 32 bytes>,…"');
  // One id, one key: a ciphertext names its key by id. (The same key twice is fine — the ring is
  // that for a moment when a rotation ends, MASTER_KEYS_NEXT and MASTER_KEYS both the new key.)
  if (keys.some(([id, k]) => keys.some(([id2, k2]) => id === id2 && k !== k2))) throw new Error('MASTER_KEYS: one key id names two keys');
  return keys;
}

/** The ring a Worker seals and opens with: a rotation's new key first, when there is one. A Worker
 *  secret cannot be read back, so the new key cannot be written in front of MASTER_KEYS itself. */
export const keyring = (env: { MASTER_KEYS: string; MASTER_KEYS_NEXT?: string }): string => [env.MASTER_KEYS_NEXT, env.MASTER_KEYS].filter(Boolean).join(',');

/** The id of the key that seals now. */
export const sealingKeyId = (secret: string): string => ring(secret)[0]![0];

const importKey = (raw: string) => crypto.subtle.importKey('raw', unb64(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);

export async function seal(secret: string, plaintext: string, aad: string): Promise<Sealed> {
  const [[id, raw]] = ring(secret) as [[string, string]];
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) }, await importKey(raw), new TextEncoder().encode(plaintext));
  return { key_id: id, iv: b64(iv), data: b64(new Uint8Array(data)) };
}

export async function open(secret: string, sealed: Sealed, aad: string): Promise<string> {
  const raw = ring(secret).find(([id]) => id === sealed.key_id)?.[1];
  if (!raw) throw new Error(`MASTER_KEYS has no key ${sealed.key_id}`);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(sealed.iv), additionalData: new TextEncoder().encode(aad) }, await importKey(raw), unb64(sealed.data));
  return new TextDecoder().decode(plain);
}

/** Hex SHA-256 — for API keys, request bodies and the like. */
export async function sha256(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

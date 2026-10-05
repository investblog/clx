// Working tokens at rest (docs/spec.md §3 item 5): AES-GCM-256, a random 12-byte IV, AAD binding
// the ciphertext to its record. MASTER_KEYS is the keyring secret, "<id>:<base64 32 bytes>,…"; the
// first key encrypts, any key of the ring decrypts by the id stored with the ciphertext. Rotation:
// put a new key first, re-encrypt in the background, then drop the old one.

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
  return keys;
}

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

// A MASTER_KEYS rotation's re-encryption (docs/spec.md §3 item 5, ADR 0038). While a new key is set
// in MASTER_KEYS_NEXT, the minute cron re-seals a few working tokens at a time with it — the token
// in use and a renewal's new one. Each write is a compare-and-swap on the ciphertext read, so a
// connect or a renewal that changes the row meanwhile wins and the row is taken again next minute.
// scripts/rekey.mjs ends the rotation once no ciphertext names another key.
import { keyring, open, seal, sealingKeyId, type Sealed } from '../lib/crypto';
import type { Env } from '../types';
import { aad } from './connect';

const BATCH = 20;

interface Row {
  id: string;
  cf_account_id: string;
  token_sealed: string | null;
  next_sealed: string | null;
}

/** A ciphertext not sealed with `current` — malformed or without a key id included. */
const stale = (column: string) => `(${column} IS NOT NULL AND (NOT json_valid(${column}) OR coalesce(json_extract(${column}, '$.key_id'), '') != ?1))`;

/** One minute's share of the re-encryption: how many ciphertexts were re-sealed, and how many could
 *  not be opened (a key missing from the ring, a broken row — never lost here: it stays as it was). */
export async function rekey(env: Env): Promise<{ resealed: number; failed: number }> {
  const done = { resealed: 0, failed: 0 };
  if (!env.MASTER_KEYS_NEXT) return done;
  const ring = keyring(env);
  const current = sealingKeyId(ring);
  // In random order: rows that cannot be opened must not hold the batch for good.
  const rows = (
    await env.DB.prepare(`SELECT id, cf_account_id, token_sealed, next_sealed FROM edge_accounts WHERE ${stale('token_sealed')} OR ${stale('next_sealed')} ORDER BY random() LIMIT ?2`)
      .bind(current, BATCH)
      .all<Row>()
  ).results;
  for (const row of rows) {
    for (const column of ['token_sealed', 'next_sealed'] as const) {
      const old = row[column];
      if (!old) continue;
      try {
        const sealed = JSON.parse(old) as Sealed;
        if (sealed.key_id === current) continue;
        const box = await seal(ring, await open(ring, sealed, aad(row)), aad(row));
        const write =
          column === 'token_sealed'
            ? env.DB.prepare('UPDATE edge_accounts SET token_sealed = ?1, key_id = ?2 WHERE id = ?3 AND token_sealed = ?4').bind(JSON.stringify(box), box.key_id, row.id, old)
            : env.DB.prepare('UPDATE edge_accounts SET next_sealed = ?1 WHERE id = ?2 AND next_sealed = ?3').bind(JSON.stringify(box), row.id, old);
        if ((await write.run()).meta.changes) done.resealed++;
      } catch (e) {
        done.failed++;
        console.error('rekey', row.id, column, e instanceof Error ? e.message : e);
      }
    }
  }
  return done;
}

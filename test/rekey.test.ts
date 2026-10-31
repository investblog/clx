// A MASTER_KEYS rotation's cron part (ADR 0038): with MASTER_KEYS_NEXT set, the working tokens are
// re-sealed with the new key, a row changed meanwhile is left to the next run, and a row that cannot
// be opened stays as it was without stopping the others. (When the old key may go — scripts/rekey.mjs
// `finish` — is checked live, not here.)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rekey } from '../src/cf/rekey';
import { keyring, open, seal, type Sealed } from '../src/lib/crypto';
import type { Env } from '../src/types';
import { testEnv } from './env';

let env: Env;
let dispose: () => Promise<void>;
const NEXT = `t2:${btoa('n'.repeat(32))}`;

beforeAll(async () => {
  ({ env, dispose } = await testEnv());
  await env.DB.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (1, 'owner@example.com', 'x', 0)").run();
});
afterAll(() => dispose());
beforeEach(() => env.DB.prepare('DELETE FROM edge_accounts').run());

async function account(id: string, token: string | null, next: string | null = null) {
  const cf = `cf-${id}`;
  const box = (s: string) => seal(env.MASTER_KEYS, s, `${id}|${cf}`).then((b) => JSON.stringify(b));
  await env.DB.prepare("INSERT INTO edge_accounts (id, user_id, cf_account_id, state, key_id, token_sealed, next_sealed, created_at, updated_at) VALUES (?, 1, ?, 'ready', 't1', ?, ?, 0, 0)")
    .bind(id, cf, token && (await box(token)), next && (await box(next)))
    .run();
}
const row = (id: string) => env.DB.prepare('SELECT cf_account_id, key_id, token_sealed, next_sealed FROM edge_accounts WHERE id = ?').bind(id).first<{ cf_account_id: string; key_id: string; token_sealed: string | null; next_sealed: string | null }>();

describe('MASTER_KEYS rotation', () => {
  it('does nothing without MASTER_KEYS_NEXT', async () => {
    await account('a1', 'secret-1');
    expect(await rekey(env)).toEqual({ resealed: 0, failed: 0 });
    expect(JSON.parse((await row('a1'))!.token_sealed!).key_id).toBe('t1');
  });

  it('re-seals the token in use and a renewal’s new one with the new key, readable by the new ring', async () => {
    await account('a1', 'secret-1', 'secret-1-next');
    await account('a2', 'secret-2');
    await account('a3', null);
    const rotating = { ...env, MASTER_KEYS_NEXT: NEXT };
    expect(await rekey(rotating)).toEqual({ resealed: 3, failed: 0 });
    for (const [id, column, plain] of [['a1', 'token_sealed', 'secret-1'], ['a1', 'next_sealed', 'secret-1-next'], ['a2', 'token_sealed', 'secret-2']] as const) {
      const r = (await row(id))!;
      const box = JSON.parse(r[column]!) as Sealed;
      expect(box.key_id).toBe('t2');
      expect(await open(keyring(rotating), box, `${id}|${r.cf_account_id}`)).toBe(plain);
      // After the rotation the ring is the new key alone.
      expect(await open(NEXT, box, `${id}|${r.cf_account_id}`)).toBe(plain);
    }
    expect((await row('a1'))!.key_id).toBe('t2');
    expect((await row('a3'))!.token_sealed).toBeNull();
    // Done: nothing left to take.
    expect(await rekey(rotating)).toEqual({ resealed: 0, failed: 0 });
  });

  it('leaves a row a connect changed meanwhile to the next run (compare-and-swap on the ciphertext)', async () => {
    await account('a1', 'secret-1');
    const rotating = { ...env, MASTER_KEYS_NEXT: NEXT };
    // A renewal swaps the token between the re-seal's read and its write: the write must not undo it.
    const swapped = JSON.stringify(await seal(env.MASTER_KEYS, 'secret-new', 'a1|cf-a1'));
    const db = env.DB;
    const racing = {
      prepare: (sql: string) => {
        const stmt = db.prepare(sql);
        if (!sql.startsWith('UPDATE edge_accounts SET token_sealed = ?1')) return stmt;
        return {
          bind: (...args: unknown[]) => ({
            run: async () => {
              await db.prepare('UPDATE edge_accounts SET token_sealed = ? WHERE id = ?').bind(swapped, 'a1').run();
              return stmt.bind(...args).run();
            },
          }),
        };
      },
    } as unknown as D1Database;
    expect(await rekey({ ...rotating, DB: racing })).toEqual({ resealed: 0, failed: 0 });
    expect((await row('a1'))!.token_sealed).toBe(swapped);
    // The next run takes the renewed token.
    expect(await rekey(rotating)).toEqual({ resealed: 1, failed: 0 });
    const after = JSON.parse((await row('a1'))!.token_sealed!) as Sealed;
    expect(after.key_id).toBe('t2');
    expect(await open(keyring(rotating), after, 'a1|cf-a1')).toBe('secret-new');
  });

  it('a broken ciphertext does not stop the others', async () => {
    await account('a1', 'secret-1');
    await account('a2', 'secret-2');
    await env.DB.prepare("UPDATE edge_accounts SET token_sealed = 'not json' WHERE id = 'a1'").run();
    const rotating = { ...env, MASTER_KEYS_NEXT: NEXT };
    expect(await rekey(rotating)).toEqual({ resealed: 1, failed: 1 });
    expect((await row('a1'))!.token_sealed).toBe('not json');
    expect(JSON.parse((await row('a2'))!.token_sealed!).key_id).toBe('t2');
  });

  it('re-seals a renewal’s new token that a swap then makes the one in use', async () => {
    await account('a1', 'secret-1', 'secret-1-next');
    const rotating = { ...env, MASTER_KEYS_NEXT: NEXT };
    await rekey(rotating);
    // The renewal's swap (src/cf/connect.ts finish): the key_id column follows the ciphertext.
    await env.DB.prepare("UPDATE edge_accounts SET key_id = json_extract(next_sealed, '$.key_id'), token_sealed = next_sealed, next_sealed = NULL WHERE id = 'a1'").run();
    const r = (await row('a1'))!;
    expect(r.key_id).toBe('t2');
    expect(await open(NEXT, JSON.parse(r.token_sealed!) as Sealed, 'a1|cf-a1')).toBe('secret-1-next');
  });

  it('a ring may not name two keys by one id, but may hold the same key twice', async () => {
    await expect(seal(`t1:${btoa('z'.repeat(32))},${env.MASTER_KEYS}`, 'x', 'a')).rejects.toThrow('one key id names two keys');
    const twice = keyring({ MASTER_KEYS: NEXT, MASTER_KEYS_NEXT: NEXT });
    expect(await open(twice, await seal(twice, 'x', 'a'), 'a')).toBe('x');
  });

  it('counts a ciphertext it cannot open and leaves it as it was', async () => {
    await account('a1', 'secret-1');
    // A ring without the old key: the row's key is missing.
    const lost = { ...env, MASTER_KEYS: NEXT, MASTER_KEYS_NEXT: `t3:${btoa('m'.repeat(32))}` };
    const before = (await row('a1'))!.token_sealed;
    expect(await rekey(lost)).toEqual({ resealed: 0, failed: 1 });
    expect((await row('a1'))!.token_sealed).toBe(before);
  });
});

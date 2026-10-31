// When every snippet's code changes (SNIPPET_REV, ADR 0039), the cron moves each synced site that
// today's code did not write to a new revision — once — so the sync writes its served script again
// (the sync's own part: sites.test.ts).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runSites } from '../src/cf/sites';
import type { Env } from '../src/types';
import { testEnv } from './env';

let env: Env;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ env, dispose } = await testEnv());
  // No bundle: the sync itself does not run, only the move to a new revision. The sites carry no
  // record of the code that wrote them — as every site before migration 0021.
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (1, 'owner@example.com', 'x', 0)"),
    env.DB.prepare("INSERT INTO edge_accounts (id, user_id, cf_account_id, state, config_revision, synced_revision, created_at, updated_at) VALUES ('ea1', 1, 'cf1', 'ready', 5, 5, 0, 0), ('ea2', 1, 'cf2', 'ready', 3, 3, 0, 0)"),
    env.DB.prepare(
      "INSERT INTO sites (id, account_id, user_id, target, host, zone_id, seed, state, revision, created_at, updated_at) VALUES ('s1', 'ea1', 1, 't1', 'a.example.com', 'z', 'a', 'active', 2, 0, 0), ('s2', 'ea1', 1, 't2', 'b.example.com', 'z', 'b', 'deleted', 4, 0, 0), ('s3', 'ea2', 1, 't3', 'c.example.com', 'z', 'c', 'active', 3, 0, 0)",
    ),
  ]);
});
afterAll(() => dispose());

describe('SNIPPET_REV', () => {
  it('moves every synced live site that today’s code did not write to a new revision, once', async () => {
    await runSites(env);
    const accounts = (await env.DB.prepare('SELECT id, config_revision, synced_revision FROM edge_accounts ORDER BY id').all()).results;
    expect(accounts).toEqual([
      { id: 'ea1', config_revision: 6, synced_revision: 5 },
      { id: 'ea2', config_revision: 4, synced_revision: 3 },
    ]);
    const sites = (await env.DB.prepare('SELECT id, revision FROM sites ORDER BY id').all()).results;
    expect(sites).toEqual([
      { id: 's1', revision: 6 },
      { id: 's2', revision: 4 },
      { id: 's3', revision: 4 },
    ]);
    // Not synced yet: the next look leaves them to their sync.
    await runSites(env);
    expect(await env.DB.prepare("SELECT config_revision FROM edge_accounts WHERE id = 'ea1'").first('config_revision')).toBe(6);
  });
});

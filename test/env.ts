// A real local D1 for tests: wrangler's platform proxy, fresh and unpersisted per suite, with the
// migrations applied statement by statement.
import fs from 'node:fs';
import path from 'node:path';
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/types';

export async function testEnv(): Promise<{ env: Env; dispose: () => Promise<void> }> {
  const proxy = await getPlatformProxy<Env>({ configPath: 'wrangler.example.jsonc', persist: false });
  const env: Env = { ...proxy.env, JWT_SECRET: 'test-jwt-secret', MASTER_KEYS: `t1:${btoa('k'.repeat(32))}` };
  for (const file of fs.readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join('migrations', file), 'utf8').replace(/--.*$/gmu, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await env.DB.prepare(stmt).run();
  }
  return { env, dispose: () => proxy.dispose() };
}

/** An ExecutionContext whose waitUntil work the test can wait for. */
export function fakeCtx(): { ctx: ExecutionContext; settle: () => Promise<unknown> } {
  const work: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void work.push(p), passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
  return { ctx, settle: () => Promise.all(work) };
}

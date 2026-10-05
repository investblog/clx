// Admin commands (docs/spec.md §4): the bundle info checked before a rollout, and the rollout of
// the current clx-edge bundle — to every installed account or a list, with `dry_run`. A page
// session of a user marked admin (`node scripts/user.mjs admin <email>`); API keys never.
import { Hono, type Context } from 'hono';
import { EDGE_CODE, EDGE_COMPATIBILITY_DATE, EDGE_SHA256 } from '../edge/bundle.gen';
import { SCHEMA } from '../edge/migrations';
import RELEASED from '../edge/released.json';
import { CfError } from './cf/api';
import type { EdgeAccount } from './cf/connect';
import { runDeploy, startDeploy } from './cf/deploy';
import type { Env } from './types';
import { principalOf, requireSession } from './v1/auth';
import { ApiError, errorBody, fail } from './v1/http';

export const admin = new Hono<{ Bindings: Env }>();

admin.onError((e, c) => {
  if (e instanceof ApiError) return c.json(errorBody(e), e.status as 400);
  console.error('admin', e instanceof CfError ? e.message : e);
  return c.json({ error: { code: 'internal', message: 'Something went wrong on our side.' } }, 500);
});

/** The admin calling, or a 404 — the admin paths are not advertised. */
async function adminOf(c: Context<{ Bindings: Env }>): Promise<string> {
  const p = await principalOf(c);
  requireSession(p);
  const user = await c.env.DB.prepare('SELECT admin FROM users WHERE id = ?').bind(p.userId).first<{ admin: number }>();
  if (!user?.admin) fail(404, 'not_found', 'Not found.');
  return p.id;
}

admin.get('/edge/bundle-info', async (c) => {
  await adminOf(c);
  return c.json({ sha256: EDGE_SHA256, size: EDGE_CODE.length, schema: SCHEMA, compatibility_date: EDGE_COMPATIBILITY_DATE, released: RELEASED });
});

/**
 * Update installed accounts to the current bundle. `accounts` — clx account ids, or every ready
 * account not on it yet; `force` redeploys accounts already on it. The operations table holds
 * each account's result.
 */
admin.post('/edge/rollout', async (c) => {
  const principal = await adminOf(c);
  const body = (await c.req.json().catch(() => ({}))) as { accounts?: unknown; dry_run?: unknown; force?: unknown };
  const ids = Array.isArray(body.accounts) && body.accounts.every((x) => typeof x === 'string') ? (body.accounts as string[]) : null;
  if (body.accounts !== undefined && !ids) fail(400, 'invalid_request', '"accounts" must be a list of account ids.');
  const rows = (await c.env.DB.prepare("SELECT * FROM edge_accounts WHERE state = 'ready' AND bundle IS NOT NULL ORDER BY created_at").all<EdgeAccount>()).results;
  const chosen = rows.filter((a) => (ids ? ids.includes(a.id) : true) && (body.force === true || a.bundle !== EDGE_SHA256));
  if (body.dry_run === true) return c.json({ bundle: EDGE_SHA256, dry_run: true, accounts: chosen.map((a) => ({ id: a.id, from: a.bundle })) });
  const started: { id: string; from: string | null; operation?: string; error?: string }[] = [];
  for (const a of chosen) {
    try {
      started.push({ id: a.id, from: a.bundle, operation: await startDeploy(c.env, principal, a, 'update') });
    } catch (e) {
      started.push({ id: a.id, from: a.bundle, error: e instanceof ApiError ? e.code : 'internal' });
    }
  }
  // The first steps run now, one account after another; the per-minute cron carries on.
  c.executionCtx.waitUntil(
    (async () => {
      for (const s of started) if (s.operation) await runDeploy(c.env, s.operation).catch((e: unknown) => console.error('rollout', s.id, e));
    })(),
  );
  return c.json({ bundle: EDGE_SHA256, accounts: started }, 202);
});

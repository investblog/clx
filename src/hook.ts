// What clx-edge workers send to clx.cx (docs/spec.md §4, §7). The account is found by the worker
// key alone (`Bearer EDGE_KEY` → SHA-256 → the current hash, or the previous one for a day after a
// reinstall); the body never names it. Stage 3: `setup_ok`.
import { Hono } from 'hono';
import { confirmSetup } from './cf/deploy';
import type { EdgeAccount } from './cf/connect';
import { sha256 } from './lib/crypto';
import type { Env } from './types';

export const hook = new Hono<{ Bindings: Env }>();

const MAX_BODY = 2048;

hook.onError((e, c) => {
  console.error('hook', e instanceof Error ? e.message : e);
  return c.json({ error: 'retry' }, 502);
});

hook.post('/setup', async (c) => {
  const key = c.req.header('authorization')?.match(/^Bearer (.{20,200})$/u)?.[1];
  const hash = key ? await sha256(key) : null;
  const edge = hash
    ? await c.env.DB.prepare('SELECT * FROM edge_accounts WHERE edge_key_hash = ?1 OR (edge_key_prev_hash = ?1 AND edge_key_prev_until > ?2)').bind(hash, Date.now()).first<EdgeAccount>()
    : null;
  if (!edge) return c.json({ error: 'unauthorized' }, 401);
  const raw = await c.req.text();
  let body: Record<string, unknown> = {};
  try {
    if (raw.length <= MAX_BODY) body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // refused below
  }
  const report = { deployment_id: body.deployment_id, bundle: body.bundle, schema: body.schema };
  if (typeof report.deployment_id !== 'string' || typeof report.bundle !== 'string' || !(report.schema === null || Number.isInteger(report.schema)) || Object.keys(body).length !== 3)
    return c.json({ error: 'invalid' }, 400);
  const outcome = await confirmSetup(c.env, edge, report as { deployment_id: string; bundle: string; schema: number | null });
  // Not this deployment (an old or delayed report) or busy: the worker tries again next minute.
  return outcome === 'ok' ? c.json({ ok: true }) : c.json({ error: outcome }, outcome === 'busy' ? 503 : 409);
});

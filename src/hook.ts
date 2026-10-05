// What clx-edge workers send to clx.cx (docs/spec.md §4, §7). The account is found by the worker
// key alone (`Bearer EDGE_KEY` → SHA-256 → the current hash, or the previous one for a day after a
// reinstall); the body never names it. `setup_ok` (stage 3) and the pushes of totals (stage 4c).
import { Hono, type Context } from 'hono';
import { PUSH_BYTES } from '../edge/contract';
import { confirmSetup } from './cf/deploy';
import type { EdgeAccount } from './cf/connect';
import { sha256 } from './lib/crypto';
import { parseBody, receive } from './push';
import type { Env } from './types';

export const hook = new Hono<{ Bindings: Env }>();

const MAX_BODY = 2048;

hook.onError((e, c) => {
  console.error('hook', e instanceof Error ? e.message : e);
  return c.json({ error: 'retry' }, 502);
});

async function edgeOf(c: Context<{ Bindings: Env }>): Promise<EdgeAccount | null> {
  const key = c.req.header('authorization')?.match(/^Bearer (.{20,200})$/u)?.[1];
  if (!key) return null;
  return c.env.DB.prepare('SELECT * FROM edge_accounts WHERE edge_key_hash = ?1 OR (edge_key_prev_hash = ?1 AND edge_key_prev_until > ?2)').bind(await sha256(key), Date.now()).first<EdgeAccount>();
}

/** The body as text, or null past `max` bytes — read no further than that. */
async function bounded(req: Request, max: number): Promise<string | null> {
  if (Number(req.headers.get('content-length') ?? 0) > max) return null;
  const reader = req.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(n);
  let at = 0;
  for (const c of chunks) bytes.set(c, (at += c.byteLength) - c.byteLength);
  return new TextDecoder().decode(bytes);
}

hook.post('/setup', async (c) => {
  const edge = await edgeOf(c);
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

hook.post('/push', async (c) => {
  const edge = await edgeOf(c);
  if (!edge) return c.json({ error: 'unauthorized' }, 401);
  const raw = await bounded(c.req.raw, PUSH_BYTES);
  if (raw === null) return c.json({ error: 'too_large' }, 413);
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // refused below
  }
  const body = parseBody(parsed);
  if (!body) return c.json({ error: 'invalid' }, 400);
  return c.json(await receive(c.env.DB, edge, body, Date.now()));
});

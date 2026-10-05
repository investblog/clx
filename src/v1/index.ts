// The management API (docs/spec.md §15). The page is a thin client over the same endpoints.
// Stage 2: who am I, API keys, connecting Cloudflare accounts.
import { Hono, type Context } from 'hono';
import { CfError } from '../cf/api';
import { accountView, connect, disconnect, type EdgeAccount } from '../cf/connect';
import { sha256 } from '../lib/crypto';
import { LIMITS, planOf, SCOPES } from '../limits';
import type { Env, Principal } from '../types';
import { KEY_PREFIX, mayTouch, principalOf, requireScope, requireSession } from './auth';
import { ApiError, errorBody, fail, newId } from './http';
import { canonicalPath, IDEM_TTL, idempotent, type Answer } from './idempotency';

type C = Context<{ Bindings: Env }>;
const MAX_BODY = 65_536;

async function bodyOf(c: C): Promise<Record<string, unknown>> {
  if (Number(c.req.header('content-length') ?? 0) > MAX_BODY) fail(413, 'payload_too_large', 'The request body is over 64 KB.');
  const raw = await c.req.text();
  if (raw.length > MAX_BODY) fail(413, 'payload_too_large', 'The request body is over 64 KB.');
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    // reported below
  }
  return fail(400, 'invalid_request', 'The body must be a JSON object.');
}

const send = (c: C, a: Answer) => c.json(a.body as object, a.status as 200);

/**
 * One endpoint: who calls, may they, and — for a mutation — the idempotency record around the
 * handler (§15). `replay` turns a stored answer back into a response.
 */
function handle(opts: { scope?: string; session?: boolean; replay?: (stored: { status: number; answer: unknown }) => Answer }, run: (c: C, p: Principal, body: Record<string, unknown>, idemRef: string | null) => Promise<Answer>) {
  return async (c: C) => {
    const p = await principalOf(c);
    if (opts.session) requireSession(p);
    if (opts.scope) requireScope(p, opts.scope);
    if (c.req.method === 'GET') return send(c, await run(c, p, {}, null));
    const body = await bodyOf(c);
    const key = c.req.header('idempotency-key');
    if (!key) {
      if (p.via === 'key') fail(400, 'invalid_request', 'Mutating calls with an API key need an Idempotency-Key header.');
      return send(c, await run(c, p, body, null));
    }
    const replay = opts.replay ?? ((s) => ({ status: s.status, body: s.answer }));
    const path = canonicalPath(new URL(c.req.url));
    const idemRef = await sha256(`${p.id}|${c.req.method}|${path}|${key}`);
    return send(c, await idempotent(c.env.DB, { principal: p.id, method: c.req.method, path, key, body }, replay, () => run(c, p, body, idemRef)));
  };
}

export const v1 = new Hono<{ Bindings: Env }>();

v1.onError((e, c) => {
  if (e instanceof ApiError) return c.json(errorBody(e), e.status as 400);
  if (e instanceof CfError) {
    console.error('cloudflare', e.message);
    return c.json({ error: { code: 'cloudflare_unavailable', message: 'Cloudflare did not answer as expected; retry shortly.', details: { status: e.status } } }, 502);
  }
  console.error('v1', e);
  return c.json({ error: { code: 'internal', message: 'Something went wrong on our side; retry shortly.' } }, 500);
});

v1.get(
  '/me',
  handle({}, async (c, p) => {
    const user = (await c.env.DB.prepare('SELECT id, email FROM users WHERE id = ?').bind(p.userId).first<{ id: number; email: string }>())!;
    const use = await c.env.DB.prepare(
      "SELECT (SELECT count(*) FROM edge_accounts WHERE user_id = ?1 AND state != 'pending') AS cf_accounts, (SELECT count(*) FROM api_keys WHERE user_id = ?1 AND revoked_at IS NULL) AS api_keys",
    )
      .bind(p.userId)
      .first<{ cf_accounts: number; api_keys: number }>();
    return { status: 200, body: { user, plan: planOf(p.plan), limits: LIMITS[planOf(p.plan)], use, via: p.via } };
  }),
);

// ---- API keys: issued, listed and revoked from a page session only ----

const keyView = (k: { id: string; prefix: string; scopes: string; allow_accounts: string | null; allow_ips: string | null; created_at: number; last_used_day: number | null }) => ({
  id: k.id,
  prefix: k.prefix,
  scopes: k.scopes.split(','),
  allow_accounts: k.allow_accounts?.split(',') ?? null,
  allow_ips: k.allow_ips?.split(',') ?? null,
  created_at: new Date(k.created_at).toISOString(),
  last_used: k.last_used_day === null ? null : new Date(k.last_used_day * 86_400_000).toISOString().slice(0, 10),
});

function stringList(v: unknown, field: string, re: RegExp, max: number): string[] | null {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v) || !v.length || v.length > max || !v.every((x) => typeof x === 'string' && re.test(x))) fail(400, 'invalid_request', `"${field}" must be a non-empty list of at most ${max} valid values.`, { field });
  return [...new Set(v as string[])];
}

v1.post(
  '/keys',
  handle(
    {
      session: true,
      // Only an issued key is stored without its secret; a stored refusal replays as it was.
      replay: (s) =>
        s.status === 201
          ? { status: 409, body: { error: { code: 'key_already_issued', message: 'This Idempotency-Key already issued a key; it is shown once. Revoke it and issue a new one if it was lost.', details: s.answer } } }
          : { status: s.status, body: s.answer },
    },
    async (c, p, body, idemRef) => {
      if (planOf(p.plan) !== 'api') fail(403, 'plan_required', 'API keys come with the api plan.');
      // A retry of a call that died after its insert finds that key, and never shows it again.
      const issued = idemRef ? await c.env.DB.prepare('SELECT id FROM api_keys WHERE idem_ref = ? AND created_at > ?').bind(idemRef, Date.now() - IDEM_TTL).first<{ id: string }>() : null;
      if (issued) fail(409, 'key_already_issued', 'This Idempotency-Key already issued a key; it is shown once. Revoke it and issue a new one if it was lost.', { key_id: issued.id });
      const scopes = stringList(body.scopes, 'scopes', /^[a-z]+$/u, SCOPES.length) ?? fail(400, 'invalid_request', '"scopes" is required.', { field: 'scopes' });
      const unknown = scopes.filter((s) => !(SCOPES as readonly string[]).includes(s));
      if (unknown.length) fail(400, 'invalid_request', `Unknown scopes: ${unknown.join(', ')}.`, { field: 'scopes' });
      const accounts = stringList(body.allow_accounts, 'allow_accounts', /^[0-9a-f]{32}$/u, LIMITS.api.cfAccounts);
      const ips = stringList(body.allow_ips, 'allow_ips', /^[0-9a-f.:]{2,45}$/u, 20);
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const key = KEY_PREFIX + btoa(String.fromCharCode(...bytes)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
      const row = { id: newId(), prefix: key.slice(0, 8), scopes: scopes.join(','), allow_accounts: accounts?.join(',') ?? null, allow_ips: ips?.join(',') ?? null, created_at: Date.now(), last_used_day: null };
      // The limit is part of the insert, so two calls at once cannot both pass it.
      const added = await c.env.DB.prepare(
        'INSERT INTO api_keys (id, user_id, prefix, key_hash, scopes, allow_accounts, allow_ips, created_at, idem_ref) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?10 WHERE (SELECT count(*) FROM api_keys WHERE user_id = ?2 AND revoked_at IS NULL) < ?9',
      )
        .bind(row.id, p.userId, row.prefix, await sha256(key), row.scopes, row.allow_accounts, row.allow_ips, row.created_at, LIMITS.api.apiKeys, idemRef)
        .run();
      if (!added.meta.changes) fail(403, 'limit_reached', `At most ${LIMITS.api.apiKeys} API keys; revoke one first.`, { limit: LIMITS.api.apiKeys });
      return { status: 201, body: { ...keyView(row), key }, stored: { key_id: row.id } };
    },
  ),
);

v1.get(
  '/keys',
  handle({ session: true }, async (c, p) => {
    const rows = (await c.env.DB.prepare('SELECT * FROM api_keys WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at').bind(p.userId).all<Parameters<typeof keyView>[0]>()).results;
    return { status: 200, body: { keys: rows.map(keyView) } };
  }),
);

v1.delete(
  '/keys/:id',
  handle({ session: true }, async (c, p) => {
    const done = await c.env.DB.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL').bind(Date.now(), c.req.param('id'), p.userId).run();
    if (!done.meta.changes) fail(404, 'not_found', 'No such key.');
    return { status: 200, body: { ok: true } };
  }),
);

// ---- Cloudflare accounts (§3) ----

const BOOTSTRAP = /^[A-Za-z0-9_-]{20,200}$/u;

async function accountOf(c: C, p: Principal): Promise<EdgeAccount> {
  const edge = await c.env.DB.prepare('SELECT * FROM edge_accounts WHERE id = ? AND user_id = ?').bind(c.req.param('id'), p.userId).first<EdgeAccount>();
  if (!edge || !mayTouch(p, edge.cf_account_id)) return fail(404, 'not_found', 'No such account.');
  return edge;
}

/** Reading accounts takes `accounts`, or `sites` — a build pipeline needs the account ids (§15). */
function requireAccountRead(p: Principal): void {
  if (!p.scopes.has('accounts') && !p.scopes.has('sites')) fail(403, 'scope_required', 'Reading accounts needs the "accounts" or "sites" scope.', { scope: 'accounts' });
}

v1.post(
  '/accounts',
  handle({ scope: 'accounts' }, async (c, p, body) => {
    const cfAccountId = typeof body.cf_account_id === 'string' ? body.cf_account_id : '';
    const bootstrap = typeof body.bootstrap_token === 'string' ? body.bootstrap_token : '';
    if (!/^[0-9a-f]{32}$/u.test(cfAccountId)) fail(400, 'invalid_request', '"cf_account_id" must be 32 hex characters.', { field: 'cf_account_id' });
    if (!BOOTSTRAP.test(bootstrap)) fail(400, 'invalid_request', '"bootstrap_token" is missing or malformed.', { field: 'bootstrap_token' });
    if (!mayTouch(p, cfAccountId)) fail(403, 'scope_required', 'This key may not touch that Cloudflare account.');
    // 202: the account goes on to the install (§4, stage 3); the caller polls GET for its state.
    return { status: 202, body: { account: accountView(await connect(c.env, p, cfAccountId, bootstrap)) } };
  }),
);

v1.get(
  '/accounts',
  handle({}, async (c, p) => {
    requireAccountRead(p);
    const rows = (await c.env.DB.prepare('SELECT * FROM edge_accounts WHERE user_id = ? ORDER BY created_at').bind(p.userId).all<EdgeAccount>()).results;
    return { status: 200, body: { accounts: rows.filter((a) => mayTouch(p, a.cf_account_id)).map(accountView) } };
  }),
);

v1.get(
  '/accounts/:id',
  handle({}, async (c, p) => {
    requireAccountRead(p);
    return { status: 200, body: { account: accountView(await accountOf(c, p)) } };
  }),
);

v1.post(
  '/accounts/:id/token',
  handle({ scope: 'accounts' }, async (c, p, body) => {
    const edge = await accountOf(c, p);
    const bootstrap = typeof body.bootstrap_token === 'string' ? body.bootstrap_token : '';
    if (!BOOTSTRAP.test(bootstrap)) fail(400, 'invalid_request', '"bootstrap_token" is missing or malformed.', { field: 'bootstrap_token' });
    return { status: 200, body: { account: accountView(await connect(c.env, p, edge.cf_account_id, bootstrap, edge)) } };
  }),
);

v1.delete(
  '/accounts/:id',
  handle({ scope: 'accounts' }, async (c, p) => ({ status: 200, body: { ok: true, ...(await disconnect(c.env, await accountOf(c, p))) } })),
);

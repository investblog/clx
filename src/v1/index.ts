// The management API (docs/spec.md §15). The page is a thin client over the same endpoints.
// Stage 2: who am I, API keys, connecting Cloudflare accounts. Stage 3: installing clx-edge.
// Stage 4: sites and their reports. Stage 5: the link host and short links.
import { Hono, type Context } from 'hono';
import { CfError } from '../cf/api';
import { accountView, connect, workingToken, type EdgeAccount } from '../cf/connect';
import { disconnect, runDeploy, startDeploy } from '../cf/deploy';
import { addLink, deleteLink, linkHostView, linkView, liveLinkHost, patchLink, setLinkHost, type LinkRow } from '../cf/links';
import { addSite, deleteSite, listZones, patchSite, rotateSite, siteView, syncAccount, validHost, type SiteRow } from '../cf/sites';
import { verifyPassword } from '../auth/password';
import { sha256 } from '../lib/crypto';
import { generateMatrix, renderSvg } from '../qr';
import { LIMITS, planOf, SCOPES } from '../limits';
import { linkReport, PERIODS, siteReport, type Period } from '../report';
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

/** Work that goes on after the answer; the per-minute cron resumes it if this run dies. */
const background = (c: C, work: Promise<unknown>) => c.executionCtx.waitUntil(work.catch((e: unknown) => console.error('background', e)));

/** Start the install of a connected account and run its first steps after the answer. */
async function install(c: C, p: Principal, edge: EdgeAccount): Promise<EdgeAccount> {
  const opId = await startDeploy(c.env, p.id, edge, 'install');
  background(c, runDeploy(c.env, opId));
  return (await c.env.DB.prepare('SELECT * FROM edge_accounts WHERE id = ?').bind(edge.id).first<EdgeAccount>())!;
}

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
    const row = (await c.env.DB.prepare('SELECT id, email, email_confirmed_at FROM users WHERE id = ?').bind(p.userId).first<{ id: number; email: string; email_confirmed_at: number | null }>())!;
    const user = { id: row.id, email: row.email, email_confirmed: row.email_confirmed_at !== null };
    const use = await c.env.DB.prepare(
      "SELECT (SELECT count(*) FROM edge_accounts WHERE user_id = ?1 AND state != 'pending') AS cf_accounts, (SELECT count(*) FROM api_keys WHERE user_id = ?1 AND revoked_at IS NULL) AS api_keys",
    )
      .bind(p.userId)
      .first<{ cf_accounts: number; api_keys: number }>();
    return { status: 200, body: { user, plan: planOf(p.plan), limits: LIMITS[planOf(p.plan)], use, via: p.via } };
  }),
);

/**
 * Delete the account (§9), from a page session with the password: every Cloudflare account is
 * disconnected first (§4 — clx-edge, its database and routes removed where the token still can),
 * then the totals go at once instead of after 30 days, then the user with everything of theirs.
 */
v1.delete(
  '/me',
  handle({ session: true }, async (c, p, body) => {
    const db = c.env.DB;
    const user = await db.prepare('SELECT password_hash FROM users WHERE id = ?').bind(p.userId).first<{ password_hash: string }>();
    if (!(await verifyPassword(typeof body.password === 'string' ? body.password.slice(0, 256) : '', user?.password_hash ?? null))) fail(403, 'invalid_password', 'The password is wrong.', { field: 'password' });
    // An operation running on an account (an install, a renewal) would refuse the disconnect halfway:
    // refused here, before anything is ended.
    if (await db.prepare('SELECT 1 FROM edge_accounts WHERE user_id = ? AND lease_until > ?').bind(p.userId, Date.now()).first())
      fail(409, 'operation_in_progress', 'An operation on one of your Cloudflare accounts is running; retry in a minute.');
    // The fence first: every session and API key of the user ends, so nothing of theirs can start a
    // new connect while the accounts are being disconnected (this call runs on).
    await db.batch([
      db.prepare('UPDATE users SET session_version = session_version + 1 WHERE id = ?').bind(p.userId),
      db.prepare('UPDATE api_keys SET revoked_at = coalesce(revoked_at, ?) WHERE user_id = ?').bind(Date.now(), p.userId),
    ]);
    const keys = (await db.prepare('SELECT id FROM api_keys WHERE user_id = ?').bind(p.userId).all<{ id: string }>()).results.map((k) => `k:${k.id}`);
    const left: string[] = [];
    const revoke: string[] = [];
    const ids: string[] = [];
    // Again until none is left: a connect that began before the fence may add one meanwhile.
    for (let round = 0; round < 3; round++) {
      const accounts = (await db.prepare('SELECT * FROM edge_accounts WHERE user_id = ?').bind(p.userId).all<EdgeAccount>()).results;
      if (!accounts.length) break;
      for (const a of accounts) {
        const r = await disconnect(c.env, p.id, a);
        ids.push(a.id);
        left.push(...r.left);
        if (r.revoke_token) revoke.push(r.revoke_token);
      }
    }
    // An account still there — a connect that began before the fence and is still running — is
    // never deleted by the cascade behind its back (its token would be left in Cloudflare): the
    // delete stops here; signed in again, the user repeats it once that connect is over.
    // What was disconnected goes at once either way — a repeat would not find these accounts again.
    const accountIds = JSON.stringify(ids);
    const disconnected = [
      ...['hourly', 'daily', 'departed'].map((t) => db.prepare(`DELETE FROM ${t} WHERE account_id IN (SELECT value FROM json_each(?))`).bind(accountIds)),
      db.prepare('DELETE FROM cf_calls WHERE edge_account_id IN (SELECT value FROM json_each(?))').bind(accountIds),
    ];
    if (await db.prepare('SELECT 1 FROM edge_accounts WHERE user_id = ?').bind(p.userId).first()) {
      await db.batch(disconnected);
      fail(409, 'operation_in_progress', 'A Cloudflare account was being connected meanwhile; sign in again and repeat the delete in a minute.', { left, revoke_tokens: revoke });
    }
    const email = await db.prepare('SELECT email FROM users WHERE id = ?').bind(p.userId).first<string>('email');
    await db.batch([
      ...disconnected,
      // The keys' idempotency records; the session's own go after this answer is stored, within 24 hours.
      db.prepare('DELETE FROM idempotency WHERE principal IN (SELECT value FROM json_each(?))').bind(JSON.stringify(keys)),
      db.prepare('DELETE FROM email_sends WHERE email = ?').bind(email),
      // Keys, sites, links, link hosts, e-mail tokens and what is left of the accounts go with the
      // user (ON DELETE CASCADE).
      db.prepare('DELETE FROM users WHERE id = ?').bind(p.userId),
    ]);
    return { status: 200, body: { ok: true, left, revoke_tokens: revoke } };
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
      // Every plan has keys (ADR 0014): one on free, more on api.
      const limits = LIMITS[planOf(p.plan)];
      // A retry of a call that died after its insert finds that key, and never shows it again.
      const issued = idemRef ? await c.env.DB.prepare('SELECT id FROM api_keys WHERE idem_ref = ? AND created_at > ?').bind(idemRef, Date.now() - IDEM_TTL).first<{ id: string }>() : null;
      if (issued) fail(409, 'key_already_issued', 'This Idempotency-Key already issued a key; it is shown once. Revoke it and issue a new one if it was lost.', { key_id: issued.id });
      const scopes = stringList(body.scopes, 'scopes', /^[a-z]+$/u, SCOPES.length) ?? fail(400, 'invalid_request', '"scopes" is required.', { field: 'scopes' });
      const unknown = scopes.filter((s) => !(SCOPES as readonly string[]).includes(s));
      if (unknown.length) fail(400, 'invalid_request', `Unknown scopes: ${unknown.join(', ')}.`, { field: 'scopes' });
      const accounts = stringList(body.allow_accounts, 'allow_accounts', /^[0-9a-f]{32}$/u, limits.cfAccounts);
      const ips = stringList(body.allow_ips, 'allow_ips', /^[0-9a-f.:]{2,45}$/u, 20);
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const key = KEY_PREFIX + btoa(String.fromCharCode(...bytes)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
      const row = { id: newId(), prefix: key.slice(0, 8), scopes: scopes.join(','), allow_accounts: accounts?.join(',') ?? null, allow_ips: ips?.join(',') ?? null, created_at: Date.now(), last_used_day: null };
      // The limit is part of the insert, so two calls at once cannot both pass it.
      const added = await c.env.DB.prepare(
        'INSERT INTO api_keys (id, user_id, prefix, key_hash, scopes, allow_accounts, allow_ips, created_at, idem_ref) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?10 WHERE (SELECT count(*) FROM api_keys WHERE user_id = ?2 AND revoked_at IS NULL) < ?9',
      )
        .bind(row.id, p.userId, row.prefix, await sha256(key), row.scopes, row.allow_accounts, row.allow_ips, row.created_at, limits.apiKeys, idemRef)
        .run();
      if (!added.meta.changes) fail(403, 'limit_reached', `At most ${limits.apiKeys} API key(s) on the ${planOf(p.plan)} plan; revoke one first.`, { limit: limits.apiKeys });
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
    // Before the address is confirmed the user can sign in but not connect an account (§9).
    if (!(await c.env.DB.prepare('SELECT email_confirmed_at IS NOT NULL AS ok FROM users WHERE id = ?').bind(p.userId).first<number>('ok')))
      fail(403, 'email_unconfirmed', 'Confirm your e-mail address first: the link is in the e-mail clx sent at sign-up.');
    // 202: a connected account goes on to the install (§4); the caller polls GET for its state.
    const edge = await connect(c.env, p, cfAccountId, bootstrap);
    return { status: 202, body: { account: accountView(edge.state === 'connected' ? await install(c, p, edge) : edge) } };
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
    const edge = await accountOf(c, p);
    const op = edge.operation_id
      ? await c.env.DB.prepare('SELECT kind, state, step, data, updated_at FROM operations WHERE id = ?').bind(edge.operation_id).first<{ kind: string; state: string; step: string; data: string; updated_at: number }>()
      : null;
    const operation = op ? { kind: op.kind, state: op.state, step: op.step, error: (JSON.parse(op.data) as { error?: unknown }).error ?? null, updated_at: new Date(op.updated_at).toISOString() } : null;
    const host = await liveLinkHost(c.env.DB, edge.id);
    return { status: 200, body: { account: { ...accountView(edge), operation, link_host: host ? linkHostView(host, edge.synced_revision) : null } } };
  }),
);

v1.get(
  '/accounts/:id/zones',
  handle({}, async (c, p) => {
    requireAccountRead(p);
    const edge = await accountOf(c, p);
    return { status: 200, body: await listZones(await workingToken(c.env, edge), edge.cf_account_id) };
  }),
);

v1.put(
  '/accounts/:id/link-host',
  handle({ scope: 'sites' }, async (c, p, body) => {
    const edge = await accountOf(c, p);
    const host = typeof body.host === 'string' ? body.host.trim().toLowerCase().replace(/\.$/u, '') : '';
    const set = await setLinkHost(c.env, p, edge, host);
    sync(c, p, edge.id);
    return { status: 202, body: { link_host: linkHostView(set, edge.synced_revision) } };
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

v1.post(
  '/accounts/:id/install',
  handle({ scope: 'accounts' }, async (c, p) => ({ status: 202, body: { account: accountView(await install(c, p, await accountOf(c, p))) } })),
);

v1.delete(
  '/accounts/:id',
  handle({ scope: 'accounts' }, async (c, p) => ({ status: 200, body: { ok: true, ...(await disconnect(c.env, p.id, await accountOf(c, p))) } })),
);

// ---- Sites (§5) ----

/** Excluded path prefixes: up to 50, each `/…` of at most 200 characters. */
function excludedOf(v: unknown): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 50 || !v.every((x) => typeof x === 'string' && /^\/[^\s?#]{0,199}$/u.test(x)))
    fail(400, 'invalid_request', '"excluded_paths" must be a list of at most 50 path prefixes starting with "/".', { field: 'excluded_paths' });
  return [...new Set(v as string[])];
}

/** A site of the caller, with its account; one outside the key's allow list is not found. */
async function siteOf(c: C, p: Principal): Promise<{ site: SiteRow; edge: EdgeAccount }> {
  const site = await c.env.DB.prepare('SELECT * FROM sites WHERE id = ? AND user_id = ?').bind(c.req.param('id'), p.userId).first<SiteRow>();
  const edge = site ? await c.env.DB.prepare('SELECT * FROM edge_accounts WHERE id = ?').bind(site.account_id).first<EdgeAccount>() : null;
  if (!site || !edge || !mayTouch(p, edge.cf_account_id)) return fail(404, 'not_found', 'No such site.');
  return { site, edge };
}

/** Sync the account's config after the answer (§6); the per-minute cron catches up if this fails. */
const sync = (c: C, p: Principal, accountId: string) => background(c, syncAccount(c.env, accountId, p.id));

v1.post(
  '/sites',
  handle({ scope: 'sites' }, async (c, p, body) => {
    const accountId = typeof body.account_id === 'string' ? body.account_id : '';
    const host = typeof body.host === 'string' ? body.host.trim().toLowerCase().replace(/\.$/u, '') : '';
    if (!validHost(host)) fail(400, 'invalid_request', '"host" must be a host name such as example.com.', { field: 'host' });
    const excluded = excludedOf(body.excluded_paths);
    const edge = await c.env.DB.prepare('SELECT * FROM edge_accounts WHERE id = ? AND user_id = ?').bind(accountId, p.userId).first<EdgeAccount>();
    if (!edge || !mayTouch(p, edge.cf_account_id)) return fail(404, 'not_found', 'No such account.', { field: 'account_id' });
    const site = await addSite(c.env, p, edge, host, excluded);
    sync(c, p, edge.id);
    return { status: 202, body: { site: siteView(site, edge.synced_revision) } };
  }),
);

v1.get(
  '/sites',
  handle({ scope: 'sites' }, async (c, p) => {
    const accountId = c.req.query('account_id') ?? null;
    const rows = (
      await c.env.DB.prepare(
        "SELECT s.*, e.cf_account_id, e.synced_revision FROM sites s JOIN edge_accounts e ON e.id = s.account_id WHERE s.user_id = ?1 AND s.state != 'deleted' AND (?2 IS NULL OR s.account_id = ?2) ORDER BY s.created_at",
      )
        .bind(p.userId, accountId)
        .all<SiteRow & { cf_account_id: string; synced_revision: number }>()
    ).results;
    return { status: 200, body: { sites: rows.filter((r) => mayTouch(p, r.cf_account_id)).map((r) => siteView(r, r.synced_revision)) } };
  }),
);

v1.get(
  '/sites/:id',
  handle({ scope: 'sites' }, async (c, p) => {
    const { site, edge } = await siteOf(c, p);
    return { status: 200, body: { site: siteView(site, edge.synced_revision) } };
  }),
);

v1.get(
  '/sites/:id/report',
  handle({ scope: 'reports' }, async (c, p) => {
    const { site, edge } = await siteOf(c, p);
    const period = c.req.query('period') ?? 'today';
    if (!Object.hasOwn(PERIODS, period)) fail(400, 'invalid_request', `"period" must be one of ${Object.keys(PERIODS).join(', ')}.`, { field: 'period' });
    const report = await siteReport(c.env, { id: p.userId, plan: p.plan }, edge, site.target, period as Period, c.req.query('breakdowns') === '1');
    return { status: 200, body: { report } };
  }),
);

v1.patch(
  '/sites/:id',
  handle({ scope: 'sites' }, async (c, p, body) => {
    const { site, edge } = await siteOf(c, p);
    const updated = await patchSite(c.env, site, excludedOf(body.excluded_paths));
    sync(c, p, edge.id);
    return { status: 200, body: { site: siteView(updated, edge.synced_revision) } };
  }),
);

v1.post(
  '/sites/:id/rotate',
  handle({ scope: 'sites' }, async (c, p) => {
    const { site, edge } = await siteOf(c, p);
    const rotated = await rotateSite(c.env, p.id, edge, site);
    sync(c, p, edge.id);
    return { status: 200, body: { site: siteView(rotated, edge.synced_revision) } };
  }),
);

v1.delete(
  '/sites/:id',
  handle({ scope: 'sites' }, async (c, p) => {
    const { site, edge } = await siteOf(c, p);
    const deleted = await deleteSite(c.env, p.id, edge, site);
    sync(c, p, edge.id);
    return { status: 200, body: { site: siteView(deleted, edge.synced_revision) } };
  }),
);

// ---- Short links (§6) ----

/** A link of the caller, with its account and link host; one outside the key's allow list is not found. */
async function linkOf(c: C, p: Principal): Promise<{ link: LinkRow; edge: EdgeAccount; host: string | null }> {
  const link = await c.env.DB.prepare('SELECT * FROM links WHERE id = ? AND user_id = ?').bind(c.req.param('id'), p.userId).first<LinkRow>();
  const edge = link ? await c.env.DB.prepare('SELECT * FROM edge_accounts WHERE id = ?').bind(link.account_id).first<EdgeAccount>() : null;
  if (!link || !edge || !mayTouch(p, edge.cf_account_id)) return fail(404, 'not_found', 'No such link.');
  return { link, edge, host: (await liveLinkHost(c.env.DB, edge.id))?.host ?? null };
}

v1.post(
  '/links',
  handle({ scope: 'links' }, async (c, p, body) => {
    const accountId = typeof body.account_id === 'string' ? body.account_id : '';
    const edge = await c.env.DB.prepare('SELECT * FROM edge_accounts WHERE id = ? AND user_id = ?').bind(accountId, p.userId).first<EdgeAccount>();
    if (!edge || !mayTouch(p, edge.cf_account_id)) return fail(404, 'not_found', 'No such account.', { field: 'account_id' });
    const link = await addLink(c.env, p, edge, { code: body.code, url: body.url, rules: body.rules });
    sync(c, p, edge.id);
    return { status: 201, body: { link: linkView(link, (await liveLinkHost(c.env.DB, edge.id))?.host ?? null, edge.synced_revision) } };
  }),
);

v1.get(
  '/links',
  handle({ scope: 'links' }, async (c, p) => {
    const accountId = c.req.query('account_id') ?? null;
    const rows = (
      await c.env.DB.prepare(
        "SELECT l.*, e.cf_account_id, e.synced_revision, h.host AS link_host FROM links l JOIN edge_accounts e ON e.id = l.account_id LEFT JOIN link_hosts h ON h.account_id = l.account_id AND h.state != 'deleted' WHERE l.user_id = ?1 AND l.state != 'deleted' AND (?2 IS NULL OR l.account_id = ?2) ORDER BY l.created_at",
      )
        .bind(p.userId, accountId)
        .all<LinkRow & { cf_account_id: string; synced_revision: number; link_host: string | null }>()
    ).results;
    const mine = rows.filter((r) => mayTouch(p, r.cf_account_id));
    // Totals are the `reports` scope's (§15): a key with `links` alone sees the links, not their clicks.
    if (!p.scopes.has('reports')) return { status: 200, body: { links: mine.map((r) => linkView(r, r.link_host, r.synced_revision)) } };
    // Clicks of the last 7 closed days, from clx.cx's own totals (§10): today is in the report.
    const day = Math.floor(Date.now() / 86_400_000);
    const clicks = new Map(
      (
        await c.env.DB.prepare('SELECT d.target, sum(d.views) AS n FROM daily d JOIN links l ON l.account_id = d.account_id AND l.target = d.target WHERE l.user_id = ?1 AND d.day >= ?2 AND d.day < ?3 GROUP BY d.target')
          .bind(p.userId, day - 7, day)
          .all<{ target: string; n: number }>()
      ).results.map((r) => [r.target, r.n]),
    );
    return { status: 200, body: { links: mine.map((r) => ({ ...linkView(r, r.link_host, r.synced_revision), clicks_7d: clicks.get(r.target) ?? 0 })) } };
  }),
);

// The QR code of a link (§6): an SVG of its address with `?q`, so scans are counted as source qr.
// Not JSON, so not through handle(): the same auth and scope, the image as the body.
v1.get('/links/:id/qr.svg', async (c) => {
  const p = await principalOf(c);
  requireScope(p, 'links');
  const { link, host } = await linkOf(c, p);
  if (link.state === 'deleted') fail(404, 'not_found', 'No such link.');
  if (!host) fail(409, 'link_host_required', 'This account has no link host.');
  const size = c.req.query('size');
  if (size !== undefined && !/^(6[4-9]|[7-9]\d|[1-9]\d{2,3})$/u.test(size)) fail(400, 'invalid_request', '"size" must be an integer 64–9999 (pixels); without it the SVG scales to its container.', { field: 'size' });
  const svg = renderSvg(generateMatrix(`https://${host}/${link.code}?q`, { ecc: 'M' }), size ? { size: Number(size) } : {});
  return c.body(svg, 200, { 'content-type': 'image/svg+xml', 'content-disposition': `inline; filename="${link.code}.svg"` });
});

v1.get(
  '/links/:id/report',
  handle({ scope: 'reports' }, async (c, p) => {
    const { link, edge } = await linkOf(c, p);
    const period = c.req.query('period') ?? 'today';
    if (!Object.hasOwn(PERIODS, period)) fail(400, 'invalid_request', `"period" must be one of ${Object.keys(PERIODS).join(', ')}.`, { field: 'period' });
    const report = await linkReport(c.env, { id: p.userId, plan: p.plan }, edge, link.target, period as Period, c.req.query('breakdowns') === '1');
    return { status: 200, body: { report } };
  }),
);

v1.get(
  '/links/:id',
  handle({ scope: 'links' }, async (c, p) => {
    const { link, edge, host } = await linkOf(c, p);
    return { status: 200, body: { link: linkView(link, host, edge.synced_revision) } };
  }),
);

v1.patch(
  '/links/:id',
  handle({ scope: 'links' }, async (c, p, body) => {
    const { link, edge, host } = await linkOf(c, p);
    if (body.code !== undefined) fail(400, 'invalid_request', 'A link keeps its code; create a new link for another one.', { field: 'code' });
    const updated = await patchLink(c.env, p, link, { url: body.url, rules: body.rules });
    sync(c, p, edge.id);
    return { status: 200, body: { link: linkView(updated, host, edge.synced_revision) } };
  }),
);

v1.delete(
  '/links/:id',
  handle({ scope: 'links' }, async (c, p) => {
    const { link, edge, host } = await linkOf(c, p);
    const deleted = await deleteLink(c.env, link);
    sync(c, p, edge.id);
    return { status: 200, body: { link: linkView(deleted, host, edge.synced_revision) } };
  }),
);

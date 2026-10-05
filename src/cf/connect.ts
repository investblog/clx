// Connecting a Cloudflare account (docs/spec.md §3): a bootstrap token makes a working token for
// one account, the working token is checked and stored sealed, the bootstrap token is deleted —
// all within one request, so the bootstrap token never outlives it. Every step is recorded in
// `operations` before the next one starts (§15), and one operation at a time holds an account
// through a lease with an owner: each step renews it, and a step that finds it lost stops. A
// retried request resumes: tokens of this account's earlier operations (`clx-<operation id>` —
// names clx can prove it made) are deleted and made again, and an operation that got past its
// checks is finished even when its bootstrap token is already gone. The sealed token lives in the
// account's own row, so a renewal swaps secret and metadata in one statement.
import { open, seal, type Sealed } from '../lib/crypto';
import { FREE_ACCOUNTS_CAP, LIMITS, planOf } from '../limits';
import type { Env, Principal } from '../types';
import { ApiError, fail, newId } from '../v1/http';
import { cf, CfError, cfGraphql, type CallLog } from './api';

/** The working token's rights (§3 table), by Cloudflare's catalog names. */
export const ACCOUNT_RIGHTS = ['Account Settings Read', 'Account Analytics Read', 'D1 Read', 'D1 Write', 'Workers Scripts Read', 'Workers Scripts Write'];
export const ZONE_RIGHTS = ['Zone Read', 'Workers Routes Read', 'Workers Routes Write'];
const TOKEN_TTL = 365 * 86_400_000;
const LEASE = 120_000;
/** A pending connect untouched this long has lost its bootstrap token (§15 `bootstrap_lost`). */
export const BOOTSTRAP_LOST_AFTER = 3_600_000;

interface Group {
  id: string;
  name: string;
  scopes?: string[];
}
interface Policy {
  effect: string;
  resources: Record<string, unknown>;
  permission_groups: { id: string }[];
}
interface CfToken {
  id: string;
  name: string;
  value?: string;
  policies?: Policy[];
}
interface OpData {
  token_id?: string;
  token_name?: string;
  token_expires_at?: number;
  account_name?: string;
  /** a renewal: the token it replaces, kept so a resumed finish can still delete it */
  old_token_id?: string | null;
  old_token_name?: string | null;
  /** a 403 from a probe: the token stays, the account is `permission_error` (§3 item 6) */
  permission_error?: { path: string; status: number; codes: number[] };
  warnings?: string[];
  orphans_deleted?: string[];
  error?: string;
}
export interface EdgeAccount {
  id: string;
  user_id: number;
  cf_account_id: string;
  cf_account_name: string;
  state: string;
  token_id: string | null;
  token_name: string | null;
  token_expires_at: number | null;
  key_id: string | null;
  token_sealed: string | null;
  next_sealed: string | null;
  error: string | null;
  operation_id: string | null;
  lease_until: number | null;
  lease_owner: string | null;
  token_checked_at: number;
  created_at: number;
  updated_at: number;
}

/** AAD: the ciphertext belongs to this record and this Cloudflare account only (§3 item 5). */
const aad = (edge: { id: string; cf_account_id: string }) => `${edge.id}|${edge.cf_account_id}`;

/** The public shape of a connected account (never the ciphertext). */
export function accountView(a: EdgeAccount) {
  return {
    id: a.id,
    cf_account_id: a.cf_account_id,
    name: a.cf_account_name,
    state: a.state,
    token: a.token_name ? { name: a.token_name, expires_at: a.token_expires_at ? new Date(a.token_expires_at).toISOString() : null } : null,
    error: a.error ? JSON.parse(a.error) : null,
    created_at: new Date(a.created_at).toISOString(),
  };
}

const edgeById = (db: D1Database, id: string) => db.prepare('SELECT * FROM edge_accounts WHERE id = ?').bind(id).first<EdgeAccount>();

/** Take the account for one operation, or say another one is running. */
async function lease(db: D1Database, edgeId: string, owner: string): Promise<void> {
  const now = Date.now();
  const r = await db.prepare('UPDATE edge_accounts SET lease_until = ?, lease_owner = ? WHERE id = ? AND (lease_until IS NULL OR lease_until < ?)').bind(now + LEASE, owner, edgeId, now).run();
  if (!r.meta.changes) fail(409, 'operation_in_progress', 'Another operation on this Cloudflare account is running; retry shortly.');
}
/** Only the owner releases; a second release, or one after a takeover, does nothing. */
const release = (db: D1Database, edgeId: string, owner: string) => db.prepare('UPDATE edge_accounts SET lease_until = NULL, lease_owner = NULL WHERE id = ? AND lease_owner = ?').bind(edgeId, owner).run();

/** Renew the lease before an outside change; a lost lease (a takeover) stops this request first. */
async function held(db: D1Database, edgeId: string, owner: string): Promise<void> {
  const r = await db.prepare('UPDATE edge_accounts SET lease_until = ? WHERE id = ? AND lease_owner = ?').bind(Date.now() + LEASE, edgeId, owner).run();
  if (!r.meta.changes) fail(409, 'operation_in_progress', 'This operation was taken over by a newer request.');
}

/** A write that only the lease owner may make; none made means the lease was lost. */
async function owned(stmt: D1PreparedStatement): Promise<void> {
  const r = await stmt.run();
  if (!r.meta.changes) fail(409, 'operation_in_progress', 'This operation was taken over by a newer request.');
}

/** Record a step and renew the lease; a lost lease (another request took over) stops this one. */
async function step(db: D1Database, edgeId: string, owner: string, opId: string, name: string, data: OpData, state = 'running'): Promise<void> {
  const now = Date.now();
  const [held] = await db.batch([
    db.prepare('UPDATE edge_accounts SET lease_until = ? WHERE id = ? AND lease_owner = ?').bind(now + LEASE, edgeId, owner),
    db.prepare('UPDATE operations SET step = ?, data = ?, state = ?, updated_at = ? WHERE id = ? AND changes() = 1').bind(name, JSON.stringify(data), state, now, opId),
  ]);
  if (!held!.meta.changes) fail(409, 'operation_in_progress', 'This operation was taken over by a newer request.');
}

/** Cloudflare can take a moment to accept a token it has just made: a few short retries. */
async function settled<T>(call: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await call();
    } catch (e) {
      if (i >= 4 || !(e instanceof CfError) || (e.status !== 401 && e.status !== 403)) throw e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
}

function bootstrapError(e: unknown): never {
  if (e instanceof CfError && e.status === 401) fail(400, 'invalid_bootstrap', 'The bootstrap token is invalid, expired or not for this account.');
  if (e instanceof CfError && e.status === 403) fail(400, 'bootstrap_permission_error', 'The bootstrap token lacks a right it needs (Account Settings Read, Account API Tokens Write).', { path: e.path, codes: e.codes });
  throw e;
}

/** The token is exactly what was asked for: allow, these rights, on this account and its zones only. */
function rightsMatch(policies: Policy[] | undefined, cfAccountId: string, accountGroups: string[], zoneGroups: string[]): boolean {
  const ids = (p: Policy) => p.permission_groups.map((g) => g.id).sort().join(',');
  const want = [
    { resources: JSON.stringify({ [`com.cloudflare.api.account.${cfAccountId}`]: '*' }), groups: [...accountGroups].sort().join(',') },
    { resources: JSON.stringify({ [`com.cloudflare.api.account.${cfAccountId}`]: { 'com.cloudflare.api.account.zone.*': '*' } }), groups: [...zoneGroups].sort().join(',') },
  ];
  const got = (policies ?? []).map((p) => ({ effect: p.effect, resources: JSON.stringify(p.resources), groups: ids(p) }));
  return got.length === want.length && want.every((w) => got.some((g) => g.effect === 'allow' && g.resources === w.resources && g.groups === w.groups));
}

/** Delete a token; a failure is reported, never swallowed — the token would stay live (§15). */
async function dropToken(bootstrap: string, cfAccountId: string, tokenId: string, log: CallLog): Promise<boolean> {
  return cf(bootstrap, 'DELETE', `/accounts/${cfAccountId}/tokens/${tokenId}`, undefined, log).then(
    () => true,
    (e: unknown) => e instanceof CfError && e.status === 404,
  );
}

/** All of the account's tokens, page by page. */
async function allTokens(bootstrap: string, cfAccountId: string): Promise<CfToken[]> {
  const out: CfToken[] = [];
  for (let page = 1; page <= 20; page++) {
    const batch = await cf<CfToken[]>(bootstrap, 'GET', `/accounts/${cfAccountId}/tokens?per_page=50&page=${page}`).catch(bootstrapError);
    out.push(...batch);
    if (batch.length < 50) break;
  }
  return out;
}

const verifyBootstrap = (bootstrap: string, cfAccountId: string) =>
  cf<{ id: string; status: string; expires_on?: string }>(bootstrap, 'GET', `/accounts/${cfAccountId}/tokens/verify`).catch(bootstrapError);

/**
 * Connect a Cloudflare account, or — with `renew` — give a connected one a new working token: the
 * same steps, and the old working token is replaced only once the new one works.
 */
export async function connect(env: Env, p: Principal, cfAccountId: string, bootstrap: string, renew?: EdgeAccount): Promise<EdgeAccount> {
  const db = env.DB;
  const plan = planOf(p.plan);
  const now = Date.now();
  const owner = newId();
  let edge = renew ?? (await db.prepare('SELECT * FROM edge_accounts WHERE cf_account_id = ?').bind(cfAccountId).first<EdgeAccount>());
  if (edge && edge.user_id !== p.userId) {
    // Whose account it is, is told only to someone who proves access to it.
    const v = await verifyBootstrap(bootstrap, cfAccountId);
    if (v.status !== 'active') fail(400, 'invalid_bootstrap', 'The bootstrap token is not active.');
    fail(409, 'account_taken', 'This Cloudflare account is connected to another clx account.');
  }
  if (edge && !renew && !['pending', 'bootstrap_lost'].includes(edge.state)) fail(409, 'already_connected', 'This Cloudflare account is already connected; renew its token instead.', { account_id: edge.id });

  // 1. Reserve. A new account: the record, its operation and the lease in one go, and only within
  //    the plan's limit and the service cap (§8) — checked by the insert itself, so two connects at
  //    once cannot both pass. A known account: the lease, then a new or the resumed operation.
  let opId: string;
  let data: OpData = renew ? { old_token_id: renew.token_id, old_token_name: renew.token_name } : {};
  if (!edge) {
    opId = newId();
    const id = newId();
    const cap = plan === 'api' ? -1 : FREE_ACCOUNTS_CAP;
    const rows = await db.batch([
      db
        .prepare(
          `INSERT INTO edge_accounts (id, user_id, cf_account_id, state, operation_id, lease_until, lease_owner, created_at, updated_at)
           SELECT ?1, ?2, ?3, 'pending', ?4, ?5, ?9, ?6, ?6
           WHERE (SELECT count(*) FROM edge_accounts WHERE user_id = ?2) < ?7
             AND (?8 < 0 OR (SELECT count(*) FROM edge_accounts e JOIN users u ON u.id = e.user_id WHERE u.plan = 'free') < ?8)
           ON CONFLICT (cf_account_id) DO NOTHING`,
        )
        .bind(id, p.userId, cfAccountId, opId, now + LEASE, now, LIMITS[plan].cfAccounts, cap, owner),
      db
        .prepare("INSERT INTO operations (id, user_id, kind, cf_account_id, state, step, created_at, updated_at) SELECT ?, ?, 'connect', ?, 'running', 'reserved', ?, ? WHERE changes() = 1")
        .bind(opId, p.userId, cfAccountId, now, now),
    ]);
    if (!rows[0]!.meta.changes) {
      if (await db.prepare('SELECT 1 FROM edge_accounts WHERE cf_account_id = ?').bind(cfAccountId).first()) fail(409, 'operation_in_progress', 'This Cloudflare account is being connected right now; retry shortly.');
      const mine = await db.prepare('SELECT count(*) AS n FROM edge_accounts WHERE user_id = ?').bind(p.userId).first<{ n: number }>();
      if ((mine?.n ?? 0) >= LIMITS[plan].cfAccounts) fail(403, 'limit_reached', `The ${plan} plan connects at most ${LIMITS[plan].cfAccounts} Cloudflare account(s).`, { limit: LIMITS[plan].cfAccounts });
      fail(403, 'service_full', 'clx takes no more free accounts for now; you are welcome on the waiting list.');
    }
    edge = (await edgeById(db, id))!;
  } else {
    await lease(db, edge.id, owner);
    // Read again under the lease: an operation that finished in between changed the row.
    edge = (await edgeById(db, edge.id))!;
    if (renew) {
      renew = edge;
      data = { old_token_id: edge.token_id, old_token_name: edge.token_name };
    }
    const prior = edge.operation_id ? await db.prepare('SELECT kind, state, step, data FROM operations WHERE id = ?').bind(edge.operation_id).first<{ kind: string; state: string; step: string; data: string }>() : null;
    const resumable = prior && prior.state === 'running' && prior.kind === (renew ? 'renew' : 'connect');
    if (resumable) {
      opId = edge.operation_id!;
      // A resumed renewal keeps the token it set out to replace, even if the swap already happened.
      const before = JSON.parse(prior.data) as OpData;
      if (renew && 'old_token_id' in before) data = { old_token_id: before.old_token_id, old_token_name: before.old_token_name };
      // Past its checks, with its token still held: finish without the bootstrap token.
      const tokenHeld = renew ? !!edge.next_sealed || edge.token_id === before.token_id : !!edge.token_sealed && edge.token_id === before.token_id;
      if (prior.step === 'probed' && tokenHeld) {
        try {
          return await finish(env, p, (await edgeById(db, edge.id))!, owner, opId, before, bootstrap, !!renew);
        } finally {
          await release(db, edge.id, owner);
        }
      }
    } else {
      opId = newId();
      await db.batch([
        db
          .prepare("INSERT INTO operations (id, user_id, kind, cf_account_id, state, step, data, created_at, updated_at) VALUES (?, ?, ?, ?, 'running', 'reserved', ?, ?, ?)")
          .bind(opId, p.userId, renew ? 'renew' : 'connect', cfAccountId, JSON.stringify(data), now, now),
        db.prepare('UPDATE edge_accounts SET operation_id = ?, updated_at = ? WHERE id = ?').bind(opId, now, edge.id),
      ]);
    }
  }

  const log: CallLog = { db, edgeAccountId: edge.id, principal: p.id };
  try {
    // 2. The bootstrap token is alive and belongs to this account; the account's name; the
    //    catalog ids of the rights by name.
    const verified = await verifyBootstrap(bootstrap, cfAccountId);
    if (verified.status !== 'active') fail(400, 'invalid_bootstrap', 'The bootstrap token is not active.');
    if (!verified.expires_on || Date.parse(verified.expires_on) - now > 86_400_000 + 3_600_000) data.warnings = ['bootstrap_long_lived'];
    data.account_name = (await cf<{ name: string }>(bootstrap, 'GET', `/accounts/${cfAccountId}`).catch(bootstrapError)).name;
    const catalog = await cf<Group[]>(bootstrap, 'GET', `/accounts/${cfAccountId}/tokens/permission_groups`).catch(bootstrapError);
    const pick = (names: string[], scope: string) =>
      names.map((name) => catalog.find((g) => g.name === name && (g.scopes ?? []).includes(scope))?.id ?? fail(502, 'permission_catalog', `Cloudflare's catalog has no "${name}".`));
    const accountGroups = pick(ACCOUNT_RIGHTS, 'com.cloudflare.api.account');
    const zoneGroups = pick(ZONE_RIGHTS, 'com.cloudflare.api.account.zone');

    // 3. Tokens of this account's earlier clx operations — the only names clx can prove it made —
    //    are deleted; the token a renewal replaces stays until the new one works.
    const ours = new Set(
      (await db.prepare('SELECT id FROM operations WHERE cf_account_id = ?').bind(cfAccountId).all<{ id: string }>()).results.map((o) => `clx-${o.id}`),
    );
    const keep = new Set([data.old_token_id, edge.token_id].filter(Boolean));
    const orphans = (await allTokens(bootstrap, cfAccountId)).filter((t) => ours.has(t.name) && (!renew || !keep.has(t.id)));
    for (const t of orphans) {
      await held(db, edge.id, owner);
      if (!(await dropToken(bootstrap, cfAccountId, t.id, log))) fail(502, 'orphan_not_deleted', `An earlier clx token (${t.name}) could not be deleted; retry, or revoke it in Cloudflare.`, { token: t.name });
    }
    if (orphans.length) data.orphans_deleted = orphans.map((t) => t.name);
    await step(db, edge.id, owner, opId, 'catalog', data);

    // 4. The working token, named after this operation, stored sealed in the same row before
    //    anything else can fail: from here a lost request leaves a token clx holds. A renewal
    //    keeps it in `next_sealed` until it has proven itself.
    const name = `clx-${opId}`;
    const expires = now + TOKEN_TTL;
    await held(db, edge.id, owner);
    const made = await cf<CfToken>(
      bootstrap,
      'POST',
      `/accounts/${cfAccountId}/tokens`,
      {
        name,
        expires_on: new Date(expires).toISOString().replace(/\.\d{3}Z$/u, 'Z'),
        policies: [
          { effect: 'allow', resources: { [`com.cloudflare.api.account.${cfAccountId}`]: '*' }, permission_groups: accountGroups.map((id) => ({ id })) },
          { effect: 'allow', resources: { [`com.cloudflare.api.account.${cfAccountId}`]: { 'com.cloudflare.api.account.zone.*': '*' } }, permission_groups: zoneGroups.map((id) => ({ id })) },
        ],
      },
      log,
    ).catch(bootstrapError);
    Object.assign(data, { token_id: made.id, token_name: name, token_expires_at: expires });
    const sealed = JSON.stringify(await seal(env.MASTER_KEYS, made.value!, aad(edge)));
    if (renew) await owned(db.prepare('UPDATE edge_accounts SET next_sealed = ?, updated_at = ? WHERE id = ? AND lease_owner = ?').bind(sealed, Date.now(), edge.id, owner));
    else
      await owned(
        db
          .prepare('UPDATE edge_accounts SET cf_account_name = ?, token_id = ?, token_name = ?, token_expires_at = ?, key_id = ?, token_sealed = ?, updated_at = ? WHERE id = ? AND lease_owner = ?')
          .bind(data.account_name, made.id, name, expires, env.MASTER_KEYS.split(':')[0], sealed, Date.now(), edge.id, owner),
      );
    await step(db, edge.id, owner, opId, 'token_stored', data);

    // 5. Exactly the rights asked for, and every read right of the §3 table works (write rights are
    //    proven by the install, §4). A 401 that persists means the token is unusable; a 403 means a
    //    right or a plan is missing on one resource — the token stays and the account says so.
    if (!rightsMatch(made.policies, cfAccountId, accountGroups, zoneGroups)) fail(502, 'token_rights_mismatch', 'Cloudflare made the working token with other rights or resources than asked for.');
    const working = made.value!;
    const probe = async <T>(call: () => Promise<T>): Promise<T | null> => {
      try {
        return await settled(call);
      } catch (e) {
        if (e instanceof CfError && e.status === 403) {
          data.permission_error ??= { path: e.path, status: e.status, codes: e.codes };
          return null;
        }
        if (e instanceof CfError && e.status === 401) fail(502, 'token_check_failed', 'The new working token is not accepted by Cloudflare.', { path: e.path, status: e.status, codes: e.codes });
        throw e;
      }
    };
    await probe(() => cf(working, 'GET', `/accounts/${cfAccountId}`));
    await probe(() => cf(working, 'GET', `/accounts/${cfAccountId}/d1/database?per_page=1`));
    await probe(() => cf(working, 'GET', `/accounts/${cfAccountId}/workers/scripts`));
    const zones = await probe(() => cf<{ id: string }[]>(working, 'GET', `/zones?account.id=${cfAccountId}&per_page=1`));
    if (zones?.[0]) await probe(() => cf(working, 'GET', `/zones/${zones[0]!.id}/workers/routes`));
    const since = new Date(now - 3_600_000).toISOString();
    await probe(() => cfGraphql(working, `{ viewer { accounts(filter: { accountTag: "${cfAccountId}" }) { workersInvocationsAdaptive(limit: 1, filter: { datetime_geq: "${since}" }) { sum { requests } } } } }`));
    await step(db, edge.id, owner, opId, 'probed', data);
    return await finish(env, p, (await edgeById(db, edge.id))!, owner, opId, data, bootstrap, !!renew);
  } catch (e) {
    // A client-side failure ends the operation: the token it made (if any) is deleted with the
    // bootstrap token — and if that fails, the error names it for the user to revoke. A new connect
    // also drops its record; a renewal leaves the account as it was. A passing failure (5xx,
    // network) or a takeover leaves the operation to a retry.
    const final = e instanceof ApiError && e.code !== 'operation_in_progress' && (e.status < 500 || ['token_rights_mismatch', 'token_check_failed', 'permission_catalog'].includes(e.code));
    // Only while the lease is still ours: after a takeover the newer request owns the cleanup.
    if (final && (await held(db, edge.id, owner).then(() => true, () => false))) {
      const stranded = data.token_id && !(await dropToken(bootstrap, cfAccountId, data.token_id, log)) ? data.token_name : null;
      if (renew) await db.prepare('UPDATE edge_accounts SET next_sealed = NULL WHERE id = ? AND lease_owner = ?').bind(edge.id, owner).run();
      else await db.prepare('DELETE FROM edge_accounts WHERE id = ? AND lease_owner = ?').bind(edge.id, owner).run();
      await db.prepare("UPDATE operations SET state = 'failed', step = 'failed', data = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify({ ...data, error: e.code }), Date.now(), opId).run();
      if (stranded) throw new ApiError(e.status, e.code, `${e.message} The token it made (${stranded}) could not be deleted: revoke it in Cloudflare.`, { ...e.details, revoke_token: stranded });
    }
    throw e;
  } finally {
    await release(db, edge.id, owner);
  }
}

/** The last steps, which need the bootstrap token only to delete tokens: swap, clean up, commit. */
async function finish(env: Env, p: Principal, edge: EdgeAccount, owner: string, opId: string, data: OpData, bootstrap: string, renew: boolean): Promise<EdgeAccount> {
  const db = env.DB;
  const log: CallLog = { db, edgeAccountId: edge.id, principal: p.id };
  const warnings = new Set(data.warnings ?? []);
  if (renew && edge.token_id !== data.token_id) {
    // The swap, in one statement: secret and metadata together, and only from the token proven.
    if (!edge.next_sealed) fail(409, 'renew_lost', 'The new token of this renewal is gone; renew again.');
    await owned(
      db
        .prepare(
          'UPDATE edge_accounts SET cf_account_name = ?, token_id = ?, token_name = ?, token_expires_at = ?, key_id = ?, token_sealed = next_sealed, next_sealed = NULL, updated_at = ? WHERE id = ? AND lease_owner = ? AND next_sealed IS NOT NULL',
        )
        .bind(data.account_name ?? edge.cf_account_name, data.token_id, data.token_name, data.token_expires_at, env.MASTER_KEYS.split(':')[0], Date.now(), edge.id, owner),
    );
  }
  if (renew && data.old_token_id && data.old_token_id !== data.token_id) {
    await held(db, edge.id, owner);
    if (!(await dropToken(bootstrap, edge.cf_account_id, data.old_token_id, log))) warnings.add(`old_token_not_deleted:${data.old_token_name}`);
  }
  await held(db, edge.id, owner);
  // The bootstrap token: gone (401) is fine; alive is deleted; anything else is unknown and said so.
  const verified = await cf<{ id: string }>(bootstrap, 'GET', `/accounts/${edge.cf_account_id}/tokens/verify`).then(
    (r) => r,
    (e: unknown) => (e instanceof CfError && e.status === 401 ? null : 'unknown'),
  );
  if (verified === 'unknown') warnings.add('bootstrap_not_deleted');
  else if (verified) {
    let deleted = false;
    for (let i = 0; i < 3 && !deleted; i++) deleted = await dropToken(bootstrap, edge.cf_account_id, verified.id, log);
    if (!deleted) warnings.add('bootstrap_not_deleted');
  }
  const list = [...warnings];
  const state = data.permission_error ? 'permission_error' : 'connected';
  const error = data.permission_error ? { code: 'permission_error', ...data.permission_error, warnings: list } : list.length ? { warnings: list } : null;
  await owned(
    db
      .prepare('UPDATE edge_accounts SET state = ?, error = ?, token_checked_at = ?, updated_at = ? WHERE id = ? AND lease_owner = ?')
      .bind(state, error ? JSON.stringify(error) : null, Date.now(), Date.now(), edge.id, owner),
  );
  await step(db, edge.id, owner, opId, 'done', { ...data, warnings: list }, 'done');
  return (await edgeById(db, edge.id))!;
}

/** The working token of a connected account, opened from its ciphertext. */
export async function workingToken(env: Env, edge: EdgeAccount): Promise<string> {
  if (!edge.token_sealed) return fail(409, 'account_not_ready', 'This account has no working token; connect it again.');
  return open(env.MASTER_KEYS, JSON.parse(edge.token_sealed) as Sealed, aad(edge));
}

/**
 * Disconnect (§4). Until the install exists (stage 3) there is nothing of clx in the account but
 * the working token, which cannot delete itself: the answer names it for the user to revoke.
 */
export async function disconnect(env: Env, edge: EdgeAccount): Promise<{ revoke_token: string | null }> {
  const owner = newId();
  await lease(env.DB, edge.id, owner);
  await env.DB.prepare('DELETE FROM edge_accounts WHERE id = ? AND lease_owner = ?').bind(edge.id, owner).run();
  return { revoke_token: edge.token_name };
}

/** Accounts the token check visits per cron run: hourly runs cover ~4,800 accounts a day. */
const CHECK_BATCH = 200;
const CHECK_EVERY = 20 * 3_600_000;

/**
 * The token check (§3 item 6), run hourly over the accounts checked longest ago. 401 or a
 * non-active status is `revoked`; 403 is `permission_error`; a passing failure (5xx, network)
 * leaves the account to the next hour; a missing ciphertext is our fault and is flagged as such,
 * never taken for a revocation. A pending connect left alone for an hour is `bootstrap_lost` (§15).
 */
export async function checkTokens(env: Env, now = Date.now()): Promise<{ checked: number; revoked: number; lost: number }> {
  const lost = await env.DB.prepare(
    "UPDATE edge_accounts SET state = 'bootstrap_lost', error = json_object('code', 'bootstrap_lost', 'possible_orphan', 'clx-' || operation_id), updated_at = ?1 WHERE state = 'pending' AND updated_at < ?2 AND (lease_until IS NULL OR lease_until < ?1)",
  )
    .bind(now, now - BOOTSTRAP_LOST_AFTER)
    .run();
  const rows = (
    await env.DB.prepare("SELECT * FROM edge_accounts WHERE state IN ('connected', 'permission_error') AND token_checked_at < ? ORDER BY token_checked_at LIMIT ?")
      .bind(now - CHECK_EVERY, CHECK_BATCH)
      .all<EdgeAccount>()
  ).results;
  let revoked = 0;
  for (const edge of rows) {
    let state: string | null = null;
    let error: string | null = null;
    let checkedAt = now;
    // An unreadable ciphertext (a dropped key, damage) is flagged and the check goes on.
    const token = edge.token_sealed ? await open(env.MASTER_KEYS, JSON.parse(edge.token_sealed) as Sealed, aad(edge)).catch(() => null) : null;
    if (!edge.token_sealed) error = JSON.stringify({ code: 'credentials_missing' });
    else if (!token) error = JSON.stringify({ code: 'credentials_unreadable' });
    else {
      const outcome = await cf<{ status: string }>(token, 'GET', `/accounts/${edge.cf_account_id}/tokens/verify`).then(
        (r) => (r.status === 'active' ? 'ok' : 'revoked'),
        (e: unknown) => (e instanceof CfError && e.status === 401 ? 'revoked' : e instanceof CfError && e.status === 403 ? 'forbidden' : 'retry'),
      );
      if (outcome === 'revoked') {
        state = 'revoked';
        error = JSON.stringify({ code: 'revoked' });
        revoked++;
      } else if (outcome === 'forbidden') {
        state = 'permission_error';
        error = JSON.stringify({ code: 'permission_error', path: '/tokens/verify', status: 403 });
      } else if (outcome === 'retry') checkedAt = now - CHECK_EVERY + 3_600_000; // due again in an hour
    }
    // Only if the token checked is still the account's and no operation holds it: a renewal that
    // swapped tokens meanwhile is not taken for a revocation of the new one.
    await env.DB.prepare(
      'UPDATE edge_accounts SET state = coalesce(?1, state), error = coalesce(?2, error), token_checked_at = ?3 WHERE id = ?4 AND token_id IS ?5 AND (lease_until IS NULL OR lease_until < ?6)',
    )
      .bind(state, error, checkedAt, edge.id, edge.token_id, Date.now())
      .run();
  }
  return { checked: rows.length, revoked, lost: lost.meta.changes ?? 0 };
}

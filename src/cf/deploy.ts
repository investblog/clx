// Installing, updating and removing clx-edge in a connected account (docs/spec.md §4). An install
// or an update is an operation of recorded steps (§15): it is started by a request, run right after
// the answer, and resumed by the per-minute cron from its last recorded step if the run dies; one
// operation at a time holds the account's lease. Its last step waits for the worker's `setup_ok`
// (src/hook.ts), which sets the working cron; none within fifteen minutes and the operation is undone.
//
// Ownership: clx deletes only what it recorded — the database by its UUID, the script while
// `script_owned` says clx put it there — and before it replaces or deletes the script it checks that
// the code there is a clx bundle (edge/released.json); anything else is `resource_drift` and left
// alone. An install that finds `clx-edge` in place and not recorded stops with `name_taken`.
import { EDGE_CODE, EDGE_COMPATIBILITY_DATE, EDGE_SHA256 } from '../../edge/bundle.gen';
import { SELF_CHECK_CRON, WORKING_CRON } from '../../edge/contract';
import { MIGRATIONS, SCHEMA } from '../../edge/migrations';
import RELEASED from '../../edge/released.json';
import { sha256 } from '../lib/crypto';
import type { Env } from '../types';
import { ApiError, fail, newId } from '../v1/http';
import { cf, CfError, scriptDigest, type CallLog } from './api';
import { edgeById, lease, owned, release, step, workingToken, type EdgeAccount } from './connect';
import { dropRoute, recordedRoutes } from './sites';

const SCRIPT = 'clx-edge';
const DATABASE = 'clx-edge';
/** No setup_ok within this — the deployment failed (§4). A new script's cron first fired after
 *  ~4.5 minutes on 05.10.2026 (an updated one's after ~40 s), so five minutes was too tight. */
export const SELF_CHECK_TIMEOUT = 15 * 60_000;
/** Cron triggers per account on Workers Free (§5). */
const CRON_LIMIT = 5;
/** Runs of one operation that may end in a passing failure before it is given up. */
const MAX_ATTEMPTS = 10;
/** After a reinstall the previous worker key is accepted this long (§4). */
const PREV_KEY_TTL = 86_400_000;

export const isClxBundle = (sha: string | null) => sha !== null && (RELEASED as string[]).includes(sha);

type Kind = 'install' | 'update';
interface DeployData {
  principal: string;
  /** the bundle this operation deploys */
  bundle: string;
  attempts?: number;
  /** created by this operation: a rollback deletes these, and only these */
  d1_created?: boolean;
  script_created?: boolean;
  /** the script was ours before: a rollback returns to this version (and key) instead */
  prev_version_id?: string | null;
  prev_key_hash?: string | null;
  deployment_id?: string;
  version_id?: string;
  schema?: number;
  deadline?: number;
  error?: Record<string, unknown>;
  warnings?: string[];
}
interface OpRow {
  id: string;
  kind: string;
  cf_account_id: string;
  state: string;
  step: string;
  data: string;
}
interface Script {
  id: string;
  handlers?: string[];
}
interface Database {
  uuid: string;
  name: string;
}

/**
 * Start an install (a reinstall over clx's own script is the same) or an update of an account. Only
 * one operation at a time: the account must have no running one and a free lease.
 */
export async function startDeploy(env: Env, principal: string, edge: EdgeAccount, kind: Kind): Promise<string> {
  if (!edge.token_sealed || ['pending', 'bootstrap_lost', 'revoked', 'permission_error'].includes(edge.state))
    fail(409, 'account_not_ready', 'This account has no working token with the rights clx needs; renew its token first.', { state: edge.state });
  if (kind === 'update' && !edge.bundle) fail(409, 'account_not_ready', 'clx-edge is not installed in this account; install it first.');
  const db = env.DB;
  const opId = newId();
  const now = Date.now();
  const data: DeployData = { principal, bundle: EDGE_SHA256 };
  const [taken] = await db.batch([
    db
      .prepare(
        `UPDATE edge_accounts SET operation_id = ?1, state = CASE WHEN ?2 = 'install' THEN 'installing' ELSE state END, updated_at = ?3
         WHERE id = ?4 AND (lease_until IS NULL OR lease_until < ?3)
           AND NOT EXISTS (SELECT 1 FROM operations o WHERE o.id = edge_accounts.operation_id AND o.state = 'running')`,
      )
      .bind(opId, kind, now, edge.id),
    db
      .prepare("INSERT INTO operations (id, user_id, kind, cf_account_id, state, step, data, created_at, updated_at) SELECT ?, ?, ?, ?, 'running', 'reserved', ?, ?, ? WHERE changes() = 1")
      .bind(opId, edge.user_id, kind, edge.cf_account_id, JSON.stringify(data), now, now),
  ]);
  if (!taken!.meta.changes) fail(409, 'operation_in_progress', 'Another operation on this Cloudflare account is running; retry shortly.');
  return opId;
}

interface Run {
  env: Env;
  db: D1Database;
  edge: EdgeAccount;
  owner: string;
  opId: string;
  kind: Kind;
  data: DeployData;
  token: string;
  log: CallLog;
}

const acc = (r: Run) => `/accounts/${r.edge.cf_account_id}`;
const record = (r: Run, name: string, state = 'running') => step(r.db, r.edge.id, r.owner, r.opId, name, r.data, state);
const ownedUpdate = (r: Run, sql: string, ...args: unknown[]) =>
  owned(r.db.prepare(`UPDATE edge_accounts SET ${sql}, updated_at = ? WHERE id = ? AND lease_owner = ?`).bind(...args, Date.now(), r.edge.id, r.owner));

/** The version serving now: the only one of the latest deployment (clx never splits traffic). */
async function liveVersion(r: Run): Promise<string | null> {
  const d = await cf<{ deployments: { versions: { version_id: string; percentage: number }[] }[] }>(r.token, 'GET', `${acc(r)}/workers/scripts/${SCRIPT}/deployments`);
  return d.deployments[0]?.versions.find((v) => v.percentage === 100)?.version_id ?? null;
}

async function databaseNamed(r: Run): Promise<Database | null> {
  const list = await cf<Database[]>(r.token, 'GET', `${acc(r)}/d1/database?name=${DATABASE}&per_page=100`);
  return list.find((d) => d.name === DATABASE) ?? null;
}

/** Bring the database to SCHEMA; each migration and its number in one call (edge/migrations.ts). */
async function migrate(r: Run): Promise<number> {
  const query = (sql: string) => cf<{ results: { value?: number }[] }[]>(r.token, 'POST', `${acc(r)}/d1/database/${r.edge.d1_id}/query`, { sql }, r.log);
  const read = await query("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value); SELECT value FROM meta WHERE key = 'schema'");
  let at = Number(read.at(-1)?.results[0]?.value ?? 0);
  for (; at < SCHEMA; at++) {
    await query(`${MIGRATIONS[at]}; INSERT INTO meta (key, value) VALUES ('schema', ${at + 1}) ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
  }
  return at;
}

/** One step forward from `at`; returns the step reached. */
async function advance(r: Run, at: string): Promise<string> {
  const { data } = r;
  switch (at) {
    case 'reserved': {
      // What is there now: the script, the database, and — for an install — the cron triggers.
      const scripts = await cf<Script[]>(r.token, 'GET', `${acc(r)}/workers/scripts`);
      const there = scripts.find((s) => s.id === SCRIPT);
      if (there) {
        if (!r.edge.script_owned) fail(409, 'name_taken', 'A worker named clx-edge is already in this account and clx did not put it there; it is left alone.', { resource: 'worker' });
        const digest = await scriptDigest(r.token, r.edge.cf_account_id, SCRIPT);
        if (!isClxBundle(digest)) fail(409, 'resource_drift', 'The clx-edge worker was changed outside clx; it is left alone.', { resource: 'worker' });
        data.prev_version_id = await liveVersion(r);
        data.prev_key_hash = r.edge.edge_key_hash;
      } else if (r.kind === 'update') fail(409, 'resource_drift', 'The clx-edge worker is gone from this account; reinstall it.', { resource: 'worker', missing: true });
      data.script_created = !there;
      if (r.kind === 'install') {
        const holders: { script: string; crons: number }[] = [];
        for (const s of scripts.filter((x) => x.id !== SCRIPT && x.handlers?.includes('scheduled'))) {
          const n = (await cf<{ schedules: unknown[] }>(r.token, 'GET', `${acc(r)}/workers/scripts/${s.id}/schedules`)).schedules.length;
          if (n) holders.push({ script: s.id, crons: n });
        }
        if (holders.reduce((sum, h) => sum + h.crons, 0) >= CRON_LIMIT) fail(409, 'cron_limit', `This account already uses all ${CRON_LIMIT} cron triggers of Workers Free; clx-edge needs one.`, { holders });
      }
      const found = await databaseNamed(r);
      if (found && found.uuid !== r.edge.d1_id) fail(409, 'name_taken', 'A database named clx-edge is already in this account and clx did not create it; it is left alone.', { resource: 'database' });
      if (!found && r.kind === 'update') fail(409, 'resource_drift', 'The clx-edge database is gone from this account; reinstall clx-edge.', { resource: 'database', missing: true });
      if (found) {
        await record(r, 'd1');
        return 'd1';
      }
      // Recorded before the create call: a resumed step adopts a database it finds by name.
      await record(r, 'd1_creating');
      return 'd1_creating';
    }
    case 'd1_creating': {
      const db = (await databaseNamed(r)) ?? (await cf<Database>(r.token, 'POST', `${acc(r)}/d1/database`, { name: DATABASE }, r.log));
      data.d1_created = true;
      // A new database holds no config yet: the sync starts over from revision 0.
      await ownedUpdate(r, 'd1_id = ?, synced_revision = 0', db.uuid);
      r.edge.d1_id = db.uuid;
      await record(r, 'd1');
      return 'd1';
    }
    case 'd1':
      data.schema = await migrate(r);
      await record(r, 'migrated');
      return 'migrated';
    case 'migrated':
      // From here clx-edge may exist because of us, whatever happens to this request.
      await ownedUpdate(r, 'script_owned = 1');
      await record(r, 'uploading');
      return 'uploading';
    case 'uploading': {
      // Checked again right before the upload — the step may be resumed long after `reserved`:
      // whatever is there now must be a clx bundle (ours from an earlier attempt) or nothing.
      const there = await scriptDigest(r.token, r.edge.cf_account_id, SCRIPT);
      if (there !== null && !isClxBundle(there))
        fail(409, data.script_created ? 'name_taken' : 'resource_drift', 'A clx-edge worker that is not a clx bundle appeared in this account; it is left alone.', { resource: 'worker' });
      // An install puts a new worker key in the upload itself; an update keeps the key there.
      const deployment = newId();
      const key = r.kind === 'install' ? `${newId()}${newId()}` : null;
      const bindings: Record<string, string>[] = [
        { type: 'd1', name: 'DB', id: r.edge.d1_id! },
        { type: 'plain_text', name: 'HOOK_URL', text: r.env.HOOK_URL },
        { type: 'plain_text', name: 'BUNDLE', text: data.bundle },
        { type: 'plain_text', name: 'DEPLOYMENT_ID', text: deployment },
      ];
      if (key) bindings.push({ type: 'secret_text', name: 'EDGE_KEY', text: key });
      const form = new FormData();
      form.append('worker.js', new Blob([EDGE_CODE], { type: 'application/javascript+module' }), 'worker.js');
      const metadata = { main_module: 'worker.js', compatibility_date: EDGE_COMPATIBILITY_DATE, bindings, ...(key ? {} : { keep_bindings: ['secret_text'] }) };
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      await cf(r.token, 'PUT', `${acc(r)}/workers/scripts/${SCRIPT}`, form, r.log);
      data.version_id = (await liveVersion(r)) ?? undefined;
      data.deployment_id = deployment;
      if (key) {
        const hash = await sha256(key);
        await ownedUpdate(
          r,
          'edge_key_prev_hash = CASE WHEN edge_key_hash IS NULL THEN edge_key_prev_hash ELSE edge_key_hash END, edge_key_prev_until = CASE WHEN edge_key_hash IS NULL THEN edge_key_prev_until ELSE ? END, edge_key_hash = ?, deployment_id = ?',
          Date.now() + PREV_KEY_TTL,
          hash,
          deployment,
        );
      } else await ownedUpdate(r, 'deployment_id = ?', deployment);
      await record(r, 'uploaded');
      return 'uploaded';
    }
    case 'uploaded':
      await cf(r.token, 'PUT', `${acc(r)}/workers/scripts/${SCRIPT}/schedules`, [{ cron: SELF_CHECK_CRON }], r.log);
      data.deadline = Date.now() + SELF_CHECK_TIMEOUT;
      await record(r, 'selfcheck');
      return 'selfcheck';
  }
  return fail(500, 'internal', `Unknown step ${at}.`);
}

const passing = (e: unknown) => !(e instanceof ApiError) && !(e instanceof CfError && e.status >= 400 && e.status < 500 && e.status !== 429);

/**
 * Undo a failed install or update. A script that was ours before goes back to its previous version
 * (and key) with the working cron; one this operation created is deleted, and so is a database it
 * created. A token Cloudflare no longer accepts (401) stops all calls: what was made is listed.
 */
async function undo(r: Run, at: string, e: unknown): Promise<void> {
  const { data } = r;
  const code = e instanceof ApiError ? e.code : e instanceof CfError ? (e.tokenState ?? 'cloudflare_error') : 'internal';
  data.error = { code, step: at, ...(e instanceof ApiError ? e.details : {}), ...(e instanceof CfError ? { path: e.path, status: e.status, codes: e.codes } : {}) };
  const warnings = new Set(data.warnings ?? []);
  const revoked = e instanceof CfError && e.status === 401;
  const uploaded = ['uploading', 'uploaded', 'selfcheck'].includes(at);
  // scriptGone: clx-edge is no longer ours (deleted, absent, or someone else's) — the mark and key go.
  let scriptGone = false;
  let reverted = false;
  let cronBack = false;
  if (!revoked) {
    const attempt = async (what: string, call: () => Promise<unknown>) =>
      call().then(
        () => true,
        (x: unknown) => {
          if (x instanceof CfError && x.status === 404) return true;
          warnings.add(`${what}_not_undone`);
          return false;
        },
      );
    if (uploaded && (data.prev_version_id || data.script_created)) {
      // Only a clx bundle is reverted or deleted: the upload may never have happened, and a worker
      // of that name may have appeared since (§4 ownership).
      const there = await scriptDigest(r.token, r.edge.cf_account_id, SCRIPT).catch(() => 'unreadable');
      if (there === 'unreadable') warnings.add('worker_not_undone');
      else if (there === null) scriptGone = true;
      else if (!isClxBundle(there)) {
        warnings.add('worker_not_ours');
        scriptGone = !!data.script_created;
      } else if (data.prev_version_id) {
        reverted = await attempt('worker_version', () => cf(r.token, 'POST', `${acc(r)}/workers/scripts/${SCRIPT}/deployments`, { strategy: 'percentage', versions: [{ version_id: data.prev_version_id, percentage: 100 }] }, r.log));
        cronBack = await attempt('cron', () => cf(r.token, 'PUT', `${acc(r)}/workers/scripts/${SCRIPT}/schedules`, [{ cron: WORKING_CRON }], r.log));
      } else scriptGone = await attempt('worker', () => cf(r.token, 'DELETE', `${acc(r)}/workers/scripts/${SCRIPT}?force=true`, undefined, r.log));
    }
    if (data.d1_created && r.edge.d1_id && (await attempt('database', () => cf(r.token, 'DELETE', `${acc(r)}/d1/database/${r.edge.d1_id}`, undefined, r.log)))) r.edge.d1_id = null;
  } else warnings.add('token_revoked');
  // A clx script whose return did not fully happen may serve the failed new code, or run on the
  // self-check cron: that is not a ready account, so no bundle is claimed — a reinstall sets it
  // right.
  const unknownCode = uploaded && !!data.prev_version_id && !(reverted && cronBack) && !scriptGone;
  if (unknownCode) warnings.add('serving_unknown');
  data.warnings = [...warnings];
  const fresh = (await edgeById(r.db, r.edge.id))!;
  const state = revoked ? 'revoked' : code === 'permission_error' ? 'permission_error' : code === 'resource_drift' ? 'resource_drift' : fresh.bundle && !scriptGone && !unknownCode ? 'ready' : 'connected';
  // The key goes with the code: a deleted worker takes its key along, a restored version brings
  // back the key it was uploaded with.
  const restoreKey = reverted;
  const error = JSON.stringify({ ...data.error, ...(data.warnings.length ? { warnings: data.warnings } : {}) });
  await r.db.batch([
    r.db
      .prepare(
        `UPDATE edge_accounts SET state = ?1, error = ?2, d1_id = ?3, deployment_id = NULL,
           script_owned = CASE WHEN ?4 THEN 0 ELSE script_owned END, bundle = CASE WHEN ?4 OR ?10 THEN NULL ELSE bundle END,
           edge_key_hash = CASE WHEN ?4 THEN NULL WHEN ?5 THEN ?6 ELSE edge_key_hash END,
           edge_key_prev_hash = CASE WHEN ?4 OR ?5 THEN NULL ELSE edge_key_prev_hash END,
           updated_at = ?7
         WHERE id = ?8 AND lease_owner = ?9`,
      )
      .bind(state, error, r.edge.d1_id, scriptGone ? 1 : 0, restoreKey ? 1 : 0, data.prev_key_hash ?? null, Date.now(), r.edge.id, r.owner, unknownCode ? 1 : 0),
    r.db.prepare("UPDATE operations SET state = 'failed', step = ?, data = ?, updated_at = ? WHERE id = ?").bind(`failed:${at}`, JSON.stringify(data), Date.now(), r.opId),
  ]);
}

/**
 * Run an operation from its last recorded step as far as it goes now. Called right after the
 * request that started it, and by the per-minute cron for one that stalled or waits for setup_ok.
 */
export async function runDeploy(env: Env, opId: string): Promise<void> {
  const db = env.DB;
  const op = await db.prepare('SELECT * FROM operations WHERE id = ?').bind(opId).first<OpRow>();
  if (!op || op.state !== 'running' || (op.kind !== 'install' && op.kind !== 'update')) return;
  const data = JSON.parse(op.data) as DeployData;
  const found = await db.prepare('SELECT * FROM edge_accounts WHERE cf_account_id = ?').bind(op.cf_account_id).first<EdgeAccount>();
  if (!found || found.operation_id !== opId) {
    // The account was disconnected or another operation replaced this one.
    await db.prepare("UPDATE operations SET state = 'failed', step = 'superseded', updated_at = ? WHERE id = ? AND state = 'running'").bind(Date.now(), opId).run();
    return;
  }
  if (op.step === 'selfcheck' && Date.now() < (data.deadline ?? 0)) return;
  const owner = newId();
  try {
    await lease(db, found.id, owner);
  } catch {
    return; // another run holds it
  }
  let r: Run | null = null;
  let at = op.step;
  try {
    const edge = (await edgeById(db, found.id))!;
    if (edge.operation_id !== opId) return;
    const fresh = (await db.prepare('SELECT step, data FROM operations WHERE id = ?').bind(opId).first<{ step: string; data: string }>())!;
    at = fresh.step;
    const token = await workingToken(env, edge).catch(() => null);
    if (!token) {
      // No token to act with (none stored, or its ciphertext unreadable): nothing can be made or
      // undone in Cloudflare, so the operation ends here and says why.
      const error = JSON.stringify({ code: edge.token_sealed ? 'credentials_unreadable' : 'credentials_missing', step: at });
      await db.batch([
        db.prepare("UPDATE edge_accounts SET state = CASE WHEN state = 'installing' THEN (CASE WHEN bundle IS NULL THEN 'connected' ELSE 'ready' END) ELSE state END, error = ?, deployment_id = NULL, updated_at = ? WHERE id = ? AND lease_owner = ?").bind(error, Date.now(), edge.id, owner),
        db.prepare("UPDATE operations SET state = 'failed', step = ?, updated_at = ? WHERE id = ?").bind(`failed:${at}`, Date.now(), opId),
      ]);
      return;
    }
    r = { env, db, edge, owner, opId, kind: op.kind as Kind, data: JSON.parse(fresh.data) as DeployData, token, log: { db, edgeAccountId: edge.id, principal: data.principal } };
    if (at === 'selfcheck') fail(504, 'self_check_timeout', 'The worker did not report within fifteen minutes of its upload.');
    while (at !== 'selfcheck') at = await advance(r, at);
  } catch (e) {
    if (!r) throw e;
    // The lease was lost to a newer run: that run owns the operation now, this one only stops.
    if (e instanceof ApiError && e.code === 'operation_in_progress') return;
    r.data.attempts = (r.data.attempts ?? 0) + 1;
    if (passing(e) && r.data.attempts < MAX_ATTEMPTS) {
      // A passing failure: the cron takes it up again next minute.
      await db.prepare('UPDATE operations SET data = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(r.data), Date.now(), opId).run();
      console.error('deploy', opId, at, e instanceof Error ? e.message : e);
    } else await undo(r, at, e);
  } finally {
    await release(db, found.id, owner);
  }
}

/**
 * `setup_ok` from a worker (§4): the deployment, bundle and schema must all be the ones the waiting
 * operation uploaded. Then the working cron replaces the self-check and the account is ready.
 */
export async function confirmSetup(env: Env, edge: EdgeAccount, report: { deployment_id: string; bundle: string; schema: number | null }): Promise<'ok' | 'mismatch' | 'busy'> {
  const db = env.DB;
  if (!edge.deployment_id || report.deployment_id !== edge.deployment_id || !edge.operation_id) return 'mismatch';
  const op = await db.prepare('SELECT * FROM operations WHERE id = ?').bind(edge.operation_id).first<OpRow>();
  if (!op || op.state !== 'running') return 'mismatch';
  // The cron can fire the moment it is set, before the run has recorded its step: too early, not
  // wrong — the worker asks again in a few seconds.
  if (op.step === 'uploaded') return 'busy';
  if (op.step !== 'selfcheck') return 'mismatch';
  const data = JSON.parse(op.data) as DeployData;
  if (report.deployment_id !== data.deployment_id || report.bundle !== data.bundle || report.schema !== data.schema) return 'mismatch';
  const owner = newId();
  try {
    await lease(db, edge.id, owner);
  } catch {
    return 'busy';
  }
  try {
    const token = await workingToken(env, edge);
    await cf(token, 'PUT', `/accounts/${edge.cf_account_id}/workers/scripts/${SCRIPT}/schedules`, [{ cron: WORKING_CRON }], { db, edgeAccountId: edge.id, principal: data.principal });
    const now = Date.now();
    await db.batch([
      db
        .prepare("UPDATE edge_accounts SET state = 'ready', error = NULL, bundle = ?, version_id = ?, schema = ?, deployment_id = NULL, installed_at = ?, updated_at = ? WHERE id = ? AND lease_owner = ? AND deployment_id = ?")
        .bind(data.bundle, data.version_id ?? null, data.schema, now, now, edge.id, owner, report.deployment_id),
      db.prepare("UPDATE operations SET state = 'done', step = 'done', updated_at = ? WHERE id = ? AND changes() = 1").bind(now, op.id),
    ]);
    return 'ok';
  } finally {
    await release(db, edge.id, owner);
  }
}

/** The per-minute cron: operations that stalled, wait for setup_ok, or lost their account. */
export async function runOperations(env: Env, now = Date.now()): Promise<number> {
  const ops = (
    // A self-check still within its deadline needs nothing; leaving it out keeps the batch for
    // operations that do.
    await env.DB.prepare(
      "SELECT id FROM operations WHERE state = 'running' AND kind IN ('install', 'update') AND updated_at < ?1 AND NOT (step = 'selfcheck' AND json_extract(data, '$.deadline') > ?2) ORDER BY updated_at LIMIT 20",
    )
      .bind(now - 60_000, now)
      .all<{ id: string }>()
  ).results;
  // One account's trouble never stops the others.
  for (const op of ops) await runDeploy(env, op.id).catch((e: unknown) => console.error('operation', op.id, e instanceof Error ? e.message : e));
  return ops.length;
}

/**
 * Disconnect (§4): delete the recorded worker and database with the working token, then the
 * record. The worker is deleted only if its code is a clx bundle. What could not be deleted — the
 * token is revoked, a right is missing, the worker was changed — is listed for the user, with the
 * working token, which cannot delete itself.
 */
export async function disconnect(env: Env, principal: string, edge: EdgeAccount): Promise<{ revoke_token: string | null; left: string[] }> {
  const db = env.DB;
  const owner = newId();
  await lease(db, edge.id, owner);
  try {
    const opId = newId();
    const now = Date.now();
    await db.batch([
      db.prepare("INSERT INTO operations (id, user_id, kind, cf_account_id, state, step, data, created_at, updated_at) VALUES (?, ?, 'disconnect', ?, 'running', 'reserved', '{}', ?, ?)").bind(opId, edge.user_id, edge.cf_account_id, now, now),
      db.prepare('UPDATE edge_accounts SET operation_id = ? WHERE id = ? AND lease_owner = ?').bind(opId, edge.id, owner),
    ]);
    const current = (await edgeById(db, edge.id))!;
    const left: string[] = [];
    const token = current.token_sealed ? await workingToken(env, current).catch(() => null) : null;
    const path = `/accounts/${current.cf_account_id}`;
    const log: CallLog = { db, edgeAccountId: current.id, principal };
    let script = !!current.script_owned;
    let database = current.d1_id;
    // The sites' routes first: a route left without its worker would only fail.
    let routes = await recordedRoutes(db, current.id);
    if (token && (script || database || routes.length)) {
      try {
        while (routes.length) {
          const r = routes[0]!;
          // A route the user pointed elsewhere is theirs now: named, not deleted.
          if ((await dropRoute(token, log, r.zone_id, r.route_id, r.pattern)) === 'not_ours') left.push(`route ${r.pattern} (changed outside clx)`);
          routes = routes.slice(1);
        }
        if (script) {
          const digest = await scriptDigest(token, current.cf_account_id, SCRIPT);
          if (digest !== null && !isClxBundle(digest)) left.push('worker clx-edge (changed outside clx)');
          else if (digest !== null) await cf(token, 'DELETE', `${path}/workers/scripts/${SCRIPT}?force=true`, undefined, log).catch((e: unknown) => (e instanceof CfError && e.status === 404 ? null : Promise.reject(e)));
          script = false;
          await db.prepare('UPDATE edge_accounts SET script_owned = 0 WHERE id = ? AND lease_owner = ?').bind(current.id, owner).run();
        }
        if (database) {
          await cf(token, 'DELETE', `${path}/d1/database/${database}`, undefined, log).catch((e: unknown) => (e instanceof CfError && e.status === 404 ? null : Promise.reject(e)));
          database = null;
        }
      } catch (e) {
        // Cloudflare refuses this token: what is left goes to the user. Anything else is retried.
        if (!(e instanceof CfError && (e.status === 401 || e.status === 403))) throw e;
      }
    }
    for (const r of routes) left.push(`route ${r.pattern}`);
    if (script) left.push('worker clx-edge');
    if (database) left.push(`database clx-edge (${database})`);
    await db.batch([
      db.prepare('DELETE FROM edge_accounts WHERE id = ? AND lease_owner = ?').bind(current.id, owner),
      db.prepare("UPDATE operations SET state = 'done', step = 'done', data = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify({ left }), Date.now(), opId),
    ]);
    return { revoke_token: current.token_name, left };
  } finally {
    await release(db, edge.id, owner);
  }
}


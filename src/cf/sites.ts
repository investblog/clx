// Sites (docs/spec.md §5) and the config sync to the worker's database (§6).
//
// A site is a host in one of the account's zones, a route `<host><path>/*` → clx-edge, and a seed
// from which the path, names and snippet come (src/snippet.ts). Every change issues the account's
// next config revision in the same batch as the change; the sync then writes the changed sites as
// new rows of that revision and makes them visible with one conditional commit — a sync that dies
// halfway leaves rows no commit names, which the worker never reads. clx deletes only the routes it
// recorded (§4 ownership); a pattern held by someone else's worker is `route_conflict`, never
// overwritten.
import { siteKey, type SiteConfig } from '../../edge/contract';
import { LIMITS, planOf } from '../limits';
import { namesFor, scriptFor, snippetFor } from '../snippet';
import type { Env, Principal } from '../types';
import { fail, newId } from '../v1/http';
import { cf, CfError, type CallLog } from './api';
import { edgeById, held, lease, release, workingToken, type EdgeAccount } from './connect';

const SCRIPT = 'clx-edge';
/** After a rotation the old path is served this long: cached pages still carry it (§5). */
export const RETIRE_AFTER = 30 * 86_400_000;
/** One D1 statement may be at most 100 KB (`d1/platform/limits`); the rows are sent in chunks below. */
const CHUNK_BYTES = 90_000;
const ROUTE_CONFLICT = 10020;

export interface SiteRow {
  id: string;
  account_id: string;
  user_id: number;
  target: string;
  host: string;
  zone_id: string;
  seed: string;
  excluded: string;
  state: string;
  route_id: string | null;
  retiring: string;
  retire_at: number | null;
  revision: number;
  error: string | null;
  created_at: number;
  updated_at: number;
}
interface Retiring {
  seed: string;
  route_id: string | null;
  until: number;
}

const HOST = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/u;
export const validHost = (h: string) => HOST.test(h);

const patternOf = (host: string, seed: string) => `${host}${namesFor(seed).path}/*`;

/** What the API shows of a site: never the seed itself. */
export function siteView(s: SiteRow, syncedRevision: number) {
  const names = namesFor(s.seed);
  return {
    id: s.id,
    account_id: s.account_id,
    host: s.host,
    state: s.state,
    path: names.path,
    snippet: s.state === 'deleted' ? null : snippetFor(s.seed, names),
    excluded_paths: JSON.parse(s.excluded) as string[],
    config: s.revision <= syncedRevision ? 'synced' : 'pending',
    retiring: (JSON.parse(s.retiring) as Retiring[]).map((r) => ({ path: namesFor(r.seed).path, until: new Date(r.until).toISOString() })),
    error: s.error ? JSON.parse(s.error) : null,
    created_at: new Date(s.created_at).toISOString(),
  };
}

/** The site as the worker reads it (edge/contract.ts). */
function configOf(s: SiteRow): SiteConfig {
  const path = (seed: string, until?: number) => {
    const n = namesFor(seed);
    return { path: n.path, c: n.c, s: n.s, script: scriptFor(seed, n), ...(until ? { until } : {}) };
  };
  return { t: s.target, paths: [path(s.seed), ...(JSON.parse(s.retiring) as Retiring[]).map((r) => path(r.seed, r.until))], excluded: JSON.parse(s.excluded) as string[] };
}

/** The account's zone that holds `host`: the most specific one (names match exactly, so suffixes are tried). */
async function zoneFor(token: string, cfAccountId: string, host: string): Promise<{ id: string; name: string } | null> {
  const labels = host.split('.');
  for (let i = 0; i <= labels.length - 2; i++) {
    const name = labels.slice(i).join('.');
    const [zone] = await cf<{ id: string; name: string }[]>(token, 'GET', `/zones?account.id=${cfAccountId}&name=${name}`);
    if (zone) return zone;
  }
  return null;
}

/** Create the route, or adopt it if it is clx's from an earlier attempt; someone else's is a conflict. */
async function ensureRoute(token: string, log: CallLog, zoneId: string, pattern: string): Promise<{ id: string } | { conflict: string }> {
  try {
    return { id: (await cf<{ id: string }>(token, 'POST', `/zones/${zoneId}/workers/routes`, { pattern, script: SCRIPT }, log)).id };
  } catch (e) {
    if (!(e instanceof CfError && e.codes.includes(ROUTE_CONFLICT))) throw e;
    const there = (await cf<{ id: string; pattern: string; script?: string }[]>(token, 'GET', `/zones/${zoneId}/workers/routes`)).find((r) => r.pattern === pattern);
    return there?.script === SCRIPT ? { id: there.id } : { conflict: there?.script ?? 'unknown' };
  }
}

/**
 * Delete a recorded route — only if it is still what clx made: the recorded pattern, to clx-edge. A
 * route the user has since pointed elsewhere is no longer ours and is left (§4 ownership).
 */
async function dropRoute(token: string, log: CallLog, zoneId: string, routeId: string, pattern: string): Promise<'deleted' | 'gone' | 'not_ours'> {
  const path = `/zones/${zoneId}/workers/routes/${routeId}`;
  const gone = (e: unknown) => {
    if (e instanceof CfError && e.status === 404) return null;
    throw e;
  };
  const there = await cf<{ pattern: string; script?: string }>(token, 'GET', path).catch(gone);
  if (!there) return 'gone';
  if (there.pattern !== pattern || there.script !== SCRIPT) return 'not_ours';
  return (await cf(token, 'DELETE', path, undefined, log).then(() => true, gone)) ? 'deleted' : 'gone';
}

/**
 * A change and the next config revision, in one batch. `where` makes the change conditional on the
 * row being as the caller read it; the answer says whether it was.
 */
async function revise(db: D1Database, accountId: string, siteId: string, set: string, args: unknown[], where = '', whereArgs: unknown[] = []): Promise<boolean> {
  const [, changed] = await db.batch([
    db.prepare('UPDATE edge_accounts SET config_revision = config_revision + 1 WHERE id = ?').bind(accountId),
    db.prepare(`UPDATE sites SET ${set}, revision = (SELECT config_revision FROM edge_accounts WHERE id = ?), updated_at = ? WHERE id = ?${where}`).bind(...args, accountId, Date.now(), siteId, ...whereArgs),
  ]);
  return !!changed!.meta.changes;
}

/** The row as read: the same seed, state, route and retiring list (a compare-and-swap). */
const unchanged = (s: SiteRow): [string, unknown[]] => [' AND seed = ? AND state = ? AND route_id IS ? AND retiring = ?', [s.seed, s.state, s.route_id, s.retiring]];

const siteById = (db: D1Database, id: string) => db.prepare('SELECT * FROM sites WHERE id = ?').bind(id).first<SiteRow>();

/** Make or adopt the site's route and record the outcome. */
async function placeRoute(env: Env, edge: EdgeAccount, site: SiteRow, principal: string): Promise<void> {
  const log: CallLog = { db: env.DB, edgeAccountId: edge.id, principal };
  const token = await workingToken(env, edge);
  const pattern = patternOf(site.host, site.seed);
  let state = 'route_pending';
  let routeId: string | null = null;
  let error: Record<string, unknown> | null = null;
  try {
    const r = await ensureRoute(token, log, site.zone_id, pattern);
    if ('id' in r) {
      state = 'active';
      routeId = r.id;
    } else {
      state = 'route_conflict';
      error = { code: 'route_conflict', worker: r.conflict, pattern };
    }
  } catch (e) {
    // Left route_pending: the cron tries again.
    error = { code: e instanceof CfError ? (e.tokenState ?? 'cloudflare_error') : 'internal', ...(e instanceof CfError ? { status: e.status, codes: e.codes } : {}) };
  }
  // A conflict changes what the worker is told (the site is withdrawn there), so it is a revision.
  const recorded =
    state === 'route_conflict'
      ? await revise(env.DB, site.account_id, site.id, 'state = ?, error = ?', [state, JSON.stringify(error)], " AND state = 'route_pending' AND seed = ?", [site.seed])
      : !!(
          await env.DB.prepare("UPDATE sites SET state = ?, route_id = ?, error = ?, updated_at = ? WHERE id = ? AND state = 'route_pending' AND seed = ?")
            .bind(state, routeId, error ? JSON.stringify(error) : null, Date.now(), site.id, site.seed)
            .run()
        ).meta.changes;
  // The site changed or went meanwhile (deleted, account disconnected): the route is nobody's.
  if (!recorded && routeId) await dropRoute(token, log, site.zone_id, routeId, pattern);
}

/** Add a site: the zone is found in the account, the site recorded, the route made (§15). */
export async function addSite(env: Env, p: Principal, edge: EdgeAccount, host: string, excluded: string[]): Promise<SiteRow> {
  if (edge.state !== 'ready') fail(409, 'account_not_ready', 'clx-edge is not installed and confirmed in this account yet.', { state: edge.state });
  const token = await workingToken(env, edge);
  const zone = await zoneFor(token, edge.cf_account_id, host);
  if (!zone) fail(400, 'zone_not_found', `No zone of this Cloudflare account holds ${host}.`, { field: 'host' });
  const db = env.DB;
  const id = newId();
  const seed = newId();
  const target = `s${[...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(36).padStart(2, '0')).join('')}`;
  const now = Date.now();
  const limit = LIMITS[planOf(p.plan)].sites;
  let rows: D1Result[];
  try {
    // The limit is part of the batch, so two adds at once cannot both pass it.
    rows = await db.batch([
      db
        .prepare("UPDATE edge_accounts SET config_revision = config_revision + 1 WHERE id = ?1 AND (SELECT count(*) FROM sites WHERE user_id = ?2 AND state != 'deleted') < ?3")
        .bind(edge.id, p.userId, limit),
      db
        .prepare(
          `INSERT INTO sites (id, account_id, user_id, target, host, zone_id, seed, excluded, state, revision, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'route_pending', (SELECT config_revision FROM edge_accounts WHERE id = ?), ?, ? WHERE changes() = 1`,
        )
        .bind(id, edge.id, p.userId, target, host, zone!.id, seed, JSON.stringify(excluded), edge.id, now, now),
    ]);
  } catch (e) {
    if (String(e).includes('UNIQUE')) fail(409, 'site_exists', `${host} is already a site.`, { field: 'host' });
    throw e;
  }
  if (!rows[0]!.meta.changes) fail(403, 'limit_reached', `The ${planOf(p.plan)} plan has at most ${limit} sites.`, { limit });
  await placeRoute(env, edge, (await siteById(db, id))!, p.id);
  return (await siteById(db, id))!;
}

const changedMeanwhile = (): never => fail(409, 'operation_in_progress', 'The site changed while this call ran; read it and retry.');

export async function patchSite(env: Env, site: SiteRow, excluded: string[]): Promise<SiteRow> {
  if (site.state === 'deleted') fail(404, 'not_found', 'No such site.');
  if (!(await revise(env.DB, site.account_id, site.id, 'excluded = ?', [JSON.stringify(excluded)], " AND state != 'deleted'"))) changedMeanwhile();
  return (await siteById(env.DB, site.id))!;
}

/** A new seed: new path, names and snippet; the old path keeps counting for 30 days (§5). */
export async function rotateSite(env: Env, principal: string, edge: EdgeAccount, site: SiteRow): Promise<SiteRow> {
  if (site.state !== 'active') fail(409, 'site_not_active', 'Only an active site can be rotated.', { state: site.state });
  const token = await workingToken(env, edge);
  const log: CallLog = { db: env.DB, edgeAccountId: edge.id, principal };
  const seed = newId();
  const pattern = patternOf(site.host, seed);
  const r = await ensureRoute(token, log, site.zone_id, pattern);
  if (!('id' in r)) return fail(409, 'route_conflict', `The new path is already routed to another worker (${r.conflict}); rotate again.`, { worker: r.conflict });
  const retiring = [...(JSON.parse(site.retiring) as Retiring[]), { seed: site.seed, route_id: site.route_id, until: Date.now() + RETIRE_AFTER }];
  const [where, whereArgs] = unchanged(site);
  if (!(await revise(env.DB, site.account_id, site.id, 'seed = ?, route_id = ?, retiring = ?, retire_at = ?', [seed, r.id, JSON.stringify(retiring), Math.min(...retiring.map((x) => x.until))], where, whereArgs))) {
    // Rotated, deleted or disconnected meanwhile: the route just made would be recorded nowhere.
    await dropRoute(token, log, site.zone_id, r.id, pattern);
    changedMeanwhile();
  }
  return (await siteById(env.DB, site.id))!;
}

/**
 * Remove a site; its row stays (totals, §15) as `deleted`, and the worker forgets it. The row is
 * marked first — every route becomes due for removal now — and only then are the routes deleted, so
 * a delete that loses a race deletes nothing, and one that dies halfway leaves the rest to the cron.
 */
export async function deleteSite(env: Env, principal: string, edge: EdgeAccount, site: SiteRow): Promise<SiteRow> {
  if (site.state === 'deleted') return site;
  const due: Retiring[] = [{ seed: site.seed, route_id: site.route_id, until: 0 }, ...(JSON.parse(site.retiring) as Retiring[]).map((r) => ({ ...r, until: 0 }))].filter((r) => r.route_id);
  const [where, whereArgs] = unchanged(site);
  if (!(await revise(env.DB, site.account_id, site.id, "state = 'deleted', route_id = NULL, retiring = ?, retire_at = ?, error = NULL", [JSON.stringify(due), due.length ? 0 : null], where, whereArgs))) changedMeanwhile();
  // Routes Cloudflare will not delete now stay due: the cron finishes them.
  await removeDue(env, edge, (await siteById(env.DB, site.id))!, principal, Date.now()).catch((e: unknown) => console.error('delete site', site.id, e instanceof Error ? e.message : e));
  return (await siteById(env.DB, site.id))!;
}

/**
 * Delete a site's routes whose time is over (`until` ≤ now: a rotation's old path after 30 days, or
 * every route of a deleted site), then drop them from the row — if the row is still as read; a
 * route already deleted is simply `gone` next time. A route changed outside clx is left and named.
 */
async function removeDue(env: Env, edge: EdgeAccount, s: SiteRow, principal: string, now: number): Promise<boolean> {
  const token = await workingToken(env, edge);
  const log: CallLog = { db: env.DB, edgeAccountId: edge.id, principal };
  const all = JSON.parse(s.retiring) as Retiring[];
  const notOurs: string[] = [];
  for (const r of all.filter((x) => x.until <= now && x.route_id)) if ((await dropRoute(token, log, s.zone_id, r.route_id!, patternOf(s.host, r.seed))) === 'not_ours') notOurs.push(patternOf(s.host, r.seed));
  const left = all.filter((x) => x.until > now);
  const error = notOurs.length ? JSON.stringify({ code: 'route_not_ours', routes: notOurs }) : s.error;
  const [where, whereArgs] = unchanged(s);
  return revise(env.DB, s.account_id, s.id, 'retiring = ?, retire_at = ?, error = ?', [JSON.stringify(left), left.length ? Math.min(...left.map((x) => x.until)) : null, error], where, whereArgs);
}

/** The routes clx recorded for a site: the current one and those of past seeds still served. */
function routesOf(s: SiteRow): { zone_id: string; route_id: string; pattern: string }[] {
  return [
    ...(s.route_id ? [{ zone_id: s.zone_id, route_id: s.route_id, pattern: patternOf(s.host, s.seed) }] : []),
    ...(JSON.parse(s.retiring) as Retiring[]).filter((r) => r.route_id).map((r) => ({ zone_id: s.zone_id, route_id: r.route_id!, pattern: patternOf(s.host, r.seed) })),
  ];
}

const lit = (s: string) => `'${s.replace(/'/gu, "''")}'`;

/**
 * Bring the worker's config up to the account's revision (§6): read the worker's last commit, write
 * every site changed since as rows of the new revision, commit them in one conditional statement,
 * then clean up rows no commit names and versions a newer commit superseded. One sync per account
 * at a time (the lease); returns false when another holds it.
 */
export async function syncAccount(env: Env, accountId: string, principal = 'cron'): Promise<boolean> {
  const db = env.DB;
  const owner = newId();
  try {
    await lease(db, accountId, owner);
  } catch {
    return false;
  }
  try {
    const edge = await edgeById(db, accountId);
    if (!edge || !edge.d1_id || !edge.bundle || edge.synced_revision >= edge.config_revision) return true;
    const token = await workingToken(env, edge);
    const log: CallLog = { db, edgeAccountId: edge.id, principal };
    const query = (sql: string) => cf<{ results: Record<string, unknown>[]; meta?: { changes?: number } }[]>(token, 'POST', `/accounts/${edge.cf_account_id}/d1/database/${edge.d1_id}/query`, { sql }, log);
    const head = Number((await query('SELECT coalesce(max(revision), 0) AS r FROM commits'))[0]?.results[0]?.r ?? 0);
    const target = edge.config_revision;
    if (head > target) {
      // The worker's database is ahead of us (restored from elsewhere, or changed by hand): its
      // config cannot be trusted, so every site is written again above its head.
      await db.batch([
        db.prepare('UPDATE edge_accounts SET config_revision = ?, synced_revision = 0 WHERE id = ?').bind(head + 1, edge.id),
        db.prepare('UPDATE sites SET revision = ? WHERE account_id = ?').bind(head + 1, edge.id),
      ]);
      return true;
    }
    if (head < target) {
      const sites = (await db.prepare('SELECT * FROM sites WHERE account_id = ? AND revision > ? AND revision <= ?').bind(edge.id, head, target).all<SiteRow>()).results;
      const syncId = newId();
      const now = Date.now();
      // A deleted site, or one whose path another worker holds, is withdrawn from the worker.
      const live = (s: SiteRow) => s.state === 'active' || s.state === 'route_pending';
      const values = sites.map((s) => `(${lit(siteKey(s.host))}, ${target}, ${lit(syncId)}, ${live(s) ? 0 : 1}, ${live(s) ? lit(JSON.stringify(configOf(s))) : 'NULL'}, ${now})`);
      const encoder = new TextEncoder();
      for (let i = 0; i < values.length; ) {
        const chunk: string[] = [];
        let bytes = 0;
        while (i < values.length && (chunk.length === 0 || bytes + encoder.encode(values[i]!).length < CHUNK_BYTES)) {
          bytes += encoder.encode(values[i]!).length + 1;
          chunk.push(values[i++]!);
        }
        await held(db, edge.id, owner);
        await query(`INSERT INTO cfg (key, revision, sync_id, deleted, data, at) VALUES ${chunk.join(',')}`);
      }
      await held(db, edge.id, owner);
      const [commit] = await query(`INSERT INTO commits (revision, sync_id, at) SELECT ${target}, ${lit(syncId)}, ${now} WHERE (SELECT coalesce(max(revision), 0) FROM commits) = ${head}`);
      if (!commit?.meta?.changes) return true; // the worker moved on meanwhile: the next run looks again
      await query(
        `DELETE FROM cfg WHERE (sync_id NOT IN (SELECT sync_id FROM commits) AND at < ${now - 3_600_000}) OR EXISTS (SELECT 1 FROM cfg n JOIN commits m ON m.revision = n.revision AND m.sync_id = n.sync_id WHERE n.key = cfg.key AND n.revision > cfg.revision)`,
      );
    }
    await db.prepare('UPDATE edge_accounts SET synced_revision = max(synced_revision, ?) WHERE id = ?').bind(target, edge.id).run();
    return true;
  } finally {
    await release(db, accountId, owner);
  }
}

/**
 * The per-minute work on sites: syncs that are behind, routes still to make, and old paths whose
 * 30 days are over (their route deleted, the worker told).
 */
export async function runSites(env: Env, now = Date.now()): Promise<{ synced: number; routes: number; retired: number }> {
  const db = env.DB;
  const behind = (await db.prepare('SELECT id FROM edge_accounts WHERE synced_revision < config_revision AND bundle IS NOT NULL AND (lease_until IS NULL OR lease_until < ?) LIMIT 20').bind(now).all<{ id: string }>()).results;
  let synced = 0;
  for (const a of behind) if (await syncAccount(env, a.id).catch((e: unknown) => (console.error('sync', a.id, e instanceof Error ? e.message : e), false))) synced++;

  const pending = (await db.prepare("SELECT * FROM sites WHERE state = 'route_pending' AND updated_at < ? ORDER BY updated_at LIMIT 20").bind(now - 60_000).all<SiteRow>()).results;
  for (const s of pending) {
    const edge = await edgeById(db, s.account_id);
    if (edge?.state === 'ready') await placeRoute(env, edge, s, 'cron').catch((e: unknown) => console.error('route', s.id, e instanceof Error ? e.message : e));
  }

  const due = (await db.prepare('SELECT * FROM sites WHERE retire_at <= ? LIMIT 20').bind(now).all<SiteRow>()).results;
  let retired = 0;
  for (const s of due) {
    const edge = await edgeById(db, s.account_id);
    if (!edge) continue;
    if (await removeDue(env, edge, s, 'cron', now).catch((e: unknown) => (console.error('retire', s.id, e instanceof Error ? e.message : e), false))) retired++;
  }
  return { synced, routes: pending.length, retired };
}

/** Every route clx recorded for the account's sites — for disconnect (§4). */
export async function recordedRoutes(db: D1Database, accountId: string): Promise<{ zone_id: string; route_id: string; pattern: string }[]> {
  // Deleted sites too: their routes may still be due for removal.
  const sites = (await db.prepare('SELECT * FROM sites WHERE account_id = ?').bind(accountId).all<SiteRow>()).results;
  return sites.flatMap(routesOf);
}

export { dropRoute };

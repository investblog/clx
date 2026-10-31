// Sites (docs/spec.md §5) and the config sync to the worker's database (§6).
//
// A site is a host in one of the account's zones, a route `<host><path>/*` → clx-edge, and a seed
// from which the path, names and snippet come (src/snippet.ts). An external site (§5, ADR 0037) is a
// host in none, its route on a collector host that is; it keeps its seed for life. Every change issues the account's
// next config revision in the same batch as the change; the sync then writes the changed sites as
// new rows of that revision and makes them visible with one conditional commit — a sync that dies
// halfway leaves rows no commit names, which the worker never reads. clx deletes only the routes it
// recorded (§4 ownership); a pattern held by someone else's worker is `route_conflict`, never
// overwritten.
import RELEASED from '../../edge/released.json';
import { extKey, siteKey, type SiteConfig } from '../../edge/contract';
import { LIMITS, planOf } from '../limits';
import { namesFor, scriptFor, SNIPPET_REV, snippetFor } from '../snippet';
import type { Env, Principal } from '../types';
import { fail, newId } from '../v1/http';
import { cf, CfError, type CallLog } from './api';
import { edgeById, held, inService, lease, leased, release, workingToken, type EdgeAccount } from './connect';
import { linkConfigRows } from './links';

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
  kind: 'zone' | 'external';
  /** an external site's: the host its route is on (§5) */
  collector_host: string | null;
  /** the zone of the route's host */
  zone_id: string;
  seed: string;
  excluded: string;
  state: string;
  route_id: string | null;
  retiring: string;
  retire_at: number | null;
  /** The seed of a rotation under way, recorded before its route is made. */
  rotating: string | null;
  revision: number;
  error: string | null;
  /** Beyond free's limits on free (§18): withdrawn from the worker, kept. */
  paused_at: number | null;
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
/** The host a site's routes are on: its own, or an external site's collector host. */
const routeHost = (s: SiteRow) => s.collector_host ?? s.host;

/** The first bundle in edge/released.json that serves external sites (§5): its index. */
const EXTERNAL_SINCE = 11;
const servesExternal = (sha: string | null) => sha !== null && (RELEASED as string[]).indexOf(sha) >= EXTERNAL_SINCE;

/** Two paths meet when one is the other or lies under it: the worker would take one for the other. */
const meet = (a: string, b: string) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

/**
 * Every path the account's sites hold on `host` — current, rotating and retiring — but the current
 * one of `except`. Read under the account's lease, so a new seed checked against it is recorded
 * before anyone else draws one (§5): `ensureRoute` must never adopt another site's route.
 */
async function pathsOn(db: D1Database, accountId: string, host: string, except?: string): Promise<string[]> {
  const rows = (await db.prepare('SELECT * FROM sites WHERE account_id = ? AND coalesce(collector_host, host) = ?').bind(accountId, host).all<SiteRow>()).results;
  return rows
    .flatMap((s) => [...(s.state !== 'deleted' && s.id !== except ? [s.seed] : []), ...(s.rotating ? [s.rotating] : []), ...(JSON.parse(s.retiring) as Retiring[]).map((r) => r.seed)])
    .map((seed) => namesFor(seed).path);
}

/** A seed whose path meets none of `taken`: `seed` itself if it does not. */
function freeSeed(taken: string[], seed = newId()): string {
  while (taken.some((t) => meet(t, namesFor(seed).path))) seed = newId();
  return seed;
}

/** What the API shows of a site: never the seed itself. */
export function siteView(s: SiteRow, syncedRevision: number) {
  const names = namesFor(s.seed);
  return {
    id: s.id,
    account_id: s.account_id,
    host: s.host,
    kind: s.kind,
    collector_host: s.collector_host,
    state: s.state,
    path: names.path,
    snippet: s.state === 'deleted' ? null : snippetFor(s.seed, names, s.collector_host ?? undefined),
    excluded_paths: JSON.parse(s.excluded) as string[],
    config: s.revision <= syncedRevision ? 'synced' : 'pending',
    retiring: (JSON.parse(s.retiring) as Retiring[]).map((r) => ({ path: namesFor(r.seed).path, until: new Date(r.until).toISOString() })),
    error: s.error ? JSON.parse(s.error) : null,
    paused_at: s.paused_at ? new Date(s.paused_at).toISOString() : null,
    created_at: new Date(s.created_at).toISOString(),
  };
}

/** A paused object can be read and deleted, not changed (§18). */
export const refusePaused = (o: { paused_at: number | null }, what: string) => {
  if (o.paused_at) fail(409, 'paused', `This ${what} is paused: it is beyond the free plan's limits. Switch Pro on to use it again.`);
};

/** The site as the worker reads it (edge/contract.ts). */
function configOf(s: SiteRow): SiteConfig {
  const path = (seed: string, until?: number) => {
    const n = namesFor(seed);
    return { path: n.path, c: n.c, s: n.s, script: scriptFor(seed, n, s.collector_host ?? undefined), ...(until ? { until } : {}) };
  };
  const config: SiteConfig = { t: s.target, paths: [path(s.seed), ...(JSON.parse(s.retiring) as Retiring[]).map((r) => path(r.seed, r.until))], excluded: JSON.parse(s.excluded) as string[] };
  // An external site's pages may send from its host with and without `www.` (§5).
  if (s.kind === 'external') config.origins = [...new Set([s.host, s.host.replace(/^www\./u, ''), `www.${s.host.replace(/^www\./u, '')}`])];
  return config;
}

/** Where the worker reads a site: by its host, or an external site by its collector host and path. */
const keyOf = (s: SiteRow) => (s.kind === 'external' ? extKey(s.collector_host!, namesFor(s.seed).path) : siteKey(s.host));

/** The account's zone that holds `host`: the most specific one (names match exactly, so suffixes are tried). */
export async function zoneFor(token: string, cfAccountId: string, host: string): Promise<{ id: string; name: string } | null> {
  const labels = host.split('.');
  for (let i = 0; i <= labels.length - 2; i++) {
    const name = labels.slice(i).join('.');
    const [zone] = await cf<{ id: string; name: string }[]>(token, 'GET', `/zones?account.id=${cfAccountId}&name=${name}`);
    if (zone) return zone;
  }
  return null;
}

/** At most this many zones are listed for the page's host picker (20 calls of 50). */
const ZONES_MAX = 1000;

/** The account's zones by name, for the page to suggest a host from; `truncated` past ZONES_MAX. */
export async function listZones(token: string, cfAccountId: string): Promise<{ zones: { name: string; status: string }[]; truncated: boolean }> {
  const zones: { name: string; status: string }[] = [];
  for (let page = 1; zones.length < ZONES_MAX; page++) {
    const batch = await cf<{ name: string; status: string }[]>(token, 'GET', `/zones?account.id=${cfAccountId}&per_page=50&page=${page}&order=name`);
    zones.push(...batch.map((z) => ({ name: z.name, status: z.status })));
    if (batch.length < 50) return { zones, truncated: false };
  }
  // Exactly ZONES_MAX is not truncated: the next page says whether there are more (per_page is 5–50).
  const more = await cf<unknown[]>(token, 'GET', `/zones?account.id=${cfAccountId}&per_page=50&page=${ZONES_MAX / 50 + 1}&order=name`);
  return { zones, truncated: more.length > 0 };
}

/** Create the route, or adopt it if it is clx's from an earlier attempt; someone else's is a conflict. */
export async function ensureRoute(token: string, log: CallLog, zoneId: string, pattern: string): Promise<{ id: string } | { conflict: string }> {
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
 * route the user has since pointed elsewhere is no longer ours and is left (§4 ownership). With no
 * ID, the route of the pattern: one a rotation made but died before recording (§15).
 */
async function dropRoute(token: string, log: CallLog, zoneId: string, routeId: string | null, pattern: string): Promise<'deleted' | 'gone' | 'not_ours'> {
  if (!routeId) {
    const there = (await cf<{ id: string; pattern: string; script?: string }[]>(token, 'GET', `/zones/${zoneId}/workers/routes`)).find((r) => r.pattern === pattern);
    if (!there) return 'gone';
    if (there.script !== SCRIPT) return 'not_ours';
    routeId = there.id;
  }
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

/** The row as read: the same seed, state, route, retiring list and rotation (a compare-and-swap). */
const unchanged = (s: SiteRow): [string, unknown[]] => [' AND seed = ? AND state = ? AND route_id IS ? AND retiring = ? AND rotating IS ?', [s.seed, s.state, s.route_id, s.retiring, s.rotating]];

const siteById = (db: D1Database, id: string) => db.prepare('SELECT * FROM sites WHERE id = ?').bind(id).first<SiteRow>();

/**
 * Make or adopt the site's route and record the outcome — under the account's lease: disconnect
 * takes it too, so it never runs between a route made and the row that records it (the route would
 * outlive the account, recorded nowhere). Lease busy: the site stays route_pending for the cron.
 */
async function placeRoute(env: Env, edge: EdgeAccount, site: SiteRow, principal: string): Promise<void> {
  await leased(env.DB, edge.id, () => makeRoute(env, edge, site, principal));
}

async function makeRoute(env: Env, edge: EdgeAccount, site: SiteRow, principal: string): Promise<void> {
  const log: CallLog = { db: env.DB, edgeAccountId: edge.id, principal };
  // A zone site added while the lease was held was not checked (§5): a path that meets another on
  // its host gets a new seed first — its config is keyed by its host, so the worker is simply told
  // the new path. An external site's seed was checked under the lease when it was added and is
  // never drawn again: its key is its path (addSite).
  const seed = site.kind === 'zone' ? freeSeed(await pathsOn(env.DB, site.account_id, routeHost(site), site.id), site.seed) : site.seed;
  if (seed !== site.seed) {
    if (!(await revise(env.DB, site.account_id, site.id, 'seed = ?', [seed], " AND state = 'route_pending' AND seed = ? AND route_id IS NULL", [site.seed]))) return;
    site = { ...site, seed };
  }
  const token = await workingToken(env, edge);
  const pattern = patternOf(routeHost(site), site.seed);
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

/**
 * Add a site: the zone is found in the account, the site recorded, the route made (§15). With a
 * `collector` it is an external site (§5, Pro): its host is in no zone of the account, its route on
 * the collector host, which is.
 */
export async function addSite(env: Env, p: Principal, edge: EdgeAccount, host: string, excluded: string[], collector?: string): Promise<SiteRow> {
  refusePaused(edge, 'Cloudflare account');
  if (!inService(edge)) fail(409, 'account_not_ready', 'clx-edge is not installed and confirmed in this account yet.', { state: edge.state });
  if (collector !== undefined) {
    if (!LIMITS[planOf(p.plan)].externalSites) fail(403, 'limit_reached', 'External sites (sites not on Cloudflare) are on Pro.', { limit: 0, field: 'collector_host' });
    if (!servesExternal(edge.bundle)) fail(409, 'update_required', 'clx-edge in this account is too old for external sites; update it first.', { bundle: edge.bundle });
  }
  const token = await workingToken(env, edge);
  const on = collector ?? host;
  const field = collector === undefined ? 'host' : 'collector_host';
  const zone = await zoneFor(token, edge.cf_account_id, on);
  if (!zone) fail(400, 'zone_not_found', `No zone of this Cloudflare account holds ${on}.`, { field });
  if (collector !== undefined && (await zoneFor(token, edge.cf_account_id, host))) fail(400, 'invalid_request', `${host} is in a zone of this account: add it as a site of its own, without collector_host.`, { field: 'host' });
  const db = env.DB;
  // A link host passes nothing through, a site's route host everything outside the counter: one
  // host cannot be both (src/cf/links.ts).
  const taken = () => fail(409, 'invalid_request', `${on} is a link host; a site needs a host of its own.`, { field });
  if (await db.prepare("SELECT 1 FROM link_hosts WHERE host = ? AND (state != 'deleted' OR domain_id IS NOT NULL)").bind(on).first()) taken();
  const id = newId();
  const target = `s${[...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(36).padStart(2, '0')).join('')}`;
  const now = Date.now();
  const limit = LIMITS[planOf(p.plan)].sites;
  const record = async (seed: string) => {
    let rows: D1Result[];
    try {
      // The limit is part of the batch, so two adds at once cannot both pass it.
      rows = await db.batch([
        db
          .prepare("UPDATE edge_accounts SET config_revision = config_revision + 1 WHERE id = ?1 AND paused_at IS NULL AND (SELECT count(*) FROM sites WHERE user_id = ?2 AND state != 'deleted' AND paused_at IS NULL) < ?3")
          .bind(edge.id, p.userId, limit),
        db
          .prepare(
            `INSERT INTO sites (id, account_id, user_id, target, host, kind, collector_host, zone_id, seed, excluded, state, revision, created_at, updated_at)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'route_pending', (SELECT config_revision FROM edge_accounts WHERE id = ?), ?, ? WHERE changes() = 1
             AND NOT EXISTS (SELECT 1 FROM link_hosts WHERE host = ? AND (state != 'deleted' OR domain_id IS NOT NULL))`,
          )
          .bind(id, edge.id, p.userId, target, host, collector === undefined ? 'zone' : 'external', collector ?? null, zone!.id, seed, JSON.stringify(excluded), edge.id, now, now, on),
      ]);
    } catch (e) {
      if (String(e).includes('UNIQUE')) fail(409, 'site_exists', `${host} is already a site.`, { field: 'host' });
      throw e;
    }
    if (!rows[0]!.meta.changes) fail(403, 'limit_reached', `The ${planOf(p.plan)} plan has at most ${limit} sites.`, { limit });
    if (!rows[1]!.meta.changes) taken();
  };
  if (collector === undefined) {
    await record(newId());
    await placeRoute(env, edge, (await siteById(db, id))!, p.id);
  } else {
    // An external site's key is its path for life (§5): drawn against every path on the collector
    // host and recorded under the account's lease, so no other seed is drawn in between.
    const made = await leased(db, edge.id, async () => {
      await record(freeSeed(await pathsOn(db, edge.id, collector)));
      await makeRoute(env, edge, (await siteById(db, id))!, p.id);
      return true;
    });
    if (!made) fail(409, 'operation_in_progress', 'Another operation on this Cloudflare account is running; retry shortly.');
  }
  return (await siteById(db, id))!;
}

const changedMeanwhile = (): never => fail(409, 'operation_in_progress', 'The site changed while this call ran; read it and retry.');

export async function patchSite(env: Env, site: SiteRow, excluded: string[]): Promise<SiteRow> {
  if (site.state === 'deleted') fail(404, 'not_found', 'No such site.');
  refusePaused(site, 'site');
  if (!(await revise(env.DB, site.account_id, site.id, 'excluded = ?', [JSON.stringify(excluded)], " AND state != 'deleted' AND paused_at IS NULL"))) {
    refusePaused((await siteById(env.DB, site.id)) ?? site, 'site');
    changedMeanwhile();
  }
  return (await siteById(env.DB, site.id))!;
}

/** A new seed: new path, names and snippet; the old path keeps counting for 30 days (§5). */
export async function rotateSite(env: Env, principal: string, edge: EdgeAccount, site: SiteRow): Promise<SiteRow> {
  if (site.kind === 'external') fail(400, 'invalid_request', 'An external site keeps its path for life (§5): delete it and add it again for a new one.');
  if (site.state !== 'active') fail(409, 'site_not_active', 'Only an active site can be rotated.', { state: site.state });
  refusePaused(site, 'site');
  // Under the lease, as placeRoute.
  return (await leased(env.DB, edge.id, () => rotate(env, principal, edge, site))) ?? fail(409, 'operation_in_progress', 'Another operation on this Cloudflare account is running; retry shortly.');
}

async function rotate(env: Env, principal: string, edge: EdgeAccount, site: SiteRow): Promise<SiteRow> {
  const token = await workingToken(env, edge);
  const log: CallLog = { db: env.DB, edgeAccountId: edge.id, principal };
  // The new seed is recorded before its route is made (§15): a retry of a rotation that died after
  // Cloudflare made the route finishes it with the same seed, the route adopted; left alone, the cron
  // undoes it (undoRotation) — the call that died answered no rotation.
  let seed = site.rotating;
  if (!seed) {
    // Its path meets none on the host, its own old ones included (§5).
    seed = freeSeed(await pathsOn(env.DB, site.account_id, routeHost(site)));
    const set = await env.DB.prepare("UPDATE sites SET rotating = ?, updated_at = ? WHERE id = ? AND state = 'active' AND seed = ? AND rotating IS NULL AND paused_at IS NULL").bind(seed, Date.now(), site.id, site.seed).run();
    if (!set.meta.changes) changedMeanwhile();
    site = { ...site, rotating: seed };
  }
  const pattern = patternOf(routeHost(site), seed);
  const r = await ensureRoute(token, log, site.zone_id, pattern);
  if (!('id' in r)) {
    await env.DB.prepare('UPDATE sites SET rotating = NULL WHERE id = ? AND rotating = ?').bind(site.id, seed).run();
    return fail(409, 'route_conflict', `The new path is already routed to another worker (${r.conflict}); rotate again.`, { worker: r.conflict });
  }
  const retiring = [...(JSON.parse(site.retiring) as Retiring[]), { seed: site.seed, route_id: site.route_id, until: Date.now() + RETIRE_AFTER }];
  const [where, whereArgs] = unchanged(site);
  if (!(await revise(env.DB, site.account_id, site.id, 'seed = ?, rotating = NULL, route_id = ?, retiring = ?, retire_at = ?', [seed, r.id, JSON.stringify(retiring), Math.min(...retiring.map((x) => x.until))], where, whereArgs))) {
    // Rotated, deleted or disconnected meanwhile: the route just made would be recorded nowhere.
    await dropRoute(token, log, site.zone_id, r.id, pattern);
    changedMeanwhile();
  }
  return (await siteById(env.DB, site.id))!;
}

/**
 * A rotation that died and was not retried: its route, if Cloudflare made it, is deleted by its
 * pattern and the rotation forgotten — under the lease, which a live rotation holds. The row is read
 * again under it: a retry may have finished the rotation since, and its route is the site's now. A
 * route that is not clx's any more is left; the rotation is forgotten all the same.
 */
export async function undoRotation(env: Env, edge: EdgeAccount, siteId: string, seed: string): Promise<void> {
  const site = await siteById(env.DB, siteId);
  if (site?.rotating !== seed) return;
  const token = await workingToken(env, edge);
  await dropRoute(token, { db: env.DB, edgeAccountId: edge.id, principal: 'cron' }, site.zone_id, null, patternOf(routeHost(site), seed));
  await env.DB.prepare('UPDATE sites SET rotating = NULL WHERE id = ? AND rotating = ?').bind(site.id, seed).run();
}

/**
 * Remove a site; its row stays (totals, §15) as `deleted`, and the worker forgets it. The row is
 * marked first — every route becomes due for removal now — and only then are the routes deleted, so
 * a delete that loses a race deletes nothing, and one that dies halfway leaves the rest to the cron.
 * A route that may be in the making (a new site's, a rotation's) is looked for by its pattern, under
 * the lease the call making it holds, so never before it exists.
 */
export async function deleteSite(env: Env, principal: string, edge: EdgeAccount, site: SiteRow): Promise<SiteRow> {
  if (site.state === 'deleted') return site;
  if (site.state !== 'route_pending' && !site.rotating) return removeSite(env, principal, edge, site);
  return (await leased(env.DB, edge.id, async () => removeSite(env, principal, edge, (await siteById(env.DB, site.id))!))) ?? fail(409, 'operation_in_progress', 'Another operation on this Cloudflare account is running; retry shortly.');
}

async function removeSite(env: Env, principal: string, edge: EdgeAccount, site: SiteRow): Promise<SiteRow> {
  if (site.state === 'deleted') return site;
  const due: Retiring[] = [
    // A route without an ID is looked for by its pattern: a new site's may be made and not recorded.
    ...(site.route_id || site.state === 'route_pending' ? [{ seed: site.seed, route_id: site.route_id, until: 0 }] : []),
    ...(JSON.parse(site.retiring) as Retiring[]).map((r) => ({ ...r, until: 0 })),
    // So may a rotation's under way.
    ...(site.rotating ? [{ seed: site.rotating, route_id: null, until: 0 }] : []),
  ];
  const [where, whereArgs] = unchanged(site);
  if (!(await revise(env.DB, site.account_id, site.id, "state = 'deleted', route_id = NULL, retiring = ?, retire_at = ?, rotating = NULL, error = NULL", [JSON.stringify(due), due.length ? 0 : null], where, whereArgs))) changedMeanwhile();
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
  for (const r of all.filter((x) => x.until <= now)) if ((await dropRoute(token, log, s.zone_id, r.route_id, patternOf(routeHost(s), r.seed))) === 'not_ours') notOurs.push(patternOf(routeHost(s), r.seed));
  const left = all.filter((x) => x.until > now);
  const error = notOurs.length ? JSON.stringify({ code: 'route_not_ours', routes: notOurs }) : s.error;
  const [where, whereArgs] = unchanged(s);
  return revise(env.DB, s.account_id, s.id, 'retiring = ?, retire_at = ?, error = ?', [JSON.stringify(left), left.length ? Math.min(...left.map((x) => x.until)) : null, error], where, whereArgs);
}

/**
 * The routes clx recorded for a site: the current one, those of past seeds still served, and a
 * rotation's under way. One without an ID — a new site's or a rotation's, which may be made and not
 * recorded — is found by its pattern.
 */
function routesOf(s: SiteRow): { zone_id: string; route_id: string | null; pattern: string }[] {
  const seeds: { seed: string; route_id: string | null }[] = [
    ...(s.route_id || s.state === 'route_pending' ? [{ seed: s.seed, route_id: s.route_id }] : []),
    ...(JSON.parse(s.retiring) as Retiring[]),
    ...(s.rotating ? [{ seed: s.rotating, route_id: null }] : []),
  ];
  return seeds.map((r) => ({ zone_id: s.zone_id, route_id: r.route_id, pattern: patternOf(routeHost(s), r.seed) }));
}

export const lit = (s: string) => `'${s.replace(/'/gu, "''")}'`;
/** Every table of config the worker gets: a full rewrite moves all of their rows to one revision. */
const CONFIG_TABLES = ['sites', 'link_hosts', 'links'] as const;

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
        ...CONFIG_TABLES.map((t) => db.prepare(`UPDATE ${t} SET revision = ? WHERE account_id = ?`).bind(head + 1, edge.id)),
      ]);
      return true;
    }
    if (head < target) {
      const sites = (await db.prepare('SELECT * FROM sites WHERE account_id = ? AND revision > ? AND revision <= ? ORDER BY revision').bind(edge.id, head, target).all<SiteRow>()).results;
      const syncId = newId();
      const now = Date.now();
      // A deleted site, one whose path another worker holds, or a paused one (§18) is withdrawn
      // from the worker.
      const live = (s: SiteRow) => (s.state === 'active' || s.state === 'route_pending') && !s.paused_at;
      // One row per key: a host or code deleted and added again in this range has a withdrawn row
      // and a live one, and the live one wins.
      const rows = new Map<string, string | null>();
      for (const [key, data] of [...sites.map((s): [string, string | null] => [keyOf(s), live(s) ? JSON.stringify(configOf(s)) : null]), ...(await linkConfigRows(db, edge.id, head, target))])
        if (data !== null || !rows.has(key)) rows.set(key, data);
      const values = [...rows].map(([key, data]) => `(${lit(key)}, ${target}, ${lit(syncId)}, ${data === null ? 1 : 0}, ${data === null ? 'NULL' : lit(data)}, ${now})`);
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
      // What wrote these sites: today's snippet code, at their revision (ADR 0039). An older Worker's
      // sync leaves no such record, and the cron writes its sites again.
      await db.prepare('UPDATE sites SET snippet_rev = ?1, written_rev = revision WHERE account_id = ?2 AND revision > ?3 AND revision <= ?4').bind(SNIPPET_REV, edge.id, head, target).run();
      await query(
        `DELETE FROM cfg WHERE (sync_id NOT IN (SELECT sync_id FROM commits) AND at < ${now - 3_600_000}) OR EXISTS (SELECT 1 FROM cfg n JOIN commits m ON m.revision = n.revision AND m.sync_id = n.sync_id WHERE n.key = cfg.key AND n.revision > cfg.revision)`,
      );
    }
    await db.prepare('UPDATE edge_accounts SET synced_revision = max(synced_revision, ?), synced_at = ? WHERE id = ?').bind(target, Date.now(), edge.id).run();
    return true;
  } finally {
    await release(db, accountId, owner);
  }
}

/** A heartbeat's revision is trusted only this long after a sync finished: the worker reads its
 *  head shortly before it pushes, and a sync may commit in between. */
const SYNC_SETTLE = 10 * 60_000;

/**
 * The worker-side sync check (§6): the latest config commit the worker reports in its heartbeat.
 * With no sync pending and none finished in the last 10 minutes, a commit that is not the one clx.cx
 * synced means the worker's database was changed elsewhere (restored, edited by hand, lost): every
 * site is written again above both revisions, as for a head found ahead. Returns whether it was.
 */
export async function staleSync(db: D1Database, edge: EdgeAccount, revision: number, now: number): Promise<boolean> {
  if (!edge.bundle || revision === edge.synced_revision || edge.config_revision !== edge.synced_revision || (edge.synced_at ?? 0) > now - SYNC_SETTLE) return false;
  const next = Math.max(edge.config_revision, revision) + 1;
  const [moved] = await db.batch([
    db.prepare('UPDATE edge_accounts SET config_revision = ?1, synced_revision = 0 WHERE id = ?2 AND config_revision = ?3 AND synced_revision = ?3').bind(next, edge.id, edge.config_revision),
    ...CONFIG_TABLES.map((t) => db.prepare(`UPDATE ${t} SET revision = ?1 WHERE account_id = ?2 AND (SELECT config_revision FROM edge_accounts WHERE id = ?2) = ?1`).bind(next, edge.id)),
  ]);
  if (moved!.meta.changes) console.log(`sync_stale ${edge.id}: worker at ${revision}, clx.cx at ${edge.synced_revision}`);
  return Boolean(moved!.meta.changes);
}

/**
 * The per-minute work on sites: syncs that are behind, routes still to make, and old paths whose
 * 30 days are over (their route deleted, the worker told).
 */
export async function runSites(env: Env, now = Date.now()): Promise<{ synced: number; routes: number; retired: number }> {
  const db = env.DB;
  // A synced site not written by today's snippet code at its revision (ADR 0039) — every site when
  // SNIPPET_REV is raised, or one an older Worker synced just after a deploy or after a rollback —
  // moves to a new revision, so the sync below writes its served script again; 20 accounts a minute.
  const STALE = "state != 'deleted' AND revision <= (SELECT synced_revision FROM edge_accounts e WHERE e.id = sites.account_id) AND (snippet_rev IS NOT ?1 OR written_rev IS NOT revision)";
  const stale = (await db.prepare(`SELECT DISTINCT account_id AS id FROM sites WHERE ${STALE} LIMIT 20`).bind(SNIPPET_REV).all<{ id: string }>()).results;
  for (const a of stale)
    await db.batch([
      db.prepare('UPDATE edge_accounts SET config_revision = config_revision + 1 WHERE id = ?2').bind(SNIPPET_REV, a.id),
      db.prepare(`UPDATE sites SET revision = (SELECT config_revision FROM edge_accounts WHERE id = ?2) WHERE account_id = ?2 AND ${STALE}`).bind(SNIPPET_REV, a.id),
    ]);
  const behind = (await db.prepare('SELECT id FROM edge_accounts WHERE synced_revision < config_revision AND bundle IS NOT NULL AND (lease_until IS NULL OR lease_until < ?) LIMIT 20').bind(now).all<{ id: string }>()).results;
  let synced = 0;
  for (const a of behind) if (await syncAccount(env, a.id).catch((e: unknown) => (console.error('sync', a.id, e instanceof Error ? e.message : e), false))) synced++;

  const pending = (await db.prepare("SELECT * FROM sites WHERE state = 'route_pending' AND updated_at < ? ORDER BY updated_at LIMIT 20").bind(now - 60_000).all<SiteRow>()).results;
  for (const s of pending) {
    const edge = await edgeById(db, s.account_id);
    if (edge && inService(edge)) await placeRoute(env, edge, s, 'cron').catch((e: unknown) => console.error('route', s.id, e instanceof Error ? e.message : e));
  }

  // Rotations that died and were not retried: undone (a live one holds the lease). One that fails
  // goes to the back of the queue.
  const rotating = (
    await db
      .prepare("SELECT s.* FROM sites s JOIN edge_accounts e ON e.id = s.account_id WHERE s.rotating IS NOT NULL AND e.state IN ('ready', 'no_connection') AND s.updated_at < ? ORDER BY s.updated_at LIMIT 20")
      .bind(now - 60_000)
      .all<SiteRow>()
  ).results;
  for (const s of rotating) {
    const edge = await edgeById(db, s.account_id);
    if (!edge) continue;
    await leased(db, edge.id, () => undoRotation(env, edge, s.id, s.rotating!)).catch(async (e: unknown) => {
      console.error('undo rotation', s.id, e instanceof Error ? e.message : e);
      await db.prepare('UPDATE sites SET updated_at = ? WHERE id = ? AND rotating = ?').bind(now, s.id, s.rotating).run();
    });
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

/** Every route clx recorded for the account's sites — for disconnect (§4). Deleted sites too: their
 *  routes may still be due for removal. (Link hosts are custom domains: src/cf/links.ts.) */
export async function recordedRoutes(db: D1Database, accountId: string): Promise<{ zone_id: string; route_id: string | null; pattern: string }[]> {
  const sites = await db.prepare('SELECT * FROM sites WHERE account_id = ?').bind(accountId).all<SiteRow>();
  return sites.results.flatMap(routesOf);
}

export { dropRoute };

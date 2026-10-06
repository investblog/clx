// Short links and the link host (docs/spec.md §6).
//
// The link host is a host in one of the account's zones, routed whole (`<host>/*`) to clx-edge; one
// live host per account. A link is a code on it → a target URL, with rules by country and device.
// Both are config like sites: every change issues the account's next revision in the same batch,
// and the sync (src/cf/sites.ts) writes them to the worker as `linkhost:<host>` and `link:<code>`.
// clx deletes only the route it recorded (§4 ownership); a pattern held by someone else's worker is
// `route_conflict`, never overwritten.
import { CODE, linkHostKey, linkKey, type Device, type LinkConfig } from '../../edge/contract';
import { LIMITS, planOf } from '../limits';
import type { Env, Principal } from '../types';
import { fail, newId } from '../v1/http';
import { CfError, type CallLog } from './api';
import { inService, workingToken, type EdgeAccount } from './connect';
import { dropRoute, ensureRoute, validHost, zoneFor } from './sites';

export interface LinkHostRow {
  id: string;
  account_id: string;
  host: string;
  zone_id: string;
  state: string;
  route_id: string | null;
  revision: number;
  error: string | null;
  created_at: number;
  updated_at: number;
}
export interface LinkRow {
  id: string;
  account_id: string;
  user_id: number;
  target: string;
  code: string;
  url: string;
  url_host: string;
  rules: string;
  state: string;
  revision: number;
  created_at: number;
  updated_at: number;
}
export type Rule = LinkConfig['rules'][number];

const patternOf = (host: string) => `${host}/*`;
const MAX_URL = 2048;
const DEVICES: Device[] = ['mobile', 'desktop'];

export function linkHostView(h: LinkHostRow, syncedRevision: number) {
  return { host: h.host, state: h.state, config: h.revision <= syncedRevision ? 'synced' : 'pending', error: h.error ? JSON.parse(h.error) : null };
}

export function linkView(l: LinkRow, host: string | null, syncedRevision: number) {
  return {
    id: l.id,
    account_id: l.account_id,
    code: l.code,
    short_url: host && l.state !== 'deleted' ? `https://${host}/${l.code}` : null,
    url: l.url,
    rules: JSON.parse(l.rules) as Rule[],
    state: l.state,
    config: l.revision <= syncedRevision ? 'synced' : 'pending',
    created_at: new Date(l.created_at).toISOString(),
  };
}

/** The link as the worker reads it (edge/contract.ts). */
export const linkConfigOf = (l: LinkRow): LinkConfig => ({ t: l.target, url: l.url, rules: JSON.parse(l.rules) as Rule[] });

export const liveLinkHost = (db: D1Database, accountId: string) => db.prepare("SELECT * FROM link_hosts WHERE account_id = ? AND state != 'deleted'").bind(accountId).first<LinkHostRow>();
const linkHostById = (db: D1Database, id: string) => db.prepare('SELECT * FROM link_hosts WHERE id = ?').bind(id).first<LinkHostRow>();
const linkById = (db: D1Database, id: string) => db.prepare('SELECT * FROM links WHERE id = ?').bind(id).first<LinkRow>();

/** A target URL: `https://` only, at most 2048 characters, not on the link host (no loops). */
export function targetOf(v: unknown, field: string, linkHost: string | null): { url: string; host: string } {
  let u: URL | null = null;
  try {
    u = typeof v === 'string' && v.length <= MAX_URL ? new URL(v) : null;
  } catch {
    // refused below
  }
  if (!u || u.protocol !== 'https:' || u.username || u.password || !u.hostname) fail(400, 'invalid_request', `"${field}" must be an https:// URL of at most ${MAX_URL} characters.`, { field });
  const host = u!.hostname.toLowerCase();
  if (host === linkHost) fail(400, 'invalid_request', `"${field}" may not point at the link host itself.`, { field });
  return { url: u!.href, host };
}

/** Rules: up to the plan's limit, each with countries (ISO 3166 alpha-2) and/or devices, and a URL. */
export function rulesOf(v: unknown, plan: string, linkHost: string | null): { rules: Rule[]; hosts: string[] } {
  if (v === undefined) return { rules: [], hosts: [] };
  const max = LIMITS[planOf(plan)].rulesPerLink;
  if (!Array.isArray(v) || v.length > max) fail(400, 'invalid_request', `"rules" must be a list of at most ${max} rules.`, { field: 'rules' });
  const hosts: string[] = [];
  const rules = (v as unknown[]).map((r, i) => {
    const field = `rules[${i}]`;
    if (!r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).some((k) => !['countries', 'devices', 'url'].includes(k))) fail(400, 'invalid_request', `"${field}" must be {countries?, devices?, url}.`, { field });
    const { countries, devices, url } = r as Record<string, unknown>;
    if (countries !== undefined && (!Array.isArray(countries) || !countries.length || countries.length > 250 || !countries.every((c) => typeof c === 'string' && /^[A-Z]{2}$/u.test(c))))
      fail(400, 'invalid_request', `"${field}.countries" must be a non-empty list of two-letter country codes such as "DE".`, { field: `${field}.countries` });
    if (devices !== undefined && (!Array.isArray(devices) || !devices.length || !devices.every((d) => DEVICES.includes(d as Device))))
      fail(400, 'invalid_request', `"${field}.devices" must be a non-empty list of "mobile" and "desktop".`, { field: `${field}.devices` });
    if (countries === undefined && devices === undefined) fail(400, 'invalid_request', `"${field}" needs countries or devices.`, { field });
    const target = targetOf(url, `${field}.url`, linkHost);
    hosts.push(target.host);
    return { ...(countries ? { countries: [...new Set(countries as string[])] } : {}), ...(devices ? { devices: [...new Set(devices as Device[])] } : {}), url: target.url };
  });
  return { rules, hosts };
}

/** Make or adopt the link host's route and record the outcome (as for a site, src/cf/sites.ts). */
async function placeLinkRoute(env: Env, edge: EdgeAccount, h: LinkHostRow, principal: string): Promise<void> {
  const log: CallLog = { db: env.DB, edgeAccountId: edge.id, principal };
  const token = await workingToken(env, edge);
  const pattern = patternOf(h.host);
  let state = 'route_pending';
  let routeId: string | null = null;
  let error: Record<string, unknown> | null = null;
  try {
    const r = await ensureRoute(token, log, h.zone_id, pattern);
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
  const db = env.DB;
  // A conflict withdraws the host from the worker, so it is a revision.
  const [, changed] = await db.batch([
    db.prepare('UPDATE edge_accounts SET config_revision = config_revision + ?2 WHERE id = ?1').bind(h.account_id, state === 'route_conflict' ? 1 : 0),
    db
      .prepare(
        "UPDATE link_hosts SET state = ?1, route_id = ?2, error = ?3, updated_at = ?4, revision = CASE WHEN ?1 = 'route_conflict' THEN (SELECT config_revision FROM edge_accounts WHERE id = ?6) ELSE revision END WHERE id = ?5 AND state = 'route_pending'",
      )
      .bind(state, routeId, error ? JSON.stringify(error) : null, Date.now(), h.id, h.account_id),
  ]);
  // Replaced or gone meanwhile: the route is nobody's.
  if (!changed!.meta.changes && routeId) await dropRoute(token, log, h.zone_id, routeId, pattern);
}

/** Delete the routes of replaced link hosts; a row whose route is gone keeps no route_id. */
async function dropReplaced(env: Env, edge: EdgeAccount, principal: string): Promise<void> {
  const rows = (await env.DB.prepare("SELECT * FROM link_hosts WHERE account_id = ? AND state = 'deleted' AND route_id IS NOT NULL").bind(edge.id).all<LinkHostRow>()).results;
  if (!rows.length) return;
  const token = await workingToken(env, edge);
  const log: CallLog = { db: env.DB, edgeAccountId: edge.id, principal };
  for (const h of rows) {
    const outcome = await dropRoute(token, log, h.zone_id, h.route_id!, patternOf(h.host));
    const error = outcome === 'not_ours' ? JSON.stringify({ code: 'route_not_ours', routes: [patternOf(h.host)] }) : h.error;
    await env.DB.prepare('UPDATE link_hosts SET route_id = NULL, error = ?, updated_at = ? WHERE id = ? AND route_id = ?').bind(error, Date.now(), h.id, h.route_id).run();
  }
}

/**
 * Set the account's link host (§6): a host in one of its zones, routed whole to clx-edge. The same
 * host again changes nothing; another one replaces it — its route goes, and the links move with it
 * (their codes stay).
 */
export async function setLinkHost(env: Env, p: Principal, edge: EdgeAccount, host: string): Promise<LinkHostRow> {
  if (!inService(edge)) fail(409, 'account_not_ready', 'clx-edge is not installed and confirmed in this account yet.', { state: edge.state });
  if (!validHost(host)) fail(400, 'invalid_request', '"host" must be a host name such as go.example.com.', { field: 'host' });
  const db = env.DB;
  const current = await liveLinkHost(db, edge.id);
  if (current?.host === host) {
    if (current.state !== 'route_conflict') return current;
    // The same host again after a conflict: the user may have freed the pattern — try once more.
    const [, retried] = await db.batch([
      db.prepare('UPDATE edge_accounts SET config_revision = config_revision + 1 WHERE id = ?').bind(edge.id),
      db
        .prepare("UPDATE link_hosts SET state = 'route_pending', error = NULL, revision = (SELECT config_revision FROM edge_accounts WHERE id = ?1), updated_at = ?2 WHERE id = ?3 AND state = 'route_conflict'")
        .bind(edge.id, Date.now(), current.id),
    ]);
    if (retried!.meta.changes) await placeLinkRoute(env, edge, (await linkHostById(db, current.id))!, p.id);
    return (await linkHostById(db, current.id))!;
  }
  // A site's host passes everything outside its counter through to the site; a link host passes
  // nothing. One host cannot be both.
  if (await db.prepare("SELECT 1 FROM sites WHERE host = ? AND state != 'deleted'").bind(host).first()) fail(409, 'invalid_request', `${host} is a site; the link host must be a host of its own, such as go.${host}.`, { field: 'host' });
  // A rule's URL is stored as its href: the host is followed by "/" or ":" (a port).
  const pointing = await db
    .prepare("SELECT count(*) AS n FROM links WHERE account_id = ?1 AND state != 'deleted' AND (url_host = ?2 OR instr(rules, ?3) > 0 OR instr(rules, ?4) > 0)")
    .bind(edge.id, host, `"https://${host}/`, `"https://${host}:`)
    .first<number>('n');
  if (pointing) fail(409, 'invalid_request', `${pointing} link(s) point at ${host}; a link host cannot be a link's target.`, { field: 'host' });
  const zone = await zoneFor(await workingToken(env, edge), edge.cf_account_id, host);
  if (!zone) fail(400, 'zone_not_found', `No zone of this Cloudflare account holds ${host}.`, { field: 'host' });
  const id = newId();
  const now = Date.now();
  try {
    // The old host is withdrawn and the new one added under one revision; the links' keys do not
    // name the host, so they stay as they are.
    const rows = await db.batch([
      db.prepare('UPDATE edge_accounts SET config_revision = config_revision + 1 WHERE id = ?').bind(edge.id),
      // The old host goes only if the new one will be inserted: the same condition as the insert,
      // in the same transaction.
      db
        .prepare(
          "UPDATE link_hosts SET state = 'deleted', revision = (SELECT config_revision FROM edge_accounts WHERE id = ?1), updated_at = ?2 WHERE account_id = ?1 AND state != 'deleted' AND id IS ?3 AND NOT EXISTS (SELECT 1 FROM sites WHERE host = ?4 AND state != 'deleted')",
        )
        .bind(edge.id, now, current?.id ?? null, host),
      db
        .prepare(
          "INSERT INTO link_hosts (id, account_id, host, zone_id, state, revision, created_at, updated_at) SELECT ?1, ?2, ?3, ?4, 'route_pending', (SELECT config_revision FROM edge_accounts WHERE id = ?2), ?5, ?5 WHERE NOT EXISTS (SELECT 1 FROM link_hosts WHERE account_id = ?2 AND state != 'deleted') AND NOT EXISTS (SELECT 1 FROM sites WHERE host = ?3 AND state != 'deleted')",
        )
        .bind(id, edge.id, host, zone!.id, now),
    ]);
    if (!rows[2]!.meta.changes) fail(409, 'operation_in_progress', 'The link host changed while this call ran; read it and retry.');
  } catch (e) {
    if (String(e).includes('UNIQUE')) fail(409, 'invalid_request', `${host} is already a link host.`, { field: 'host' });
    throw e;
  }
  await placeLinkRoute(env, edge, (await linkHostById(db, id))!, p.id);
  await dropReplaced(env, edge, p.id).catch((e: unknown) => console.error('link host route', edge.id, e instanceof Error ? e.message : e));
  return (await linkHostById(db, id))!;
}

const randomCode = () => {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return [...crypto.getRandomValues(new Uint8Array(6))].map((b) => abc[b % abc.length]).join('');
};

/** Add a link on the account's link host (§6); a random 6-character code unless one is chosen. */
export async function addLink(env: Env, p: Principal, edge: EdgeAccount, input: { code?: unknown; url: unknown; rules?: unknown }): Promise<LinkRow> {
  const db = env.DB;
  const host = await liveLinkHost(db, edge.id);
  if (!host) fail(409, 'link_host_required', 'Set the link host of this account first (PUT /v1/accounts/{id}/link-host).');
  if (input.code !== undefined && (typeof input.code !== 'string' || !CODE.test(input.code))) fail(400, 'invalid_request', '"code" must be 3–32 characters of A–Z, a–z, 0–9, "_" and "-".', { field: 'code' });
  const target = targetOf(input.url, 'url', host!.host);
  const { rules } = rulesOf(input.rules, p.plan, host!.host);
  const limit = LIMITS[planOf(p.plan)].links;
  const id = newId();
  const t = `l${[...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(36).padStart(2, '0')).join('')}`;
  for (let attempt = 0; ; attempt++) {
    const code = (input.code as string | undefined) ?? randomCode();
    const now = Date.now();
    try {
      // The limit is part of the batch, so two adds at once cannot both pass it.
      const rows = await db.batch([
        db.prepare("UPDATE edge_accounts SET config_revision = config_revision + 1 WHERE id = ?1 AND (SELECT count(*) FROM links WHERE user_id = ?2 AND state != 'deleted') < ?3").bind(edge.id, p.userId, limit),
        db
          .prepare(
            `INSERT INTO links (id, account_id, user_id, target, code, url, url_host, rules, state, revision, created_at, updated_at)
             SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'active', (SELECT config_revision FROM edge_accounts WHERE id = ?2), ?9, ?9 WHERE changes() = 1`,
          )
          .bind(id, edge.id, p.userId, t, code, target.url, target.host, JSON.stringify(rules), now),
      ]);
      if (!rows[0]!.meta.changes) fail(403, 'limit_reached', `The ${planOf(p.plan)} plan has at most ${limit} links.`, { limit });
      return (await linkById(db, id))!;
    } catch (e) {
      if (!String(e).includes('UNIQUE')) throw e;
      if (input.code !== undefined) fail(409, 'link_exists', `The code ${input.code as string} is already a link of this account.`, { field: 'code' });
      if (attempt >= 4) throw e;
    }
  }
}

/** Change a link's URL or rules; the code stays (printed QR codes carry it). */
export async function patchLink(env: Env, p: Principal, link: LinkRow, input: { url?: unknown; rules?: unknown }): Promise<LinkRow> {
  if (link.state === 'deleted') fail(404, 'not_found', 'No such link.');
  const db = env.DB;
  const host = (await liveLinkHost(db, link.account_id))?.host ?? null;
  const target = input.url === undefined ? { url: link.url, host: link.url_host } : targetOf(input.url, 'url', host);
  const rules = input.rules === undefined ? link.rules : JSON.stringify(rulesOf(input.rules, p.plan, host).rules);
  const [, changed] = await db.batch([
    db.prepare('UPDATE edge_accounts SET config_revision = config_revision + 1 WHERE id = ?').bind(link.account_id),
    db
      .prepare("UPDATE links SET url = ?1, url_host = ?2, rules = ?3, revision = (SELECT config_revision FROM edge_accounts WHERE id = ?4), updated_at = ?5 WHERE id = ?6 AND state != 'deleted' AND updated_at = ?7")
      .bind(target.url, target.host, rules, link.account_id, Date.now(), link.id, link.updated_at),
  ]);
  if (!changed!.meta.changes) fail(409, 'operation_in_progress', 'The link changed while this call ran; read it and retry.');
  return (await linkById(db, link.id))!;
}

/** Remove a link: the worker forgets its code; its row stays (totals) as `deleted`. */
export async function deleteLink(env: Env, link: LinkRow): Promise<LinkRow> {
  if (link.state === 'deleted') return link;
  const db = env.DB;
  await db.batch([
    db.prepare('UPDATE edge_accounts SET config_revision = config_revision + 1 WHERE id = ?').bind(link.account_id),
    db.prepare("UPDATE links SET state = 'deleted', revision = (SELECT config_revision FROM edge_accounts WHERE id = ?1), updated_at = ?2 WHERE id = ?3 AND state != 'deleted'").bind(link.account_id, Date.now(), link.id),
  ]);
  return (await linkById(db, link.id))!;
}

/** The link hosts and links changed in (head, target], as config rows: key, data or null (withdrawn). */
export async function linkConfigRows(db: D1Database, accountId: string, head: number, target: number): Promise<[string, string | null][]> {
  const [hosts, links] = await db.batch([
    db.prepare('SELECT * FROM link_hosts WHERE account_id = ? AND revision > ? AND revision <= ? ORDER BY revision').bind(accountId, head, target),
    db.prepare('SELECT * FROM links WHERE account_id = ? AND revision > ? AND revision <= ? ORDER BY revision').bind(accountId, head, target),
  ]);
  const live = (s: string) => s === 'active' || s === 'route_pending';
  return [
    ...(hosts!.results as unknown as LinkHostRow[]).map((h): [string, string | null] => [linkHostKey(h.host), live(h.state) ? '{}' : null]),
    ...(links!.results as unknown as LinkRow[]).map((l): [string, string | null] => [linkKey(l.code), l.state === 'active' ? JSON.stringify(linkConfigOf(l)) : null]),
  ];
}

/** The per-minute work on link hosts: routes still to make, routes of replaced hosts to delete. */
export async function runLinkHosts(env: Env, now = Date.now()): Promise<number> {
  const db = env.DB;
  const rows = (
    await db
      .prepare("SELECT * FROM link_hosts WHERE (state = 'route_pending' AND updated_at < ?1) OR (state = 'deleted' AND route_id IS NOT NULL AND updated_at < ?1) ORDER BY updated_at LIMIT 20")
      .bind(now - 60_000)
      .all<LinkHostRow>()
  ).results;
  for (const h of rows) {
    const edge = await db.prepare('SELECT * FROM edge_accounts WHERE id = ?').bind(h.account_id).first<EdgeAccount>();
    if (!edge || !inService(edge)) continue;
    const work = h.state === 'deleted' ? dropReplaced(env, edge, 'cron') : placeLinkRoute(env, edge, h, 'cron');
    await work.catch((e: unknown) => console.error('link host', h.id, e instanceof Error ? e.message : e));
  }
  return rows.length;
}

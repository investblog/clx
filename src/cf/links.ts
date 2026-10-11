// Short links and their hosts (docs/spec.md §6, ADR 0024).
//
// A link host is a host in one of the account's zones made a Workers Custom Domain of clx-edge:
// Cloudflare creates its DNS record and certificate, and the whole host is the worker's. An account
// has many — one per site, if wished, under the site's host with a random 3-character label. A link
// is a code on one host → a target URL, with rules by country and device. Hosts and links are config
// like sites: every change issues the account's next revision in the same batch, and the sync
// (src/cf/sites.ts) writes them to the worker as `linkhost:<host>` and `link:<host>/<code>`.
// clx deletes only a custom domain it recorded and that still serves clx-edge (§4 ownership); a
// host with someone's DNS record is refused by Cloudflare and never taken over.
import { CODE, linkHostKey, linkKey, type Device, type LinkConfig } from '../../edge/contract';
import { LIMITS, planOf } from '../limits';
import type { Env, Principal } from '../types';
import { fail, newId } from '../v1/http';
import { cf, CfError, type CallLog } from './api';
import { inService, leased, workingToken, type EdgeAccount } from './connect';
import { validHost, zoneFor, type SiteRow } from './sites';

export interface LinkHostRow {
  id: string;
  account_id: string;
  site_id: string | null;
  host: string;
  zone_id: string;
  /** pending, active, conflict, deleted */
  state: string;
  /** the custom domain clx made: the only one it deletes (§4) */
  domain_id: string | null;
  revision: number;
  error: string | null;
  created_at: number;
  updated_at: number;
}
export interface LinkRow {
  id: string;
  account_id: string;
  host_id: string;
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

const SCRIPT = 'clx-edge';
const MAX_URL = 2048;
const DEVICES: Device[] = ['mobile', 'desktop'];
/** Random labels tried for a site's host before giving up: each taken one is someone's record. */
const LABEL_TRIES = 5;

export function linkHostView(h: LinkHostRow, syncedRevision: number) {
  return {
    id: h.id,
    account_id: h.account_id,
    site_id: h.site_id,
    host: h.host,
    state: h.state,
    config: h.revision <= syncedRevision ? 'synced' : 'pending',
    error: h.error ? JSON.parse(h.error) : null,
    created_at: new Date(h.created_at).toISOString(),
  };
}

export function linkView(l: LinkRow, host: string | null, syncedRevision: number) {
  return {
    id: l.id,
    account_id: l.account_id,
    link_host_id: l.host_id,
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

export const linkHostById = (db: D1Database, id: string) => db.prepare('SELECT * FROM link_hosts WHERE id = ?').bind(id).first<LinkHostRow>();
const linkById = (db: D1Database, id: string) => db.prepare('SELECT * FROM links WHERE id = ?').bind(id).first<LinkRow>();
/** The account's link hosts in use, or still serving while their domain is removed: a link's target
 *  may be none of them (no loops). */
const liveHosts = async (db: D1Database, accountId: string) =>
  (await db.prepare("SELECT host FROM link_hosts WHERE account_id = ? AND (state != 'deleted' OR domain_id IS NOT NULL)").bind(accountId).all<{ host: string }>()).results.map((h) => h.host);

/** A target URL: `https://` only, at most 2048 characters, not on a link host of the account. */
export function targetOf(v: unknown, field: string, linkHosts: string[]): { url: string; host: string } {
  let u: URL | null = null;
  try {
    u = typeof v === 'string' && v.length <= MAX_URL ? new URL(v) : null;
  } catch {
    // refused below
  }
  if (!u || u.protocol !== 'https:' || u.username || u.password || !u.hostname) fail(400, 'invalid_request', `"${field}" must be an https:// URL of at most ${MAX_URL} characters.`, { field });
  const host = u!.hostname.toLowerCase();
  if (linkHosts.includes(host)) fail(400, 'invalid_request', `"${field}" may not point at a link host of this account.`, { field });
  return { url: u!.href, host };
}

/** Rules: up to the plan's limit, each with countries (ISO 3166 alpha-2) and/or devices, and a URL. */
export function rulesOf(v: unknown, plan: string, linkHosts: string[]): { rules: Rule[]; hosts: string[] } {
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
    const target = targetOf(url, `${field}.url`, linkHosts);
    hosts.push(target.host);
    return { ...(countries ? { countries: [...new Set(countries as string[])] } : {}), ...(devices ? { devices: [...new Set(devices as Device[])] } : {}), url: target.url };
  });
  return { rules, hosts };
}

/** A random label of 3 characters `[a-z0-9]` (ADR 0024): 46,656 of them under a site's host. */
const randomLabel = () => [...crypto.getRandomValues(new Uint8Array(3))].map((b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');

/** Whether a host may become a link host of the account: not a site, not a link host (nor one whose
 *  custom domain is still to be removed), and no live link of the account leads to it (no loops). */
async function free(db: D1Database, accountId: string, host: string, except = ''): Promise<boolean> {
  const taken = await db
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM sites WHERE host = ?2 AND state != 'deleted')
         OR EXISTS (SELECT 1 FROM link_hosts WHERE host = ?2 AND (state != 'deleted' OR domain_id IS NOT NULL) AND id != ?3)
         OR ${POINTED('?1', '?2')} AS taken`,
    )
    .bind(accountId, host, except)
    .first<number>('taken');
  return !taken;
}

/** SQL: a live link of the account (parameter `a`) leads to the host (parameter `h`) — by its URL or
 *  a rule's (stored as an href: the host is followed by "/" or ":"). Repeated in each statement that
 *  takes a name, so the check and the write are one. */
const POINTED = (a: string, h: string) =>
  `EXISTS (SELECT 1 FROM links WHERE account_id = ${a} AND state != 'deleted' AND (url_host = ${h} OR instr(rules, '"https://' || ${h} || '/') > 0 OR instr(rules, '"https://' || ${h} || ':') > 0))`;

/** A free random host under `base`, or null after a few draws. */
async function freeRandom(db: D1Database, accountId: string, base: string, except = ''): Promise<string | null> {
  for (let i = 0; i < LABEL_TRIES; i++) {
    const host = `${randomLabel()}.${base}`;
    if (await free(db, accountId, host, except)) return host;
  }
  return null;
}

interface Domain {
  id: string;
  hostname: string;
  service: string;
}
/** Cloudflare's code for a host that already has a DNS record (docs/cloudflare-facts.md). */
const HAS_RECORD = 100117;

/**
 * Make or adopt the host's custom domain and record the outcome. A domain found on the host for
 * clx-edge is adopted (a retry after a crash); one for another worker, or a host with someone's DNS
 * record, is a conflict — for a site's random host, another free label is tried first (the host is
 * not in the worker's config while it is pending, so its name may still change). The host enters
 * the config once active.
 */
async function makeDomain(env: Env, edge: EdgeAccount, h: LinkHostRow, principal: string): Promise<void> {
  const db = env.DB;
  const log: CallLog = { db, edgeAccountId: edge.id, principal };
  const token = await workingToken(env, edge);
  const base = `/accounts/${edge.cf_account_id}/workers/domains`;
  let row = h;
  for (let attempt = 1; ; attempt++) {
    let state = 'pending';
    let domainId: string | null = null;
    let error: Record<string, unknown> | null = null;
    let taken: Record<string, unknown> | null = null;
    try {
      const found = (await cf<Domain[]>(token, 'GET', `${base}?hostname=${encodeURIComponent(row.host)}`, undefined, log)).find((d) => d.hostname === row.host);
      if (found && found.service !== SCRIPT) taken = { code: 'domain_taken', worker: found.service };
      else domainId = (found ?? (await cf<Domain>(token, 'PUT', base, { zone_id: row.zone_id, hostname: row.host, service: SCRIPT, environment: 'production' }, log))).id;
    } catch (e) {
      if (e instanceof CfError && e.status === 409 && e.codes.includes(HAS_RECORD)) taken = { code: 'dns_record_exists', host: row.host };
      // Anything else leaves it pending: the cron tries again.
      else error = { code: e instanceof CfError ? (e.tokenState ?? 'cloudflare_error') : 'internal', ...(e instanceof CfError ? { status: e.status, codes: e.codes } : {}) };
    }
    if (taken && row.site_id && attempt < LABEL_TRIES) {
      // Someone's record or worker is on this name: a site's random host takes another free one.
      const next = await freeRandom(db, row.account_id, row.host.slice(row.host.indexOf('.') + 1), row.id);
      if (next) {
        const moved = await db
          // free() again, in the same statement: a site or a link may have taken the name meanwhile.
          .prepare(`UPDATE link_hosts SET host = ?1, updated_at = ?2 WHERE id = ?3 AND state = 'pending' AND host = ?4 AND NOT EXISTS (SELECT 1 FROM sites WHERE host = ?1 AND state != 'deleted') AND NOT ${POINTED('?5', '?1')}`)
          .bind(next, Date.now(), row.id, row.host, row.account_id)
          .run()
          .catch((e: unknown) => (String(e).includes('UNIQUE') ? null : Promise.reject(e)));
        const now = (await linkHostById(db, row.id))!;
        if (now.state !== 'pending') return;
        if (moved?.meta.changes) row = now;
        continue;
      }
    }
    if (taken) {
      state = 'conflict';
      error = taken;
    } else if (domainId) state = 'active';
    // Active, the host enters the worker's config; a conflict never was in it.
    const [, changed] = await db.batch([
      db.prepare('UPDATE edge_accounts SET config_revision = config_revision + ?2 WHERE id = ?1').bind(row.account_id, state === 'active' ? 1 : 0),
      db
        .prepare(
          "UPDATE link_hosts SET state = ?1, domain_id = ?2, error = ?3, updated_at = ?4, revision = CASE WHEN ?1 = 'active' THEN (SELECT config_revision FROM edge_accounts WHERE id = ?6) ELSE revision END WHERE id = ?5 AND state = 'pending' AND host = ?7",
        )
        .bind(state, domainId, error ? JSON.stringify(error) : null, Date.now(), row.id, row.account_id, row.host),
    ]);
    // Deleted meanwhile: the domain is recorded on the deleted row, which keeps its name taken until
    // the domain is removed (dropDeleted, now or by the cron). No row at all (the account was
    // disconnected while Cloudflare answered): nobody would ever remove it, so it goes now.
    if (!changed!.meta.changes && domainId) {
      const kept = await db.prepare("UPDATE link_hosts SET domain_id = ?1, updated_at = ?2 WHERE id = ?3 AND state = 'deleted' AND domain_id IS NULL").bind(domainId, Date.now(), row.id).run();
      if (kept.meta.changes) await dropDeleted(env, edge, principal);
      else if (!(await linkHostById(db, row.id))) await dropDomain(token, undefined, edge.cf_account_id, domainId, row.host).catch((e: unknown) => console.error('orphan domain', row.host, e instanceof Error ? e.message : e));
    }
    return;
  }
}
/** Delete a custom domain clx made — only while it still serves clx-edge. */
async function dropDomain(token: string, log: CallLog | undefined, cfAccountId: string, id: string, host: string): Promise<'gone' | 'not_ours'> {
  const base = `/accounts/${cfAccountId}/workers/domains`;
  const d = await cf<Domain>(token, 'GET', `${base}/${id}`, undefined, log).catch((e: unknown) => (e instanceof CfError && e.status === 404 ? null : Promise.reject(e)));
  if (!d) return 'gone';
  if (d.service !== SCRIPT || d.hostname !== host) return 'not_ours';
  await cf(token, 'DELETE', `${base}/${id}`, undefined, log).catch((e: unknown) => (e instanceof CfError && e.status === 404 ? null : Promise.reject(e)));
  return 'gone';
}

/** Remove the custom domains of deleted link hosts; a row whose domain is gone keeps no domain_id. */
async function dropDeleted(env: Env, edge: EdgeAccount, principal: string): Promise<void> {
  const rows = (await env.DB.prepare("SELECT * FROM link_hosts WHERE account_id = ? AND state = 'deleted' AND domain_id IS NOT NULL").bind(edge.id).all<LinkHostRow>()).results;
  if (!rows.length) return;
  const token = await workingToken(env, edge);
  const log: CallLog = { db: env.DB, edgeAccountId: edge.id, principal };
  for (const h of rows) {
    const outcome = await dropDomain(token, log, edge.cf_account_id, h.domain_id!, h.host);
    const error = outcome === 'not_ours' ? JSON.stringify({ code: 'domain_not_ours', host: h.host }) : h.error;
    await env.DB.prepare('UPDATE link_hosts SET domain_id = NULL, error = ?, updated_at = ? WHERE id = ? AND domain_id = ?').bind(error, Date.now(), h.id, h.domain_id).run();
  }
}

/**
 * Add a link host (§6): `{site_id}` — a random 3-character label under the site's host (`www.`
 * dropped); `{host}` — a host the user names, in one of the account's zones. Recorded before the
 * first Cloudflare call, then made a custom domain under the account's lease.
 */
export async function addLinkHost(env: Env, p: Principal, edge: EdgeAccount, input: { site?: SiteRow; host?: string }): Promise<LinkHostRow> {
  if (!inService(edge)) fail(409, 'account_not_ready', 'clx-edge is not installed and confirmed in this account yet.', { state: edge.state });
  const db = env.DB;
  let host: string;
  let zoneId: string;
  if (input.site) {
    if (input.site.state === 'deleted') fail(404, 'not_found', 'No such site.', { field: 'site_id' });
    const drawn = await freeRandom(db, edge.id, input.site.host.replace(/^www\./u, ''));
    if (!drawn) fail(409, 'operation_in_progress', 'No free name was drawn for the host; retry.');
    host = drawn!;
    zoneId = input.site.zone_id;
  } else {
    host = input.host ?? '';
    if (!validHost(host)) fail(400, 'invalid_request', '"host" must be a host name such as k7q.example.com.', { field: 'host' });
    // A site's host passes everything outside its counter through to the site; a link host passes
    // nothing. One host cannot be both.
    if (await db.prepare("SELECT 1 FROM sites WHERE host = ? AND state != 'deleted'").bind(host).first()) fail(409, 'invalid_request', `${host} is a site; a link host must be a host of its own.`, { field: 'host' });
    // A rule's URL is stored as its href: the host is followed by "/" or ":" (a port).
    const pointing = await db
      .prepare("SELECT count(*) AS n FROM links WHERE account_id = ?1 AND state != 'deleted' AND (url_host = ?2 OR instr(rules, ?3) > 0 OR instr(rules, ?4) > 0)")
      .bind(edge.id, host, `"https://${host}/`, `"https://${host}:`)
      .first<number>('n');
    if (pointing) fail(409, 'invalid_request', `${pointing} link(s) point at ${host}; a link host cannot be a link's target.`, { field: 'host' });
    const zone = await zoneFor(await workingToken(env, edge), edge.cf_account_id, host);
    if (!zone) fail(400, 'zone_not_found', `No zone of this Cloudflare account holds ${host}.`, { field: 'host' });
    zoneId = zone!.id;
  }
  const limit = LIMITS[planOf(p.plan)].sites;
  const id = newId();
  const now = Date.now();
  try {
    // The limit is part of the batch, so two adds at once cannot both pass it.
    const rows = await db.batch([
      db
        .prepare(
          "UPDATE edge_accounts SET config_revision = config_revision + 1 WHERE id = ?1 AND (SELECT count(*) FROM link_hosts h JOIN edge_accounts e ON e.id = h.account_id WHERE e.user_id = ?2 AND h.state != 'deleted') < ?3",
        )
        .bind(edge.id, p.userId, limit),
      db
        .prepare(
          `INSERT INTO link_hosts (id, account_id, site_id, host, zone_id, state, revision, created_at, updated_at) SELECT ?1, ?2, ?3, ?4, ?5, 'pending', (SELECT config_revision FROM edge_accounts WHERE id = ?2), ?6, ?6 WHERE changes() = 1 AND NOT EXISTS (SELECT 1 FROM sites WHERE host = ?4 AND state != 'deleted') AND NOT ${POINTED('?2', '?4')}`,
        )
        .bind(id, edge.id, input.site?.id ?? null, host, zoneId, now),
    ]);
    if (!rows[0]!.meta.changes) fail(403, 'limit_reached', `The ${planOf(p.plan)} plan has at most ${limit} link hosts.`, { limit });
    if (!rows[1]!.meta.changes) fail(409, 'invalid_request', `${host} became a site, or a link now leads to it; a link host must be a host of its own.`, { field: 'host' });
  } catch (e) {
    if (String(e).includes('UNIQUE')) fail(409, 'invalid_request', `${host} is already a link host.`, { field: 'host' });
    throw e;
  }
  const made = (await linkHostById(db, id))!;
  await leased(db, edge.id, () => makeDomain(env, edge, made, p.id));
  return (await linkHostById(db, id))!;
}

/** Delete a link host: refused while live links are on it; its custom domain goes, and with it its record. */
export async function deleteLinkHost(env: Env, p: Principal, edge: EdgeAccount, h: LinkHostRow): Promise<LinkHostRow> {
  if (h.state === 'deleted') return h;
  const db = env.DB;
  const [, gone] = await db.batch([
    db.prepare("UPDATE edge_accounts SET config_revision = config_revision + 1 WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM links WHERE host_id = ?2 AND state != 'deleted')").bind(edge.id, h.id),
    db.prepare("UPDATE link_hosts SET state = 'deleted', revision = (SELECT config_revision FROM edge_accounts WHERE id = ?1), updated_at = ?2 WHERE id = ?3 AND state != 'deleted' AND changes() = 1").bind(edge.id, Date.now(), h.id),
  ]);
  if (!gone!.meta.changes) {
    const n = await db.prepare("SELECT count(*) AS n FROM links WHERE host_id = ? AND state != 'deleted'").bind(h.id).first<number>('n');
    if (n) fail(409, 'link_host_in_use', `${n} link(s) are on ${h.host}; delete them first.`, { links: n });
  }
  await leased(db, edge.id, () => dropDeleted(env, edge, p.id)).catch((e: unknown) => console.error('link host domain', h.id, e instanceof Error ? e.message : e));
  return (await linkHostById(db, h.id))!;
}

const randomCode = () => {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return [...crypto.getRandomValues(new Uint8Array(6))].map((b) => abc[b % abc.length]).join('');
};

/** Add a link on a link host (§6); a random 6-character code unless one is chosen. */
export async function addLink(env: Env, p: Principal, host: LinkHostRow, input: { code?: unknown; url: unknown; rules?: unknown }): Promise<LinkRow> {
  const db = env.DB;
  if (host.state === 'deleted') fail(404, 'not_found', 'No such link host.', { field: 'link_host_id' });
  // Links go on a working host only: until then its name may still change (makeDomain).
  if (host.state !== 'active') fail(409, 'link_host_not_ready', `${host.host} is ${host.state}; links can be added once it is active.`, { field: 'link_host_id', state: host.state });
  if (input.code !== undefined && (typeof input.code !== 'string' || !CODE.test(input.code))) fail(400, 'invalid_request', '"code" must be 3–32 characters of A–Z, a–z, 0–9, "_" and "-".', { field: 'code' });
  const hosts = await liveHosts(db, host.account_id);
  const target = targetOf(input.url, 'url', hosts);
  const { rules, hosts: ruleHosts } = rulesOf(input.rules, p.plan, hosts);
  // Every host the link leads to: checked again in the write, against hosts made meanwhile.
  const leads = JSON.stringify([target.host, ...ruleHosts]);
  const limit = LIMITS[planOf(p.plan)].links;
  const id = newId();
  const t = `l${[...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(36).padStart(2, '0')).join('')}`;
  for (let attempt = 0; ; attempt++) {
    const code = (input.code as string | undefined) ?? randomCode();
    const now = Date.now();
    try {
      // The limit is part of the batch, so two adds at once cannot both pass it.
      const rows = await db.batch([
        db.prepare("UPDATE edge_accounts SET config_revision = config_revision + 1 WHERE id = ?1 AND (SELECT count(*) FROM links WHERE user_id = ?2 AND state != 'deleted') < ?3").bind(host.account_id, p.userId, limit),
        db
          .prepare(
            `INSERT INTO links (id, account_id, host_id, user_id, target, code, url, url_host, rules, state, revision, created_at, updated_at)
             SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'active', (SELECT config_revision FROM edge_accounts WHERE id = ?2), ?10, ?10 WHERE changes() = 1
               AND EXISTS (SELECT 1 FROM link_hosts WHERE id = ?3 AND state = 'active')
               AND NOT EXISTS (SELECT 1 FROM link_hosts WHERE account_id = ?2 AND host IN (SELECT value FROM json_each(?11)) AND (state != 'deleted' OR domain_id IS NOT NULL))`,
          )
          .bind(id, host.account_id, host.id, p.userId, t, code, target.url, target.host, JSON.stringify(rules), now, leads),
      ]);
      if (!rows[0]!.meta.changes) fail(403, 'limit_reached', `The ${planOf(p.plan)} plan has at most ${limit} links.`, { limit });
      if (!rows[1]!.meta.changes) {
        // The host left meanwhile, or its URL became a link host of the account (no loops).
        if ((await linkHostById(db, host.id))?.state !== 'active') fail(409, 'link_host_not_ready', `${host.host} is no longer active.`, { field: 'link_host_id' });
        fail(400, 'invalid_request', '"url" may not point at a link host of this account.', { field: 'url' });
      }
      return (await linkById(db, id))!;
    } catch (e) {
      if (!String(e).includes('UNIQUE')) throw e;
      if (input.code !== undefined) fail(409, 'link_exists', `The code ${input.code as string} is already a link on ${host.host}.`, { field: 'code' });
      if (attempt >= 4) throw e;
    }
  }
}

/** Change a link's URL or rules; the code and the host stay (printed QR codes carry them). */
export async function patchLink(env: Env, p: Principal, link: LinkRow, input: { url?: unknown; rules?: unknown }): Promise<LinkRow> {
  if (link.state === 'deleted') fail(404, 'not_found', 'No such link.');
  const db = env.DB;
  const hosts = await liveHosts(db, link.account_id);
  const target = input.url === undefined ? { url: link.url, host: link.url_host } : targetOf(input.url, 'url', hosts);
  const checked = input.rules === undefined ? null : rulesOf(input.rules, p.plan, hosts);
  const rules = checked ? JSON.stringify(checked.rules) : link.rules;
  // Every host the link leads to: checked again in the write, against hosts made meanwhile.
  const ruleHosts = checked ? checked.hosts : (JSON.parse(link.rules) as Rule[]).map((r) => new URL(r.url).hostname);
  const leads = JSON.stringify([target.host, ...ruleHosts]);
  const [, changed] = await db.batch([
    db.prepare('UPDATE edge_accounts SET config_revision = config_revision + 1 WHERE id = ?').bind(link.account_id),
    db
      .prepare(
        "UPDATE links SET url = ?1, url_host = ?2, rules = ?3, revision = (SELECT config_revision FROM edge_accounts WHERE id = ?4), updated_at = ?5 WHERE id = ?6 AND state != 'deleted' AND updated_at = ?7 AND NOT EXISTS (SELECT 1 FROM link_hosts WHERE account_id = ?4 AND host IN (SELECT value FROM json_each(?8)) AND (state != 'deleted' OR domain_id IS NOT NULL))",
      )
      .bind(target.url, target.host, rules, link.account_id, Date.now(), link.id, link.updated_at, leads),
  ]);
  if (!changed!.meta.changes) {
    if ((await linkById(db, link.id))?.updated_at !== link.updated_at) fail(409, 'operation_in_progress', 'The link changed while this call ran; read it and retry.');
    fail(400, 'invalid_request', 'The link may not lead to a link host of this account.', { field: 'url' });
  }
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
    db.prepare('SELECT l.*, h.host AS host FROM links l JOIN link_hosts h ON h.id = l.host_id WHERE l.account_id = ? AND l.revision > ? AND l.revision <= ? ORDER BY l.revision').bind(accountId, head, target),
  ]);
  // A host is in the worker's config once active: until then its name may change.
  const live = (s: string) => s === 'active';
  return [
    ...(hosts!.results as unknown as LinkHostRow[]).map((h): [string, string | null] => [linkHostKey(h.host), live(h.state) ? '{}' : null]),
    ...(links!.results as unknown as (LinkRow & { host: string })[]).map((l): [string, string | null] => [linkKey(l.host, l.code), l.state === 'active' ? JSON.stringify(linkConfigOf(l)) : null]),
  ];
}

/** Every custom domain clx recorded for the account's link hosts — for disconnect (§4). */
export async function recordedDomains(db: D1Database, accountId: string): Promise<{ id: string; host: string }[]> {
  return (await db.prepare('SELECT domain_id AS id, host FROM link_hosts WHERE account_id = ? AND domain_id IS NOT NULL').bind(accountId).all<{ id: string; host: string }>()).results;
}
export { dropDomain };

/** The per-minute work on link hosts: domains still to make, domains of deleted hosts to remove. */
export async function runLinkHosts(env: Env, now = Date.now()): Promise<number> {
  const db = env.DB;
  const rows = (
    await db
      // Accounts in service only, before the limit: rows of a revoked account must not take every run.
      .prepare(
        "SELECT h.* FROM link_hosts h JOIN edge_accounts e ON e.id = h.account_id WHERE e.state IN ('ready', 'no_connection') AND ((h.state = 'pending' AND h.updated_at < ?1) OR (h.state = 'deleted' AND h.domain_id IS NOT NULL AND h.updated_at < ?1)) ORDER BY h.updated_at LIMIT 20",
      )
      .bind(now - 60_000)
      .all<LinkHostRow>()
  ).results;
  for (const h of rows) {
    const edge = await db.prepare('SELECT * FROM edge_accounts WHERE id = ?').bind(h.account_id).first<EdgeAccount>();
    if (!edge || !inService(edge)) continue;
    const work = h.state === 'deleted' ? leased(db, edge.id, () => dropDeleted(env, edge, 'cron')) : leased(db, edge.id, () => makeDomain(env, edge, h, 'cron'));
    await work.catch((e: unknown) => console.error('link host', h.id, e instanceof Error ? e.message : e));
  }
  return rows.length;
}

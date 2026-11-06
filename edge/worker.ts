// clx-edge — the worker clx installs into a user's Cloudflare account (docs/spec.md §4, §5). One
// bundle for everyone; a deployment's own settings come in bindings, the sites in the synced config
// (§6). It answers only its own paths — a site's script and collector (an external site's on its
// collector host), and the short links of the
// account's link hosts — and passes every other request through to the origin, so a probe under a
// site's path gets the site's own answer. While
// clx.cx checks a fresh deployment (the every-minute cron) it reports `setup_ok`.
import { botCategory } from './bots';
import { allowedOrigin, bodyHead, click, collect, collectExternal, countryOf, userAgentOf } from './collect';
import { CODE, destinationOf, deviceOf, extKey, linkHostKey, linkKey, SELF_CHECK_CRON, siteKey, WORKING_CRON, type LinkConfig, type LinkRule, type SiteConfig } from './contract';
import { hourly } from './cron';

interface Env {
  DB: D1Database;
  /** https://clx.cx/hook */
  HOOK_URL: string;
  /** the sha256 of this bundle, as clx.cx uploaded it */
  BUNDLE: string;
  /** single-use: names this deployment in its `setup_ok` */
  DEPLOYMENT_ID: string;
  /** the worker key; clx.cx keeps only its SHA-256 */
  EDGE_KEY: string;
}

/** Config by key, for speed only: 60 s in isolate memory (§6). */
const cache = new Map<string, { at: number; value: unknown }>();
const CACHE_MS = 60_000;
/** "None" is kept only briefly: it happens only before a new site's or link's first sync or after a
 *  delete — and kept for 60 s it can hide a fresh one from an isolate that looked before the sync. */
const MISS_MS = 5_000;
/** Keys cached at most: a scan of random link codes must not grow the map without bound. */
const CACHE_KEYS = 5_000;

/** The committed version of one config key, or null — one query, one consistent answer (§6). */
async function configFor<T>(env: Env, key: string): Promise<T | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (hit.value ? CACHE_MS : MISS_MS)) return hit.value as T | null;
  const row = await env.DB.prepare(
    'SELECT c.deleted, c.data FROM cfg c JOIN commits m ON m.revision = c.revision AND m.sync_id = c.sync_id WHERE c.key = ? ORDER BY c.revision DESC LIMIT 1',
  )
    .bind(key)
    .first<{ deleted: number; data: string | null }>();
  const value = row && !row.deleted && row.data ? (JSON.parse(row.data) as T) : null;
  if (cache.size >= CACHE_KEYS) cache.clear();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Where a link sends this visitor: the first rule matching their country, device and bot category
 *  (a browser has none, so a rule with `bots` never takes it), else its URL. */
function destination(link: LinkConfig, request: Request): { url: string; rule?: LinkRule } {
  const country = countryOf(request);
  const ua = userAgentOf(request);
  const device = deviceOf(ua);
  const bot = botCategory(ua);
  const rule = (link.all ?? link.rules).find(
    (r) => (!r.countries || r.countries.includes(country)) && (!r.devices || r.devices.includes(device)) && (!r.bots || (bot !== null && r.bots.includes(bot))),
  );
  return rule ? { url: rule.url, rule } : { url: link.url };
}

/** A site's script or collector at this address, or null when the path is none of its own. An
 *  external site's collector answers CORS: its allowed `Origin` comes back in the answer. */
async function serve(request: Request, url: URL, env: Env, ctx: ExecutionContext, site: SiteConfig, now: number): Promise<Response | null> {
  for (const p of site.paths) {
    if (p.until && now > p.until) continue;
    if (url.pathname === `${p.path}/${p.s}.js` && (request.method === 'GET' || request.method === 'HEAD'))
      // The cache headers of an ordinary static file, nothing of clx (§5).
      return new Response(request.method === 'HEAD' ? null : p.script, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=86400' } });
    if (url.pathname === `${p.path}/${p.c}` && request.method === 'POST') {
      // The body is read before answering; counting goes on after. The answer is the same
      // whether the beacon was counted, dropped or failed — but for an external site's allowed
      // `Origin`, which the browser needs back.
      const body = await bodyHead(request).catch(() => '');
      if (!site.origins) {
        ctx.waitUntil(collect(env.DB, request, body, url.hostname, site, now).catch(() => undefined));
        return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
      }
      const origin = allowedOrigin(request, site);
      if (!origin) return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
      ctx.waitUntil(collectExternal(env.DB, request, body, new URL(origin).hostname, site, now).catch(() => undefined));
      return new Response(null, { status: 204, headers: { 'cache-control': 'no-store', 'access-control-allow-origin': origin } });
    }
  }
  return null;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // Only the user's own routes lead here; the workers.dev address (off by default) would loop.
    if (url.hostname.endsWith('.workers.dev')) return new Response(null, { status: 404 });
    // Unreadable config: behave as if the path were not ours.
    const site = await configFor<SiteConfig>(env, siteKey(url.hostname)).catch(() => null);
    const now = Date.now();
    const own = site && (await serve(request, url, env, ctx, site, now));
    if (own) return own;
    // A link host is the worker's custom domain and has no origin behind it: nothing passes through.
    const linkHost = await configFor<object>(env, linkHostKey(url.hostname)).catch(() => undefined);
    // An external site on this collector host (§5, ADR 0037) — a host known to be no link host
    // (unreadable is not known): by the first two segments of the path, then the first. Its script
    // and collector are a name under its path, so a request of one segment (a link's code) reads
    // nothing more.
    const segments = url.pathname.split('/').slice(1);
    if (linkHost === null)
      for (const path of [segments.length >= 3 ? `/${segments[0]}/${segments[1]}` : null, segments.length >= 2 ? `/${segments[0]}` : null]) {
        if (!path) continue;
        const ext = await configFor<SiteConfig>(env, extKey(url.hostname, path)).catch(() => null);
        const answer = ext && (await serve(request, url, env, ctx, ext, now));
        if (answer) return answer;
      }
    // Unreadable (D1 down, the daily reads used up): what could be a link's address is told to try
    // again later (§8) — passed through, it would get only Cloudflare's error. A site's own requests
    // never look like one: its route is `<host>/<path>/*`, two segments at least.
    if (linkHost === undefined && !site && CODE.test(url.pathname.slice(1)) && (request.method === 'GET' || request.method === 'HEAD'))
      return new Response(null, { status: 503, headers: { 'retry-after': '30' } });
    if (linkHost) {
      const code = url.pathname.slice(1);
      if (!CODE.test(code) || (request.method !== 'GET' && request.method !== 'HEAD')) return new Response(null, { status: 404 });
      const link = await configFor<LinkConfig>(env, linkKey(url.hostname, code)).then(
        (l) => l ?? false,
        () => null,
      );
      // The link cannot be read now (D1 down, the daily reads used up): try again later (§8).
      if (link === null) return new Response(null, { status: 503, headers: { 'retry-after': '30' } });
      if (!link) return new Response(null, { status: 404 });
      // Every click must reach the worker: no-store, and nothing else — no clx header, no body (§6).
      const to = destination(link, request);
      if (request.method === 'GET') ctx.waitUntil(click(env.DB, request, link, url.hostname, destinationOf(to.url, to.rule), now).catch(() => undefined));
      return new Response(null, { status: 302, headers: { location: to.url, 'cache-control': 'no-store' } });
    }
    return fetch(request);
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    if (controller.cron === WORKING_CRON) {
      const r = await hourly(env.DB, controller.scheduledTime, env);
      if (r.errors.length) console.log(`hourly: ${r.errors.join('; ')}`);
      return;
    }
    if (controller.cron !== SELF_CHECK_CRON) return;
    const schema = await env.DB.prepare("SELECT value FROM meta WHERE key = 'schema'")
      .first<number>('value')
      .catch(() => null);
    // A new script's cron fires rarely at first (minutes apart, measured 05.10.2026), so one run
    // keeps asking while clx.cx says "not yet" (503) or fails, every 5 s for up to 50 s. A refusal
    // (401, 409: another deployment) ends the run; the next one tries again.
    for (let attempt = 0; attempt < 10; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 5000));
      const status = await fetch(`${env.HOOK_URL}/setup`, {
        method: 'POST',
        headers: { authorization: `Bearer ${env.EDGE_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ deployment_id: env.DEPLOYMENT_ID, bundle: env.BUNDLE, schema }),
      }).then(
        (res) => res.status,
        () => 0,
      );
      if (status === 200) return;
      console.log(`setup_ok: ${status}`);
      if (status !== 0 && status !== 503 && status < 500) return;
    }
  },
} satisfies ExportedHandler<Env>;

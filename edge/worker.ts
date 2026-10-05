// clx-edge — the worker clx installs into a user's Cloudflare account (docs/spec.md §4, §5). One
// bundle for everyone; a deployment's own settings come in bindings, the sites in the synced config
// (§6). It answers only its own paths — a site's script and collector — and passes every other
// request through to the origin, so a probe under the path gets the site's own answer. While
// clx.cx checks a fresh deployment (the every-minute cron) it reports `setup_ok`.
import { SELF_CHECK_CRON, siteKey, type SiteConfig } from './contract';

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

/** Sites by host, for speed only: 60 s in isolate memory (§6). */
const cache = new Map<string, { at: number; site: SiteConfig | null }>();
const CACHE_MS = 60_000;

/** The committed version of a site's config, or null — one query, one consistent answer (§6). */
async function siteFor(env: Env, host: string): Promise<SiteConfig | null> {
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.site;
  const row = await env.DB.prepare(
    'SELECT c.deleted, c.data FROM cfg c JOIN commits m ON m.revision = c.revision AND m.sync_id = c.sync_id WHERE c.key = ? ORDER BY c.revision DESC LIMIT 1',
  )
    .bind(siteKey(host))
    .first<{ deleted: number; data: string | null }>();
  const site = row && !row.deleted && row.data ? (JSON.parse(row.data) as SiteConfig) : null;
  cache.set(host, { at: Date.now(), site });
  return site;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // Only the user's own routes lead here; the workers.dev address (off by default) would loop.
    if (url.hostname.endsWith('.workers.dev')) return new Response(null, { status: 404 });
    // Unreadable config: behave as if the path were not ours.
    const site = await siteFor(env, url.hostname).catch(() => null);
    const now = Date.now();
    for (const p of site?.paths ?? []) {
      if (p.until && now > p.until) continue;
      if (url.pathname === `${p.path}/${p.s}.js` && (request.method === 'GET' || request.method === 'HEAD'))
        // The cache headers of an ordinary static file, nothing of clx (§5).
        return new Response(request.method === 'HEAD' ? null : p.script, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=86400' } });
      if (url.pathname === `${p.path}/${p.c}` && request.method === 'POST')
        // Counting arrives at stage 4b; the answer is the same whether a view is counted or not.
        return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
    }
    return fetch(request);
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
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

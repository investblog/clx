// clx-edge — the worker clx installs into a user's Cloudflare account (docs/spec.md §4, §5). One
// bundle for everyone; a deployment's own settings come in bindings. Stage 3: every request passes
// through to the origin, and while clx.cx checks a fresh deployment (the every-minute cron) the
// worker reports `setup_ok` to it. The counter, links and pushes arrive at stages 4–5.
import { SELF_CHECK_CRON } from './contract';

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

export default {
  async fetch(request: Request): Promise<Response> {
    // Only the user's own routes lead here; the workers.dev address (off by default) would loop.
    if (new URL(request.url).hostname.endsWith('.workers.dev')) return new Response(null, { status: 404 });
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

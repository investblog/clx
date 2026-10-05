import { Hono } from 'hono';
import { admin } from './admin';
import { auth } from './auth/routes';
import { checkTokens } from './cf/connect';
import { runOperations } from './cf/deploy';
import { hook } from './hook';
import type { Env } from './types';
import { IDEM_TTL } from './v1/idempotency';
import { v1 } from './v1/index';

const CF_CALLS_TTL = 90 * 86_400_000;
/** The minute of the hour the hourly jobs run in. */
const HOURLY_AT = 20;

export const app = new Hono<{ Bindings: Env }>();

// Answers about a session or a user's data are never cached. Without its secrets the Worker refuses
// them: an empty JWT_SECRET would sign tokens anyone could forge, and without MASTER_KEYS no
// working token can be stored or opened.
for (const path of ['/auth/*', '/v1/*', '/admin/*', '/hook/*']) {
  app.use(path, async (c, next) => {
    if (!c.env.JWT_SECRET || (path !== '/auth/*' && !c.env.MASTER_KEYS)) {
      const error = path === '/auth/*' ? 'not_configured' : { code: 'not_configured', message: 'The service is not configured.' };
      return c.json({ error }, 503, { 'cache-control': 'no-store' });
    }
    await next();
    c.header('cache-control', 'no-store');
  });
}
app.route('/auth', auth);
app.route('/v1', v1);
app.route('/admin', admin);
app.route('/hook', hook);

export default {
  fetch: app.fetch,
  // Every minute: install and update operations — resumed if stalled, ended if the worker's
  // setup_ok is overdue (§4). Hourly: a slice of the token check (§3 item 6), lost connects, and
  // expired idempotency records (§15) and API call log rows (90 days, §13 item 1).
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        const now = Date.now();
        const ops = await runOperations(env, now);
        if (ops) console.log(`operations run ${ops}`);
        if (new Date(event.scheduledTime).getUTCMinutes() !== HOURLY_AT) return;
        await env.DB.batch([
          env.DB.prepare('DELETE FROM idempotency WHERE created_at < ?').bind(now - IDEM_TTL),
          env.DB.prepare('DELETE FROM cf_calls WHERE at < ?').bind(now - CF_CALLS_TTL),
        ]);
        const r = await checkTokens(env, now);
        console.log(`tokens checked ${r.checked}, revoked ${r.revoked}, connects lost ${r.lost}`);
      })(),
    );
  },
} satisfies ExportedHandler<Env>;

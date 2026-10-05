import { Hono } from 'hono';
import { auth } from './auth/routes';
import { checkTokens } from './cf/connect';
import type { Env } from './types';
import { IDEM_TTL } from './v1/idempotency';
import { v1 } from './v1/index';

const CF_CALLS_TTL = 90 * 86_400_000;

export const app = new Hono<{ Bindings: Env }>();

// Answers about a session or a user's data are never cached. Without its secrets the Worker refuses
// them: an empty JWT_SECRET would sign tokens anyone could forge, and without MASTER_KEYS no
// working token can be stored.
for (const path of ['/auth/*', '/v1/*']) {
  app.use(path, async (c, next) => {
    if (!c.env.JWT_SECRET || (path === '/v1/*' && !c.env.MASTER_KEYS)) {
      const error = path === '/v1/*' ? { code: 'not_configured', message: 'The service is not configured.' } : 'not_configured';
      return c.json({ error }, 503, { 'cache-control': 'no-store' });
    }
    await next();
    c.header('cache-control', 'no-store');
  });
}
app.route('/auth', auth);
app.route('/v1', v1);

export default {
  fetch: app.fetch,
  // Hourly: a slice of the token check (§3 item 6), lost connects, and expired idempotency
  // records (§15) and API call log rows (90 days, §13 item 1).
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        const now = Date.now();
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

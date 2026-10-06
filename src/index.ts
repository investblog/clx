import { Hono } from 'hono';
import { admin } from './admin';
import { runAdvice } from './advice';
import { auth } from './auth/routes';
import { checkTokens } from './cf/connect';
import { runOperations } from './cf/deploy';
import { runSites } from './cf/sites';
import { hook } from './hook';
import type { Env } from './types';
import { IDEM_TTL } from './v1/idempotency';
import { v1 } from './v1/index';

const CF_CALLS_TTL = 90 * 86_400_000;
const HOURLY_HOURS = 48;
const DAILY_DAYS = 400;
const DEPARTED_TTL = 30 * 86_400_000;
/** Silence after which a worker is "no connection" (§4). */
const SILENCE = 26 * 3_600_000;
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
  // setup_ok is overdue (§4). Hourly: a slice of the token check (§3 item 6), lost connects,
  // expired idempotency records (§15), API call log rows (90 days, §13 item 1) and totals (§7), and
  // workers gone silent, and a slice of the upgrade advice (§8).
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        const now = Date.now();
        const ops = await runOperations(env, now);
        if (ops) console.log(`operations run ${ops}`);
        const sites = await runSites(env, now);
        if (sites.synced + sites.routes + sites.retired) console.log(`sites: synced ${sites.synced}, routes ${sites.routes}, retired ${sites.retired}`);
        if (new Date(event.scheduledTime).getUTCMinutes() !== HOURLY_AT) return;
        const hour = Math.floor(now / 3_600_000);
        const day = Math.floor(now / 86_400_000);
        const [, , , , , , , silent] = await env.DB.batch([
          env.DB.prepare('DELETE FROM idempotency WHERE created_at < ?').bind(now - IDEM_TTL),
          env.DB.prepare('DELETE FROM cf_calls WHERE at < ?').bind(now - CF_CALLS_TTL),
          // Totals (§7): hours for the "today" chart, 2 days; days, 400; a disconnected account's, 30 days.
          env.DB.prepare('DELETE FROM hourly WHERE hour < ?').bind(hour - HOURLY_HOURS),
          env.DB.prepare('DELETE FROM daily WHERE day < ?').bind(day - DAILY_DAYS),
          env.DB.prepare('DELETE FROM hourly WHERE account_id IN (SELECT account_id FROM departed WHERE at < ?)').bind(now - DEPARTED_TTL),
          env.DB.prepare('DELETE FROM daily WHERE account_id IN (SELECT account_id FROM departed WHERE at < ?)').bind(now - DEPARTED_TTL),
          env.DB.prepare('DELETE FROM departed WHERE at < ?').bind(now - DEPARTED_TTL),
          // A worker silent for 26 hours: "no connection" (§4), until its next push.
          env.DB.prepare("UPDATE edge_accounts SET state = 'no_connection', updated_at = ?1 WHERE state = 'ready' AND coalesce(last_push_at, installed_at, created_at) < ?2 AND (lease_until IS NULL OR lease_until < ?1)").bind(now, now - SILENCE),
        ]);
        if (silent?.meta.changes) console.log(`no connection: ${silent.meta.changes} accounts`);
        const r = await checkTokens(env, now);
        console.log(`tokens checked ${r.checked}, revoked ${r.revoked}, connects lost ${r.lost}`);
        const a = await runAdvice(env, now);
        if (a.advised) console.log(`advice: ${a.advised} accounts`);
      })(),
    );
  },
} satisfies ExportedHandler<Env>;

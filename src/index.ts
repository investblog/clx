import { Hono } from 'hono';
import { admin } from './admin';
import { runAdvice } from './advice';
import { auth } from './auth/routes';
import { signup } from './auth/signup';
import { checkTokens } from './cf/connect';
import { runOperations } from './cf/deploy';
import { runLinkHosts } from './cf/links';
import { runSites } from './cf/sites';
import { hook } from './hook';
import { appOrigin, sendNotice } from './mail';
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

/** How long before the working token expires the user is asked to renew it (§3 item 6). */
const RENEW_BEFORE = 30 * 86_400_000;

async function mailRenew(env: Env, a: { id: string; user_id: number; cf_account_id: string; cf_account_name: string | null; token_expires_at: number }, now: number): Promise<void> {
  const user = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(a.user_id).first<{ email: string }>();
  if (!user) return;
  const name = a.cf_account_name ?? a.cf_account_id;
  const until = new Date(a.token_expires_at).toLocaleDateString('ru-RU', { timeZone: 'UTC' });
  const sent = await sendNotice(
    env,
    user.email,
    `clx: продлите подключение «${name}»`,
    `Здравствуйте!\n\nТокен, которым clx работает в аккаунте Cloudflare «${name}», действует до ${until}. После этого clx не сможет обновлять воркер, добавлять сайты и ссылки и читать разбивки отчётов.\nЧтобы продлить, создайте новый bootstrap-токен и вставьте его на странице аккаунта: ${appOrigin(env)}/#/accounts/${a.id}\n`,
    now,
  );
  // Marked only once it went: a send that failed is tried again the next hour.
  if (sent) await env.DB.prepare('UPDATE edge_accounts SET renew_mailed_at = ? WHERE id = ?').bind(now, a.id).run();
}

/** The e-mail of §4: a worker silent for 26 hours. */
async function mailSilence(env: Env, a: { id: string; user_id: number; cf_account_id: string; cf_account_name: string | null }, now: number): Promise<void> {
  const user = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(a.user_id).first<{ email: string }>();
  if (!user) return;
  const name = a.cf_account_name ?? a.cf_account_id;
  await sendNotice(
    env,
    user.email,
    `clx: нет связи с воркером в «${name}»`,
    `Здравствуйте!\n\nВоркер clx-edge в аккаунте Cloudflare «${name}» не присылал итоги больше суток. Счётчик и ссылки, скорее всего, работают, но итоги на clx.cx не обновляются.\nЧастые причины: воркер или его база удалены в Cloudflare, отозван токен, не срабатывает его крон.\n\nСостояние аккаунта: ${appOrigin(env)}/#/accounts/${a.id}\n`,
    now,
  );
}

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
app.route('/auth', signup);
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
        const linkHosts = await runLinkHosts(env, now);
        if (linkHosts) console.log(`link hosts: ${linkHosts}`);
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
          env.DB.prepare(
            "UPDATE edge_accounts SET state = 'no_connection', updated_at = ?1 WHERE state = 'ready' AND coalesce(last_push_at, installed_at, created_at) < ?2 AND (lease_until IS NULL OR lease_until < ?1) RETURNING id, user_id, cf_account_id, cf_account_name",
          ).bind(now, now - SILENCE),
        ]);
        if (silent?.meta.changes) console.log(`no connection: ${silent.meta.changes} accounts`);
        // The user hears of it once, when the account goes silent (§4).
        for (const a of (silent?.results ?? []) as { id: string; user_id: number; cf_account_id: string; cf_account_name: string | null }[]) await mailSilence(env, a, now).catch((e: unknown) => console.error('silence mail', a.id, e instanceof Error ? e.message : e));
        // "Renew the connection" 30 days before the working token expires (§3 item 6), once per token.
        const expiring = (
          await env.DB.prepare(
            "SELECT id, user_id, cf_account_id, cf_account_name, token_expires_at FROM edge_accounts WHERE token_expires_at BETWEEN ?1 AND ?1 + ?2 AND (renew_mailed_at IS NULL OR renew_mailed_at < token_expires_at - ?2 - 86400000) AND state NOT IN ('pending', 'bootstrap_lost', 'revoked') LIMIT 100",
          )
            .bind(now, RENEW_BEFORE)
            .all<{ id: string; user_id: number; cf_account_id: string; cf_account_name: string | null; token_expires_at: number }>()
        ).results;
        for (const a of expiring) await mailRenew(env, a, now).catch((e: unknown) => console.error('renew mail', a.id, e instanceof Error ? e.message : e));
        const r = await checkTokens(env, now);
        console.log(`tokens checked ${r.checked}, revoked ${r.revoked}, connects lost ${r.lost}`);
        const a = await runAdvice(env, now);
        if (a.advised) console.log(`advice: ${a.advised} accounts`);
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
